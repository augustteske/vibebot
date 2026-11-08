<div align="center">
  <img src="public/bee-mascot.png" alt="Vibee — 3D-пчёлка" width="260" />

  <h1>Vibee</h1>

  <h3>Почувствовать команду. Сделать следующий шаг.</h3>

  <p>
    Open-source Telegram-бот для бережной аналитики командной коммуникации. Без слежки и персональных оценок.
  </p>

  <p>
    <a href="https://github.com/augustteske/vibebot/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/augustteske/vibebot/ci.yml?branch=develop&style=flat-square&label=CI&color=171719" alt="CI" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-FFD638?style=flat-square&labelColor=171719" alt="License MIT" /></a>
    <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24-339933?style=flat-square&logo=node.js&logoColor=white&labelColor=171719" alt="Node.js 24" /></a>
    <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3.12-3776AB?style=flat-square&logo=python&logoColor=white&labelColor=171719" alt="Python 3.12" /></a>
    <a href="bot/README.md"><img src="https://img.shields.io/badge/Telegram-Bot-26A5E4?style=flat-square&logo=telegram&logoColor=white&labelColor=171719" alt="Telegram Bot" /></a>
  </p>
</div>

---

## ✨ Возможности

- 🔒 **Приватность по умолчанию** — работа только по явному согласию команды, публикация командных агрегатов с порогами защиты и без личных рейтингов.
- 📊 **Умные метрики и рекомендации** — отслеживание ритма общения вне рабочих часов, равномерности участия и взаимной поддержки с готовым следующим шагом.
- 🔑 **Вход по ключу комнаты** — быстрый онбординг участников команды в две кнопки по короткому 8-символьному коду без сложных форм регистрации.
- 🎙️ **Голосовые и чек-ины** — добровольные быстрые чек-ины в боте и веб-кабинете, а также защищённый контур учёта голосовых метаданных.
- 🔔 **Бережные уведомления** — автоматические сводки для организатора по итогам закрытого периода и встроенное окно обратной связи.
- 🌓 **Светлая, тёмная и 🎄 новогодняя темы** — плавное переключение оформления с автоопределением системной темы и праздничным зимним режимом (с 1 декабря по 15 января).

---

## 🚀 Быстрый старт

```bash
git clone https://github.com/augustteske/vibebot.git
cd vibebot
docker compose up -d --build
```

После запуска веб-кабинет доступен по адресу **[http://127.0.0.1:8787](http://127.0.0.1:8787)** (для локальной разработки без Docker: `npm ci && npm run dev`).

---

## 📚 Документация

<p>
  <a href="docs/PROJECT_CONTEXT.md">О продукте</a> ·
  <a href="docs/STACK.md">Архитектура и стек</a> ·
  <a href="docs/CONTRACTS.md">Контракты и приватность</a> ·
  <a href="bot/README.md">Telegram-бот</a> ·
  <a href="docs/QA.md">Проверка и деплой</a> ·
  <a href="LICENSE">Лицензия MIT</a>
</p>
