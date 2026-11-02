#!/bin/sh
set -eu

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEPLOY_BRANCH=${DEPLOY_BRANCH:-main}

if [ ! -f "$APP_DIR/.env" ]; then
  echo "Missing $APP_DIR/.env; create it from .env.example first." >&2
  exit 1
fi

CURRENT_BRANCH=$(git -C "$APP_DIR" branch --show-current)
if [ "$CURRENT_BRANCH" != "$DEPLOY_BRANCH" ]; then
  echo "Checkout '$DEPLOY_BRANCH' before deploying (currently on '$CURRENT_BRANCH')." >&2
  exit 1
fi

if [ -n "$(git -C "$APP_DIR" status --porcelain --untracked-files=normal)" ]; then
  echo "Refusing to deploy with local changes or untracked files." >&2
  exit 1
fi

command -v npm >/dev/null 2>&1 || { echo "npm is required." >&2; exit 1; }
command -v pm2 >/dev/null 2>&1 || { echo "PM2 is required." >&2; exit 1; }
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" != 24 ]; then
  echo "Node.js 24 is required (found $(node --version))." >&2
  exit 1
fi

cd "$APP_DIR"
git pull --ff-only origin "$DEPLOY_BRANCH"
npm ci
npm run build

if pm2 describe vibee-api >/dev/null 2>&1; then
  pm2 restart vibee-api --update-env
else
  pm2 start npm --name vibee-api -- start
fi

pm2 save
curl --fail --silent --show-error http://127.0.0.1:8787/api/health
printf '\n'
