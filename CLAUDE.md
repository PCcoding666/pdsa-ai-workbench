# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                                # setup
npm run dev:all                            # Vite frontend :3001 + Express API :3002
npm test                                   # node --test — full suite, no network
node --test test/discovery.test.js         # single test file
node scripts/research-engine.js --dry-run  # one engine cycle, no writes/notifications
node scripts/research-engine.js --once     # one real engine cycle (cron/launchd entry)
npm run serenity:domains:dry-run           # preview domain research seeds
npm run build                              # vite build → dist/
```

Tests use `node:test` with fixtures under `test/fixtures/` and temp dirs via env
overrides (`DATA_DIR`, `DECISION_RECORDS_FILE`, `ENTITY_STORE_FILE`,
`DECISION_RESOLUTIONS_FILE`). **Tests must never hit the network** — network
wrappers take an injectable `fetchImpl`; storage/notification take injectable
`io`. Modules resolve file paths from env at import time, so tests set env
first, then `await import('../server/x.js?test=' + Date.now())`.

## Architecture

Two-process design: Vite dev server (`:3001`) proxies `/api` to Express
(`server/index.js`, `:3002`). `src/main.jsx` is a single-file React SPA. The
Express server also carries the Serenity research endpoints (protocol enums,
state machine and scoring in `server/serenity-v2.js`; domain seeds in
`server/serenity-domain-scheduler.js`; workflow-A mock in
`server/serenity-company-analysis.js`).

### The research engine (discovery machine + review loop)

Design doc: `docs/discovery-machine.md`. Status + every autonomous default +
human gates: `docs/PROGRESS.md`. Deployment templates (launchd/cron, never
self-installing): `docs/deployment/`.

Pipeline, one cron-able cycle in `scripts/research-engine.js`
(`runResearchEngine` is pure orchestration over injected I/O):

1. **`server/market-data.js`** — verified fact sheet per ticker from SEC EDGAR
   `companyfacts` + stooq prices (market cap, ADV, EV/Sales, cash runway,
   dilution, 3/6/12m performance). Pure extractors are separated from fetch
   wrappers. `SEC_USER_AGENT` env is required for live EDGAR calls.
2. **`server/entity-store.js`** — append-only fact-sheet snapshot history per
   ticker (JSONL), deduped on (ticker, asOf); `computeEntityTrend` for
   longitudinal fields (dot paths allowed).
3. **`server/discovery.js`** — funnel stages ①③④: quant pre-screen,
   hard-disqualifier screen (pass|flag|fail with provenance), open-question
   packet. Emits ranked shortlist or `no_candidate`. Thresholds live in
   `DISCOVERY_DEFAULTS`, all overridable per call.
4. **`server/decision-records.js`** — append-only decision log with freeze hash
   (`verifyDecisionRecordIntegrity`); prices auto-stamped via injected
   `priceLookup`. There is deliberately no mutator.
5. **`server/decision-scoring.js`** — benchmark-relative excess return at
   +3/6/12m horizons; future horizons `pending`, missing prices
   `incomplete_prices`.
6. **`server/decision-queue.js`** — folds discoveries + matured scores +
   falsifier alerts into the daily human judgment queue (JSON + markdown under
   `data/decision-queue/`).
7. **`server/scorecard.js`** — append-only human resolutions (`thesisCorrect`)
   plus the calibration scorecard: discovery/selection/sizing decomposition,
   Brier score, thesis×paid 2×2, alpha summary.

### Non-negotiable invariants (all enforced by tests)

- **Never fabricate data.** A field without real source data is the sentinel
  `UNAVAILABLE` (exported by `server/market-data.js`) with a reason. Missing
  prices at scoring time → `incomplete_prices`, never a guessed return.
- **unavailable ≠ fail** in discovery: missing data becomes an open question or
  the `insufficientData` bucket — it neither eliminates nor silently passes a
  name.
- **`no_candidate` is a valid funnel output.** Do not "fix" empty shortlists.
- **Decision records and resolutions are append-only.** Corrections are new
  events; frozen fields are hash-protected. Never add an update/edit function.
- **Gate, not automation:** nothing in this repo may place orders, size real
  positions, or touch broker/money APIs. The engine terminates at the decision
  queue.

### Data directory

`data/` is gitignored. Files created by the engine: `entity-snapshots.jsonl`,
`decision-records.jsonl`, `decision-resolutions.jsonl`,
`decision-queue/YYYY-MM-DD.{json,md}`, optional `universe.json`
(`[{ticker, domain, benchmark, analystCoverage?}]`; absent → universe derives
from the six curated domain maps in `server/serenity-domain-scheduler.js`,
benchmark defaults to SOXX).

For the Mac mini auto research job, prefer the git-tracked scope file
`config/auto-research-universe.json` and set
`UNIVERSE_FILE=<repo>/config/auto-research-universe.json` in launchd/cron.
Runtime state stays in ignored `data/`; research scope belongs in git.
