#!/usr/bin/env bash
set -euo pipefail

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$APP_DIR"

if [[ ! -f .env ]]; then
  if [[ ! -f .env.example ]]; then
    printf '%s\n' "Не найден .env.example — невозможно подготовить .env." >&2
    exit 1
  fi
  cp .env.example .env
  printf '%s\n' "Заполните токены в .env и запустите скрипт снова"
  exit 1
fi

run_privileged() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    printf '%s\n' "Для установки Docker нужны права root или команда sudo." >&2
    return 1
  fi
}

install_docker_linux() {
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
      printf 'Автоматическая установка поддерживается только на Ubuntu/Debian (обнаружен %s).\n' "${ID:-unknown}" >&2
      exit 1
      ;;
  esac

  if [[ -z "$docker_repo_codename" ]]; then
    printf '%s\n' "Не удалось определить кодовое имя дистрибутива для репозитория Docker." >&2
    exit 1
  fi
  command -v apt-get >/dev/null 2>&1 || {
    printf '%s\n' "Для установки Docker на Ubuntu/Debian требуется apt-get." >&2
    exit 1
  }
  command -v curl >/dev/null 2>&1 || {
    printf '%s\n' "Для установки Docker требуется curl." >&2
    exit 1
  }

  printf '%s\n' "Устанавливаю Docker Engine и Docker Compose из официального репозитория Docker..."
  run_privileged apt-get update
  run_privileged apt-get install -y ca-certificates curl
  run_privileged install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${docker_repo_os}/gpg" |
    run_privileged tee /etc/apt/keyrings/docker.asc >/dev/null
  run_privileged chmod a+r /etc/apt/keyrings/docker.asc
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
    "$(dpkg --print-architecture)" "$docker_repo_os" "$docker_repo_codename" |
    run_privileged tee /etc/apt/sources.list.d/docker.list >/dev/null
  run_privileged apt-get update
  run_privileged apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  if command -v systemctl >/dev/null 2>&1; then
    run_privileged systemctl enable --now docker
  fi
}

install_docker_macos() {
  if ! command -v brew >/dev/null 2>&1; then
    printf '%s\n' "Для автоматической установки Docker Desktop на macOS установите Homebrew: https://brew.sh/" >&2
    exit 1
  fi
  printf '%s\n' "Устанавливаю Docker Desktop через Homebrew..."
  brew install --cask docker
  open -a Docker
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  case "$(uname -s)" in
    Linux) install_docker_linux ;;
    Darwin) install_docker_macos ;;
    *)
      printf 'Автоматическая установка Docker не поддерживается в этой ОС: %s\n' "$(uname -s)" >&2
      exit 1
      ;;
  esac

  if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
    printf '%s\n' "Docker и Docker Compose не обнаружены после установки. Проверьте установку и запустите скрипт снова." >&2
    exit 1
  fi
}

ensure_docker

docker_cmd=(docker)
if ! docker info >/dev/null 2>&1 && [[ "$(uname -s)" == "Linux" && "$(id -u)" -ne 0 ]]; then
  if ! command -v sudo >/dev/null 2>&1 || ! sudo -v; then
    printf '%s\n' "Docker установлен, но демон недоступен или нет прав sudo." >&2
    exit 1
  fi
  docker_cmd=(sudo docker)
fi

docker_ready=false
for ((attempt = 0; attempt < 60; attempt++)); do
  if "${docker_cmd[@]}" info >/dev/null 2>&1; then
    docker_ready=true
    break
  fi
  sleep 2
done
if [[ "$docker_ready" != true ]]; then
  printf '%s\n' "Демон Docker не запустился. Запустите Docker Desktop или проверьте установку Docker Engine." >&2
  exit 1
fi

"${docker_cmd[@]}" compose up -d --build
printf '%s\n' "Vibee успешно запущен! Сервер доступен на порту 8787"
