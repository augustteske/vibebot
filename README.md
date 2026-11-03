<div align="center">
  <h1>🐝 Vibee</h1>
  <img src="public/bee.svg" alt="Маскот Vibee — пчёлка" width="180">
  <p><strong>Почувствовать команду. Сделать следующий шаг.</strong></p>
  <p>
    <a href="https://github.com/augustteske/vibebot/actions/workflows/ci.yml"><img alt="Node tests" src="https://github.com/augustteske/vibebot/actions/workflows/ci.yml/badge.svg?branch=main&amp;job=node-tests"></a>
    <a href="https://github.com/augustteske/vibebot/actions/workflows/ci.yml"><img alt="Python tests" src="https://github.com/augustteske/vibebot/actions/workflows/ci.yml/badge.svg?branch=main&amp;job=python-tests"></a>
    <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-FFD329.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node.js 24.x" src="https://img.shields.io/badge/Node.js-24.x%2B-339933?logo=node.js&amp;logoColor=white"></a>
  </p>
</div>

---

## Что это?

**Vibee** — open-source прототип для бережного анализа командной коммуникации и поиска полезных следующих шагов. Он помогает замечать общие тенденции в ритме сообщений, не превращая людей в рейтинги и не ставя диагнозов. Подробнее — в [продуктовом контексте](docs/PROJECT_CONTEXT.md).

## Возможности

- 🔗 **Telegram-интеграция** — Python-бот и API с обработкой согласий; реальный групповой сбор пока выключен.
- 📊 **Командные метрики** — сообщения вне расписания, равномерность участия и явные благодарности; показываются только допустимые агрегаты.
- 💡 **Рекомендации** — объяснимые идеи для обсуждения следующего шага, а не оценка сотрудников.
- 🎙️ **Голосовые сообщения** — локальная расшифровка Whisper доступна как отдельный личный сценарий с согласием; групповая расшифровка не включена.
- 🔔 **Уведомления** — прототип отправки организатору сводки опубликованного периода; требует настроенного Telegram Bot API и разрешённого серверного контура.
- 🏠 **Локальный Whisper** — опциональная обработка аудио локальной моделью; веса модели устанавливаются отдельно.
- 🔒 **Защита приватности** — явные согласия, ограниченные сроки хранения данных (TTL), изоляция команд и отсутствие персональных рейтингов.

> **Статус проекта:** исследовательский прототип. Синтетическая Telegram-аналитика запускается только в development-режиме; production-Compose не включает её. Не подключайте к нему реальные рабочие группы и не передавайте реальные данные.

---

## Быстрый старт

### Docker

Нужны Docker Engine и Docker Compose v2. Скопируйте пример окружения:

```sh
cp .env.example .env
```

Для личного бота задайте в `.env` `TELEGRAM_BOT_TOKEN`. Для внешнего провайдера рекомендаций настройте `LLM_PROVIDER` и `LLM_API_KEY` — ключ передаётся только серверу.

Запустите веб-приложение и API:

```sh
docker compose up --build
```

Чтобы запустить ещё и личного polling-бота, используйте `docker compose --profile bot-demo up --build`. Бот подключается к API по адресу `http://web:8787`; для его scoped transport также задаются `VIBEE_BOT_TOKEN`, `VIBEE_BINDING_ID` и `VIBEE_CHAT_ID`.

Остановка: `docker compose down` или `Ctrl+C`. Именованный том SQLite сохраняет данные. Для пересборки и запуска повторите `docker compose up --build`. См. также [Compose-конфигурацию](compose.yaml) и скрипты [`start.sh`](scripts/start.sh) / [`start.ps1`](scripts/start.ps1).

### npm

Нужны Node.js **24.x** и npm. Из корня репозитория:

```sh
npm ci
npm run dev
```

Откройте <http://127.0.0.1:5173>. Для локальной проверки синтетического Telegram API следуйте [сценарию QA](docs/QA.md); обычный запуск сам по себе этот API не включает.

---

## Архитектура

```text
Telegram → Python / aiogram → Node.js API → SQLite
                                  ↓
                           React / TypeScript
```

Бот не обращается к базе напрямую. Node API отвечает за роли, изоляцию команд, согласия, хранение и публикацию агрегатов; React отображает разрешённые результаты. Личная расшифровка Whisper остаётся отдельным локальным сценарием.

---

## Безопасность и приватность

- Обработка начинается только при наличии соответствующего согласия; голосовая расшифровка требует отдельного согласия на запись.
- В синтетическом Telegram-контуре сырые тексты хранятся до 15 минут, записи сообщений — не дольше 24 часов, закрытые агрегаты — до 7 дней; просроченное удаляет плановая очистка. Отзыв согласия очищает связанные данные без ожидания TTL. Это не обещает физическое стирание страниц SQLite/WAL или копий Telegram.
- Личное аудио обрабатывается локально в памяти и не сохраняется приложением в файл или базу.
- Для командной аналитики применяются правила закрытия периода и публикации агрегатов. Исходные сообщения не показываются в кабинете.
- Групповая аналитика и групповая расшифровка не готовы для реальных чатов. Не используйте синтетические сценарии с реальными рабочими сообщениями.
- Агрегация снижает риск раскрытия, но не гарантирует полную анонимность. Vibee не является медицинским или HR-инструментом.

См. [контракт Telegram](docs/CONTRACTS.md) и [QA/ограничения](docs/QA.md).

---

## Документация и контакты

- [Продуктовый контекст](docs/PROJECT_CONTEXT.md)
- [Контракт API и границы Telegram-интеграции](docs/CONTRACTS.md)
- [План команды](docs/TEAM_PLAN.md)
- [Руководство Telegram-бота](bot/README.md)
- [QA и сценарии проверки](docs/QA.md)
- [CI: GitHub Actions](https://github.com/augustteske/vibebot/actions)
- [GitHub: вопросы и сообщения об ошибках](https://github.com/augustteske/vibebot/issues)
- [GitLab: проект и обсуждения](https://gitlab.com/shertwg-group1/vibebot/-/issues)

## Лицензия

MIT — см. файл [LICENSE](LICENSE).
