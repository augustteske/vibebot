#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$APP_DIR"
mkdir -p .data

run_privileged() {
  if [[ "$(id -u)" -eq 0 ]]; then
    env DEBIAN_FRONTEND=noninteractive "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo env DEBIAN_FRONTEND=noninteractive "$@"
  else
    printf '%s\n' "Для установки пакетов нужны права root или команда sudo." >&2
    return 1
  fi
}

ensure_apt() {
  if ! command -v apt-get >/dev/null 2>&1; then
    printf '%s\n' "Автоматическая установка поддерживается только на Ubuntu/Debian (apt-get)." >&2
    exit 1
  fi
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then
    return
  fi
  ensure_apt
  printf '%s\n' "Устанавливаю git через apt-get..."
  run_privileged apt-get update
  run_privileged apt-get install -y git
}

install_docker_apt() {
  ensure_apt
  if [[ ! -r /etc/os-release ]]; then
    printf '%s\n' "Не удалось определить дистрибутив Linux для установки Docker." >&2
    exit 1
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu)
      docker_repo_os=ubuntu
      docker_repo_codename=${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}
      ;;
    debian)
      docker_repo_os=debian
      docker_repo_codename=${VERSION_CODENAME:-}
      ;;
    *)
      printf 'Автоматическая установка Docker поддерживается только на Ubuntu/Debian (обнаружен %s).\n' "${ID:-unknown}" >&2
      exit 1
      ;;
  esac

  if [[ -z "${docker_repo_codename:-}" ]]; then
    printf '%s\n' "Не удалось определить кодовое имя дистрибутива для репозитория Docker." >&2
    exit 1
  fi

  arch="$(dpkg --print-architecture)"
  printf 'Устанавливаю Docker и Docker Compose через apt-get (архитектура: %s)...\n' "$arch"
  run_privileged apt-get update
  run_privileged apt-get install -y ca-certificates curl
  run_privileged install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${docker_repo_os}/gpg" |
    run_privileged tee /etc/apt/keyrings/docker.asc >/dev/null
  run_privileged chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$arch" "$docker_repo_os" "$docker_repo_codename" |
    run_privileged tee /etc/apt/sources.list.d/docker.list >/dev/null
  run_privileged apt-get update
  run_privileged apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  if command -v systemctl >/dev/null 2>&1; then
    run_privileged systemctl enable --now docker
  fi
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi
  install_docker_apt
  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    printf '%s\n' "Docker и Docker Compose не обнаружены после установки." >&2
    exit 1
  fi
}

ensure_git
ensure_docker

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    cp .env.example .env
    chmod 600 .env || true
    server_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
    if [[ -n "${server_ip:-}" ]]; then
      sed -i "s|APP_ORIGIN=http://127.0.0.1:5173|APP_ORIGIN=http://${server_ip}:8787|g" .env || true
    else
      sed -i "s|APP_ORIGIN=http://127.0.0.1:5173|APP_ORIGIN=http://127.0.0.1:8787|g" .env || true
    fi
    printf '%s\n' "Создан файл .env на основе .env.example."
  else
    printf '%s\n' "Не найден .env.example — невозможно подготовить .env." >&2
    exit 1
  fi
fi

docker_cmd=(docker)
if ! docker info >/dev/null 2>&1 && [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    docker_cmd=(sudo docker)
  else
    printf '%s\n' "Docker установлен, но демон недоступен или нет прав sudo." >&2
    exit 1
  fi
fi

printf '%s\n' "Запускаю сборку и старт контейнеров Vibee..."
"${docker_cmd[@]}" compose up -d --build

server_ip=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
printf '\n%s\n' "======================================================"
printf '%s\n' "   Vibee успешно запущен!"
printf '%s\n' "======================================================"
printf '%s\n' "Проверка здоровья: curl http://127.0.0.1:8787/api/health"
if [[ -n "${server_ip:-}" ]]; then
  printf 'Веб-кабинет: http://%s:8787\n' "$server_ip"
else
  printf '%s\n' "Веб-кабинет: http://<IP-сервера>:8787"
fi
printf '%s\n' "Для подключения Telegram-бота задайте TELEGRAM_BOT_TOKEN в файле .env"
printf '%s\n' "и перезапустите: docker compose up -d --build"
printf '%s\n' "======================================================"
