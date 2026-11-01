# Telegram-прототип Vibee
Владелец: Илиан. Ветка: feat/ilian-bot. Python 3.12 + aiogram 3.31.0.

## Что готово
Демо в личном диалоге: /start → объяснение сбора → согласие или отказ → три вопроса с оценками 1–5. /stop удаляет черновик. Старые кнопки и повторные ответы отклоняются. Черновик действует 5 минут, фоновая очистка выполняется каждые 15 секунд; после завершения удаляется сразу. Содержимое сообщений не пишется на диск. Сообщения в самом Telegram автоматически не удаляются.

Это ещё НЕ корпоративное подключение и НЕ интеграция с веб-сервисом. Анализа переписки, передачи ответов на сервер и вызовов Groq здесь нет. Бот не подключается к SQLite напрямую. Для корпоративной активации нужны модель согласий и авторизация компании, описанные в дорожной карте.

## Установка из корня проекта
Windows:
```powershell
python -m venv bot/.venv
bot/.venv/Scripts/python.exe -m pip install -r bot/requirements.txt
bot/.venv/Scripts/python.exe -m bot --check
bot/.venv/Scripts/python.exe -m unittest discover -s bot/tests -v
```
Linux/macOS:
```sh
python3.12 -m venv bot/.venv
bot/.venv/bin/python -m pip install -r bot/requirements.txt
bot/.venv/bin/python -m bot --check
bot/.venv/bin/python -m unittest discover -s bot/tests -v
```

## Настоящий запуск
Локально задать TELEGRAM_BOT_TOKEN в окружении и выполнить тем же Python команду -m bot без --check. Не присылать токен в чат и не коммитить. Python-бот сам .env не загружает. --check работает без токена и не обращается в Telegram. Реальный обмен с Telegram требует отдельного токена и сетевой проверки.

## Следующий шаг Илиана
Прочитать docs/onboarding/ILIAN.md и docs/CONTRACTS.md. Согласовать с Августом связь Telegram-пользователя с уже существующим участником веб-команды: один человек не должен получать второй голос. Согласовать авторизацию, согласия, roundId, идемпотентность и ошибки. Затем реализовать отправку через этот контракт, сохранить честный демо-режим. До согласования endpoint не выдумывать.

## Docker
Из корня: docker compose --profile bot-demo up --build bot. Токен передаётся через TELEGRAM_BOT_TOKEN (окружение либо локальный корневой .env, который читает Compose). Образ бота отдельный; веб-приложение не требует Python.
