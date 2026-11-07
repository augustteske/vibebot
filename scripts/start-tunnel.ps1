param(
    [ValidateRange(1024, 65535)][int]$Port = 8787,
    [ValidateSet('auto', 'http2', 'quic')][string]$Protocol = 'auto',
    [string[]]$EdgeAddress = @(),
    [string]$EdgeBindAddress
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtime = Join-Path $root ".vibee.local\$Port"
$cf = Join-Path $env:LOCALAPPDATA 'Cloudflare\cloudflared\cloudflared.exe'
if (-not (Test-Path $cf)) { throw 'Install the official cloudflared EXE; see docs/WINDOWS_TUNNEL.md.' }
if (Get-Process cloudflared -ErrorAction SilentlyContinue) {
    throw 'cloudflared is already running. Inspect it before starting another tunnel.'
}
if (-not (Test-Path (Join-Path $root 'dist/index.html'))) { throw 'Build the frontend first.' }
if ($EdgeBindAddress) { [void][Net.IPAddress]::Parse($EdgeBindAddress) }
foreach ($edge in $EdgeAddress) {
    if ($edge -notmatch '^\d{1,3}(\.\d{1,3}){3}:7844$') { throw 'EdgeAddress must be an IPv4 Cloudflare edge address on port 7844.' }
    [void][Net.IPAddress]::Parse(($edge -split ':')[0])
}
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
$configFile = Join-Path $runtime 'config.json'
$dataDir = ''
if (Test-Path $configFile) { $dataDir = (Get-Content $configFile -Raw | ConvertFrom-Json).dataDir }
# Shut down local HTTP before publication; retain the existing database directory.
& (Join-Path $PSScriptRoot 'stop-local.ps1') -Port $Port
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw 'The application port is still in use. No tunnel was started.'
}
$outLog = Join-Path $runtime 'tunnel.stdout.log'
$errLog = Join-Path $runtime 'tunnel.stderr.log'
$arguments = @('tunnel', '--url', "http://127.0.0.1:$Port", '--metrics', '127.0.0.1:0', '--protocol', $Protocol)
if ($EdgeBindAddress) {
    $arguments += @('--edge-bind-address', $EdgeBindAddress)
}
foreach ($edge in $EdgeAddress) {
    $arguments += @('--edge', $edge)
}
if ($EdgeAddress.Count -gt 0) { $arguments += '--no-prechecks' }
$tunnel = Start-Process -FilePath $cf -ArgumentList $arguments `
    -WorkingDirectory $root -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog
$stateFile = Join-Path $runtime 'tunnel.json'
$state = @{ pid = $tunnel.Id; started = $tunnel.StartTime.ToUniversalTime().Ticks.ToString(); executable = $cf; origin = ''; protocol = $Protocol; edgeAddresses = $EdgeAddress; edgeBindAddress = $EdgeBindAddress }
$state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
try {
    for ($attempt = 0; $attempt -lt 90; $attempt++) {
        $tunnel.Refresh()
        if ($tunnel.HasExited) { throw "cloudflared exited. Inspect $errLog locally." }
        $log = (Get-Content $outLog,$errLog -Raw -ErrorAction SilentlyContinue) -join "`n"
        $match = [regex]::Match($log, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($match.Success -and $log -match 'Registered tunnel connection') {
            $state.origin = $match.Value
            $state | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
            & (Join-Path $PSScriptRoot 'start-local.ps1') -Port $Port -SkipBuild -PublicOrigin $state.origin -DataDir $dataDir
            Write-Host "Quick Tunnel: $($state.origin) (PID $($tunnel.Id))"
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw 'Timed out waiting for the hostname and a registered tunnel connection.'
} catch {
    & (Join-Path $PSScriptRoot 'stop-tunnel.ps1') -Port $Port
    # Restore local service if startup failed before the app became available.
    if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
        & (Join-Path $PSScriptRoot 'start-local.ps1') -Port $Port -SkipBuild -DataDir $dataDir
    }
    throw
}
