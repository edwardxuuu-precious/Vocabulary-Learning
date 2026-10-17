$ErrorActionPreference = 'Stop'
try {
  & (Join-Path $PSScriptRoot 'launch.ps1')
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "The local app could not start. Open the project launcher for details.`n`n$($_.Exception.Message)",
    'Word Playroom', 'OK', 'Error'
  ) | Out-Null
  exit 1
}
