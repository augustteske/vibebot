param([Parameter(Mandatory=$true)][string]$RepositoryUrl)
$ErrorActionPreference = 'Stop'
if ($RepositoryUrl -notmatch '^https://[^\s]+/[^\s]+/[^\s]+(?:\.git)?$' -and $RepositoryUrl -notmatch '^git@[^\s:]+:[^\s]+/[^\s]+(?:\.git)?$') { throw 'Use the exact HTTPS or SSH clone URL from your GitLab project.' }
if ($RepositoryUrl -match '^https://[^/]*@') { throw 'Do not embed credentials in the repository URL.' }
function Invoke-VibeGit { & git @args; if ($LASTEXITCODE -ne 0) { throw 'Git command failed. Check access and the displayed error.' } }
Invoke-VibeGit rev-parse --show-toplevel
$vibeExisting = & git remote get-url gitlab 2>$null
if ($LASTEXITCODE -eq 0) {
  if ($vibeExisting -ne $RepositoryUrl) { throw 'The gitlab remote already points elsewhere. Review it first.' }
} else { Invoke-VibeGit remote add gitlab $RepositoryUrl }
$vibeRemoteRefs = & git ls-remote gitlab
if ($LASTEXITCODE -ne 0) { throw 'Cannot access GitLab. Sign in using your regular Git authentication.' }
if ($vibeRemoteRefs) { throw 'The target repository is not empty. Review its history before merging; no force-push was attempted.' }
Invoke-VibeGit push gitlab main develop feat/august-core feat/ilian-checkin feat/arina-actions feat/alisa-insights-demo
Invoke-VibeGit ls-remote --heads gitlab
Write-Output 'Six branches uploaded. Verify the GitLab pipeline before changing the primary remote.'
