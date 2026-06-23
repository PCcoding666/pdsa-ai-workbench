# Information Gain Research Ops Replay - 2026-06-23

> 本文档是 2026-06-23 对历史 `Information Gain 72h Research Ops` 会话重新触发后的可审计资料汇总。它记录的是研究操作系统状态和 memo 证据，不构成投资建议，也不把 `partial_not_candidate_ready` 解释为候选标的升级。

## Replay Scope

- 重新触发范围：11 个历史 `Information Gain 72h Research Ops` 自动化会话。
- 本地工作区：`/Users/chengpeng/Documents/Information-Gain`。
- 审计依据：`data/research-queue.json`、`data/research-memos/`、`data/research-ops-log.jsonl`、Obsidian memo 同步副本。
- 运行边界：AgentGo 仅允许用于正常可访问公开网页和材料提取；不抽取或转移 Chrome cookies，不绕过登录、付费墙、访问控制或反爬机制。

## Queue State

| Metric | Count |
| --- | ---: |
| Total queue items | 50 |
| Queued | 41 |
| Done | 9 |
| In progress | 0 |
| Blocked | 0 |

当前最高优先级下一项：

| ID | Priority | Question | Tickers |
| --- | ---: | --- | --- |
| `rq:8c1ba81fa6d54c7e` | 1 | SIVE follow-up: photonics segment split, liquidity, cash runway, GF/Jabil purchase-order conversion and governance/audit review. | SIVE, GFS |

## Completion Contract Audit

9 个 `done` item 均满足当前 Research Ops 完成 contract：

- 有主研究 loop 判断：`loopVerdict`、`scarcityAssessment`、`candidateMappings` 或 `candidateConclusion`、`demandToTickerGap`、`fatalGateReview`、`pricingGap`、`nextDecisiveEvidence`。
- 有独立 Challenge Agent review。
- Challenge Agent 覆盖 13 层 Serenity 链路：top-level demand、technology route、necessary dependency、bottleneck、supplier landscape、listed carrier、business purity、financial transmission、market expectations、pricing gap、catalyst、risk、falsifier。
- 每个已完成 item 至少记录 3 条 Red Team search。
- 本地 Markdown memo 存在，Obsidian memo 同步成功。

## Completed Research Links

| Queue ID | Verdict | Mapped tickers / carriers | Upgrade decision | Main gap |
| --- | --- | --- | --- | --- |
| `rq:ai-policy-export-control-energy-permits` | `partial_not_candidate_ready` | ETN, GEV, CEG, NVDA, TSM, ASML | No candidate upgrade. Split into export-control transmission and large-load power beneficiary follow-ups. | 政策 chokepoint 已成立，但还没有完成路线、供应商、财务传导、预期和 pricing gap。 |
| `rq:7befc4d8e4146bba` | `candidate_watchlist_not_upgraded` | AAOI | Keep AAOI as watchlist/active follow-up, not high-conviction candidate. | AAOI 有直接 AI optics 暴露，但 backlog 耐久性、客户集中度和毛利转化未过 Fatal Gate。 |
| `rq:f0fe39a80a87b00a` | `closed_no_candidate_for_module_layer; active_research_for_ELS_layer` | LITE, COHR, AVGO/GFS, POET/O-Net/Enablence, AAOI/InnoLight/Eoptolink/Accelink/LIGENT | Reject generic module-scarcity upgrade. Keep ELS/CPO candidates in screening only. | 通用光模块层供应商过多，不是稀缺层；ELS/CPO 仍需客户认证供应商数量和扩产周期证据。 |
| `rq:efd26209adcbaaea` | `partial_not_candidate_ready` | NVDA/AMD, TSM/ASML/AMAT/MU, ANET/VRT/ETN | No candidate upgrade. Treat as demand anchor only. | 只证明 AI 顶层需求持续，尚未进入稀缺层和标的级传导。 |
| `rq:3d2ef9a2f5599134` | `partial_not_candidate_ready` | NVDA/AMD, AVGO/MSFT/GOOG, TSM/ASML/AMAT/MU, ANET/VRT/ETN | No candidate upgrade. Keep as route-map input for downstream bottleneck research. | 已有路线/依赖 map，但缺供应商数量、纯度、财务弹性和 pricing gap。 |
| `rq:94d5a6bf022601bf` | `partial_not_candidate_ready` | LITE/COHR, AAOI, SIVE/POET, AVGO/NVDA | No candidate upgrade. Use as photonics demand anchor. | AI photonics 需求成立，但 CPO/ELS 是否为绑定稀缺层还未证明。 |
| `rq:5ac85f3dbd3426cb` | `partial_not_candidate_ready` | LITE/COHR, AAOI, SIVE/POET, AVGO/NVDA | No candidate upgrade. Use to scope ELS/CPO follow-up tasks. | route map 成立，但路线 dominance、客户认证供应商数量和 ticker-level economics 未完成。 |
| `rq:9be8233b6e66e754` | `partial_not_candidate_ready` | VRT, MOD, ETN/POWL/GEV, NVDA | No candidate upgrade. Use as demand anchor for power/thermal infrastructure. | rack power/thermal 需求成立，但具体稀缺子层和标的级 gap 未识别。 |
| `rq:7d1f11d3cdc81783` | `partial_not_candidate_ready` | VRT/MOD, ETN/POWL, GEV, NVDA | No candidate upgrade. Keep as route-map input. | 已有 power/thermal route map，但缺供应商稀缺性、业务纯度和 pricing gap。 |

## Challenge Agent Takeaways

- 当前系统已经阻止了“需求真实 = 标的升级”的错误闭环。
- 多数 done item 仍是 demand anchor、route map 或 supplier-count 子任务，不应被包装成完整 Serenity closed candidate。
- 真正接近 Serenity 完整链路的方向是：
  - AAOI：已有单标的 follow-up，但仍未过 backlog durability、customer concentration、gross-margin conversion。
  - optical module / ELS / CPO：通用 module layer 被拒绝，ELS/CPO 仍保留 screening。
  - policy / power infrastructure：政策和电力 interconnection 是真实 chokepoint，但尚未完成 ticker-level financial transmission 和 valuation gap。
- 下一轮主 agent 应优先做“候选标的闭环”，而不是继续只证明需求和路线。

## Bark And Obsidian Status

| Channel | Status |
| --- | --- |
| Obsidian memo sync | 21 次 `research_memo_written` 均记录 `obsidian.status = success`。 |
| Bark notification | 19 次 notification 均为 `skipped`，原因是运行环境未配置 `BARK_PUSH_URL` 或 `BARK_SERVER + BARK_KEY`。 |

## Recommended Next Runs

1. `SIVE follow-up`：photonic segment split、liquidity、cash runway、GF/Jabil purchase-order conversion、governance/audit risk。
2. `AAOI follow-up`：1.6T shipment conversion、customer mix、gross margin after capacity ramp、inventory reserve risk。
3. `ELS/CPO supplier count`：只统计客户认证和可规模交付的供应商，排除泛 module 供应商。
4. `Power infrastructure ticker bridge`：VRT、MOD、ETN、POWL、GEV 的 data-center revenue exposure、backlog conversion、margin sensitivity、valuation gap。
5. `Policy-to-financial bridge`：FERC/DOE/BIS 政策变化如何具体传导到 ETN、GEV、CEG、NVDA、TSM、ASML 的收入或风险。

