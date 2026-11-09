# 🚀 Универсальное руководство по деплою Vibee на VPS за 5 минут

Пошаговая инструкция по установке и запуску **Vibee** на любом VPS / выделенном сервере с **Ubuntu 22.04 LTS** (Timeweb, Hetzner, DigitalOcean, Selectel, Beget и др.).

---

## ⚡ Экспресс-установка в 1 команду

Если у вас свежий сервер на Ubuntu/Debian, войдите по SSH и выполните:

```bash
git clone https://github.com/augustteske/vibebot.git && cd vibebot && bash scripts/bootstrap.sh
```

Скрипт автоматически установит Docker, Docker Compose, создаст файл `.env` и поднимет контейнеры.

---

## 📋 Пошаговая ручная установка

### Шаг 1. Подключитесь к VPS по SSH

Откройте терминал на вашем компьютере:

```bash
ssh root@<IP_ВАШЕГО_СЕРВЕРА>
```
*(Если хостинг выдал отдельного пользователя, например `ubuntu`: `ssh ubuntu@<IP_ВАШЕГО_СЕРВЕРА>`)*

---

### Шаг 2. Установите Docker и Docker Compose

Обновите пакеты и установите Docker через официальный скрипт:

```bash
apt-get update && apt-get install -y curl git
curl -fsSL https://get.docker.com | sh
```

Убедитесь, что Docker работает:

```bash
docker --version
docker compose version
```

---

### Шаг 3. Склонируйте репозиторий

```bash
git clone https://github.com/augustteske/vibebot.git /opt/vibee
cd /opt/vibee
```

---

### Шаг 4. Настройте файл переменных окружения `.env`

Скопируйте шаблон:

```bash
cp .env.example .env
nano .env
```

Минимальные настройки для запуска по HTTP (по IP-адресу сервера):

```dotenv
# Основные параметры сервера
HOST=0.0.0.0
PORT=8787
NODE_ENV=production
COOKIE_SECURE=false

# Укажите публичный IP вашего сервера (или домен)
APP_ORIGIN=http://<IP_ВАШЕГО_СЕРВЕРА>:8787

# Токен Telegram-бота от @BotFather (необязательно для веб-версии, но нужен для бота)
TELEGRAM_BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ

# Провайдер рекомендаций (по умолчанию локальные шаблоны без внешних затрат)
LLM_PROVIDER=template
```

> **Совет:** Сохраните файл в `nano`: нажмите `Ctrl + O`, затем `Enter`, и для выхода `Ctrl + X`.

---

### Шаг 5. Запустите приложение через Docker Compose

Запустите контейнеры в фоновом режиме:

```bash
docker compose up -d --build
```

Docker соберёт легковесный образ Node.js, применит миграции SQLite в постоянном volume `vibebot_data` и автоматически настроит перезапуск (`restart: unless-stopped`).

---

### Шаг 6. Проверьте работоспособность

Проверьте статус сервисов:

```bash
docker compose ps
```

Проверьте эндпоинт здоровья:

```bash
curl -f http://127.0.0.1:8787/api/health
```
Ответ должен быть:
```json
{"ok":true}
```

Теперь откройте в браузере: `http://<IP_ВАШЕГО_СЕРВЕРА>:8787` — веб-кабинет готов к работе!

---

## 🔒 Настройка домена и HTTPS

Чтобы подключить собственный домен (например, `vibee.mycompany.com`) и получить бесплатный SSL-сертификат, выберите один из двух простых способов:

### Вариант A. Caddy (самый быстрый способ, SSL за 2 минуты)

Caddy автоматически получает и обновляет SSL-сертификаты от Let's Encrypt без certbot.

1. Установите Caddy:
   ```bash
   apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
   apt-get update && apt-get install -y caddy
   ```

2. Откройте `/etc/caddy/Caddyfile`:
   ```caddy
   vibee.mycompany.com {
       reverse_proxy 127.0.0.1:8787
   }
   ```

3. Перезапустите Caddy:
   ```bash
   systemctl restart caddy
   ```

4. В `.env` обновите переменные:
   ```dotenv
   COOKIE_SECURE=true
   APP_ORIGIN=https://vibee.mycompany.com
   ```
   и выполните: `docker compose up -d`.

---

### Вариант B. Nginx + Certbot (классический стек)

1. Установите Nginx и Certbot:
   ```bash
   apt-get install -y nginx certbot python3-certbot-nginx
   ```

2. Создайте файл конфигурации `/etc/nginx/sites-available/vibee`:
   ```nginx
   server {
       listen 80;
       server_name vibee.mycompany.com;

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

3. Активируйте сайт и проверьте конфиг:
   ```bash
   ln -s /etc/nginx/sites-available/vibee /etc/nginx/sites-enabled/
   nginx -t
   systemctl reload nginx
   ```

4. Получите бесплатный SSL-сертификат:
   ```bash
   certbot --nginx -d vibee.mycompany.com
   ```

5. В файле `.env` установите:
   ```dotenv
   COOKIE_SECURE=true
   APP_ORIGIN=https://vibee.mycompany.com
   ```
   И перезапустите: `docker compose up -d`.

---

## 🔄 Обновление Vibee на новую версию

Обновление занимает 30 секунд:

```bash
cd /opt/vibee
git pull origin main
docker compose up -d --build
```

База данных и пользовательские сессии сохраняются в Docker volume `vibebot_data` и не стираются при пересборке.

---

## 🛠️ Полезные команды для обслуживания

- **Смотреть логи приложения в реальном времени:**
  ```bash
  docker compose logs -f web
  ```
- **Смотреть логи Telegram-бота:**
  ```bash
  docker compose logs -f bot
  ```
- **Перезапустить сервер:**
  ```bash
  docker compose restart
  ```
- **Остановить контейнеры:**
  ```bash
  docker compose down
  ```
