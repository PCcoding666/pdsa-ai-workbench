#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DATA_DIR:-/var/lib/pdsa-ai-workbench}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/pdsa-ai-workbench}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

if [ ! -d "$DATA_DIR" ]; then
  echo "Data directory does not exist: $DATA_DIR" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date +%Y%m%d-%H%M%S)"
archive="$BACKUP_DIR/pdsa-ai-workbench-$timestamp.tgz"
parent_dir="$(dirname "$DATA_DIR")"
data_name="$(basename "$DATA_DIR")"

tar -czf "$archive" -C "$parent_dir" "$data_name"
find "$BACKUP_DIR" -type f -name 'pdsa-ai-workbench-*.tgz' -mtime +"$BACKUP_KEEP_DAYS" -delete

echo "$archive"
