<div align="center">
  <img src="public/bee-mascot.png" alt="3D-маскот Vibee — улыбающаяся пчёлка" width="240">
  <h1>🐝 Vibee</h1>
  <p><strong>Почувствовать команду. Сделать следующий шаг.</strong></p>
  <p>Общие сигналы для бережного разговора и командных решений.</p>
  <p>
    <a href="https://github.com/augustteske/vibebot/actions/workflows/ci.yml"><img alt="CI · Node tests" src="https://github.com/augustteske/vibebot/actions/workflows/ci.yml/badge.svg?branch=develop&amp;job=node-tests"></a>
    <a href="https://github.com/augustteske/vibebot/actions/workflows/ci.yml"><img alt="CI · Python tests" src="https://github.com/augustteske/vibebot/actions/workflows/ci.yml/badge.svg?branch=develop&amp;job=python-tests"></a>
    <a href="LICENSE"><img alt="License MIT" src="https://img.shields.io/badge/License-MIT-FFD638.svg"></a>
    <a href="https://nodejs.org/"><img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24.x-339933?logo=node.js&amp;logoColor=white"></a>
  </p>
</div>

---

<h2 align="center">Возможности</h2>

- 🔒 **Приватность по умолчанию** — явные согласия, ограниченные сроки хранения и отсутствие персональных рейтингов.
- 📊 **Умные метрики** — общение вне расписания, равномерность участия и распознанные благодарности; публикуются только разрешённые агрегаты.
- 🎙️ **Голосовые** — серверный синтетический контур проверяет только ограниченные метаданные. Загрузка аудио и расшифровка речи не реализованы.
- 🔔 **Уведомления** — есть прототип уведомления организатора о закрытом периоде; реальная доставка требует настройки и не включена в обычный запуск.
- 📱 **Telegram-бот** — Python/aiogram transport и личный демо-сценарий. Реальные групповые чаты не подключены.
- 💡 **Следующий шаг** — объяснимая шаблонная рекомендация, подтверждаемое действие и два вида обратной связи.

> **Статус:** исследовательский прототип. Групповой Telegram-контур работает только в закрытом синтетическом режиме; обычный сервер не обрабатывает реальные чаты. Не добавляйте реальные сообщения, идентификаторы или токены в демо, репозиторий и логи. Внешний ИИ по умолчанию не используется.

---

<h2 align="center">Быстрый старт</h2>

### Быстрый старт на VPS

Для развёртывания на чистом сервере Ubuntu/Debian (например, Hetzner, Timeweb или любом другом VPS):

1. **Подключитесь к серверу по SSH:**
   ```sh
   ssh root@YOUR_SERVER_IP
   ```
2. **Установите `git` (если на чистом образе его ещё нет) и склонируйте репозиторий:**
   ```sh
   apt-get update && apt-get install -y git
   git clone --branch feat/august-core https://github.com/augustteske/vibebot.git
   cd vibebot
   ```
3. **Запустите скрипт первичной подготовки `scripts/bootstrap.sh`:**
   ```sh
   bash scripts/bootstrap.sh
   ```
   - Скрипт автоматически проверит наличие `git`, `docker` и `docker compose` и при отсутствии установит их через `apt-get`.
   - При первом запуске скрипт создаст `.env` из `.env.example` и остановится с сообщением: `Заполните .env (токен бота, домен) и запустите снова`.
   - Откройте `.env` (например, `nano .env`), укажите `TELEGRAM_BOT_TOKEN`, `APP_ORIGIN` (например, `http://YOUR_SERVER_IP:8787` для проверки по IP или ваш HTTPS-домен) и `COOKIE_SECURE` (`false` для HTTP по IP, `true` для HTTPS), после чего запустите скрипт повторно:
     ```sh
     bash scripts/bootstrap.sh
     ```
4. **Проверьте, что всё работает:**
   ```sh
   docker compose ps
   curl --fail http://127.0.0.1:8787/api/health
   ```
   В ответе должно вернуться `{"ok":true}`, а веб-интерфейс будет доступен по адресу `http://YOUR_SERVER_IP:8787`.

### Развёртывание одной командой

На Ubuntu/Debian или macOS запустите из корня репозитория:

```sh
bash scripts/deploy.sh
```

На Windows запустите в PowerShell:

```powershell
.\scripts\deploy.ps1
```

Если `.env` отсутствует, скрипт создаст его из `.env.example` и остановится. Заполните необходимые значения и запустите его повторно. Скрипт проверяет Docker Compose, при необходимости выполняет установку поддерживаемым системным способом, затем собирает и запускает приложение в фоне на порту 8787. Подробнее: [`scripts/deploy.sh`](scripts/deploy.sh) и [`scripts/deploy.ps1`](scripts/deploy.ps1).

### Docker Compose

Нужны Docker Engine и Docker Compose v2:

```sh
COOKIE_SECURE=false APP_ORIGIN=http://127.0.0.1:8787 docker compose up
```

Откройте <http://127.0.0.1:8787>. Для пересборки добавьте `--build` к команде выше. В PowerShell задайте `$env:COOKIE_SECURE='false'` и `$env:APP_ORIGIN='http://127.0.0.1:8787'` перед `docker compose up`. Compose запускает веб-приложение и API; профиль Telegram-бота по умолчанию выключен. SQLite хранится в Docker volume. Остановить — `Ctrl+C` или `docker compose down`.

Настройки берутся из необязательного `.env`. `TELEGRAM_BOT_TOKEN` нужен только для отдельно разрешённой доставки уведомлений; внешний провайдер рекомендаций настраивается через `LLM_PROVIDER` и `LLM_API_KEY` и по умолчанию не вызывается. `COOKIE_SECURE=false` допустим только для локального HTTP; за HTTPS reverse proxy установите `COOKIE_SECURE=true`. Обычный Compose не включает реальный групповой Telegram-контур.

### Node.js и npm

Нужны Node.js **24.x** и npm. Из корня репозитория:

```sh
npm ci
npm run dev
```

Откройте <http://127.0.0.1:5173>. Команда запускает Vite и локальный Node.js API. Она не включает реальную Telegram-интеграцию.

## Деплой на сервер (Production)

Сервер организаторов: Ubuntu, внешний IP `109.194.123.17`, внутренний IP `172.28.77.12`. Нужны SSH-доступ организаторов, Git, Docker Engine и плагин Docker Compose. Команды ниже выполняются на сервере.

1. Подключитесь и склонируйте репозиторий. Замените `YOUR_SSH_USER` выданным логином. Ветка `feat/august-core` содержит эти настройки деплоя; после ревью используйте согласованную командой ветку или тег.

   ```sh
   ssh YOUR_SSH_USER@109.194.123.17
   git clone --branch feat/august-core https://github.com/augustteske/vibebot.git
   cd vibebot
   ```

2. Создайте серверный `.env`:

   ```sh
   cp .env.example .env
   chmod 600 .env
   nano .env
   ```

   Замените соответствующие строки (значения ниже — placeholders):

   ```dotenv
   TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
   LLM_PROVIDER=template
   APP_ORIGIN=https://YOUR_QQ_DOMAIN
   COOKIE_SECURE=true
   ```

   `TELEGRAM_BOT_TOKEN` — секретный токен вашего Telegram-бота, не QQ-бота организаторов. Он нужен для отдельно разрешённых уведомлений; обычный запуск Compose не запускает polling-бота. `LLM_PROVIDER=template` использует локальные шаблоны без внешнего ИИ. `.env` не коммитьте. Обязательно замените локальные `APP_ORIGIN` и `COOKIE_SECURE=false` из `.env.example`: origin должен точно совпадать с публичным HTTPS-адресом, без пути и завершающего `/`. Если домен ещё не выдан, сначала выполните публикацию ниже, затем обновите origin и повторите запуск.

3. Проверьте Docker и запустите приложение в фоне:

   ```sh
   docker --version
   docker compose version
   docker compose up -d --build
   ```

   Альтернатива — `bash scripts/deploy.sh --production`: скрипт проверяет Docker и Compose, при необходимости устанавливает их на Ubuntu/Debian и принудительно передаёт `COOKIE_SECURE=true`, даже если в `.env` осталось `false`. Контейнеры запускаются с `-d`. При недоступности Docker для пользователя скрипт использует sudo.

4. Дождитесь запуска и проверьте API:

   ```sh
   docker compose ps
   curl --fail http://127.0.0.1:8787/api/health
   ```

   Ожидается HTTP 200. Если сервис ещё запускается, повторите запрос; для диагностики используйте `docker compose logs --tail=100 web`. HTTP healthcheck работает независимо от Secure-cookie; вход в кабинет в production проверяйте через HTTPS-домен.

### Интеграция с QQ-ботом организаторов

В QQ-боте, предоставленном организаторами, выполните команды по очереди:

```text
/claim
/publish 8787
```

Дождитесь подтверждения `/claim` и следуйте запросам бота для закрепления сервера. После запуска приложения `/publish 8787` публикует порт и выдаёт домен по схеме организаторов. Используйте адрес из ответа бота, а не пример `YOUR_QQ_DOMAIN`. Если бот запрашивает дополнительные данные, используйте выданные организаторами параметры сервера.

Установите полученный HTTPS-origin в `.env` и примените его пересозданием контейнера:

```sh
bash scripts/deploy.sh --production
curl --fail https://YOUR_QQ_DOMAIN/api/health
```

Откройте этот домен в браузере и проверьте вход в кабинет. Публикация порта настроена как `8787:8787` (все интерфейсы хоста), а Node.js внутри контейнера слушает `0.0.0.0:8787`. Прокси организаторов должен иметь доступ к `172.28.77.12:8787` и обслуживать публичный HTTPS; при недоступности порта проверьте сетевые правила с организаторами. Сам контейнер обслуживает HTTP, TLS завершается на прокси.

В Compose `COOKIE_SECURE` по умолчанию `true`; отключение через `.env` или переменную окружения допустимо только для локальных HTTP-тестов без `--production`. SQLite сохраняется в volume `vibebot_data`; при обновлениях не используйте `docker compose down -v`. Публикация веб-кабинета не включает обработку реальных Telegram-чатов: для неё по-прежнему требуется отдельное согласование условий согласия, хранения и отзыва.

---

<h2 align="center">Архитектура</h2>

```text
Telegram updates ──→ Python 3.12 / aiogram ──→ Node.js 24 API ──→ SQLite
                                                    │
                                                    └──→ React / TypeScript
```

Это схема компонентов, а не заявление о готовом подключении живого чата. Локальная HTTP-интеграция проверена синтетическими тестами. Реальные Telegram ID, полномочия инициатора и полный состав группы ещё не подтверждены — реальный групповой контур выключен. API отвечает за авторизацию, согласия, хранение и публикацию агрегатов; интерфейс показывает только разрешённые результаты. См. [контракт API и Telegram](docs/CONTRACTS.md) и [обзор стека](docs/STACK.md).

---

<h2 align="center">Приватность и согласия</h2>

Обработка групповых сообщений требует согласия компании и **каждого** участника проверенного состава. Отказ, отзыв согласия, неизвестный отправитель или сбой доставки останавливают обработку чата. До подтверждения состава и полномочий никакие реальные рабочие чаты подключать нельзя.

В синтетическом Telegram-контуре действуют сроки: сырые тексты — до **15 минут**, производные записи сообщений и техническая дедупликация — до **24 часов**, закрытые агрегаты, рекомендации и обратная связь — до **7 дней**. Отзыв согласия немедленно останавливает обработку и удаляет связанные данные, не дожидаясь TTL. Эти правила не обещают физического стирания страниц SQLite/WAL или копий сообщений в Telegram.

Голосовые данные в текущем срезе не скачиваются и не расшифровываются. Внешняя модель отключена по умолчанию; рекомендации работают по шаблонам. Агрегаты уменьшают раскрытие данных, но не гарантируют абсолютную анонимность. Vibee — не медицинский или HR-инструмент.

Подробнее: [границы и хранение Telegram-данных](docs/CONTRACTS.md), [проверки и ограничения](docs/QA.md), [контекст продукта](docs/PROJECT_CONTEXT.md).

---

<h2 align="center">Документация</h2>

- [Контракт API и Telegram](docs/CONTRACTS.md)
- [QA и сценарии проверки](docs/QA.md)
- [Архитектура стека](docs/STACK.md)
- [Продуктовый контекст](docs/PROJECT_CONTEXT.md)
- [План команды](docs/TEAM_PLAN.md)
- [Правила бренда](docs/BRAND.md)
- [Руководство Python-бота](bot/README.md)
- [Compose-конфигурация](compose.yaml)
- [Временный HTTPS-туннель с Windows: установка, запуск и остановка](docs/WINDOWS_TUNNEL.md)
- [Развёртывание одной командой](scripts/deploy.sh) ([PowerShell](scripts/deploy.ps1))
- [Справка внутри сайта](public/docs.html)
- [Проект условий пилота и политики обработки данных](docs/LEGAL_DRAFT.md)
- [GitHub Actions](https://github.com/augustteske/vibebot/actions/workflows/ci.yml)

---

<h2 align="center">Лицензия</h2>

Этот проект распространяется по лицензии [MIT](LICENSE).
