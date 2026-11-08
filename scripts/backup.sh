#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${VIBEE_DB_PATH:-.data/vibebot.sqlite}"
BACKUP_DIR="${VIBEE_BACKUP_DIR:-/backup}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "Error: sqlite3 CLI is required for backups" >&2
  exit 1
fi

if [ ! -f "$DB_PATH" ]; then
  echo "Error: SQLite database not found at $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/vibebot_${TIMESTAMP}.bak"

echo "Creating backup: ${BACKUP_FILE} from ${DB_PATH}..."
sqlite3 "$DB_PATH" "VACUUM INTO '${BACKUP_FILE}'"

# Retain only the last 7 backups
echo "Pruning old backups, keeping last 7..."
BACKUP_COUNT=0
for file in $(ls -1t "${BACKUP_DIR}"/vibebot_*.bak 2>/dev/null); do
  BACKUP_COUNT=$((BACKUP_COUNT + 1))
  if [ "$BACKUP_COUNT" -gt 7 ]; then
    echo "Removing old backup: $file"
    rm -f "$file"
  fi
done

echo "Backup complete. Total backups retained: $(( BACKUP_COUNT > 7 ? 7 : BACKUP_COUNT ))."
