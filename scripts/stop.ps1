$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskServer = Join-Path $taskRoot 'server\index.ts'
$taskListeners = @(Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue)
foreach ($taskListener in $taskListeners) {
  $taskProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($taskListener.OwningProcess)"
  if (-not $taskProcess -or -not $taskProcess.CommandLine -or -not $taskProcess.CommandLine.Contains($taskServer)) {
    throw 'Port 8787 belongs to another application; it was left running.'
  }
  Stop-Process -Id $taskProcess.ProcessId
}
Write-Host 'The local word playroom is stopped.'
