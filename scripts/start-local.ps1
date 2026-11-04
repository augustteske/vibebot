param(
    [ValidateRange(1024, 65535)][int]$Port = 8787,
    [string]$PublicOrigin,
    [string]$DataDir,
    [switch]$SkipBuild
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $root
try {
    $node = (Get-Command node -ErrorAction Stop).Source
    if ((& $node --version) -notmatch '^v24\.') { throw 'Node.js 24 is required.' }
    $origin = "http://127.0.0.1:$Port"
    if ($PublicOrigin) {
        $uri = [Uri]$PublicOrigin
        if ($uri.Scheme -ne 'https' -or $uri.GetLeftPart([UriPartial]::Authority) -cne $PublicOrigin -or $uri.UserInfo) {
            throw 'PublicOrigin must be an exact HTTPS origin without credentials, path or trailing slash.'
        }
        $origin = $PublicOrigin
    }
    $runtime = Join-Path $root ".vibee.local\$Port"
    $stateFile = Join-Path $runtime 'process.json'
    if (Test-Path $stateFile) {
        $state = Get-Content $stateFile -Raw | ConvertFrom-Json
        $existing = Get-Process -Id $state.pid -ErrorAction SilentlyContinue
        if ($existing -and $existing.StartTime.ToUniversalTime().Ticks.ToString() -eq $state.started) {
            throw "Vibee is already running. Stop it with scripts/stop-local.ps1 -Port $Port first."
        }
    }
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $Port)
    try { $listener.Start() } finally { $listener.Stop() }
    if (-not $SkipBuild) {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
    }
    if (-not (Test-Path 'dist/index.html')) { throw 'Run npm run build first.' }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $stopFile = Join-Path $runtime 'stop'
    if (Test-Path $stopFile) { Remove-Item -LiteralPath $stopFile }
    $configFile = Join-Path $runtime 'config.json'
    @{ port = $Port; origin = $origin; dataDir = $DataDir; stopFile = $stopFile } |
        ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding UTF8
    $launcher = Join-Path $PSScriptRoot 'local-server.mjs'
    $child = Start-Process -FilePath $node -ArgumentList @('"' + $launcher + '"', '"' + $configFile + '"') `
        -WorkingDirectory $root -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtime 'stdout.log') -RedirectStandardError (Join-Path $runtime 'stderr.log')
    @{ pid = $child.Id; started = $child.StartTime.ToUniversalTime().Ticks.ToString() } |
        ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        $child.Refresh()
        if ($child.HasExited) { throw "Vibee exited. Inspect $runtime\stderr.log locally." }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
            if ($health.ok) { Write-Host "Vibee ready: $origin (listening on 127.0.0.1:$Port)"; return }
        } catch { }
        Start-Sleep -Milliseconds 250
    }
    New-Item -ItemType File -Path $stopFile -Force | Out-Null
    throw 'Startup healthcheck timed out; graceful stop requested.'
} finally { Pop-Location }
