# Vibee

**Team communication insights with consent at the center.** Vibee is an early-stage open-source prototype for turning voluntarily shared team signals into cautious, aggregate insights and practical suggestions. It is not a medical, performance-monitoring, or employee-scoring tool.

See [Project Context](docs/PROJECT_CONTEXT.md) for product goals, current status, and boundaries.

## Requirements

- Node.js 24.x and npm
- Python 3.12 for the Telegram bot
- Docker Compose v2 (optional)

## Install and run locally

```sh
npm ci
cp .env.example .env
npm run doctor
npm run dev
```

Open <http://127.0.0.1:5173>. The dev command starts the Vite UI and Node API; keep its terminal running. `npm run doctor` checks the Node version, dependencies, and repository remote.

The Python bot runs separately. In PowerShell:

```powershell
python -m venv bot/.venv
.\bot\.venv\Scripts\Activate.ps1
python -m pip install -r bot/requirements.txt
python -m bot --check
$env:TELEGRAM_BOT_TOKEN = "<token from BotFather>"
python -m bot
```

On macOS/Linux, activate with `source bot/.venv/bin/activate`. Set environment variables in the shell that launches the bot; Python does not load the root `.env` file. The personal polling demo supports `/start` and `/stop`; it does not yet complete a production group-to-dashboard workflow.

## Environment

Copy `.env.example` to `.env`. Never commit tokens or API keys.

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Secret token for the Python Telegram bot |
| `VIBEE_API_BASE_URL` | Node API URL for the bot (`http://localhost:8787` locally; `http://web:8787` in Compose) |
| `VIBEE_BINDING_ID` | Binding identifier for the optional bot HTTP transport |
| `VIBEE_BOT_TOKEN` | Scoped bot API credential; required with binding ID and chat ID |
| `VIBEE_CHAT_ID` | Negative Telegram group ID; required with the other transport credentials |
| `LLM_PROVIDER` | `template` (default), `groq`, `openai`, or `ollama` |
| `LLM_API_KEY` | Provider key for Groq or OpenAI; keep it private |
| `LLM_BASE_URL` | Optional OpenAI-compatible endpoint override |
| `LLM_MODEL` | Optional model override |

The bot's API transport is enabled only when `VIBEE_BOT_TOKEN`, `VIBEE_BINDING_ID`, and `VIBEE_CHAT_ID` are all set. Do not set these against a real group for this prototype: the production Telegram binding/bootstrap workflow is not ready.

LLM generation is opt-in. `template` makes no external request. When configured, only a published aggregate metrics object is sent to the selected provider—never chat text or participant identities. Validate your provider's data handling before enabling it. An invalid or unavailable provider response falls back to the local template.

## Connect a Telegram demo bot

1. In Telegram, open **@BotFather**, run `/newbot`, follow the prompts, and store the returned token as `TELEGRAM_BOT_TOKEN`. Do not put it in source control or screenshots.
2. Privacy Mode is enabled by default. Keep it enabled for a personal bot that responds to `/start` and `/stop`. A group bot generally sees commands and messages addressed to it; receiving all group messages requires disabling Privacy Mode with `/setprivacy` or granting admin privileges. Do not change this for a real group until the product's consent, binding, and production ingestion flow is ready.
3. For synthetic QA only, enable the development API in `.env` with `NODE_ENV=development`, `VIBEE_TELEGRAM_SYNTHETIC=true`, and a fresh 64-character lowercase hex `VIBEE_TELEGRAM_BOOTSTRAP_CREDENTIAL` (generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`). After signing in as an organizer, `POST /api/telegram/binding-tokens` with `{"requestId":"<new UUID>"}` returns a one-time token that expires in 10 minutes. This endpoint is disabled outside the synthetic development API; it is not a production binding flow.
4. For the available personal demo, start the bot with `TELEGRAM_BOT_TOKEN` and use `/start` in a private chat. It does not send check-ins to the dashboard. Never collect group messages without explicit company and participant consent.

## Docker Compose

The repository includes a Node and Python Dockerfile. The web service is available at <http://127.0.0.1:8787>; its SQLite database and server key persist in the named `vibebot_data` volume. The bot uses the internal API URL `http://web:8787` and has its own `vibebot_bot_data` volume for its pause marker; it never mounts or accesses the SQLite volume.

```sh
docker compose up --build web
```

For the personal bot demo, set `TELEGRAM_BOT_TOKEN` in `.env`, then run:

```sh
docker compose --profile bot-demo up --build
```

The bot profile does not make the unfinished production group-binding workflow available. For a self-hosted Ollama server in Docker Desktop, set `LLM_BASE_URL=http://host.docker.internal:11434/v1` in `.env`.

## Architecture

```text
Telegram → Python (aiogram) → Node API → SQLite → React web dashboard
```

The Node API owns persistence, authorization, consent checks, and aggregation. The bot communicates over HTTP and must not access SQLite directly. The React app calls the Node API. In the current prototype, the Python bot's private demo works, and a synthetic Telegram API exists for local QA; real group ingestion and production binding are not yet ready.

## Checks

```sh
npm run check
npm test
```

Python bot checks:

```sh
python -m unittest discover -s bot/tests -v
python -m bot --check
```

## License

Vibee is distributed under the [MIT License](LICENSE).
