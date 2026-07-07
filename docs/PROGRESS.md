# Engine build progress, defaults chosen, and human gates

> Living log for the 7×24 research engine build (goal set 2026-07-02). Purpose:
> the machine advanced without stopping to ask; every judgment call it made is
> listed here **for human review**. Change a default by editing the config it
> points at — nothing is buried in code without a name.

## Layer status

| Layer | Module | Status | Tests |
| --- | --- | --- | --- |
| L0 data foundation | `server/market-data.js`, `server/decision-records.js`, `server/decision-scoring.js` | ✅ built (rebuilt 2026-07-02 after tree reset) | `test/market-data.test.js`, `test/decision-records.test.js`, `test/decision-scoring.test.js` |
| L1 discovery funnel | `server/discovery.js` | ✅ built | `test/discovery.test.js` |
| L2 entity memory | `server/entity-store.js` | ✅ built | `test/entity-store.test.js` |
| L3 engine (scheduler entry) | `scripts/research-engine.js` | ✅ built | `test/research-engine.test.js` |
| L4 decision gate | `server/decision-queue.js` | ✅ built | `test/decision-queue.test.js` |
| L5 calibration scorecard | `server/scorecard.js` | ✅ built | `test/scorecard.test.js` |
| Deployment templates | `docs/deployment/` | ✅ written (not installed) | n/a |

Note (2026-07-02): the working tree had been reset to commit `71b4b0f` between
sessions — the earlier L0 foundation and the research-ops layer were not on
disk. L0 was rebuilt identically from the prior session's content. The
research-ops layer (queue/memo state machine) was **not** rebuilt: it is not a
dependency of this engine and restoring it is the owner's call.

## Defaults chosen for autonomous progress — review these

| # | Default | Where | Rationale / how to change |
| --- | --- | --- | --- |
| 1 | Market-cap band $100M–$75B | `DISCOVERY_DEFAULTS` in `server/discovery.js` | Matches the serenity domain `run_config` already in the repo. Pass `config` to `runDiscovery` to override. |
| 2 | Min ADV $1M/day | same | Matches serenity `minimum_average_daily_traded_value`. |
| 3 | Max analyst coverage 20 | same | Matches serenity `maximum_analyst_coverage`. Coverage is not derivable from EDGAR/stooq → usually `unavailable` → open question, never a silent pass/fail. |
| 4 | Cash runway: fail < 2q, flag < 6q | same | < 2 quarters = imminent financing risk; 2–6 = financing terms will matter. |
| 5 | Dilution YoY: flag > 5%, fail > 20% | same | Serenity-style small caps often finance via equity; > 20%/yr outruns most theses. |
| 6 | EV/Sales: flag > 6×, fail > 20× | same | Crude "already priced" guard. A hot bottleneck can exceed 6× legitimately — that is why it only *flags*. |
| 7 | Shortlist cap 10; rank = fewer flags → fewer data gaps → smaller market cap → ticker | `rankSurvivors` | Smaller caps ranked first because under-coverage is the funnel's point. |
| 8 | Stage-① identity rule: market cap or ADV `unavailable` → `insufficientData` bucket | `screenStage1` | unavailable ≠ fail AND ≠ silent pass: unverifiable universe membership goes to a human, not the shortlist. |
| 9 | Default benchmark `SOXX` for every universe entry | `DEFAULT_BENCHMARK` in `scripts/research-engine.js` | The "obvious semis basket" counterfactual. Set per-entry `benchmark` in `config/auto-research-universe.json` for the Mac mini job, or in any file passed through `UNIVERSE_FILE`. |
| 10 | Falsifier-review alert at excess return ≤ −20% (worst matured horizon) | `ALERT_EXCESS_RETURN_THRESHOLD` | Free-text falsifiers cannot be auto-evaluated; underperformance vs benchmark is the observable proxy that forces a human re-read of the frozen falsifier. |
| 11 | Every `buy`/`watch` record is monitored forever (no "closed" state yet) | engine step 4 | No position-close concept exists yet; skips are scored but never alert. |
| 12 | Universe source: `UNIVERSE_FILE` if set; otherwise `data/universe.json` if present; otherwise the 6 curated domain maps | `loadUniverse` and deployment env | Mac mini deployment should set `UNIVERSE_FILE=<repo>/config/auto-research-universe.json` so the researched tickers/domains are synchronized through git. |
| 13 | Engine is stateless between cycles; duplicate snapshots deduped on (ticker, asOf) | `entity-store.js` | Idempotent daily runs; no hidden cursor files. |
| 14 | Scorecard headline uses the longest matured horizon (m12 > m6 > m3) | `server/scorecard.js` | Longest horizon is the fairest test of a thesis; earlier horizons still visible in queue items. |
| 15 | Resolutions (`thesisCorrect`) are append-only events; latest wins, history kept | same | Preserves the no-hindsight-edit guarantee while letting judgments update on new facts. |
| 16 | launchd/cron template runs daily 06:15 local | `docs/deployment/` | After US close settles, before morning review. Edit the plist/cron line. |

## Human gates — deliberately NOT automated

1. **L0 live-fire validation**: one real-ticker smoke run of `getFactSheet` /
   `fetchPriceSeries` with a real `SEC_USER_AGENT`. Until done, live-format
   assumptions (companyfacts concepts, stooq CSV) are fixture-verified only.
2. **Installing the schedule**: copying the plist / adding the cron line is a
   human step. Templates never self-install.
3. **Every investment decision**: the engine ends at the decision queue. Stage
   ② (bottleneck→carrier judgment), stage ⑤ (sizing/trading), decision
   records, and `thesisCorrect` resolutions are human inputs. **No order
   placement, no money movement, ever.**
4. **Falsifier semantics**: the machine only proxies falsifiers via
   benchmark-relative drawdown; reading the frozen falsifier text against
   reality is human work.
5. **Restoring the research-ops layer** (queue/memo/Obsidian sync from the
   pre-reset tree): owner's call; not required by this engine.
6. **Analyst-coverage data**: no free source wired; supply per-ticker counts in
   `config/auto-research-universe.json` / `UNIVERSE_FILE` or leave as an open
   question in the funnel.

## What the engine still does not do (honest limits)

- `segmentPurity` is always `unavailable` — companyfacts has no clean segment
  breakdown. A dedicated segment source (10-K segment notes) is future work.
- Discovery sourcing is mode "A" only (curated domains); auto-detecting *new*
  bottleneck layers (mode "B") is not built.
- No supplier-count database; supplier scarcity remains an open judgment
  question on every candidate, by design.
- Scores use daily closes; no intraday anything.
