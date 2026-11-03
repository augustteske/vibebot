#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  printf '%s\n' "Created .env from .env.example. Review it before enabling optional services."
fi

if [ "${1:-}" = "--bot" ]; then
  shift
  if ! grep -Eq '^TELEGRAM_BOT_TOKEN=.+$' .env; then
    printf '%s\n' "Set TELEGRAM_BOT_TOKEN in .env before starting the bot." >&2
    exit 1
  fi
  exec docker compose --profile bot-demo up --build "$@"
fi

exec docker compose up --build "$@"
