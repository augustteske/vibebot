# Временный HTTPS-доступ к Vibee с Windows

Проверено 3 ноября 2026 года. Работающий локальный адрес: <http://127.0.0.1:8787>.
Все команды приложения выполняются из корня репозитория в PowerShell.
Это инструкция для последующего ручного запуска: публичный туннель при подготовке не запускался.

## Что даёт Quick Tunnel

Cloudflare Quick Tunnel выдаёт временный HTTPS-адрес `https://<случайное-имя>.trycloudflare.com` без аккаунта Cloudflare и собственного домена. При каждом новом запуске туннеля адрес меняется, после остановки процесса он перестаёт работать. Это вариант для демонстрации: нет гарантии доступности, максимум 200 одновременно обрабатываемых запросов (далее HTTP 429), SSE не поддерживается. Для постоянного адреса нужен обычный настроенный Cloudflare Tunnel с аккаунтом и доменом. См. [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Туннель публикует весь HTTP-сервис на порту 8787: frontend, статические файлы и API. Страница входа, создание команды и healthcheck доступны любому обладателю URL; защищённые данные API по-прежнему требуют сессию и соответствующие права. Сам случайный адрес не является проверкой членства в команде. `.env` и SQLite не раздаются сервером: статические файлы ограничены каталогом `dist`. Запросы проходят через Cloudflare. Компьютер должен оставаться включённым, без сна, с доступом в Интернет.

## Установка cloudflared

На этом компьютере Windows x64; `cloudflared` не найден в PATH, стандартных каталогах и списке установленных пакетов WinGet. Установка при подготовке не выполнялась.

Самый прямой вариант — официальный portable EXE, без службы Windows и изменения PATH. Команды ниже сохраняют его в пользовательский каталог, а не в репозиторий:

```powershell
$cloudflaredDir = Join-Path $env:LOCALAPPDATA 'Cloudflare\cloudflared'
New-Item -ItemType Directory -Path $cloudflaredDir -Force | Out-Null
$cloudflared = Join-Path $cloudflaredDir 'cloudflared.exe'
if (Test-Path -LiteralPath $cloudflared) { throw 'EXE already exists; check its version before replacing it.' }
Invoke-WebRequest -UseBasicParsing `
  -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' `
  -OutFile $cloudflared
& $cloudflared --version
if ($LASTEXITCODE -ne 0) { throw 'cloudflared version check failed.' }
```

Это ссылка Windows 64-bit Executable с [официальной страницы загрузок Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/#windows). На Windows обновления выполняются вручную. Если скачивание не удалось, не запускайте неполный файл: повторно скачайте EXE с этой страницы.

## Последовательность запуска

### 1. Остановить HTTP-режим перед публикацией

Сначала завершите текущий процесс Vibee штатным скриптом, чтобы туннель не опубликовал приложение с `COOKIE_SECURE=false` до настройки домена:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1
```

SQLite и ключ сервера сохраняются. Не запускайте вторую копию приложения с той же базой параллельно.

### 2. Окно PowerShell A — запустить туннель

**Эта команда начинает публичную публикацию. Выполняйте её только когда готовы открыть доступ.**

```powershell
$cloudflared = Join-Path $env:LOCALAPPDATA 'Cloudflare\cloudflared\cloudflared.exe'
& $cloudflared tunnel --url http://127.0.0.1:8787
```

Оставьте окно открытым и скопируйте выданный HTTPS-адрес `trycloudflare.com`. Пока приложение остановлено, запросы через него могут получать 502. Не перезапускайте туннель после получения адреса: следующий запуск выдаст другой.

Для дополнительного ограничения круга посетителей актуальная документация также предлагает `--allowed-mail 'alice@example.com,bob@example.com'` (замените адреса). Это вход по email PIN перед Vibee; аккаунт посетителям не нужен, но требуются интерактивные браузеры. Для такого варианта проверяйте сайт в браузере после PIN: обычный `curl` healthcheck не пройдёт почтовую авторизацию. Возможность описана в [официальной инструкции Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#restrict-access-by-email).

Открывать порты роутера и переводить Node.js на `0.0.0.0` не нужно: cloudflared подключается к локальному сервису через loopback и использует исходящие соединения. См. [схему Quick Tunnels](https://try.cloudflare.com/).

### 3. Окно PowerShell B — применить полученный адрес

```powershell
# Замените строку точным адресом из окна A, без пути и завершающего /.
$publicOrigin = 'https://REPLACE-ME.trycloudflare.com'
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 `
  -SkipBuild -PublicOrigin $publicOrigin
```

Сборка уже существует, поэтому используется `-SkipBuild`. После изменения frontend сначала выполните `npm run build` или уберите этот флаг.

Параметр `-PublicOrigin` через `scripts/local-server.mjs` устанавливает **только для запускаемого процесса**:

```text
HOST=127.0.0.1
PORT=8787
APP_ORIGIN=https://<выданный-домен>.trycloudflare.com
COOKIE_SECURE=true
NODE_ENV=production
```

`.env` не редактируется; каталог SQLite остаётся прежним. Запуск по-прежнему отключает синтетический Telegram-контур, отправку Telegram-уведомлений и использует шаблонные рекомендации.

TLS завершается на Cloudflare; локальное соединение `cloudflared → Node.js` остаётся HTTP через `127.0.0.1`. Secure-cookie устанавливается явно, поэтому серверу не требуется доверять `X-Forwarded-Proto`. `APP_ORIGIN` разрешает точный публичный origin даже при другом Host на локальном участке. Проверки Origin и `X-Vibee: 1`, `HttpOnly`, `SameSite=Strict` и авторизация сессии остаются действующими. Frontend обращается к относительным `/api/...` на том же HTTPS-домене; CORS и wildcard-origin не нужны.

В этом режиме используйте кабинет через публичный HTTPS-адрес: локальный HTTP остаётся пригоден для healthcheck, но вход и действия проверяйте через HTTPS. Локальные cookie не переносятся на домен туннеля. Для доступа к прежней команде используйте личный код входа, а для новых участников — отдельные приглашения, созданные на публичном адресе. Не создавайте новую команду вместо входа в существующую. При смене домена повторите вход и создайте ссылки приглашений для нового адреса; записи в базе сохраняются.

### 4. Проверка

Для обычного туннеля без email PIN:

```powershell
curl.exe --fail --silent --show-error http://127.0.0.1:8787/api/health
curl.exe --fail --silent --show-error "$publicOrigin/api/health"
curl.exe --fail --silent --show-error --output NUL "$publicOrigin/"
# Без cookie защищённая сессия должна ответить 401, а не раскрыть кабинет.
curl.exe --silent --output NUL --write-out '%{http_code}\n' "$publicOrigin/api/session"
```

Ожидается `{"ok":true}` у healthcheck, HTTP 200 у `/`, HTTP 401 у `/api/session` без сессии. При включённом email PIN Cloudflare сначала требует браузерную авторизацию; локальный healthcheck остаётся доступен.

Откройте HTTPS-адрес в браузере, выполните вход/вход по приглашению и обновите страницу. В DevTools проверьте cookie `vibebot_session`: Secure, HttpOnly, SameSite=Strict. Не копируйте её значение в сообщения или логи. Проверьте кабинет и одно синтетическое действие. Публичную ссылку отправляйте команде после этих проверок.

## Остановка и возврат к локальному HTTP

Сначала нажмите **Ctrl+C в окне A**: это прекращает публичный доступ. Затем в окне B:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -SkipBuild
curl.exe --fail http://127.0.0.1:8787/api/health
```

Кабинет снова открывается на <http://127.0.0.1:8787>. Запуск без `-PublicOrigin` возвращает точный локальный `APP_ORIGIN` и `COOKIE_SECURE=false` только для локального процесса, сохраняя production-настройки Compose и `.env`.

## Статус проверок

- Локальный healthcheck текущего процесса прошёл; при подготовке процесс не перезапускался.
- Совместимость публичного Origin, Secure/HttpOnly/SameSite-cookie и сессии проверена с SQLite **в памяти**: чужой Origin, HTTP-origin и запрос без клиентского заголовка отклонены; без сессии защищённый endpoint возвращает 401.
- Установка cloudflared, реальная публикация, публичный healthcheck и доступность Cloudflare из сети команды ещё не проверены: туннель намеренно не запускался.
- **Отдельная незавершённая задача:** визуальная проверка кабинета в браузере, включая вход на HTTPS-домене. Недоступность Computer Use подготовке этой инструкции не препятствует.

## Фактический запуск 3 ноября 2026 года

Этот раздел обновляет статус подготовки выше: пользователь разрешил публикацию, и туннель **запущен**.

Публичный адрес: <https://hawaii-metals-navigate-today.trycloudflare.com>.

Официальный `cloudflared 2026.10.7` установлен в `%LOCALAPPDATA%\Cloudflare\cloudflared\cloudflared.exe`; SHA-256 проверен по digest официального GitHub-релиза. Повторная сборка не потребовалась: `dist/index.html` новее входных файлов frontend. Существующие локальные скрипты запуска и остановки сохранены; добавлены `scripts/start-tunnel.ps1` и `scripts/stop-tunnel.ps1`.

На этой машине обычный запуск встретил сетевую проблему: SRV-записи Cloudflare не разрешались текущим DNS, а соединения через виртуальный интерфейс обрывались. Рабочий вариант — HTTP/2, явный исходящий Wi-Fi-адрес и edge-IP, полученные через официальный DNS-over-HTTPS Cloudflare. Использован параметр cloudflared `--edge` из [официального исходного кода](https://github.com/cloudflare/cloudflared/blob/2026.10.7/cmd/cloudflared/tunnel/cmd.go). Это скрытый диагностический параметр, его стабильность не гарантируется; он нужен здесь из-за сбоя обнаружения edge через DNS. `--no-prechecks` пропускает только предварительную сетевую диагностику. Проверка TLS не отключалась, системный DNS, VPN и правила роутера не менялись. Само приложение слушает **только 127.0.0.1:8787**.

Процессы оставлены работающими в скрытых окнах:

- Vibee: PID `6260`; актуальное состояние — `.vibee.local/8787/process.json`.
- cloudflared: PID `25448`; актуальное состояние — `.vibee.local/8787/tunnel.json`.

PID относятся к этому запуску. Скрипты остановки проверяют сохранённое время создания процесса, а для туннеля также имя и путь EXE, чтобы не завершить посторонний процесс при повторном использовании PID.

### Результаты HTTP-проверок через публичный HTTPS

| Проверка | Результат |
|---|---|
| `/` и JS-файл из HTML | HTTP 200 |
| `/api/health` | HTTP 200, `{"ok":true}` |
| Создание синтетической команды и сессии | HTTP 201 |
| Cookie сессии | Secure, HttpOnly, SameSite=Strict |
| Авторизованные `/api/session`, `/api/summary` | HTTP 200 |
| `/api/session` без cookie | HTTP 401 |
| POST с `Origin: https://untrusted.example` | HTTP 403 |
| POST без `X-Vibee` | HTTP 403 |
| Сессия и синтетический чек-ин после штатного перезапуска Vibee | Сохранены; повторный запрос по HTTPS успешен |

Для проверки добавлены только две явно синтетические команды: `SYNTHETIC HTTPS tunnel verification` и `SYNTHETIC HTTPS persistence verification`. Все 19 существовавших до публикации записей SQLite сверены по отпечаткам и сохранились без изменений. `.env` и `server.key` не менялись. Резервная копия до публикации: `.vibee.local/backups/before-https.sqlite` — это локальные приватные данные, не публикуйте и не добавляйте их в Git. Экспериментальный Telegram-сбор остаётся выключенным.

**Не проверено:** визуальное отображение и действия человека в браузере, в том числе вход по приглашению/личному коду и фактический приём Secure-cookie браузером. HTTP-проверки подтверждают серверные ответы и сохранение сессии, но не заменяют эти действия. Доступ из сети другого участника команды тоже требует отдельной проверки.

### Журналы и точная остановка

Журналы без токенов и cookie, относительно корня проекта:

- `.vibee.local/8787/stdout.log`, `.vibee.local/8787/stderr.log` — приложение.
- `.vibee.local/8787/tunnel.stdout.log`, `.vibee.local/8787/tunnel.stderr.log` — туннель, уровень info.
- `.vibee.local/8787/verification.json` — результаты HTTP-проверок без cookie и личных кодов.

Чтобы прекратить публикацию и вернуться к локальному HTTP, из корня проекта:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-tunnel.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -SkipBuild
curl.exe --fail http://127.0.0.1:8787/api/health
```

Если нужно прекратить только публичный доступ, достаточно первой команды. Для повторной публикации на этой сети сначала остановите предыдущий туннель, затем используйте свежие edge-IP и текущий Wi-Fi-адрес:

```powershell
$wifi = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object InterfaceAlias -eq 'Беспроводная сеть' |
  Select-Object -First 1 -ExpandProperty IPAddress
if (-not $wifi) { throw 'Wi-Fi IPv4 address not found; inspect network interfaces.' }
$dns = Invoke-RestMethod `
  'https://cloudflare-dns.com/dns-query?name=region1.v2.argotunnel.com&type=A' `
  -Headers @{Accept='application/dns-json'}
$edges = @($dns.Answer | Where-Object type -eq 1 | Select-Object -First 2 |
  ForEach-Object { $_.data + ':7844' })
if ($edges.Count -eq 0) { throw 'Cloudflare edge addresses not found.' }
.\scripts\start-tunnel.ps1 -Protocol http2 -EdgeAddress $edges -EdgeBindAddress $wifi
```

Скрипт не создаёт второй cloudflared, сначала останавливает текущий локальный Vibee, ждёт зарегистрированного соединения туннеля и затем запускает Vibee с полученным `PublicOrigin`. При неуспешном соединении останавливает неработающий туннель и восстанавливает локальный HTTP. Журналы нового запуска заменяют журналы предыдущего.

Для нормальной сети без указанного сбоя достаточно `.\scripts\start-tunnel.ps1`. При новом запуске Quick Tunnel **адрес изменится**. Компьютер должен оставаться включённым и подключённым к Интернету; переход в сон прерывает доступ. Commit, push и merge при настройке не выполнялись.

## Восстановление 4 ноября 2026 года

Актуальный адрес: <https://madonna-smooth-laptops-craig.trycloudflare.com>.

При диагностике порт 8787 не прослушивался, процессы из сохранённых файлов (Vibee 6260 и cloudflared 25448) отсутствовали. Посторонние процессы не останавливались. Журнал приложения не содержит ошибки завершения; точную причину его остановки установить нельзя. Журнал туннеля фиксирует недоступность прежнего исходящего адреса 172.27.17.71, которого больше нет среди адресов интерфейсов. Перезагрузка не подтверждена: Windows сообщает время последней загрузки 30 октября. Автоматическое восстановление после завершения процессов этими скриптами не предусмотрено.

Существующий start-tunnel.ps1 успешно запущен с Protocol http2, текущим Wi-Fi-адресом и свежими edge-IP из Cloudflare DNS-over-HTTPS. Скрипты исправлять не потребовалось. APP_ORIGIN установлен в новый HTTPS-origin, COOKIE_SECURE=true; Telegram-сбор выключен. Сервер слушает только 127.0.0.1:8787. Приложение и туннель оставлены работающими; актуальные PID и время запуска находятся в process.json и tunnel.json.

Проверено: npm run build; npm test (94/94); локальный и публичный healthcheck; публичные HTML и JS (200); создание синтетической сессии (201); Secure/HttpOnly/SameSite=Strict; авторизованные session и summary (200); без сессии 401; чужой Origin и отсутствие X-Vibee дают 403. Сессия сохранена после штатного перезапуска приложения при работающем туннеле.

Добавлена только отдельная тестовая команда SYNTHETIC recovery 2026-11-04 (4 новые записи). Все 30 ранее существовавших строк SQLite сверены с резервной копией и не изменились. .env, server.key и README.md совпадают с копией побайтно. Резервная копия данных, настроек, прежних журналов и незакоммиченных файлов: .vibee.local/backups/recovery-20261104-1793764227955. Не публиковать эту папку. Результаты без секретов: .vibee.local/8787/recovery-verification.json.

Визуальная проверка кабинета не завершена: browser access host недоступен, а попытку через Windows остановил Computer Use, поскольку не смог надёжно определить текущий URL браузера. Доступ из сети другого участника не проверялся.

Остановка из корня репозитория (первая команда прекращает только публичный доступ):

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-tunnel.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-local.ps1
```

При смене Quick Tunnel-домена участникам нужно заново войти в прежнюю команду по личному коду. Данные команды сохранены. Commit, push и merge не выполнялись.
