#!/usr/bin/env bash
set -euo pipefail

SOURCE_ID="${SOURCE_ID:-bloomberg-tv}"
AUDIO_DEVICE_INDEX="${AUDIO_DEVICE_INDEX:-}"
SEGMENT_SECONDS="${SEGMENT_SECONDS:-30}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${AUDIO_OUT_DIR:-$ROOT_DIR/audio/$SOURCE_ID/incoming}"

mkdir -p "$OUT_DIR"

if [[ "${1:-}" == "--list-devices" || -z "$AUDIO_DEVICE_INDEX" ]]; then
  ffmpeg -f avfoundation -list_devices true -i "" || true
  if [[ -z "$AUDIO_DEVICE_INDEX" ]]; then
    echo "Set AUDIO_DEVICE_INDEX to the AVFoundation audio device index, then rerun." >&2
    exit 2
  fi
fi

exec ffmpeg \
  -f avfoundation \
  -i ":$AUDIO_DEVICE_INDEX" \
  -ac 1 \
  -ar 16000 \
  -f segment \
  -segment_time "$SEGMENT_SECONDS" \
  -reset_timestamps 1 \
  -strftime 1 \
  "$OUT_DIR/%Y%m%dT%H%M%S.wav"
