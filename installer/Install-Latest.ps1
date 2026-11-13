#Requires -Version 5.1
param(
    [ValidateSet('next', 'original')][string]$HostKind = 'next',
    [ValidateSet('install', 'check', 'doctor', 'features')][string]$Command = 'install',
    [string]$AppDir,
    [string]$HomeDirectory,
    [switch]$MatchBaseline
)

function Get-DshProfileReleaseAssets {
    param([string]$ReleaseUrl)
    if ($ReleaseUrl -cnotmatch '^https://github\.com/xue-ding-e/DSH-Next-Profile/releases/tag/(v[0-9]+\.[0-9]+\.[0-9]+)$') {
        throw 'GitHub did not redirect to a stable Profile release.'
    }
    $tag = $Matches[1]
    $version = $tag.Substring(1)
    $archiveName = "dsh-next-profile-$version-windows.zip"
    $prefix = "https://github.com/xue-ding-e/DSH-Next-Profile/releases/download/$tag/"
    return @{
        Tag = $tag
        Archive = @{ name = $archiveName; browser_download_url = "$prefix$archiveName" }
        Checksums = @{ name = 'SHA256SUMS'; browser_download_url = "${prefix}SHA256SUMS" }
    }
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
    $headers = @{ 'User-Agent' = 'DSH-Next-Profile'; 'Cache-Control' = 'no-cache' }
    # Public release redirects avoid the anonymous REST API quota. Resolve once so archive and checksum use the same tag.
    $latest = Invoke-WebRequest -UseBasicParsing -Method Head -Uri 'https://github.com/xue-ding-e/DSH-Next-Profile/releases/latest' -Headers $headers -TimeoutSec 60
    $releaseUrl = if ($latest.BaseResponse.ResponseUri) { $latest.BaseResponse.ResponseUri.AbsoluteUri } else { $latest.BaseResponse.RequestMessage.RequestUri.AbsoluteUri }
    $assets = Get-DshProfileReleaseAssets $releaseUrl
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("dsh-next-profile-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempRoot | Out-Null
    try {
        Write-Host "DSH Next Profile $($assets.Tag): $Command (host=$HostKind)"
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
