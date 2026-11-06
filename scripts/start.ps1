param(
    [switch]$Bot,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ComposeArgs
)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $root

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Created .env from .env.example. Review it before enabling optional services."
}

if ($Bot) {
    $envContents = Get-Content ".env" -Raw
    if ($envContents -notmatch "(?m)^TELEGRAM_BOT_TOKEN=.+$") {
        throw "Set TELEGRAM_BOT_TOKEN in .env before starting the bot."
    }
    & docker compose --profile bot-demo up --build @ComposeArgs
} else {
    & docker compose up --build @ComposeArgs
}
exit $LASTEXITCODE
