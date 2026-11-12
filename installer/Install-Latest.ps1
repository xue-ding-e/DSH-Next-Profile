#Requires -Version 5.1
param(
    [ValidateSet('next', 'original')][string]$HostKind = 'next',
    [ValidateSet('install', 'check', 'doctor', 'features')][string]$Command = 'install',
    [string]$AppDir,
    [string]$HomeDirectory,
    [switch]$MatchBaseline
)

function Get-DshProfileReleaseAssets {
    param($Release)
    if ($Release.draft -or $Release.prerelease -or $Release.tag_name -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+$') {
        throw 'GitHub did not return a stable Profile release.'
    }
    $version = $Release.tag_name.Substring(1)
    $archiveName = "dsh-next-profile-$version-windows.zip"
    $archive = @($Release.assets | Where-Object { $_.name -ceq $archiveName -and $_.state -eq 'uploaded' })
    $checksums = @($Release.assets | Where-Object { $_.name -ceq 'SHA256SUMS' -and $_.state -eq 'uploaded' })
    if ($archive.Count -ne 1 -or $checksums.Count -ne 1) {
        throw "Release $($Release.tag_name) is incomplete: expected $archiveName and SHA256SUMS."
    }
    $prefix = "https://github.com/xue-ding-e/DSH-Next-Profile/releases/download/$($Release.tag_name)/"
    foreach ($asset in @($archive[0], $checksums[0])) {
        if ($asset.browser_download_url -cne "$prefix$($asset.name)") {
            throw 'The release asset URL does not belong to the selected Profile release.'
        }
    }
    return @{ Archive = $archive[0]; Checksums = $checksums[0] }
}

function Assert-DshProfileChecksum {
    param([string]$ArchivePath, [string]$ArchiveName, [string]$Checksums)
    $hashes = @($Checksums -split '\r?\n' | ForEach-Object {
        if ($_ -cmatch '^([a-f0-9]{64})  (.+)$' -and $Matches[2] -ceq $ArchiveName) { $Matches[1] }
    })
    $stream = [IO.File]::OpenRead($ArchivePath)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $sha256.Dispose() }
    if ($hashes.Count -ne 1 -or $actual -cne $hashes[0]) {
        throw "Release SHA-256 verification failed for $ArchiveName. No installer was run."
    }
}

function Invoke-DshProfileLatest {
    param(
        [string]$HostKind = 'next', [string]$Command = 'install',
        [string]$AppDir, [string]$HomeDirectory, [switch]$MatchBaseline
    )
    $ErrorActionPreference = 'Stop'
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Desktop installation requires Windows.' }
    $headers = @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'DSH-Next-Profile'; 'Cache-Control' = 'no-cache' }
    # Resolve once, then use immutable URLs so a new release cannot mix archive and checksum versions.
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/xue-ding-e/DSH-Next-Profile/releases/latest' -Headers $headers -TimeoutSec 60
    $assets = Get-DshProfileReleaseAssets $release
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("dsh-next-profile-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    try {
        Write-Host "DSH Next Profile $($release.tag_name): $Command (host=$HostKind)"
        $archivePath = Join-Path $tempRoot $assets.Archive.name
        Invoke-WebRequest -UseBasicParsing -Uri $assets.Archive.browser_download_url -Headers $headers -OutFile $archivePath -TimeoutSec 180 | Out-Null
        $checksumResponse = Invoke-WebRequest -UseBasicParsing -Uri $assets.Checksums.browser_download_url -Headers $headers -TimeoutSec 60
        $checksumText = if ($checksumResponse.Content -is [byte[]]) { [Text.Encoding]::UTF8.GetString($checksumResponse.Content) } else { [string]$checksumResponse.Content }
        Assert-DshProfileChecksum $archivePath $assets.Archive.name $checksumText
        $expanded = Join-Path $tempRoot 'release'
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $expanded)
        $installer = Join-Path $expanded 'installer\Install.ps1'
        if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'The release ZIP has no installer/Install.ps1.' }
        $forward = @($Command, '--host', $HostKind)
        if ($AppDir) { $forward += @('--app-dir', $AppDir) }
        if ($HomeDirectory) { $forward += @('--home', $HomeDirectory) }
        if ($MatchBaseline) { $forward += '--match-baseline' }
        $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        & $powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $installer @forward
        if ($LASTEXITCODE -ne 0) { throw "Profile $Command failed (exit $LASTEXITCODE). Follow the installer message and retry the same command." }
    } finally {
        # Only the private directory created by this invocation is disposable.
        try { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
        catch { Write-Warning "Temporary download cleanup failed: $tempRoot. $($_.Exception.Message)" }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    Invoke-DshProfileLatest -HostKind $HostKind -Command $Command -AppDir $AppDir -HomeDirectory $HomeDirectory -MatchBaseline:$MatchBaseline
}
