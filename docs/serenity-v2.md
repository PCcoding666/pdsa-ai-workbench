# Serenity Continuous Market Discovery Protocol V2

This document describes the executable V2 protocol implemented by the Information Gain backend. It is a research governance system, not a trading recommendation engine.

## Scope

The V2 layer applies to Serenity Research Runs:

- Run configuration and state management.
- Search, evidence, reasoning, challenge and transition ledgers.
- Candidate-state and thesis-version ledgers.
- Supply-chain coverage checks.
- Candidate Fatal Gate and 100-point scoring.
- Market pricing-gap checks.
- Close-gate validation.
- Dynamic dashboard and Obsidian synchronization.
- Next-run queue persistence.

## Research Run API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/serenity/discovery-runs` | List normalized runs with computed V2 validation. |
| `POST` | `/api/serenity/discovery-runs` | Create or update an open run. Requires complete `run_config`. |
| `GET` | `/api/serenity/discovery-runs/:id/validate` | Recompute close-gate validation without changing data. |
| `POST` | `/api/serenity/discovery-runs/:id/status` | Change an open-run state with reason, evidence and actor. |
| `POST` | `/api/serenity/discovery-runs/:id/sync/obsidian` | Idempotently write the current run note to Obsidian. |
| `POST` | `/api/serenity/discovery-runs/:id/close` | Close a run only when all V2 close criteria pass. |

Closed states cannot be written through the general create/update endpoint.

## Required Run Configuration

Every Research Run must include `run_config`:

```json
{
  "run_id": "run-2026-06-04-example",
  "run_mode": "RESEARCH",
  "research_date": "2026-06-04",
  "market_data_as_of": "2026-06-04",
  "investment_universe": "US listed equities",
  "included_exchanges": ["NYSE", "Nasdaq"],
  "included_regions": ["United States"],
  "excluded_security_types": ["OTC", "Funds"],
  "market_cap_min": 100000000,
  "market_cap_max": 10000000000,
  "minimum_average_daily_traded_value": 1000000,
  "maximum_analyst_coverage": 10,
  "minimum_revenue_exposure": 0.1,
  "maximum_supplier_count_for_bottleneck": 3,
  "minimum_capacity_expansion_lead_time": "12 months",
  "source_budget": 20,
  "search_budget": 40,
  "research_owner": "owner",
  "system_version": "2.0.0",
  "skill_version": "serenity-market-discovery@1"
}
```

Market-cap, liquidity, analyst-coverage, revenue-exposure and supplier-count thresholds must be numeric. If an industry-specific threshold is not applicable, leave the field empty and record a `threshold_exceptions` entry with both `reason` and `alternative_criteria`.

## State Machine

Allowed states:

```text
queued
market_discovery
supply_chain_mapping
candidate_screening
evidence_collection
pricing_analysis
challenge_review
active_research
closed_no_candidate
closed_candidate_found
blocked
```

`run.id` must match `run_config.run_id`. Unknown run and candidate states are rejected instead of silently normalized. Every state change requires:

```json
{
  "status": "supply_chain_mapping",
  "reason": "Top-level demand change is defined.",
  "relatedEvidence": ["evidence-id-or-source"],
  "actor": "research_owner"
}
```

The backend rejects invalid jumps, invalid historical transition rows, and direct closing before `challenge_review` or `active_research`.

## Validation

The V2 validator returns:

- `can_close`
- `coverage_status`
- `metrics`
- `checks`
- `missing`
- `warnings`
- `candidate_results`
- `supply_chain_coverage`

A run cannot close unless all required checks pass. Important checks include:

- Complete configuration and `RESEARCH` mode.
- Top-level demand, technology routes and at least three dependency levels.
- Customer, supplier, technology and regulatory investigation directions.
- Supplier count basis, capacity constraints and listed-carrier screening. A `closed_no_candidate` run may use `listedCarrierScreening` to record that no investable carrier exists.
- Search ledger, evidence ledger and reasoning ledger.
- Three Core Evidence rows, two independent source families and one non-candidate-company source.
- Company IR, SEC/ exchange filings, presentations and calls are canonicalized by author or institution into one company source family, even when the source is not the candidate company.
- Three answered Red Team rows, explicit falsifiers and unknowns.
- Auditable Research Run state transitions, candidate-state changes and thesis-version changes.
- Candidate Fatal Gate compliance.
- Fatal Gate passes include an auditable evidence basis.
- Every candidate explicitly records all nine score dimensions.
- Every surviving candidate has a pricing analysis that distinguishes good industry, good company, good stock and unpriced opportunity.
- Dashboard sync, Obsidian sync, closure report and next research queue.

## Candidate Gate

`high_conviction_candidate` is rejected unless all Fatal Gates, all Challenge Gate answers and a specific falsifier are present. Every Fatal Gate pass needs an evidence basis. The 100-point score is a comparison aid, must explicitly record all nine dimensions, and cannot override Fatal Gate failures.

## Obsidian Sync

The portable default vault is `data/obsidian` under `DATA_DIR`. Set an explicit actual vault path only when you want to mirror notes there:

```text
/path/to/your/Obsidian Vault
```

Default directory:

```text
Projects/Information Gain/Serenity Research Runs
```

File naming:

```text
YYYY-MM-DD - <run_id>.md
```

Run notes include frontmatter fields:

- `title`
- `run_id`
- `run_mode`
- `status`
- `research_date`
- `market_data_as_of`
- `protocol_version`
- `last_synced_at`
- `tags`

The sync is atomic and idempotent. It overwrites only a note whose existing `run_id` matches the current run. A conflicting note or write failure is appended to the run's sync-failure ledger. Close-time processing synchronizes the next queue before writing the closed Obsidian note, and records the actual failed target. A run cannot close when Obsidian sync fails; close-time sync failure moves the run to `blocked` when the state machine allows it.

Environment overrides:

```bash
OBSIDIAN_VAULT_PATH="/path/to/vault"
SERENITY_OBSIDIAN_DIR="Projects/Information Gain/Serenity Research Runs"
```

## Verification

```bash
npm test
npm run build
```

The tests cover state transitions, Fatal Gate enforcement, score completeness, threshold exceptions, auditable ledgers, a passing close path, legal no-candidate closure, source-family independence and Obsidian note generation.
