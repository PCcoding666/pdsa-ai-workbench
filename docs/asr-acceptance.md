# 本机合法直播音频 → Information Gain 事件流验收记录

更新：2026-07-20（Asia/Singapore）

## 验收结果

- **合法浏览器直播端到端：Blocked，尚未宣称通过。** BlackHole 已安装、被 AVFoundation 枚举且 FunASR realtime/事件 API 已实测，但 Chrome 的系统输出尚未路由到 Multi-Output Device，因而没有采集任何 Bloomberg 或 CNBC 的真实直播内容。
- **FunASR realtime → worker → 事件 API → 普通实时事件接口：Confirmed（合成英文 WAV）。** 该验证只使用本机 `say` 生成的短英文音频，不含网站、cookie、账号、视频流或真实直播内容。
- **当前唯一人工门槛：在 Audio MIDI Setup 创建并选中 `MacBook Pro Speakers + BlackHole 2ch` 的 Multi-Output Device，然后在 Chrome 合法播放 Bloomberg TV。** 该操作完成后，系统可立即继续实际 smoke test；不需要再次重启或安装本地 Whisper。

## Confirmed

| 项目 | 实测证据 |
| --- | --- |
| Node 运行时 | Node `v23.10.0`；项目声明最低支持 Node `20.6.0`。 |
| FFmpeg / ffprobe | Homebrew FFmpeg `8.0.1` 与 ffprobe `8.0.1` 均退出 `0`。 |
| AVFoundation / BlackHole | 音频设备枚举得到 `[0] BlackHole 2ch`；从 `:0` 捕获 1 秒成功。系统 profiler 显示为 48 kHz、2 输入 / 2 输出虚拟设备。 |
| FunASR realtime 认证 | 首方 WebSocket adapter 用 1 秒静音探针成功连接百炼；密钥未写入仓库、日志或本文档。 |
| 云端英文转录 | 4.745125 秒的本机合成英文 WAV 被 `fun-asr-realtime` 转录为：`Nvidia shares rose after the company reported strong artificial intelligence demand.` |
| 云端 → 事件 API 实机闭环 | worker `real-cloud-trace` 将同一合成 WAV 写入本机 Express API；事件 ID 为 `transcript:bloomberg-tv:e759952dc349ce001c85e8764a9e096a`，`sourceId=bloomberg-tv`，`asrBackend=funasr-realtime`，`needsVerification=true`。 |
| 普通实时事件读取 | 上述事件通过普通 `GET /api/events?limit=60` 返回，读取耗时 **25 ms**；不是只通过 `stored=1` 测试端点读取。 |
| 事件完整性 | `/api/events/transcripts` 现在强制 `sourceId`、`sourceName`、`timestamp`、`transcript`、`audioWindow`、`audioFile`、`asrBackend`、`workerId`；缺任何字段返回 `400`。 |
| 前端链路 | production build 已生成；`/realtime-flow` 由普通 `/api/events` 轮询。后端优先返回已存 `live_tv` 转录，不会等待 RSS 刷新。离线集成测试覆盖该读取路径。 |

## 当前预检

本次预检在临时本机 API 和有效的百炼凭据下执行，耗时 **4.467 s**：

| 检查 | 结果 |
| --- | --- |
| ffmpeg / ffprobe | Confirmed |
| FunASR realtime remote | Confirmed（reachable） |
| 解析的 loopback | Confirmed：`BlackHole 2ch`，索引 `0` |
| 本机 API | Confirmed：健康检查与事件接口 HTTP 200 |
| 当前音频信号 | Blocked：`mean=-91.0 dB`、`max=-91.0 dB`，无播放信号 |
| preflight 总体 | `NOT READY`，原因仅为非静音信号尚未出现 |

预检现在会在这一状态明确提示：先确认 Multi-Output Device（扬声器 + BlackHole），随后再在 Chrome 合法播放目标频道。

## 延迟与事件证据

| 阶段 | 结果 |
| --- | --- |
| 合成 WAV 长度 | 4.745125 s |
| FunASR realtime worker → API 总耗时 | **1,793 ms** |
| 事件写入后普通实时流读取 | **25 ms** |
| sourceId / workerId | `bloomberg-tv` / `real-cloud-trace` |
| 音频引用 | 临时测试运行目录中的逻辑 `asr://` 引用；测试结束后已清理，不保留音频。 |

上述延迟不是直播延迟承诺；真实 Chrome 直播的最终延迟要在实际路由、采集与播放后重新记录。

## 自动化验证

| 命令 | 结果 |
| --- | --- |
| `npm run test:asr` | **51/51** 通过，4.125 s（覆盖设备解析、信号、稳定文件、去重、失败恢复、payload、FunASR WebSocket 和 WAV→worker→API→普通事件流）。 |
| `npm test` | **122/122** 通过，4.119 s。 |
| `npm run build` | 通过，Vite production build 1.01 s。 |
| `npm run asr:funasr:check` | Confirmed：`{"reachable":true,"backend":"funasr-realtime"}`，2.930 s。 |
| `npm run asr:preflight` | 4.622 s；仅信号为静音，其他运行时与 API 检查通过。 |

## Bloomberg / CNBC 状态

| 来源 | 自动化与云端链路 | 合法直播实测 |
| --- | --- | --- |
| Bloomberg TV | Confirmed：默认源、5 秒分段、FunASR realtime、去重/重试/失败隔离、事件 API 与实时流均已验证 | **Blocked**：等待 Multi-Output 路由与用户合法播放 |
| CNBC Live TV | Confirmed：独立 source ID 与 `capture:cnbc` / `asr:cnbc` / preflight 命令 | **Blocked**：同一硬件路由门槛；用户仍需合法登录并播放 CNBC。单个 BlackHole 时须与 Bloomberg 分时运行。 |

## Blocked / Unknown

- **Blocked：** 当前系统默认输出仍是 `MacBook Pro Speakers`，没有发现已创建的 Multi-Output Device；BlackHole 是静音输入。
- **Blocked：** 尚未有用户在 Chrome 中合法播放 Bloomberg TV 或 CNBC Live TV，因此没有真实直播音频片段、真实节目转录、真实事件 ID 或实际页面卡片截图。
- **Unknown：** Chrome 首次采集是否会弹出麦克风/音频权限提示，取决于本机 macOS 状态；如出现，须由用户批准。
- **Unknown：** 真实直播的片段到事件延迟、电视背景音/广告下的识别质量和 Bloomberg/CNBC 各自音频电平，必须在合法播放后实测。

## 日常启动、停止与人工验收

```bash
# 仅首次：创建 .env 并填写你自己的 DASHSCOPE_API_KEY（不要提交）
cp .env.example .env
chmod 600 .env

# 终端 1：后端
npm run server

# 终端 2：路由并开始合法播放后，预检必须看到 current signal: non-silent
npm run asr:preflight

# Bloomberg：终端 3 / 4
npm run capture:bloomberg
npm run asr:bloomberg

# CNBC：单独运行，或给它独立 loopback 后再启用
npm run capture:cnbc
npm run asr:cnbc

# 也可监督已启用且不共享同一设备的来源
npm run asr:stack
```

停止前台进程使用各终端的 `Ctrl-C`。可选 launchd 模板是 [`com.information-gain.asr.plist.example`](deployment/com.information-gain.asr.plist.example)，不会自动安装；安装与卸载命令见 [`deployment/README.md`](deployment/README.md)。

实际直播 smoke test 的验收顺序必须是：

1. Chrome 中由用户合法登录并播放 Bloomberg TV 或 CNBC Live TV。
2. `npm run asr:preflight` 显示 BlackHole 非静音。
3. capture 生成 WAV 段，worker 以 `funasr-realtime` 产生英文文本。
4. worker JSONL 记录 event ID 与延迟；`GET /api/events` 返回同一 ID。
5. `/realtime-flow` 可见该事件及“待交叉验证”标记。
