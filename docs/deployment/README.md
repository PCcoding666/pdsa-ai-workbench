# Deploying the 7×24 research engine

> Templates only. Nothing here installs or runs itself — installation is a
> deliberate human step (see docs/PROGRESS.md, "human gates").

The engine is a **one-cycle process**: `node scripts/research-engine.js --once`
runs one full cycle (fact sheets → snapshots → discovery → scoring → alerts →
decision queue → Bark push) and exits. "7×24" is the scheduler's job, not the
process's — use launchd (macOS) or cron. This keeps the engine crash-proof:
a failed cycle just means the next scheduled run tries again.

## Required environment

| Variable | Why |
| --- | --- |
| `SEC_USER_AGENT` | SEC EDGAR requires a descriptive User-Agent with contact info; without it they may block your IP. Example: `Information Gain research chengpeng@example.com` |
| `UNIVERSE_FILE` | Git-synced research scope. Use `<repo>/config/auto-research-universe.json` on the Mac mini so the researched tickers/domains come from git, not from ignored runtime data. |
| `BARK_PUSH_URL` *(optional)* | Bark push endpoint (`https://api.day.app/<key>`). Unset → notifications skip, engine still runs. |
| `DATA_DIR` *(optional)* | Defaults to `<repo>/data`. |

## Git-synced research scope

The auto research job should read its universe from
`config/auto-research-universe.json`. That file is tracked in git and is the
source of truth for **what the Mac mini researches** after `git pull`.

Runtime files still belong under `data/` and are intentionally gitignored:
snapshots, decision queues, decision records, scorecards and scheduler state.
Do not move those into git just to migrate machines.

Current tracked research scope:

- AI industry chain
- AI rack power and thermal architecture
- AI photonics, CPO and external light sources
- Advanced packaging materials and package-level power integrity
- Inference memory, storage and controller bottlenecks
- Physical AI, robotics components and edge hardware

Each entry in the config has `ticker`, `domain`, `benchmark` and `role`.
The engine currently consumes `ticker`, `domain`, `benchmark` and optional
`analystCoverage`; `role` is kept for human readability and commit review.

## Option A: launchd (macOS, recommended on this machine)

1. Clone or pull this repo on the Mac mini.
2. Run `npm install`.
3. Copy `com.information-gain.research-engine.plist` to `~/Library/LaunchAgents/`.
4. Edit the paths marked `REPLACE_ME`:
   - node binary, e.g. output of `which node`
   - repo path, e.g. `/Users/chengpeng/Documents/Information-Gain`
   - `SEC_USER_AGENT`
   - optional Bark URL
5. Confirm the plist `UNIVERSE_FILE` points at
   `<repo>/config/auto-research-universe.json`.
6. Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.information-gain.research-engine.plist
launchctl start com.information-gain.research-engine   # optional immediate test run
```

Logs land in `<repo>/logs/research-engine.{out,err}.log`.

The template runs at **06:15 local time daily** — after US market close data
settles and before your morning review. Adjust `StartCalendarInterval` to taste.

## Option B: cron

```cron
# m h dom mon dow  command
15 6 * * *  cd /Users/chengpeng/Documents/Information-Gain && SEC_USER_AGENT="Information Gain research you@example.com" UNIVERSE_FILE="/Users/chengpeng/Documents/Information-Gain/config/auto-research-universe.json" /usr/local/bin/node scripts/research-engine.js --once >> logs/research-engine.out.log 2>> logs/research-engine.err.log
```

## Verify before scheduling

```bash
# no writes, no notifications — full cycle in dry-run, using git-synced scope
UNIVERSE_FILE="$PWD/config/auto-research-universe.json" node scripts/research-engine.js --dry-run
```

## What a cycle produces

- `data/entity-snapshots.jsonl` — fact-sheet history per ticker (append-only)
- `data/decision-queue/YYYY-MM-DD.{json,md}` — the daily human judgment queue
- a Bark push: summary, flagged urgent when a falsifier review triggered

The engine never places orders and never moves money. Its terminal output is a
**queue for human judgment**.

## Optional local live-TV ASR service (macOS)

The companion template
[`com.information-gain.asr.plist.example`](com.information-gain.asr.plist.example)
runs `scripts/asr-stack.js`. It supervises the local capture and ASR processes;
it does **not** log in to a website, open Chrome, bypass DRM, or install audio
drivers. Read the full setup and human routing gate in [`README.md`](../../README.md#本机合法直播音频--asr-事件流).

Only after preflight is `READY` and a human has verified a legal local playback
route, may a human install the template:

```bash
mkdir -p "$PWD/logs"
# Use Node 20.6.0+ because the template loads the repository-local .env.
node --version
cp docs/deployment/com.information-gain.asr.plist.example \
  ~/Library/LaunchAgents/com.information-gain.live-tv-asr.plist
# Edit the copied file: node path, repo path, and local ffmpeg/ffprobe paths.
# `which ffmpeg` and `which ffprobe` should be copied literally; launchd does
# not inherit your interactive Homebrew PATH. The template loads the
# repository-local `.env`; put DASHSCOPE_API_KEY and any API credentials there,
# then restrict it with `chmod 600 .env`. It uses the repository's first-party
# FunASR realtime adapter and does not invoke local Whisper.
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.information-gain.live-tv-asr.plist
```

Stop and remove it without touching audio/data files:

```bash
launchctl bootout "gui/$(id -u)" ~/Library/LaunchAgents/com.information-gain.live-tv-asr.plist
rm ~/Library/LaunchAgents/com.information-gain.live-tv-asr.plist
```
