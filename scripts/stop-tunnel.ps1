param([ValidateRange(1024, 65535)][int]$Port = 8787)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stateFile = Join-Path $root ".vibee.local\$Port\tunnel.json"
if (-not (Test-Path $stateFile)) { Write-Host 'No managed tunnel.'; return }
$state = Get-Content $stateFile -Raw | ConvertFrom-Json
$tunnel = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
if (-not $tunnel -or $tunnel.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.started) {
    Write-Host 'Recorded tunnel is already stopped; no process was terminated.'
    return
}
if ($tunnel.ProcessName -ne 'cloudflared' -or $tunnel.Path -ne $state.executable) {
    throw 'Tunnel process identity mismatch; refusing to stop it.'
}
Stop-Process -Id $tunnel.Id
if (-not $tunnel.WaitForExit(10000)) { throw 'Tunnel stop timed out.' }
Write-Host 'Public tunnel stopped. Vibee data retained.'
