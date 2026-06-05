# Serenity 持续市场发现协议 V2

本文档描述 Information Gain 后端已经实现的可执行 V2 协议。它是研究治理系统，不是交易建议引擎。

## 范围

V2 层适用于 Serenity Research Run：

- Run 配置与状态管理。
- 搜索、证据、推理、Challenge 和状态迁移账本。
- 候选状态与 thesis 版本账本。
- 供应链覆盖检查。
- 候选 Fatal Gate 与 100 分评分。
- 市场定价缺口检查。
- 关闭门槛验证。
- 动态看板与 Obsidian 同步。
- 下一轮研究队列持久化。

## Research Run API

| Method | Path | 用途 |
| --- | --- | --- |
| `GET` | `/api/serenity/discovery-runs` | 列出标准化后的 runs，并附带计算出的 V2 验证结果。 |
| `POST` | `/api/serenity/discovery-runs` | 创建或更新一个未关闭的 run。要求提供完整 `run_config`。 |
| `GET` | `/api/serenity/discovery-runs/:id/validate` | 在不修改数据的情况下重新计算关闭门槛。 |
| `POST` | `/api/serenity/discovery-runs/:id/status` | 带原因、证据和 actor 修改未关闭 run 的状态。 |
| `POST` | `/api/serenity/discovery-runs/:id/sync/obsidian` | 幂等地把当前 run note 写入 Obsidian。 |
| `POST` | `/api/serenity/discovery-runs/:id/close` | 仅当全部 V2 关闭条件通过时关闭 run。 |

已关闭状态不能通过通用创建/更新 endpoint 写入。

## 必填 Run 配置

每个 Research Run 都必须包含 `run_config`：

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

市值、流动性、分析师覆盖、收入暴露和供应商数量阈值必须是数字。如果某个行业特定阈值不适用，应留空该字段，并在 `threshold_exceptions` 中同时记录 `reason` 和 `alternative_criteria`。

## 状态机

允许的状态：

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

`run.id` 必须与 `run_config.run_id` 一致。未知 run 状态和候选状态会被拒绝，而不是被静默标准化。每次状态变化都要求提供：

```json
{
  "status": "supply_chain_mapping",
  "reason": "Top-level demand change is defined.",
  "relatedEvidence": ["evidence-id-or-source"],
  "actor": "research_owner"
}
```

后端会拒绝非法跳转、非法历史迁移记录，以及在进入 `challenge_review` 或 `active_research` 之前直接关闭 run。

## 验证

V2 validator 返回：

- `can_close`
- `coverage_status`
- `metrics`
- `checks`
- `missing`
- `warnings`
- `candidate_results`
- `supply_chain_coverage`

除非全部必填检查通过，否则 run 不能关闭。重要检查包括：

- 配置完整，且 `run_mode` 为 `RESEARCH`。
- 已定义顶层需求、技术路线，并覆盖至少三层依赖。
- 已覆盖客户、供应商、技术和监管四个调查方向。
- 已记录供应商数量依据、产能约束和上市载体筛选。`closed_no_candidate` run 可以用 `listedCarrierScreening` 记录不存在可投资上市载体。
- 已记录搜索账本、证据账本和推理账本。
- 至少三条 Core Evidence、两个独立来源家族，以及至少一个非候选公司来源。
- 公司 IR、SEC/交易所文件、投资者演示和电话会会按作者或机构标准化为同一个公司来源家族，即使该来源不是候选公司本身。
- 至少三条已回答的 Red Team 记录、明确证伪条件和未知项。
- 可审计的 Research Run 状态迁移、候选状态变化和 thesis 版本变化。
- 候选 Fatal Gate 合规。
- Fatal Gate 通过项必须包含可审计的证据依据。
- 每个候选必须显式记录全部九个评分维度。
- 每个存续候选都必须有定价分析，并区分好行业、好公司、好股票和未定价机会。
- 已完成 dashboard sync、Obsidian sync、关闭报告和下一轮研究队列。

## 候选门槛

除非全部 Fatal Gate、全部 Challenge Gate 回答和一个具体证伪条件都存在，否则 `high_conviction_candidate` 会被拒绝。每个 Fatal Gate 通过项都需要证据依据。100 分评分只是比较辅助工具，必须显式记录全部九个维度，且不能覆盖 Fatal Gate 失败。

## Obsidian 同步

默认 vault：

```text
/Users/chengpeng/Documents/Obsidian Vault
```

默认目录：

```text
Projects/Information Gain/Serenity Research Runs
```

文件命名：

```text
YYYY-MM-DD - <run_id>.md
```

Run note 包含 frontmatter 字段：

- `title`
- `run_id`
- `run_mode`
- `status`
- `research_date`
- `market_data_as_of`
- `protocol_version`
- `last_synced_at`
- `tags`

同步是原子化和幂等的。它只会覆盖已有 `run_id` 与当前 run 一致的 note。冲突 note 或写入失败会追加到 run 的 sync-failure ledger。关闭时处理会先同步下一轮队列，再写入已关闭的 Obsidian note，并记录实际失败目标。如果 Obsidian 同步失败，run 不能关闭；关闭时同步失败会在状态机允许时把 run 移动到 `blocked`。

环境变量覆盖：

```bash
OBSIDIAN_VAULT_PATH="/path/to/vault"
SERENITY_OBSIDIAN_DIR="Projects/Information Gain/Serenity Research Runs"
```

## 验证

```bash
npm test
npm run build
```

测试覆盖状态迁移、Fatal Gate enforcement、评分完整性、阈值例外、可审计账本、通过关闭路径、合法 no-candidate 关闭、来源家族独立性和 Obsidian note 生成。
