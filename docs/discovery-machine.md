# Discovery Machine + Review Loop

> Design note for the direction agreed 2026-06-23, updated 2026-07-02 with the
> built 7×24 engine. This is research tooling, not investment advice.

## What this system is (and is not)

The repo's earlier code did the *cheap* part of research — filing memos, state
machines, shape-validation — while an external LLM agent did all the actual
cognition. The system is the analyst's **instrument panel + memory + checklist,
not the analyst.** We are not trying to "reproduce Serenity's returns": its
headline multiple is survivorship + concentration + a 2026 AI bull market, not
the framework. The encodable framework is the cheap part; the edge (judgment,
sizing, temperament) does not transfer.

**7×24 means the night shift is automated, not the decisions.** The machine
proposes; the human disposes. Nothing in this repo places orders or moves
money, and that is a design invariant, not a missing feature.

## The discovery funnel

The funnel narrows a universe to a shortlist of 5–10 with hard disqualifiers
pre-removed, so scarce human judgment goes only to names that survived:

| Stage | Who does it | Where |
| --- | --- | --- |
| ① Quant pre-screen (cap band, ADV, analyst coverage) | **Data** | `server/discovery.js` `screenStage1` |
| ② Bottleneck layer → listed carrier mapping | Human + LLM | not automated, by design |
| ③ Hard-disqualifier screen (runway, dilution, EV/Sales) | **Data** | `server/discovery.js` `screenStage3` |
| ④ Open-question packet (supplier count, pricing gap, purity) | Structure → human | attached to every survivor |
| ⑤ Sizing / trade | Human | never automated |

Two invariants, both tested:

- **unavailable ≠ fail**: missing data never eliminates a name and never
  silently passes one. Missing stage-③ data → open question. Missing stage-①
  identity data (cap/ADV) → explicit `insufficientData` bucket for a human.
- **`no_candidate` is a valid output.** A funnel that always finds a name is
  broken and would push its owner into the survivorship trap.

## The review / calibration loop

Making money is not proof of edge — in a bull market everything works. The loop
answers "did my *cognition* pay, or did beta?":

1. **Immutable decision record** (`server/decision-records.js`): thesis,
   falsifier, confidence, auto-stamped reference + benchmark price; append-only
   with a freeze hash so hindsight edits are detectable.
2. **Benchmark-relative scoring** (`server/decision-scoring.js`): holding-period
   return **minus the committed benchmark** at +3/6/12m. Benchmark is the
   "obvious basket" (default SOXX), never SPY.
3. **Resolutions** (`server/scorecard.js`): a human eventually marks each thesis
   correct/incorrect as an append-only event — never by editing the record.
4. **Scorecard** (`server/scorecard.js`): skill decomposition —
   *discovery* (all flagged names vs benchmark), *selection* (buys vs skips),
   *sizing* (conviction-weighted vs equal-weight) — plus Brier calibration and
   the thesis-correct × stock-paid 2×2 (only `verified_edge` is skill;
   `lucky_beta` is never success).

Calibration is the early, regime-independent signal; **~30 decisions and at
least one drawdown** are needed before returns are conclusive.

## The 7×24 engine

`scripts/research-engine.js` chains everything into one cron-able cycle:

```
fact sheets (SEC EDGAR + stooq)          server/market-data.js
      │  append history                  server/entity-store.js   (L2)
      ▼
discovery per domain                     server/discovery.js      (L1)
      ▼
score open decisions at horizons         server/decision-scoring.js
      ▼  excess ≤ −20% at a matured horizon?
falsifier-review alerts (urgent)
      ▼
daily decision queue (JSON + md)         server/decision-queue.js (L4)
      ▼
Bark push → human judges in minutes
```

- `--dry-run` computes everything, writes and notifies nothing.
- One cycle per invocation; scheduling belongs to launchd/cron
  (`docs/deployment/`).
- Universe: `UNIVERSE_FILE` if set, otherwise `data/universe.json` if present,
  otherwise the six curated Serenity domain maps (mode "A" sourcing — mode "B"
  auto-detection of new bottleneck layers is future work). The Mac mini job
  should set `UNIVERSE_FILE=<repo>/config/auto-research-universe.json` so the
  researched tickers/domains are synchronized through git.
- All I/O is injectable; the full cycle is fixture-tested with zero network.

## Data honesty (the Serenity rule)

Any field without real source data is the sentinel `unavailable` with a
recorded reason — never a fabricated placeholder. This holds at every layer:
fact sheets, decision stamps, scores (`incomplete_prices`), trends (gaps are
not zeros), scorecard legs (sparse data → `unavailable` with a reason).
`segmentPurity` is honestly `unavailable` until a real segment source exists.

## Status & follow-ups

Layer status, every autonomous default chosen (thresholds, benchmark, alert
level, ranking heuristic), and the list of human gates (live-fire validation,
schedule installation, all investment decisions) live in
[PROGRESS.md](PROGRESS.md).
