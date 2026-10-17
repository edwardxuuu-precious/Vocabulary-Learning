param([Parameter(Mandatory=$true)][string]$OutputRoot,[Parameter(Mandatory=$true)][string]$CuesFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Speech
[void][IO.Directory]::CreateDirectory($OutputRoot)
$brush=[Drawing.Brushes]
foreach($name in @('apple-green','car-body','car-wheels','tail','big','small','red','blue','yellow','in','on','under','two')) {
  $bitmap=New-Object Drawing.Bitmap 320,260
  $g=[Drawing.Graphics]::FromImage($bitmap);$g.SmoothingMode='AntiAlias';$g.Clear([Drawing.Color]::FromArgb(250,249,241))
  $outline=New-Object Drawing.Pen ([Drawing.Color]::FromArgb(107,132,158)),5
  switch($name){
    'apple-green' {$g.FillEllipse([Drawing.Brushes]::YellowGreen,65,80,120,130);$g.FillEllipse([Drawing.Brushes]::YellowGreen,135,80,120,130);$g.DrawLine($outline,160,95,169,48);$g.FillEllipse([Drawing.Brushes]::ForestGreen,166,42,55,24)}
    'car-body' {$g.FillRectangle([Drawing.Brushes]::CadetBlue,32,115,255,70);$g.FillRectangle([Drawing.Brushes]::CadetBlue,83,68,135,70);$g.FillRectangle([Drawing.Brushes]::LightCyan,98,78,45,45);$g.FillRectangle([Drawing.Brushes]::LightCyan,157,78,45,45)}
    'car-wheels' {$g.FillEllipse([Drawing.Brushes]::DimGray,45,110,78,78);$g.FillEllipse([Drawing.Brushes]::DimGray,200,110,78,78);$g.FillEllipse([Drawing.Brushes]::LightGray,63,128,42,42);$g.FillEllipse([Drawing.Brushes]::LightGray,218,128,42,42)}
    'tail' {$pen=New-Object Drawing.Pen ([Drawing.Color]::SandyBrown),28;$g.DrawArc($pen,85,40,120,145,250,290);$pen.Dispose()}
    'big' {$g.FillEllipse([Drawing.Brushes]::Coral,48,28,220,220)}
    'small' {$g.FillEllipse([Drawing.Brushes]::Coral,120,95,72,72)}
    'red' {$g.FillRectangle([Drawing.Brushes]::LightCoral,65,40,190,180);for($i=0;$i -lt 4;$i++){$g.DrawLine($outline,85+$i*40,58,85+$i*40,202)}}
    'blue' {$g.FillRectangle([Drawing.Brushes]::CornflowerBlue,65,40,190,180);for($i=0;$i -lt 4;$i++){$g.DrawLine($outline,80,65+$i*40,240,65+$i*40)}}
    'yellow' {$g.FillRectangle([Drawing.Brushes]::Khaki,65,40,190,180);$g.FillEllipse([Drawing.Brushes]::Goldenrod,110,85,100,100)}
    'two' {$font=New-Object Drawing.Font 'Arial',110,([Drawing.FontStyle]::Bold);$g.DrawString('2',$font,[Drawing.Brushes]::SteelBlue,96,22);$font.Dispose()}
    default {$g.DrawRectangle($outline,82,85,158,105);$y=if($name -eq 'in'){120}elseif($name -eq 'on'){38}else{205};$g.FillEllipse([Drawing.Brushes]::Coral,135,$y,40,40)}
  }
  $bitmap.Save((Join-Path $OutputRoot ($name+'.png')),[Drawing.Imaging.ImageFormat]::Png);$outline.Dispose();$g.Dispose();$bitmap.Dispose()
}
$cues=Get-Content -LiteralPath $CuesFile -Raw -Encoding UTF8 | ConvertFrom-Json
$synth=New-Object System.Speech.Synthesis.SpeechSynthesizer
$manifest=@();$index=0
foreach($cue in $cues){$voice=if($cue.locale -eq 'en-US'){'Microsoft Zira Desktop'}else{'Microsoft Huihui Desktop'};$synth.SelectVoice($voice);$synth.Rate=-1;$file=Join-Path $OutputRoot ('cue-'+$index+'.wav');$synth.SetOutputToWaveFile($file);$synth.Speak([string]$cue.text);$synth.SetOutputToNull();$manifest+=@{text=$cue.text;locale=$cue.locale;file=$file};$index++}
$synth.Dispose();$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputRoot 'manifest.json') -Encoding UTF8
Write-Output ('Generated local demo diagrams and '+$index+' offline voice cues.')
