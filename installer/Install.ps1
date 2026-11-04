#Requires -Version 5.1
# Use only Node shipped with the selected desktop application.
$ErrorActionPreference = 'Stop'
try {
    $appDir = $null
    $hostKind = $null
    $forward = New-Object 'System.Collections.Generic.List[string]'
    for ($i = 0; $i -lt $args.Count; $i++) {
        switch -Regex ($args[$i]) {
            '^(--host|-HostKind)$' {
                $i++
                if ($i -ge $args.Count -or $args[$i] -notin @('original','next')) { throw '--host must be original or next.' }
                $hostKind = $args[$i]
            }
            '^(--app-dir|-AppDir)$' {
                $i++
                if ($i -ge $args.Count) { throw '--app-dir requires a directory.' }
                $appDir = $args[$i]
            }
            '^(--home|-Home)$' {
                $i++
                if ($i -ge $args.Count) { throw '--home requires a directory.' }
                $forward.Add('--home'); $forward.Add($args[$i])
            }
            '^(--manifest|-Manifest)$' {
                $i++
                if ($i -ge $args.Count) { throw '--manifest requires a file.' }
                $forward.Add('--manifest'); $forward.Add($args[$i])
            }
            '^(--check|-Check)$' { $forward.Add('--check') }
            '^(--dry-run|-DryRun)$' { $forward.Add('--dry-run') }
            '^(--isolated|-Isolated)$' { $forward.Add('--isolated') }
            '^(--help|-Help|-h)$' {
                Write-Host 'Install.cmd [--host original|next] [--app-dir <desktop installation>] [--home <host data directory>] [--check | --dry-run]'
                exit 0
            }
            default { throw "Unknown installer option: $($args[$i])" }
        }
    }
    if (-not $appDir) {
        $discoveryArgs = @{}
        if ($hostKind) { $discoveryArgs.HostKind = $hostKind }
        $json = & (Join-Path $PSScriptRoot 'Find-DshNext.ps1') @discoveryArgs
        $candidates = @($json | ConvertFrom-Json)
        if ($candidates.Count -ne 1) {
            if ($candidates.Count -lt 1 -or [Console]::IsInputRedirected -or $forward.Contains('--check') -or $forward.Contains('--dry-run')) {
                throw "Found $($candidates.Count) installation candidates. Use --host original|next and --app-dir."
            }
            for ($index=0; $index -lt $candidates.Count; $index++) {
                Write-Host "$($index+1). $($candidates[$index].host): $($candidates[$index].appDir)"
            }
            $choice = 0
            if (-not [int]::TryParse((Read-Host '选择要安装扩展的应用 / Select host number'), [ref]$choice) -or $choice -lt 1 -or $choice -gt $candidates.Count) {
                throw 'No valid host selected.'
            }
            $candidates = @($candidates[$choice-1])
        }
        $appDir = $candidates[0].appDir
        $hostKind = $candidates[0].host
    }
    $appDir = (Resolve-Path -LiteralPath $appDir).ProviderPath
    if (-not $hostKind) {
        $kinds = @()
        if (Test-Path -LiteralPath (Join-Path $appDir 'DeepSeek Harness.exe')) { $kinds += 'original' }
        if (Test-Path -LiteralPath (Join-Path $appDir 'DSH Next.exe')) { $kinds += 'next' }
        if ($kinds.Count -ne 1) { throw 'Select --host original|next for this installation.' }
        $hostKind = $kinds[0]
    }
    $node = Join-Path $appDir 'resources\runtime\primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $node -PathType Leaf)) {
        throw "Bundled Node not found: $node. Install the latest desktop release first."
    }
    $entry = Join-Path (Split-Path -Parent $PSScriptRoot) 'src\cli.mjs'
    # Process-local only: inherited Node hooks must not run inside the installer.
    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    Write-Host '请先完全退出所选应用（包括托盘），插件安装后需要重新启动客户端。'
    & $node $entry '--host' $hostKind '--app-dir' $appDir @forward
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine("DSH Next extension installer: $($_.Exception.Message)")
    exit 1
}
