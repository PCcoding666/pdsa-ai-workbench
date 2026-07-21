# Information Gain

个人美股信息优势与 AI 前沿情报工作台。当前项目从原 PDSA AI 简报扩展为三条线：

- 实时美股信息获取：源注册表、事件流，以及本机合法直播音频 ASR。
- 美股自动研究：研究队列、证据链 memo 骨架、后续接 deep research 与自省循环。
- AI 前沿：保留 RSS 聚合，并逐步映射到美股标的和市场影响。
- 政治持仓：追踪特朗普与美国行政分支官员 OGE 公开交易披露，作为政策/利益冲突/市场叙事信号。

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
- `POST /api/events/transcripts`：写入一段直播 ASR 转录，服务端会生成带来源、时间戳、ticker、主题、证据片段的事件。
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

完整数据模型和同步规则见 [`docs/serenity-v2.md`](docs/serenity-v2.md)。

## AI Stock Radar Coverage Board

`/ai-stock-radar` 页面参考 BewinQuant 式 AI 股票雷达结构，当前用于覆盖审计而不是实时交易：

- Core Research 30：大盘 anchor、算力、云、光通信、电力、EDA、应用等基准标的。
- AI 子板块热力图：20 个子板块按“已覆盖 / 部分覆盖 / 遗漏”标记。
- Coverage Gap：把截图看板里的板块和当前 Serenity discovery 信息做差异检查。
- Live Research Run：实时展示 research steps、source ledger、challenge ledger、process conclusions 和 close criteria。
- 右侧详情：显示选中 ticker、选中板块、当前已搜集市场和缺口结论。
- 遗漏板块可一键加入 `/research-queue`，后续按 Serenity discovery skill 做 24-72h 深挖。

## Obsidian Sync Rule

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

这条链路只处理**用户已经在本机 Chrome 中合法播放、并主动路由到本地虚拟音频输入的声音**。它不会登录网站、读取 cookie、下载/提取视频、绕过 DRM/付费墙/地区限制，也不会执行交易或资金操作。Bloomberg TV 是默认优先源；CNBC Live TV 在用户已合法登录并完成独立路由后同样支持。

### 从零安装

1. 安装项目依赖并创建本地环境文件。日常命令依赖 Node 的 `--env-file-if-exists`，因此需要 **Node 20.6.0 或更高版本**：

```bash
node --version
npm install
cp .env.example .env
```

2. 配置百炼 FunASR realtime。复制模板后，仅在 Git 忽略的 `.env` 填入你自己的 DashScope API key；默认模型、英文和 5 秒切片已经配置好。它不会安装、下载或调用本地 Whisper：

```bash
chmod 600 .env
# 用编辑器打开 .env，只填写这一项的值，不要提交该文件
DASHSCOPE_API_KEY=
```

运行脚本会把 `.env` 的值按**字面量**读取，不会展开 `~`、`$HOME` 或 `$(...)`。正式适配器通过百炼官方 WebSocket 发送已捕获的 16 kHz 单声道 PCM 音频，stdout 只输出最终英文转录；它不会写入、显示或记录 API key。

3. 安装虚拟音频驱动。优先选择 BlackHole 2ch；若安装命令出现管理员密码或 macOS 扩展批准提示，这是唯一需要人类完成的安装门槛：

```bash
brew install --cask blackhole-2ch
```

若安装器提示重启，先重启 macOS，使新音频驱动被 Core Audio 枚举；之后由 FFmpeg/AVFoundation 重新列出 `BlackHole 2ch`。这不是绕过 macOS 安全策略的步骤。

4. 打开 **Audio MIDI Setup（音频 MIDI 设置）**，点击 `+` → **Create Multi-Output Device**，勾选本机扬声器和 `BlackHole 2ch`。把 Chrome/系统输出切到该 Multi-Output Device；这样你仍能听见声音，同时 BlackHole 成为录音输入。首次实际采集时若 macOS 要求权限，批准终端/Codex 的麦克风（音频输入）权限。

5. 在 `config/asr-sources.json` 中确认 `deviceName` 与 Audio MIDI Setup 显示的名称**逐字一致**。不要手填索引：preflight 会枚举 AVFoundation 设备并把真实索引写进被 Git 忽略的 `audio/asr-runtime.json`。

### 预检与启动

先在一个终端启动 API：

```bash
npm run server
```

另一个终端运行预检：

```bash
npm run asr:preflight
```

如只需要验证百炼凭据与 realtime WebSocket（发送 1 秒静音探针，不发送任何直播内容），运行：

```bash
npm run asr:funasr:check
```

只验证一个来源（包括默认禁用的 CNBC）时可显式选择它：

```bash
npm run asr:preflight -- --source cnbc-live-tv
```

它会明确报告：

1. `ffmpeg`/`ffprobe` 是否可用；
2. 仓库内置的百炼 FunASR realtime 适配器和凭据是否已检测到（不会显示密钥）；
3. 可用 AVFoundation loopback 输入和解析后的索引；
4. 本地 API 的公开健康检查和受保护事件接口是否可达；若启用了 HTTP Basic Auth，会用 `ASR_API_USERNAME`/`ASR_API_PASSWORD`（未设置时回退 `APP_USERNAME`/`APP_PASSWORD`）验证认证是否真正可用；
5. 已配置输入上是否存在非静音信号；
6. 仍需要的唯一人工步骤。

若需要让脚本在未就绪时返回非零状态，使用：

```bash
ASR_PREFLIGHT_STRICT=1 npm run asr:preflight
```

当 Bloomberg 已在 Chrome 中合法播放且 preflight 显示 `READY` 后，可在两个终端分别启动：

```bash
npm run capture:bloomberg
npm run asr:bloomberg
```

或使用监督器一次启动所有已启用且拥有**不同** loopback 输入的来源：

```bash
npm run asr:stack
```

监督器会独立重启单个来源的 capture/worker；一个来源失败不会停止其他来源。若两个来源配置到同一个 BlackHole 索引，监督器会只阻止第二个 capture，避免把两个频道误标成不同来源。

### Bloomberg 与 CNBC 配置

`config/asr-sources.json` 是非敏感、可提交的源配置，包含来源 ID/名称、设备名称、英文、片段秒数、API 地址、重试和去重窗口。默认只启用 `bloomberg-tv`。要启用 CNBC：

1. 先在 Chrome 中**合法登录** CNBC Live TV（本项目不会替你登录或检查账户）；
2. 给 CNBC 配置一个与 Bloomberg 不同的 loopback 输入；
3. 把 `cnbc-live-tv.enabled` 改为 `true`，并把它的 `deviceName` 改为对应输入；
4. 再运行 `npm run asr:preflight` 和 `npm run asr:stack`。

如果只有一个 BlackHole 2ch，单次只运行一个频道：先停止 Bloomberg capture/worker，把 Chrome 输出切到目标频道，再运行：

```bash
npm run capture:cnbc
npm run asr:cnbc
```

### 运行数据、可靠性与排障

每个来源的运行目录都在 Git 忽略的 `audio/<source-id>/` 下：

```text
audio/<source-id>/
  staging/     # ffmpeg 正在写入的 .wav.part；不会被 worker 读取
  incoming/    # 已二次稳定检查并原子 rename 的 WAV
  processed/   # 已转录并成功上报的音频及可选 sidecar（默认保留 7 天）
  failed/      # 达到重试上限的音频、sidecar 与 .error.json（默认保留 30 天）
  logs/        # capture/worker JSONL、health.json、dedupe.json/.jsonl 与诊断状态（轮转）
```

- Capture 先写 `staging/*.wav.part`，确认稳定后原子发布到 `incoming/*.wav`；worker 再做一次稳定检查。每个实际 loopback 设备都有原子锁，因此不能被两个来源同时错误标记；陈旧 PID 锁会自动回收。
- worker 用音频 SHA-256 去重，并对同来源相同文本使用默认 10 分钟窗口去重。API 事件 ID 由来源和音频哈希确定，重试或崩溃恢复只会 upsert 同一事件；去重状态默认保留 30 天、最多各 50,000 条，避免长期无界增长。
- 事件中的 `audioFile` 是形如 `audio/<source-id>/processed/<segment>.wav` 的逻辑片段引用，不是本机绝对路径，也不是下载端点；音频本体不会通过事件 API 暴露。
- ASR 与 API 失败会进行默认 3 次指数退避重试；HTTP 请求默认 20 秒超时。仍失败才进入 `failed/`，原因在同名 `.error.json` 和 JSONL 中。
- FunASR realtime 适配器只在内存中处理 PCM 和最终文本，不会在仓库写入云端中间结果；JSONL 会记录 `processingLatencyMs` 和 `segmentToEventLatencyMs`，health 文件记录最后事件与错误。`Ctrl-C` 会停止 capture/worker/其 ASR 子进程，并保留尚未完成的输入供下次启动恢复。
- 为使服务可以长期运行，成功音频默认保留 7 天、失败隔离默认保留 30 天；每小时清理一次。`capture.jsonl`、`asr-worker.jsonl` 和 `asr-stack.jsonl` 默认每个 10 MiB 轮转、保留 5 个旧文件。可在忽略的 `.env` 以 `ASR_AUDIO_RETENTION_DAYS`、`ASR_FAILED_RETENTION_DAYS`、`ASR_LOG_MAX_BYTES`、`ASR_LOG_MAX_ROTATED_FILES` 调整；把保留天数设为 `0` 即交由外部归档/清理。
- 查看设备而不创建目录：`npm run audio:list`。查看实时健康文件：`cat audio/<source-id>/logs/{capture-health,health}.json`。
- 修复原因后，可把 `failed/` 中原始音频（以及 sidecar 测试文本，如有）移回对应 `incoming/` 让 worker 再次处理；不要移动 `.error.json`。
- 如果 `node --version`、`ffmpeg -version` 或 `ffprobe -version` 本身卡住/被 macOS 拒绝，先修复受信任的运行时安装后再启动链路。不要通过关闭 SIP、绕过 Gatekeeper 或移除系统安全策略解决；preflight 在工具无法执行时会保持 `NOT READY`。

百炼 FunASR realtime 是默认 ASR 后端；它只处理你已经合法播放并主动路由到 BlackHole 的本机系统音频。首次配置前请确认你同意该音频被发送至你的百炼账户。参考 [百炼 Fun-ASR realtime WebSocket 文档](https://help.aliyun.com/zh/model-studio/fun-asr-realtime-websocket-api)。

### 验证、界面与停止

离线自动化验证不需要网络、账号、麦克风或本地模型：

```bash
npm run test:asr
npm test
npm run build
```

端到端事件路径是：`audio segment → worker → POST /api/events/transcripts → GET /api/events → /realtime-flow`。事件 API 会拒绝缺少 `sourceId`、`sourceName`、时间戳、转录、音频窗口/文件、ASR backend 或 worker ID 的请求；所有直播转录始终标记“待交叉验证”。常规 `GET /api/events` 会优先返回已存的直播转录，避免它等待 RSS 刷新或被较新的 RSS 条目挤出页面；`/realtime-flow` 每 8 秒轮询该接口，转录卡会显示 ASR、worker 与音频窗口。

前台运行时使用 `Ctrl-C` 停止 capture、worker 或 stack；停止 API 也使用其终端的 `Ctrl-C`。可选的 launchd 模板在 [`docs/deployment/com.information-gain.asr.plist.example`](docs/deployment/com.information-gain.asr.plist.example)，从不自动安装；安装与卸载命令见 [`docs/deployment/README.md`](docs/deployment/README.md)。

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
