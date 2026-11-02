<div align="center">
  <img src="public/bee.svg" alt="Vibee bee mascot" width="112">
  <h1>Vibee</h1>
  <p><strong>Почувствовать команду. Сделать следующий шаг.</strong></p>
  <p>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green.svg"></a>
    <img alt="Node.js 24.x" src="https://img.shields.io/badge/Node.js-24.x%2B-339933?logo=node.js&logoColor=white">
  </p>
</div>

Vibee — open-source прототип для бережной аналитики командной коммуникации. Он помогает смотреть на общие сигналы команды и обсуждать практические шаги, не оценивая отдельных людей.

Подробнее о целях и текущих границах проекта — в [контексте проекта](docs/PROJECT_CONTEXT.md).

## Features

- **Telegram communication insights:** прототип API и UI для агрегированного обзора командной переписки; полный production-поток подключения групп пока не готов.
- **Three aggregate metrics:** доля сообщений вне рабочих часов, равномерность участия и доля сообщений с благодарностью/признанием.
- **Recommendations:** шаблонная рекомендация по умолчанию; опционально можно настроить Groq, OpenAI или Ollama. Внешнему LLM передаются только опубликованные метрики, не тексты чата и не личности.
- **Privacy by design:** добровольное участие, проверка согласий и порог публикации агрегатов. Это ранний прототип, не медицинский инструмент, система оценки сотрудников или обещание полной анонимности.
- **Python Telegram bot:** личное демо на aiogram; синтетический API доступен для локальной QA. Реальная групповая интеграция и production-привязка пока не готовы.

## Quick Start

### Web app and API

Requirements: Node.js 24.x and npm. Python 3.12 is needed for the bot. Docker Compose v2 is optional.

```sh
npm ci
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:5173>. The dev command starts the React/Vite UI and Node API. See `.env.example` for server, bot, and optional LLM settings.

### Telegram bot

Install the bot dependencies once:

```sh
python -m venv bot/.venv
source bot/.venv/bin/activate
python -m pip install -r bot/requirements.txt
```

Set `TELEGRAM_BOT_TOKEN` in the same shell that runs the bot, then start the personal demo:

```sh
export TELEGRAM_BOT_TOKEN="<token from BotFather>"
python -m bot
```

In PowerShell, activate with `.\bot\.venv\Scripts\Activate.ps1` and set the token with `$env:TELEGRAM_BOT_TOKEN = "<token from BotFather>"`. The bot answers `/start` and `/stop` in private chat; it does not yet deliver real group analytics to the dashboard. Do not configure it to collect real group messages.

### Docker Compose

Start the web app and API:

```sh
docker compose up --build
```

For the personal bot demo, set `TELEGRAM_BOT_TOKEN` in `.env`, then run:

```sh
docker compose --profile bot-demo up --build
```

The Node service owns SQLite storage in a persistent volume. The bot communicates over the Compose network and does not access the database directly. Compose does not enable the unfinished production group-binding workflow.

## Architecture

```text
Telegram → Python / aiogram → Node.js API → SQLite
                                  ↑
                           React web app
```

React provides the web UI; Node.js owns the API, consent checks, aggregation, and SQLite persistence. The Python/aiogram bot is a separate HTTP client and never connects to SQLite. Current Telegram group flows are synthetic/local QA only; the private polling demo is not connected to team analytics.

## Development checks

```sh
npm run doctor
npm run check
npm test
```

Python checks:

```sh
python -m unittest discover -s bot/tests -v
python -m bot --check
```

## License

Distributed under the [MIT License](LICENSE).
