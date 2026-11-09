<div align="center">
  <img src="public/bee-mascot.png" alt="Vibee — 3D-пчёлка" width="260" />

  <h1>Vibee</h1>

  <h3>Почувствовать команду. Сделать следующий шаг.</h3>

  <p>
    <strong>Original Authors: August Teske, Arina, Alisa, Daniil. The name &quot;Vibee&quot; and the bee mascot are trademarks of the Vibee Team.</strong><br />
    The Vibee project is maintained by August Teske, Arina, Alisa, and Daniil.
  </p>

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

## 🆕 Что нового в v1.1.0

- 🎄 **Новогодняя тема** — включается сама с 1 декабря по 15 января: шапочка на пчёлке и лёгкий снегопад (превью — `/?newyear=1`).
- 📊 **Блок «Было — Стало»** — интерактивное сравнение «хаос в чатах → понятные метрики» на лендинге.
- 📸 **Шеринг «Пульса команды»** — PNG-карточка с периодом и тремя общими показателями для ретро: скачать, скопировать или отправить.
- 🌍 **EN/RU в боте** — переключение языка командой `/lang`.
- 🛡️ **Обработка сетевых ошибок** — бот бережно сообщает о сбое и предлагает кнопку «Повторить».

Полная история версий — в [CHANGELOG.md](CHANGELOG.md).

---

## 🚀 Быстрый старт

```bash
git clone https://github.com/augustteske/vibebot.git
cd vibebot
docker compose up -d --build
```

После запуска веб-кабинет доступен по адресу **[http://127.0.0.1:8787](http://127.0.0.1:8787)**.

> Локально по HTTP задайте `COOKIE_SECURE=false` и `APP_ORIGIN=http://127.0.0.1:8787` (в `.env` или перед командой) — иначе вход в кабинет не сохранит сессию.

---

## 🛠 Локальная разработка

Для работы без Docker понадобятся **Node.js 24.x** и **Python 3.12+**.

### 1. Веб-кабинет и API (Node.js + Vite)

```bash
cp .env.example .env
npm ci
npm run dev
```

Фронтенд откроется на **[http://127.0.0.1:5173](http://127.0.0.1:5173)**, а сервер API — на `http://127.0.0.1:8787` (проверить окружение можно командой `npm run doctor`).

### 2. Telegram-бот (Python 3.12)

Создайте виртуальное окружение и установите зависимости:

```bash
# Linux / macOS
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r bot/requirements.txt

# Windows (PowerShell)
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r bot/requirements.txt
```

Запустите бота, передав `TELEGRAM_BOT_TOKEN` и `VIBEE_API_BASE_URL`:

```bash
# Linux / macOS
TELEGRAM_BOT_TOKEN=your_bot_token VIBEE_API_BASE_URL=http://localhost:8787 python -m bot

# Windows (PowerShell)
$env:TELEGRAM_BOT_TOKEN="your_bot_token"
$env:VIBEE_API_BASE_URL="http://localhost:8787"
python -m bot
```

*(Проверить конфигурацию бота без подключения к Telegram можно командой `python -m bot --check`.)*

### 3. Тестирование

```bash
# Тесты API и UI (Node.js) + полная проверка типов и сборки
npm test
npm run check

# Модульные тесты Telegram-бота (Python)
python -m unittest discover -s bot/tests -v
```

---

## ☁️ Деплой на сервер

На чистом Ubuntu/Debian, включая **Oracle Cloud ARM (Ampere A1, `linux/arm64`)**:

```bash
git clone --branch feat/august-core https://github.com/augustteske/vibebot.git
cd vibebot
bash scripts/bootstrap.sh   # установит Docker, создаст .env и остановится
nano .env                   # TELEGRAM_BOT_TOKEN, APP_ORIGIN, COOKIE_SECURE
bash scripts/bootstrap.sh   # соберёт и запустит контейнеры
curl --fail http://127.0.0.1:8787/api/health
```

В Oracle Cloud откройте TCP-порт `8787` в Security List подсети и внутри ВМ (`sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8787 -j ACCEPT && sudo netfilter-persistent save`). Данные SQLite живут в volume `vibebot_data` — не используйте `docker compose down -v`.

---

## 📚 Документация

<p>
  <a href="docs/PROJECT_CONTEXT.md">О продукте</a> ·
  <a href="docs/STACK.md">Архитектура и стек</a> ·
  <a href="docs/CONTRACTS.md">Контракты и приватность</a> ·
  <a href="bot/README.md">Telegram-бот</a> ·
  <a href="docs/QA.md">Проверка и деплой</a> ·
  <a href="LICENSE">Лицензия MIT</a> ·
  <a href="NOTICE">NOTICE</a>
</p>

---

## 📄 Лицензия

Проект распространяется по лицензии [MIT](LICENSE). Подробная информация об авторских правах и товарных знаках команды приведена в файле [NOTICE](NOTICE). The Vibee project is maintained by August Teske, Arina, Alisa, and Daniil.
