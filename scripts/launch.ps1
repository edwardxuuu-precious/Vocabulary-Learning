param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $taskRoot
$taskHealthUrl = 'http://127.0.0.1:8787/api/health'
$taskHealthy = $false
try { $taskHealth = Invoke-RestMethod -Uri $taskHealthUrl -TimeoutSec 2; $taskHealthy = $taskHealth.ok -eq $true -and $taskHealth.app -eq 'little-word-playroom' } catch {}
if (-not $taskHealthy) {
  if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'node_modules'))) {
    Write-Host 'Installing dependencies...'
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $taskRoot 'dist\index.html'))) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
  }
  $taskNode = (Get-Command node).Source
  $taskTsx = Join-Path $taskRoot 'node_modules\tsx\dist\cli.mjs'
  $taskServer = Join-Path $taskRoot 'server\index.ts'
  $taskLogDir = Join-Path $taskRoot 'data'
  New-Item -ItemType Directory -Path $taskLogDir -Force | Out-Null
  Start-Process -FilePath $taskNode -ArgumentList @('"' + $taskTsx + '"','"' + $taskServer + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $taskLogDir 'server.stdout.log') -RedirectStandardError (Join-Path $taskLogDir 'server.stderr.log') | Out-Null
  for ($taskAttempt = 0; $taskAttempt -lt 40; $taskAttempt++) {
    Start-Sleep -Milliseconds 250
    try { $taskHealth = Invoke-RestMethod -Uri $taskHealthUrl -TimeoutSec 1; if ($taskHealth.ok -eq $true -and $taskHealth.app -eq 'little-word-playroom') { $taskHealthy = $true; break } } catch {}
  }
}
if (-not $taskHealthy) { throw 'The local server did not become ready. See data/server.stderr.log.' }
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8787' }
