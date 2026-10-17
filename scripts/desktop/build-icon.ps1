# Render the local, flat SVG paths with Windows WPF; no cloud service is used.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore, WindowsBase
$taskSourcePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\public\assets\brand\playroom-simple.svg'))
$taskSource = New-Object System.Xml.XmlDocument
$taskSource.XmlResolver = $null
$taskSource.Load($taskSourcePath)
if ($taskSource.DocumentElement.GetAttribute('viewBox') -ne '0 0 256 256') { throw 'The icon source must use a 256 by 256 viewBox.' }
$taskShapes = @($taskSource.DocumentElement.ChildNodes | Where-Object { $_.LocalName -eq 'path' } | ForEach-Object {
  [pscustomobject]@{
    Geometry = [System.Windows.Media.Geometry]::Parse($_.GetAttribute('d'))
    Brush = [System.Windows.Media.BrushConverter]::new().ConvertFromString($_.GetAttribute('fill'))
  }
})
if ($taskShapes.Count -eq 0) { throw 'The icon source contains no paths.' }
$taskSizes = @(16, 24, 32, 48, 64, 128, 256)
$taskFrames = @()
foreach ($taskSize in $taskSizes) {
  $taskVisual = New-Object System.Windows.Media.DrawingVisual
  $taskDrawing = $taskVisual.RenderOpen()
  try {
    $taskScale = $taskSize / 256.0
    $taskDrawing.PushTransform([System.Windows.Media.ScaleTransform]::new($taskScale, $taskScale))
    foreach ($taskShape in $taskShapes) { $taskDrawing.DrawGeometry($taskShape.Brush, $null, $taskShape.Geometry) }
    $taskDrawing.Pop()
  } finally { $taskDrawing.Close() }
  $taskBitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new($taskSize, $taskSize, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
  $taskBitmap.Render($taskVisual)
  $taskEncoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
  $taskEncoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($taskBitmap))
  $taskStream = New-Object System.IO.MemoryStream
  try {
    $taskEncoder.Save($taskStream)
    $taskFrames += ,($taskStream.ToArray())
  } finally { $taskStream.Dispose() }
}
$taskOutputPath = Join-Path $PSScriptRoot 'playroom-simple.ico'
$taskOutput = [System.IO.File]::Create($taskOutputPath)
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
Write-Host ('Icon built: ' + $taskOutputPath)
$taskBrowserIconPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\public\assets\brand\playroom-simple.ico'))
Copy-Item -LiteralPath $taskOutputPath -Destination $taskBrowserIconPath -Force
Write-Host ('Browser icon synced: ' + $taskBrowserIconPath)
