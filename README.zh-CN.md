# Information Gain（中文）

个人美股信息优势与 AI 前沿情报工作台。当前项目从原 PDSA AI 简报扩展为四条主线：

- 实时美股信息获取：源注册表、事件流，以及本机合法直播音频 ASR。
- 美股自动研究：研究队列、证据链 memo 骨架、后续接 deep research 与自省循环。
- AI 前沿：保留 RSS 聚合，并逐步映射到美股标的和市场影响。
- 政治持仓：追踪特朗普与美国行政分支官员 OGE 公开交易披露，作为政策、利益冲突和市场叙事信号。

## 启动

```bash
npm install
npm run dev:all
```

默认端口：

- 前端：<http://localhost:3001/realtime-flow>
- RSS 后端：<http://localhost:3002/api/briefing>

## Information Gain 架构接口

后端新增第一阶段承载层：

- `GET /api/source-registry`：统一源注册表，包含 Bloomberg TV、CNBC、Fox Business、SEC、公司 IR、宏观源、免费媒体和 AI RSS 源。
- `GET /api/events?limit=60`：统一事件流，合并已保存的直播转录事件与 AI RSS 事件。
- `GET /api/events?refresh=1`：刷新 AI RSS 后重建事件流。
- `POST /api/events/transcripts`：写入一段直播 ASR 转录，服务端会生成带来源、时间戳、ticker、主题和证据片段的事件。
- `GET /api/research/queue`：读取研究队列。
- `POST /api/research/queue`：从事件或手动问题创建研究任务，自动生成证据链 memo 骨架和自省问题。
- `GET /api/serenity/research-system`：读取 Serenity 方法论系统，合并本地 X archive、固定 thesis cards、手动候选卡和证据片段。
- `POST /api/serenity/company-analysis/mock`：工作流 A 的 mock 接口。输入一个 ticker，返回“股票 -> 产业链位置 -> 上下游 -> 财务传导 -> 定价缺口 -> Red Team”的分析契约；不写入正式 Research Run。
- `GET /api/serenity/domain-research`：读取模块二定时领域研究 watchlist、默认领域拆解和最近 scheduler 状态。
- `POST /api/serenity/domain-research/run`：按 Serenity 框架生成一批领域 Research Run seed 和研究队列任务；支持 `?dryRun=1` 预览，不依赖 Bloomberg/CNBC/Fox ASR。
- `POST /api/serenity/thesis-cards`：保存一张自定义 Serenity thesis card，字段按“需求源 -> 依赖链 -> 瓶颈 -> 上市载体 -> 财务转译 -> 反证”组织。
- `POST /api/serenity/thesis-cards/:id/research`：把某张 Serenity thesis card 转入现有研究队列。
- `GET /api/serenity/discovery-runs`：读取新市场 discovery runs，包含搜索账本、推理账本、候选市场、候选标的、淘汰理由和下一轮 24-72h 队列。
- `POST /api/serenity/discovery-runs`：写入一轮新的市场发现过程，供后续 review 和沉淀。
- `GET /api/official-holdings`：读取特朗普与美国行政分支官员公开交易披露聚合数据，当前以 Open Cabinet JSON 为结构化源。
- `GET /api/official-holdings/sources`：读取政治持仓分支的数据源，包括 Open Cabinet、Trump Tracker、TrumpTrades 和 OGE 官方门户。
- `GET /api/official-holdings/documents/:slug`：读取某个官员在 Open Cabinet 页面列出的 OGE PDF，例如 `/api/official-holdings/documents/trump-donald-j`。

示例：写入一段直播转录事件：

```bash
curl -X POST http://localhost:3002/api/events/transcripts \
  -H "Content-Type: application/json" \
  -d '{
    "sourceId": "bloomberg-tv",
    "timestamp": "2026-06-01T13:42:00Z",
    "transcript": "NVIDIA and AMD are being discussed as investors focus on hyperscaler AI capex and data center demand."
  }'
```

示例：创建研究任务：

```bash
curl -X POST http://localhost:3002/api/research/queue \
  -H "Content-Type: application/json" \
  -d '{
    "question": "NVDA / AI capex：市场是否低估 hyperscaler 资本开支持续性？",
    "tickers": "NVDA, MSFT, GOOG, AMZN, AMD, AVGO"
  }'
```

## Serenity 持续研究线

`/serenity-research` 页面把 Serenity/Aleabitoreddit archive 转成可持续研究系统：

- 线性方法论：顶层需求、技术路线、BOM 依赖、供应商数量、上市载体、财务重写、市场误分类、反方验证、催化跟踪。
- 新市场 discovery runs：每轮保留搜索账本、推理账本、候选市场、候选标的、淘汰项和下一轮 24-72h research 队列。
- 固定 thesis cards：AXTI、SIVE、AAOI、LITE/COHR、RPI、NBIS、推理内存/存储、电力/电网等线条。
- 自动证据：从本地 archive 的 `symbols`、中英文本、互动数和 URL 里匹配证据片段。
- 研究队列联动：每张卡可以一键进入 `/research-queue`，后续按一手文件和反证条件继续研究。
- Codex skill：流程已沉淀为 `~/.codex/skills/serenity-market-discovery`，当前按 Protocol V2 执行后续新市场发现任务。

### A/B 双入口

系统现在明确区分两个入口：

- 工作流 A：股票出发。输入一个 ticker，分析公司在多个产业链中的位置、上下游关系、瓶颈暴露、业务纯度、财务传导、市场定价和证伪条件。当前只提供 mock 接口，不持久化结论。
- 工作流 B：产业链出发。输入一个产业链或长期跟踪领域，先拆顶层需求、技术路线、供应链层级和潜在上市载体，再通过后续证据收集判断是否存在值得继续研究的公司。

工作流 A mock 示例：

```bash
curl -X POST http://localhost:3002/api/serenity/company-analysis/mock \
  -H "Content-Type: application/json" \
  -d '{"ticker":"NVDA","companyName":"NVIDIA"}'
```

工作流 B 示例：只跑 AI 产业链，不引用 Serenity archive：

```bash
curl -X POST http://localhost:3002/api/serenity/domain-research/run \
  -H "Content-Type: application/json" \
  -d '{"domainIds":["ai-industry-chain"]}'
```

### 模块二定时领域研究

模块二不再等待模块一直播 ASR 完成后才启动。Bloomberg TV、CNBC、Fox Business 是未来的实时 discovery source，但自动研究系统可以先从长期跟踪领域和股票 watchlist 出发，定时生成 Serenity Research Run seed。

当前 seed 领域包括：

- AI industry chain
- AI rack power and thermal architecture
- AI photonics, CPO and external light sources
- Advanced packaging materials and package-level power integrity
- Inference memory, storage and controller bottlenecks
- Physical AI, robotics components and edge hardware

一次 seed 会做三件事：

- 写入一个未关闭的 Serenity discovery run，状态为 `market_discovery`。
- 把领域拆成顶层需求、技术路线、替代路线、三层依赖、潜在上市载体、未知项和证伪条件。
- 写入 4 条 research queue 任务：需求 anchor、技术/依赖拆解、供应商与上市载体筛选、定价缺口与 Red Team。

重要边界：

- Seed 不是完整 Research Run，不能声称已完成 Core Evidence、供应商数量验证或定价缺口验证。
- 所有公司只标记为 `discovered`，不得自动升级为候选。
- `closed_no_candidate` 仍是合法结果；框架稳定性优先于强行找股票。

预览一次：

```bash
npm run serenity:domains:dry-run
```

实际写入一次，要求后端已运行：

```bash
npm run serenity:domains:once
```

只跑一个领域：

```bash
node scripts/serenity-domain-scheduler.js --domain ai-photonics-cpo
```

持续 watch 模式适合本地验证；生产 7x24 更建议用 cron、launchd、CI 或外部调度器定时调用 `npm run serenity:domains:once`：

```bash
SERENITY_DOMAIN_SCHEDULER_INTERVAL_HOURS=24 npm run serenity:domains:watch
```

### Serenity Protocol V2

Discovery run 现已由可执行的 V2 协议约束，而不是只保存展示数据：

- `run_config` 必须记录研究日期、市场数据日期、投资范围、可计算阈值、预算、owner 和版本；不适用阈值必须记录原因和替代标准。
- `run.id` 必须与 `run_config.run_id` 一致；run 状态、候选状态和 thesis 版本必须进入可审计账本，记录原因、相关证据和责任主体。
- 后端会计算供应链 `coverage_sufficient`、Core Evidence 独立来源家族、候选 Fatal Gate、100 分评分、Red Team、定价分析和关闭门槛。
- 每个候选必须显式记录全部九个评分维度；`high_conviction_candidate` 不能仅凭总分升级，Fatal Gate、Challenge Gate 和明确证伪条件优先。
- Research Run 只能通过专用 close endpoint 关闭；关闭时必须同步动态看板、Obsidian 和下一轮研究队列。

新增接口：

- `GET /api/serenity/discovery-runs/:id/validate`：计算 V2 关闭门槛。
- `POST /api/serenity/discovery-runs/:id/status`：记录合法状态变化。
- `POST /api/serenity/discovery-runs/:id/sync/obsidian`：幂等同步当前 run note。
- `POST /api/serenity/discovery-runs/:id/close`：仅在全部关闭条件满足时关闭 run。

完整数据模型和同步规则见 [`docs/serenity-v2.zh-CN.md`](docs/serenity-v2.zh-CN.md)。

## AI 股票雷达覆盖看板

`/ai-stock-radar` 页面参考 BewinQuant 式 AI 股票雷达结构，当前用于覆盖审计，而不是实时交易：

- Core Research 30：大盘 anchor、算力、云、光通信、电力、EDA、应用等基准标的。
- AI 子板块热力图：20 个子板块按“已覆盖 / 部分覆盖 / 遗漏”标记。
- Coverage Gap：把截图看板里的板块和当前 Serenity discovery 信息做差异检查。
- Live Research Run：实时展示 research steps、source ledger、challenge ledger、process conclusions 和 close criteria。
- 右侧详情：显示选中 ticker、选中板块、当前已搜集市场和缺口结论。
- 遗漏板块可一键加入 `/research-queue`，后续按 Serenity discovery skill 做 24-72h 深挖。

## Obsidian 同步规则

任何 Information Gain 系统演进、research workflow、source policy、dashboard、skill 或自动化规则的改动，都必须同步更新 Obsidian。

当前 vault：

```text
/Users/chengpeng/Documents/Obsidian Vault
```

本项目相关记录：

- `Projects/Information Gain - Architecture.md`
- `Projects/Information Gain - Research Ops.md`
- `Projects/Information Gain/Serenity Research Runs/YYYY-MM-DD - <run_id>.md`

Serenity run note 默认 frontmatter 包含 `run_id`、`run_mode`、`status`、`research_date`、`market_data_as_of`、`protocol_version` 和 `last_synced_at`。同步只覆盖 `run_id` 相同的文件；冲突或写入失败会记录为 sync failure，并阻止 Research Run 关闭。

默认 archive 路径是：

```bash
SERENITY_ARCHIVE_FILE="/Users/chengpeng/Downloads/serenity_2026-06-01.json"
```

自定义候选卡会保存到 `data/serenity-thesis-cards.json`。

## 本机合法直播音频 → ASR 事件流

正式的安装、权限、BlackHole/Multi-Output 路由、Bloomberg/CNBC 配置、日常启动、停止、故障恢复和验收命令以根目录 [`README.md`](README.md#本机合法直播音频--asr-事件流) 为唯一操作手册。链路只处理用户在 Chrome 中已经合法播放、并主动路由到本机虚拟音频输入的声音；绝不登录网站、读取 cookie、下载/提取视频或绕过 DRM。

不要把 AVFoundation 设备索引写死到命令或文档中。运行 `npm run asr:preflight` 后，系统会按 `config/asr-sources.json` 中的设备名解析当前索引，并验证该设备是 loopback 输入。默认 ASR 是百炼 `fun-asr-realtime`：仅在 Git 忽略的 `.env` 中设置 `DASHSCOPE_API_KEY`，不会安装或调用本地 Whisper。默认运行 Bloomberg；CNBC 需要用户合法登录并使用独立 loopback，或与 Bloomberg 分时使用同一个 BlackHole 设备。

```bash
npm run asr:preflight
npm run capture:bloomberg
npm run asr:bloomberg
# 或监督所有已启用且设备不冲突的来源
npm run asr:stack
```

离线回归（不需要账号、麦克风、音频或模型）使用：

```bash
npm run test:asr
```

## OGE 原始文件验证链

政治持仓分支现在会从 Open Cabinet official profile 抓取 OGE 原始 PDF 链接，并挂到交易的 `verificationChain`：

- `openCabinetOfficialUrl`：Open Cabinet 官员页面。
- `ogePortalUrl`：OGE 官方披露门户。
- `sourceDocuments`：候选 OGE PDF，优先 278-T 文件。
- `verificationNote`：提醒必须用 OGE PDF 交叉验证。

## AI 简报 RSS 后端

后端位于 `server/index.js`，提供：

- `GET /api/briefing?limit=24`：聚合 RSS、去重、分类、打标签，并返回简报条目与 PDSA 结论层。
- `GET /api/briefing?refresh=1`：跳过缓存强制刷新。
- `GET /api/briefing/export.md?limit=24`：导出包含 PDSA 结论、前线话术、客户角度和风险提醒的 Markdown 简报。
- `GET /api/sources`：查看当前 RSS 源列表。
- `GET /api/health`：健康检查。
- `GET /api/subscriptions`：查看已保存订阅。
- `POST /api/subscriptions`：保存个性化订阅。
- `GET /api/voc/projects`：查看 VOC 项目列表。
- `POST /api/voc/projects`：保存一次 VOC 分析。
- `DELETE /api/voc/projects/:id`：删除 VOC 项目。
- `GET /api/voc/projects/:id/export.md`：导出 VOC Markdown 报告。
- `POST /api/push/dingtalk?limit=8&refresh=1`：可选，生成 AI 简报并推送到钉钉机器人。

### PDSA 结论层

AI 简报接口会在 `insights` 字段中输出：

- `headline`：今日判断。
- `topSignals`：最值得 PDSA 优先阅读和转述的信号。
- `talkTracks`：前线客户沟通话术。
- `customerAngles`：客户场景切入角度。
- `riskFlags`：来源、合规、可用性等风险提醒。

## 访问保护与数据

可通过环境变量启用 HTTP Basic Auth：

```bash
APP_USERNAME="pdsa"
APP_PASSWORD="replace-with-a-strong-password"
```

订阅和 VOC 项目默认保存到 `data/`，生产环境建议指定：

```bash
DATA_DIR="/var/lib/pdsa-ai-workbench"
```

### VOC 大模型分析

VOC 默认使用本地规则分析，配置 OpenAI-compatible 接口后会自动优先走大模型分析，失败时退回规则分析：

```bash
LLM_API_KEY="sk-or-dashscope-key"
LLM_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
LLM_MODEL="qwen-plus"
LLM_TIMEOUT_MS=30000
```

返回结果中的 `analysis.analysisMethod` 会标明 `llm` 或 `rules`，前端和 Markdown 导出都会展示分析方式。

### 数据备份

生产环境可安装 `scripts/backup-data.sh` 为 systemd timer。脚本默认备份：

- 数据目录：`/var/lib/pdsa-ai-workbench`
- 备份目录：`/var/backups/pdsa-ai-workbench`
- 保留天数：14 天

手动执行示例：

```bash
DATA_DIR="/var/lib/pdsa-ai-workbench" \
BACKUP_DIR="/var/backups/pdsa-ai-workbench" \
BACKUP_KEEP_DAYS=14 \
scripts/backup-data.sh
```

### HTTPS 与域名

当前公网 IP 访问可直接使用 `http://<server-ip>:3002/about-ai`。如需 HTTPS，需要先准备一个真实域名并将 A 记录指向服务器公网 IP，然后在服务器上执行：

```bash
DOMAIN="ai.example.com" EMAIL="you@example.com" scripts/setup-https.sh
```

脚本会为该域名单独创建 nginx server block，并通过 certbot 申请证书，不会覆盖其他 nginx 站点配置。

### 钉钉推送配置

通过环境变量配置钉钉自定义机器人：

```bash
DINGTALK_WEBHOOK="https://oapi.dingtalk.com/robot/send?access_token=..."
DINGTALK_SECRET="SEC..." # 如果机器人启用了加签，则填写；未启用可留空
PUSH_TRIGGER_TOKEN="..." # 可选；配置后调用推送接口必须带 x-push-token 请求头
DINGTALK_BRIEFING_LIMIT=8
```

触发一次推送：

```bash
curl -X POST -H "x-push-token: $PUSH_TRIGGER_TOKEN" \
  "http://127.0.0.1:3002/api/push/dingtalk?limit=8&refresh=1"
```

当前默认 RSS 源：

- OpenAI News
- Google AI Blog
- Google Research Blog
- AWS Machine Learning Blog
- NVIDIA Blog
- NVIDIA Developer Blog
- Hugging Face Blog
- Qwen Blog
- 量子位
- arXiv cs.AI
- arXiv cs.CL
- BAIR Blog
- The Gradient
- TechCrunch AI
- VentureBeat AI
- Simon Willison
- Latent Space
- Import AI
- InfoQ 中文
- 36氪
- 钛媒体

AI 简报没有本地 mock 兜底。RSS 后端不可用或没有匹配条目时，前端会显示错误或空态。

缓存时间默认 10 分钟，可用 `RSS_CACHE_TTL_MS` 调整。每个源默认取 8 条，可用 `RSS_ITEMS_PER_SOURCE` 调整。RSS 拉取默认并发 6 个源，可用 `RSS_FETCH_CONCURRENCY` 调整。
