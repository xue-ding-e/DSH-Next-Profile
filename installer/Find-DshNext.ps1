# Windows PowerShell 5.1. Print candidates only; installed metadata establishes identity later.
param([ValidateSet('original','next')][string]$HostKind)
$ErrorActionPreference = 'Stop'
$candidates = New-Object 'System.Collections.Generic.List[object]'
$products = @(@{host='original';product='DeepSeek Harness'}, @{host='next';product='DSH Next'})
if ($HostKind) { $products = @($products | Where-Object { $_.host -eq $HostKind }) }
foreach ($product in $products) {
foreach ($base in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (-not (Test-Path -LiteralPath $base)) { continue }
    foreach ($key in Get-ChildItem -LiteralPath $base) {
        $item = Get-ItemProperty -LiteralPath $key.PSPath
        if ($item.DisplayName -ne $product.product) { continue }
        if ($item.InstallLocation) { $candidates.Add(@{host=$product.host;appDir=$item.InstallLocation.Trim('"')}) }
        foreach ($value in @($item.DisplayIcon, $item.UninstallString)) {
            if ($value -match '^"([^"]+\.exe)"' -or $value -match '^(.+?\.exe)(?:,\d+|\s|$)') {
                $candidates.Add(@{host=$product.host;appDir=(Split-Path -Parent $Matches[1])})
            }
        }
    }
}
foreach ($process in @(Get-Process -Name $product.product -ErrorAction SilentlyContinue)) {
    if ($process.Path) { $candidates.Add(@{host=$product.host;appDir=(Split-Path -Parent $process.Path)}) }
}
$shell = New-Object -ComObject WScript.Shell
foreach ($menu in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonPrograms'))) {
    if (-not $menu -or -not (Test-Path -LiteralPath $menu)) { continue }
    foreach ($link in @(Get-ChildItem -LiteralPath $menu -Filter ($product.product + '.lnk') -Recurse -ErrorAction SilentlyContinue)) {
        $target = $shell.CreateShortcut($link.FullName).TargetPath
        if ($target) { $candidates.Add(@{host=$product.host;appDir=(Split-Path -Parent $target)}) }
    }
}
}
$unique = @($candidates | Where-Object { $_.appDir -and (Test-Path -LiteralPath $_.appDir -PathType Container) } |
    ForEach-Object { [pscustomobject]$_ } | Sort-Object -Property host,appDir -Unique)
ConvertTo-Json -InputObject $unique -Compress
