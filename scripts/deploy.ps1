$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

if (-not (Test-Path ".env")) {
    if (-not (Test-Path ".env.example")) {
        throw "Не найден .env.example — невозможно подготовить .env."
    }
    Copy-Item ".env.example" ".env"
    Write-Host "Заполните токены в .env и запустите скрипт снова"
    exit 1
}

function Test-DockerCompose {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        return $false
    }
    & docker compose version *> $null
    return ($LASTEXITCODE -eq 0)
}

if (-not (Test-DockerCompose)) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Docker и Docker Compose не найдены, а winget недоступен. Установите Docker Desktop: https://docs.docker.com/desktop/setup/install/windows-install/"
    }

    Write-Host "Устанавливаю Docker Desktop через winget..."
    & $winget.Source install --id Docker.DockerDesktop --exact --source winget --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "Не удалось установить Docker Desktop через winget (код $LASTEXITCODE)."
    }

    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

$dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (Test-Path $dockerDesktop) {
    $desktopProcess = Get-Process -Name "Docker Desktop" -ErrorAction SilentlyContinue
    if (-not $desktopProcess) {
        Start-Process $dockerDesktop
    }
}

$dockerReady = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Test-DockerCompose) {
        & docker info *> $null
        if ($LASTEXITCODE -eq 0) {
            $dockerReady = $true
            break
        }
    }
    Start-Sleep -Seconds 2
}

if (-not $dockerReady) {
    throw "Docker Desktop не запустился. Завершите первоначальную настройку Docker Desktop/WSL и запустите скрипт снова."
}

& docker compose up -d --build
if ($LASTEXITCODE -ne 0) {
    throw "docker compose up завершился с кодом $LASTEXITCODE."
}

Write-Host "Vibee успешно запущен! Сервер доступен на порту 8787"
