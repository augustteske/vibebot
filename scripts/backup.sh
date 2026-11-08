#!/usr/bin/env bash
set -euo pipefail

# Mode: 'docker' (default) or 'host'
MODE="${VIBEE_BACKUP_MODE:-docker}"
if [ "${1:-}" = "--host" ]; then
  MODE="host"
elif [ "${1:-}" = "--docker" ]; then
  MODE="docker"
fi

umask 077

NODE_BACKUP_SCRIPT='
import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const dbPath = process.env.VIBEE_DB_PATH || process.env.VIBEBOT_DB_PATH || (process.env.VIBEBOT_DATA_DIR ? join(process.env.VIBEBOT_DATA_DIR, "vibebot.sqlite") : ".data/vibebot.sqlite");
const backupDir = process.env.VIBEE_BACKUP_DIR || (process.env.VIBEBOT_DATA_DIR ? join(process.env.VIBEBOT_DATA_DIR, "backups") : ".data/backups");

if (!existsSync(dbPath)) {
  console.error("Vibee backup error: database file not found at " + dbPath);
  process.exit(1);
}

if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
}

const now = new Date();
const pad = n => String(n).padStart(2, "0");
const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const tempCopy = join(backupDir, `temp_${timestamp}.sqlite`);
const finalBak = join(backupDir, `vibebot_${timestamp}.bak`);

// 1. Hot atomic backup to temporary database file
const srcDb = new DatabaseSync(dbPath);
try {
  srcDb.exec(`VACUUM INTO "${tempCopy}"`);
} finally {
  srcDb.close();
}

try { chmodSync(tempCopy, 0o600); } catch {}

// 2. In the copy: delete raw tables per privacy contract, then VACUUM INTO final backup
const copyDb = new DatabaseSync(tempCopy);
try {
  try { copyDb.exec("DELETE FROM telegram_texts;"); } catch {}
  try { copyDb.exec("DELETE FROM telegram_media_observations;"); } catch {}
  copyDb.exec(`VACUUM INTO "${finalBak}"`);
} finally {
  copyDb.close();
  try { unlinkSync(tempCopy); } catch {}
}

try { chmodSync(finalBak, 0o600); } catch {}
console.log("Vibee backup created: " + finalBak + " (raw texts and media cleared, mode 600)");

// 3. Retention: keep copies for 7 days (or newest 7 daily copies)
const nowMs = Date.now();
const sevenDaysMs = 7 * 86400000;
const allBackups = readdirSync(backupDir)
  .filter(f => f.startsWith("vibebot_") && f.endsWith(".bak"))
  .map(f => {
    const p = join(backupDir, f);
    return { name: f, path: p, mtime: statSync(p).mtimeMs };
  })
  .sort((a, b) => b.mtime - a.mtime);

for (let i = 0; i < allBackups.length; i++) {
  const item = allBackups[i];
  if (i >= 7 || (nowMs - item.mtime > sevenDaysMs && i >= 1)) {
    try {
      unlinkSync(item.path);
      console.log("Vibee backup pruned old copy: " + item.name);
    } catch {}
  }
}
'

if [ "$MODE" = "docker" ]; then
  echo "Running Vibee backup inside Docker container (web)..."
  if command -v docker >/dev/null 2>&1; then
    docker compose exec -T web node --input-type=module -e "$NODE_BACKUP_SCRIPT"
  else
    echo "Error: docker command not found. Run with --host for local mode." >&2
    exit 1
  fi
elif [ "$MODE" = "host" ]; then
  echo "Running Vibee backup on host via Node.js..."
  if command -v node >/dev/null 2>&1; then
    node --input-type=module -e "$NODE_BACKUP_SCRIPT"
  elif command -v sqlite3 >/dev/null 2>&1; then
    DB_PATH="${VIBEE_DB_PATH:-.data/vibebot.sqlite}"
    BACKUP_DIR="${VIBEE_BACKUP_DIR:-.data/backups}"
    mkdir -p "$BACKUP_DIR"
    chmod 700 "$BACKUP_DIR" 2>/dev/null || true
    TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
    TEMP_FILE="${BACKUP_DIR}/temp_${TIMESTAMP}.sqlite"
    FINAL_FILE="${BACKUP_DIR}/vibebot_${TIMESTAMP}.bak"
    sqlite3 "$DB_PATH" "VACUUM INTO '${TEMP_FILE}'"
    chmod 600 "$TEMP_FILE" 2>/dev/null || true
    sqlite3 "$TEMP_FILE" "DELETE FROM telegram_texts; DELETE FROM telegram_media_observations; VACUUM INTO '${FINAL_FILE}'"
    rm -f "$TEMP_FILE"
    chmod 600 "$FINAL_FILE" 2>/dev/null || true
    echo "Vibee backup created: ${FINAL_FILE}"
    count=0
    for file in $(ls -1t "${BACKUP_DIR}"/vibebot_*.bak 2>/dev/null); do
      count=$((count + 1))
      if [ "$count" -gt 7 ]; then
        rm -f "$file"
      fi
    done
  else
    echo "Error: neither node nor sqlite3 CLI found." >&2
    exit 1
  fi
else
  echo "Unknown MODE: $MODE (use docker or host)" >&2
  exit 1
fi
