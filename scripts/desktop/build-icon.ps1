# Format conversion only: preserve the approved artwork and transparent background.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$taskSourcePath = Join-Path $PSScriptRoot '..\..\public\assets\brand\bumblebee-mecha-v2.png'
$taskSource = [System.Drawing.Image]::FromFile([System.IO.Path]::GetFullPath($taskSourcePath))
$taskSizes = @(16, 24, 32, 48, 64, 128, 256)
$taskFrames = @()
try {
  foreach ($taskSize in $taskSizes) {
    $taskBitmap = New-Object System.Drawing.Bitmap($taskSize, $taskSize)
    $taskGraphics = [System.Drawing.Graphics]::FromImage($taskBitmap)
    $taskStream = New-Object System.IO.MemoryStream
    try {
      $taskGraphics.Clear([System.Drawing.Color]::Transparent)
      $taskGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $taskScale = [Math]::Min($taskSize / $taskSource.Width, $taskSize / $taskSource.Height)
      $taskWidth = [int][Math]::Round($taskSource.Width * $taskScale)
      $taskHeight = [int][Math]::Round($taskSource.Height * $taskScale)
      $taskGraphics.DrawImage($taskSource, [int](($taskSize - $taskWidth) / 2), [int](($taskSize - $taskHeight) / 2), $taskWidth, $taskHeight)
      $taskBitmap.Save($taskStream, [System.Drawing.Imaging.ImageFormat]::Png)
      $taskFrames += ,($taskStream.ToArray())
    } finally { $taskGraphics.Dispose(); $taskBitmap.Dispose(); $taskStream.Dispose() }
  }
  $taskOutput = [System.IO.File]::Create((Join-Path $PSScriptRoot 'playroom.ico'))
  $taskWriter = New-Object System.IO.BinaryWriter($taskOutput)
  try {
    $taskWriter.Write([uint16]0); $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]$taskSizes.Count)
    $taskOffset = 6 + 16 * $taskSizes.Count
    for ($taskIndex = 0; $taskIndex -lt $taskSizes.Count; $taskIndex++) {
      $taskDimension = $taskSizes[$taskIndex] % 256
      $taskWriter.Write([byte]$taskDimension); $taskWriter.Write([byte]$taskDimension)
      $taskWriter.Write([byte]0); $taskWriter.Write([byte]0)
      $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]32)
      $taskWriter.Write([uint32]$taskFrames[$taskIndex].Length); $taskWriter.Write([uint32]$taskOffset)
      $taskOffset += $taskFrames[$taskIndex].Length
    }
    foreach ($taskFrame in $taskFrames) { $taskWriter.Write([byte[]]$taskFrame) }
  } finally { $taskWriter.Dispose(); $taskOutput.Dispose() }
} finally { $taskSource.Dispose() }
