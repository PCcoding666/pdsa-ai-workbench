# Serenity Methodology Gap Review - 2026-06-23

> 本文档审计的是 Information Gain 最新 agent loop 结果与 Serenity / SIVE / AAOI 推理方法论之间的差距。它不是投资建议，也不把任何候选标的升级为高置信结论。

## 结论

当前最新 agent loop 的主要进步是：它已经能阻止“需求真实 = 标的升级”的错误，并会记录 `partial_not_candidate_ready`、Fatal Gate、Challenge Agent review 和缺失层。

但它仍然低于 Serenity 中 SIVE / AAOI 型链路的要求：系统没有强制结构化回答“这个标的现在贵还是便宜”。过去的 `pricingGap` 是自由文本，允许 agent 写“估值未检查”但仍把任务标为 done。这会让输出看起来像标的推荐，却没有完成 good industry / good company / good stock 的分离。

## SIVE / AAOI 方法论基准

SIVE / AAOI 型推理不是从 ticker 出发找故事，而是走完整层级：

1. 顶层需求是否真实且持续。
2. 哪条技术路线吸收新增需求。
3. 这条路线中哪一层是必要依赖。
4. 哪一层是真的稀缺，且替代成本高。
5. 供应商数量是否少，扩产和客户认证是否慢。
6. 哪些上市公司能承载这个稀缺层。
7. 业务纯度和财务弹性是否足够。
8. 订单、backlog、收入、毛利、现金流或估值如何传导。
9. 市场已经 price in 了什么。
10. 当前估值是便宜、合理、昂贵，还是无法判断。
11. 什么 catalyst 能让市场重新定价。
12. 最强 bear case、替代路线和直接 falsifier 是什么。

AAOI 当前被系统降为 `candidate_watchlist_not_upgraded` 是正确的：它有直接 AI optics 暴露，但 backlog 耐久性、客户集中度、gross-margin conversion 和 valuation gap 不足。SIVE/SIVEF 更需要治理、流动性、cash runway、GF/Jabil purchase-order conversion 和审计风险约束。

## 最新结果的主要差距

| 最新 loop 输出 | 与 Serenity / SIVE / AAOI 方法论的差距 |
| --- | --- |
| AI industry chain demand anchor | 只证明需求，没有进入稀缺层和股票估值。 |
| AI photonics demand anchor | 证明 800G/1.6T optics 需求，但未证明 CPO/ELS 是绑定稀缺层。 |
| AI photonics route map | 找到 plausible scarcity layer，但未完成客户认证供应商数量、扩产周期、标的纯度和估值。 |
| AAOI follow-up | 已进入单标的层，但仍缺 backlog 质量、客户集中度、毛利桥和贵/便宜判断。 |
| Optical module supplier count | 成功否定泛 module 稀缺，但 ELS/CPO 仍未完成 ticker economics。 |
| Power/thermal demand and route map | 找到可能稀缺子层，但没有供应商数量、财务传导和估值判断。 |
| Policy/export-control/power lane | 证明政策 chokepoint，但没有把政策节点转成 ranked ticker funnel。 |

## 新的系统修正

Research Ops completion contract 现在增加 `valuationReview`。

只要一个任务写了 `candidateMappings`，done 前必须记录结构化估值 sanity check：

- market cap
- enterprise value
- TTM P/E 或为什么 P/E 不适用
- forward P/E 或替代指标
- P/S、EV/Sales 或行业适用倍数
- 3/6/12 个月价格表现
- 当前估值相对历史区间
- 共识预期变化
- 指引、订单、backlog、margin 或 capacity trend
- `cheap` / `fair` / `expensive` / `unknown_not_analyzed` 结论
- 仍缺什么证据

如果这些字段缺失，runner 和 server 都会拒绝把有候选映射的任务标记为 `done`。

## 对后续 agent loop 的要求

后续 watchlist 和 Serenity 任务必须显式拆分：

- Good industry：行业需求和路线是否真实。
- Good company：公司是否有纯度、财务弹性和可验证传导。
- Good stock：当前价格和估值是否还留下未计价空间。
- No stock conclusion：估值或市场预期没做完时必须明确写这个结论。

这不是把估值做成绝对精确，而是防止系统在没有最基本估值事实时给出貌似有方向的标的结论。

