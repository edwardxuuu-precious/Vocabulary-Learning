param([string]$Only)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$taskFixtureDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\artifacts\voice-e2e-fixtures'))
New-Item -ItemType Directory -Path $taskFixtureDir -Force | Out-Null
$taskSynth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$taskFormat = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
try {
  foreach ($taskName in (@('interest', 'interest2', 'pause2', 'pause3', 'confirm', 'start', 'apple', 'banana', 'cat') | Where-Object { -not $Only -or $_ -eq $Only })) {
    $taskLocale = if ($taskName -in @('apple', 'banana', 'cat')) { 'en-US' } else { 'zh-CN' }
    $taskCulture = [System.Globalization.CultureInfo]::GetCultureInfo($taskLocale)
    $taskSynth.SelectVoiceByHints([System.Speech.Synthesis.VoiceGender]::Female, [System.Speech.Synthesis.VoiceAge]::Adult, 0, $taskCulture)
    $taskPrompt = New-Object System.Speech.Synthesis.PromptBuilder($taskCulture)
    switch ($taskName) {
      'interest' { $taskPrompt.AppendText('我喜欢会变身的挖掘机。') }
      'interest2' { $taskPrompt.AppendText('我还喜欢在月球上种西瓜。') }
      'pause2' { $taskPrompt.AppendText('我喜欢'); $taskPrompt.AppendBreak([TimeSpan]::FromSeconds(2)); $taskPrompt.AppendText('会变身的挖掘机。') }
      'pause3' { $taskPrompt.AppendText('我喜欢'); $taskPrompt.AppendBreak([TimeSpan]::FromSeconds(3)); $taskPrompt.AppendText('会变身的挖掘机。') }
      'confirm' { $taskPrompt.AppendText('对。') }
      'start' { $taskPrompt.AppendText('开始学习。') }
      'apple' { $taskPrompt.AppendText('apple') }
      'banana' { $taskPrompt.AppendText('banana') }
      'cat' { $taskPrompt.AppendText('cat') }
    }
    $taskSynth.SetOutputToWaveFile((Join-Path $taskFixtureDir ($taskName + '.wav')), $taskFormat)
    $taskSynth.Speak($taskPrompt)
    $taskSynth.SetOutputToNull()
    $taskBytes = [System.IO.File]::ReadAllBytes((Join-Path $taskFixtureDir ($taskName + '.wav')))
    $taskDataAt = [System.Text.Encoding]::ASCII.GetString($taskBytes).IndexOf('data')
    $taskPeak = 0
    if ($taskDataAt -ge 0) {
      for ($taskAt = $taskDataAt + 8; $taskAt + 1 -lt $taskBytes.Length; $taskAt += 2) {
        $taskPeak = [Math]::Max($taskPeak, [Math]::Abs([int][BitConverter]::ToInt16($taskBytes, $taskAt)))
      }
    }
    if ($taskPeak -lt 500) { throw ('Synthetic fixture contains no usable speech: ' + $taskName) }
  }
} finally { $taskSynth.Dispose() }
Write-Host ('Synthetic fixtures created in: ' + $taskFixtureDir)
