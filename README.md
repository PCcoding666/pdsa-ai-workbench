# PDSA AI Workbench

面向 PDSA 的 AI 资讯与客户产品 VOC 洞察原型。

## 启动

```bash
npm install
npm run dev:all
```

默认端口：

- 前端：<http://localhost:3001/about-ai>
- RSS 后端：<http://localhost:3002/api/briefing>

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
