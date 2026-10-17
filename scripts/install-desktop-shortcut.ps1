$ErrorActionPreference = 'Stop'
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskIcon = Join-Path $PSScriptRoot 'desktop\playroom.ico'
$taskLauncher = Join-Path $PSScriptRoot 'launch-desktop.ps1'
if (-not (Test-Path -LiteralPath $taskIcon -PathType Leaf)) { throw 'The application icon is missing.' }
if (-not (Test-Path -LiteralPath $taskLauncher -PathType Leaf)) { throw 'The desktop launcher is missing.' }
$taskDesktop = [Environment]::GetFolderPath('Desktop')
if (-not $taskDesktop) { throw 'The Windows desktop folder could not be found.' }
# Use Unicode code points so this script also works in Windows PowerShell 5.1.
$taskAppName = -join ([char[]]@(0x5355, 0x8bcd, 0x6e38, 0x4e50, 0x56ed))
$taskShortcutPath = Join-Path $taskDesktop ($taskAppName + '.lnk')
$taskShell = New-Object -ComObject WScript.Shell
$taskShortcut = $taskShell.CreateShortcut($taskShortcutPath)
if ((Test-Path -LiteralPath $taskShortcutPath) -and $taskShortcut.WorkingDirectory -ne $taskRoot) {
  throw 'A shortcut with this name belongs to another location. It was left unchanged.'
}
$taskShortcut.TargetPath = (Get-Command powershell.exe).Source
$taskShortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $taskLauncher + '"'
$taskShortcut.WorkingDirectory = $taskRoot
$taskShortcut.IconLocation = $taskIcon + ',0'
$taskShortcut.Description = $taskAppName + ' - http://127.0.0.1:8787'
$taskShortcut.WindowStyle = 7
$taskShortcut.Save()
Write-Host ('Desktop shortcut: ' + $taskShortcutPath)
