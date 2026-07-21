#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node --env-file-if-exists="$ROOT_DIR/.env" "$ROOT_DIR/scripts/asr-capture.js" "$@"
