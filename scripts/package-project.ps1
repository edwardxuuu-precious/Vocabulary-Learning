param()
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskOutput = Join-Path $taskRoot 'artifacts\project-package'
$taskStage = Join-Path $taskOutput ('.staging-' + [guid]::NewGuid().ToString('N'))
$taskZip = Join-Path $taskOutput 'little-word-playroom.zip'
$taskTempZip = Join-Path $taskOutput ('.package-' + [guid]::NewGuid().ToString('N') + '.zip')
$taskUtf8 = New-Object System.Text.UTF8Encoding($false)
$taskRootFiles = @('.env.example', '.gitignore', 'AGENTS.md', 'README.md', 'package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts')
$taskRootFiles += @(Get-ChildItem -LiteralPath $taskRoot -File -Filter '*.cmd' | ForEach-Object { $_.Name })
$taskDirectories = @('src', 'server', 'shared', 'public', 'scripts', 'tests', 'docs')

function Assert-TaskChild([string]$candidate, [string]$parent) {
    $taskAbsolute = [IO.Path]::GetFullPath($candidate)
    $taskPrefix = [IO.Path]::GetFullPath($parent).TrimEnd('\') + '\'
    if (-not $taskAbsolute.StartsWith($taskPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path escaped the allowed directory.' }
}

function Get-TaskHash([string]$taskPath) {
    $taskInput = [IO.File]::OpenRead($taskPath)
    $taskAlgorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($taskAlgorithm.ComputeHash($taskInput)).Replace('-', '').ToLowerInvariant() }
    finally { $taskInput.Dispose(); $taskAlgorithm.Dispose() }
}

New-Item -ItemType Directory -Path $taskStage -Force | Out-Null
try {
    $taskFiles = @($taskRootFiles | ForEach-Object { Get-Item -LiteralPath (Join-Path $taskRoot $_) })
    foreach ($taskDirectory in $taskDirectories) {
        if ((Get-Item -LiteralPath (Join-Path $taskRoot $taskDirectory)).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package roots must not be links or junctions.' }
        $taskTree = @(Get-ChildItem -LiteralPath (Join-Path $taskRoot $taskDirectory) -Recurse -Force)
        if (@($taskTree | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) { throw 'Package inputs must not contain links or junctions.' }
        $taskFiles += @($taskTree | Where-Object { -not $_.PSIsContainer })
    }
    $taskEntries = @()
    foreach ($taskFile in ($taskFiles | Sort-Object FullName -Unique)) {
        Assert-TaskChild $taskFile.FullName $taskRoot
        if ($taskFile.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package inputs must not contain links.' }
        $taskRelative = $taskFile.FullName.Substring($taskRoot.Length + 1).Replace('\', '/')
        if ($taskRelative -match '(^|/)(\.schema|archive|legacy)(/|$)') { continue }
        if ($taskRelative -match '(^|/)(\.env($|\.)|auth\.json$)|\.(sqlite(-wal|-shm)?|log|mp3|wav|webm|zip)$') {
            if ($taskRelative -ne '.env.example') { throw ('Unexpected private/generated file in package inputs: ' + $taskRelative) }
        }
        $taskDestination = Join-Path $taskStage $taskRelative
        New-Item -ItemType Directory -Path (Split-Path -Parent $taskDestination) -Force | Out-Null
        Copy-Item -LiteralPath $taskFile.FullName -Destination $taskDestination
        $taskEntries += [ordered]@{ path = $taskRelative; bytes = (Get-Item -LiteralPath $taskDestination).Length; sha256 = (Get-TaskHash $taskDestination) }
    }
    $taskPackage = Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $taskManifest = [ordered]@{
        formatVersion = 1; name = $taskPackage.name; version = $taskPackage.version
        createdAt = (Get-Date).ToString('o'); source = 'local working-tree snapshot'
        excluded = @('.env', 'data', 'node_modules', 'dist', 'artifacts', 'Work_Progress', '.git', 'docs/archive', 'scripts/legacy', 'server/integrations/.schema')
        files = $taskEntries
    }
    [IO.File]::WriteAllText((Join-Path $taskStage 'PROJECT_MANIFEST.json'), ($taskManifest | ConvertTo-Json -Depth 6), $taskUtf8)
    $taskWriter = [IO.Compression.ZipFile]::Open($taskTempZip, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($taskStaged in (Get-ChildItem -LiteralPath $taskStage -Recurse -Force -File)) {
            $taskZipPath = $taskStaged.FullName.Substring($taskStage.Length + 1).Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskWriter, $taskStaged.FullName, $taskZipPath, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $taskWriter.Dispose() }
    $taskArchive = [IO.Compression.ZipFile]::OpenRead($taskTempZip)
    try {
        if ($taskArchive.Entries.Count -ne $taskEntries.Count + 1) { throw 'Package file count mismatch.' }
        foreach ($taskEntry in $taskEntries) {
            $taskArchived = $taskArchive.GetEntry($taskEntry.path)
            if (-not $taskArchived -or $taskArchived.Length -ne $taskEntry.bytes) { throw ('Missing/truncated package entry: ' + $taskEntry.path) }
            $taskStream = $taskArchived.Open()
            $taskHasher = [Security.Cryptography.SHA256]::Create()
            try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskStream)).Replace('-', '').ToLowerInvariant() }
            finally { $taskStream.Dispose(); $taskHasher.Dispose() }
            if ($taskHash -ne $taskEntry.sha256) { throw ('Package hash mismatch: ' + $taskEntry.path) }
        }
    } finally { $taskArchive.Dispose() }
    # Refuse a moving source tree; retain the previous successful archive on failure.
    $taskCurrentPaths = @($taskRootFiles)
    foreach ($taskDirectory in $taskDirectories) {
        $taskCurrentPaths += @(Get-ChildItem -LiteralPath (Join-Path $taskRoot $taskDirectory) -Recurse -Force -File | ForEach-Object { $_.FullName.Substring($taskRoot.Length + 1).Replace('\', '/') })
    }
    $taskCurrentPaths = @($taskCurrentPaths | Where-Object { $_ -notmatch '(^|/)(\.schema|archive|legacy)(/|$)' } | Sort-Object -Unique)
    $taskSnapshotPaths = @($taskEntries | ForEach-Object { $_.path } | Sort-Object -Unique)
    if (Compare-Object $taskCurrentPaths $taskSnapshotPaths) { throw 'Source inventory changed during packaging; retry after other work stops.' }
    foreach ($taskEntry in $taskEntries) {
        if ((Get-TaskHash (Join-Path $taskRoot $taskEntry.path)) -ne $taskEntry.sha256) { throw ('Source changed during packaging: ' + $taskEntry.path) }
    }
    Move-Item -LiteralPath $taskTempZip -Destination $taskZip -Force
    $taskZipHash = Get-TaskHash $taskZip
    [IO.File]::WriteAllText(($taskZip + '.sha256'), ($taskZipHash + '  little-word-playroom.zip' + "`n"), $taskUtf8)
    Write-Host ('Package verified: ' + $taskZip)
    Write-Host ('Files: ' + $taskEntries.Count + '; bytes: ' + (Get-Item -LiteralPath $taskZip).Length)
} finally {
    Assert-TaskChild $taskStage $taskOutput
    if (Test-Path -LiteralPath $taskStage) { Remove-Item -LiteralPath $taskStage -Recurse -Force }
    Assert-TaskChild $taskTempZip $taskOutput
    if (Test-Path -LiteralPath $taskTempZip) { Remove-Item -LiteralPath $taskTempZip -Force }
}
