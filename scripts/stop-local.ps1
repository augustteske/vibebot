param([ValidateRange(1024, 65535)][int]$Port = 8787)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $root ".vibee.local\$Port"
$stateFile = Join-Path $runtime 'process.json'
if (-not (Test-Path $stateFile)) { Write-Host 'No managed Vibee process.'; return }
$state = Get-Content $stateFile -Raw | ConvertFrom-Json
$child = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
if (-not $child -or $child.StartTime.ToUniversalTime().Ticks.ToString() -ne $state.started) {
    Remove-Item -LiteralPath $stateFile
    Write-Host 'Vibee is already stopped.'
    return
}
New-Item -ItemType File -Path (Join-Path $runtime 'stop') -Force | Out-Null
if (-not $child.WaitForExit(15000)) { throw 'Graceful stop timed out. Process was not forcibly terminated.' }
Remove-Item -LiteralPath $stateFile
Write-Host 'Vibee stopped; SQLite data retained.'
