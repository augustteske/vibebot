# Развёртывание Vibee на Ubuntu/Debian VM

Инструкция для выделенной VM организаторов хакатона. Перед запуском подготовьте выделенный домен и адрес VM. Деплой включает веб-приложение и SQLite; он **не** включает подключение корпоративного Telegram-чата или внешнего ИИ.

## 1. Подключитесь по SSH

Получите у организаторов IP-адрес VM и SSH-пользователя. Подключитесь со своего компьютера:

```sh
ssh <user>@<vm-ip>
```

Для входа используйте выданный организаторами ключ/способ доступа. Не помещайте приватный ключ в репозиторий. Используйте непривилегированную учётную запись с `sudo`; не запускайте Node.js и PM2 от root. Если организаторы выдали только root-доступ, попросите их создать отдельного пользователя для деплоя до продолжения.

## 2. Установите системные пакеты и получите домен

```sh
sudo apt update
sudo apt install -y ca-certificates curl git xz-utils nginx
```

Свяжите выделенный домен с VM через бота организаторов `@gg_domains_bot` и следуйте выданным им инструкциям. Уточните у организаторов целевой IPv4/IPv6 и настройте DNS `A`/`AAAA` записи домена. Перед получением сертификата DNS должен указывать на эту VM, а входящие порты 80 и 443 должны быть доступны в firewall VM и панели хостинга.

## 3. Получите код и установите Node.js 24

Репозиторий команды размещён на GitLab. Настройте доступ VM к нему через deploy key с минимальными правами; не вставляйте токен в URL или shell history.

```sh
sudo mkdir -p /opt/vibee
sudo chown "$USER":"$(id -gn)" /opt/vibee
git clone --branch main --single-branch git@gitlab.com:shertwg-group1/vibebot.git /opt/vibee
cd /opt/vibee
```

`main` — проверенная демонстрационная ветка. Используйте другую ветку только если Август явно подтвердил, что её можно развернуть.

Проект содержит установщик Node.js 24, который сверяет SHA-256 официальный архив до установки:

```sh
sudo env NODE_VERSION=24.22.2 sh scripts/install-node.sh
node --version
npm --version
```

Версия Node должна быть `v24.x`. Установите PM2:

```sh
sudo npm install --global pm2
pm2 --version
```

## 4. Установите зависимости и соберите приложение

```sh
cd /opt/vibee
npm ci
npm run build
```

## 5. Настройте окружение и персистентные данные

Создайте `.env` на основе шаблона и задайте публичный домен:

```sh
cp .env.example .env
nano .env
```

Для HTTPS проверьте, что значения имеют вид:

```dotenv
HOST=127.0.0.1
PORT=8787
NODE_ENV=production
COOKIE_SECURE=true
APP_ORIGIN=https://<your-domain>
VIBEE_DATA_DIR=/opt/vibee-data
```

Создайте каталог данных с доступом только пользователя приложения:

```sh
sudo install -d -o "$USER" -g "$(id -gn)" -m 700 /opt/vibee-data
chmod 600 .env
```

`server/index.mjs` загружает `.env` через `npm start`, создаёт SQLite-файл и ключ сессий в `VIBEE_DATA_DIR`. Сохранность входов зависит от сохранения этого каталога: включите его в резервное копирование с ограниченным доступом и проверьте восстановление. Не размещайте базу в очищаемом временном каталоге.

`BOT_TOKEN` и `DATABASE_URL` оставлены в `.env.example` только как помеченные зарезервированные значения: текущий сервер их не читает. SQLite задаётся через `VIBEE_DATA_DIR`. Общего токена бота нет; Telegram-контур в production entry point выключен и не должен использоваться для реальных чатов.

## 6. Запустите сервер через PM2

`server/app.mjs` только экспортирует фабрику приложения и сам не открывает порт. Запускайте production entry point через npm, чтобы Node загрузил `.env`:

```sh
cd /opt/vibee
pm2 start npm --name vibee-api -- start
pm2 status
curl --fail http://127.0.0.1:8787/api/health
pm2 save
pm2 startup
```

После `pm2 startup` выполните команду, которую напечатает PM2, затем ещё раз:

```sh
pm2 save
```

Не открывайте порт 8787 наружу: Node слушает только `127.0.0.1`, а внешний HTTPS-трафик будет принимать Nginx.

## 7. Настройте Nginx и HTTPS

Создайте `/etc/nginx/sites-available/vibee` (замените домен на выданный):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name <your-domain>;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Включите сайт и проверьте конфигурацию:

```sh
sudo ln -s /etc/nginx/sites-available/vibee /etc/nginx/sites-enabled/vibee
sudo nginx -t
sudo systemctl reload nginx
```

Разрешите SSH и веб-трафик в firewall (сначала убедитесь, что SSH доступ разрешён, чтобы не потерять соединение):

```sh
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

Когда DNS уже разрешается в IP VM и порт 80 доступен, запросите сертификат Let's Encrypt:

```sh
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d <your-domain>
sudo certbot renew --dry-run
```

Certbot настроит HTTPS и обновление сертификата для Nginx. Проверьте `https://<your-domain>/api/health`, затем откройте корень домена в браузере. Браузер должен установить защищённую сессию; `COOKIE_SECURE=true` и точный `APP_ORIGIN` обязательны при HTTPS.

## Обновление приложения

После одобрения новой версии и её попадания в `main`, из каталога checkout можно обновить приложение так:

```sh
cd /opt/vibee
git pull --ff-only origin main
npm ci
npm run build
pm2 restart vibee-api --update-env
pm2 save
```

Либо используйте `scripts/deploy-vm.sh`. Скрипт проверяет чистое рабочее дерево и текущую ветку; по умолчанию обновляет только `main`. Не удаляйте `/opt/vibee-data` при обновлении или перезапуске.

## Проверки и границы

- Локально перед выпуском: `npm run check`.
- На VM после деплоя: `curl --fail https://<your-domain>/api/health`, `pm2 status`, `sudo nginx -t`.
- Не включайте настоящий Telegram-транспорт, не передавайте реальные сообщения и не заполняйте зарезервированный `BOT_TOKEN`: текущая сборка не обрабатывает реальные корпоративные чаты.
- Реальный домен, SSH-ключи, токены и данные участников не добавляйте в Git и не выводите в логи.
