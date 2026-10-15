param([string]$Text = '我喜欢会变身的挖掘机。')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$taskRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskAudioDir = Join-Path $taskRoot 'artifacts'
New-Item -ItemType Directory -Path $taskAudioDir -Force | Out-Null
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $taskChineseVoice = $taskSynth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh-*' } | Select-Object -First 1
  if (-not $taskChineseVoice) { throw 'No installed Chinese Windows voice for synthetic STT fixture.' }
  $taskSynth.SelectVoice($taskChineseVoice.VoiceInfo.Name)
  $taskFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $taskOutput = Join-Path $taskAudioDir 'synthetic-stt-fixture.wav'
  $taskSynth.SetOutputToWaveFile($taskOutput, $taskFormat)
  $taskSynth.Speak($Text)
  $taskSynth.SetOutputToNull()
  Write-Host 'Saved synthetic 16kHz mono fixture in artifacts/synthetic-stt-fixture.wav. This is not child audio.'
} finally { $taskSynth.Dispose() }
