# Export full OneX / onex-blockchain tree for sharing (no secrets).
# Usage: .\scripts\export-onex-share.ps1
# Output: dist\onex-blockchain-share.zip + deploy\ONEX-FILE-MANIFEST.txt

param(
    [string]$OutDir = "dist"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path (Join-Path $Root "go.mod"))) {
    $Root = Get-Location
}
Set-Location $Root

$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$stage = Join-Path $env:TEMP "onex-blockchain-share-$stamp"
$zipName = "onex-blockchain-share-$stamp.zip"
$zipPath = Join-Path $OutDir $zipName

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

$exclude = @(
    ".git", "bin", "node_modules", "dist", ".env", "mobile\.env",
    "bsc-launcher\.env", "remotes.env", "*.exe", "*.dll"
)

function ShouldSkip([string]$rel) {
    foreach ($e in $exclude) {
        if ($e -like "*.*") {
            if ($rel -like $e) { return $true }
        } elseif ($rel -eq $e -or $rel -like "$e/*" -or $rel -like "$e\*") {
            return $true
        }
    }
    return $false
}

$manifest = New-Object System.Collections.Generic.List[string]

# Git-tracked files
git ls-files | ForEach-Object {
    $rel = $_ -replace '/', '\'
    if (-not (ShouldSkip $rel)) {
        $dest = Join-Path $stage $rel
        $dir = Split-Path $dest -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        Copy-Item (Join-Path $Root $rel) $dest -Force
        $manifest.Add($rel)
    }
}

# Untracked production / Bridge7 files (not in git yet)
$extra = @(
    "configs/bridge7.paths.json",
    "configs/bridge7.example.json",
    "configs/local-ledger-2026.example.json",
    "configs/ledger-pro.example.json",
    "configs/crypto-ledger.example.json",
    "configs/hybrix-bank.example.json",
    "configs/hybx-bank.example.json",
    "configs/hybx-middleware.example.json",
    "configs/fineract-bank.example.json",
    "data/bridge7/local-ledger-2026.json",
    "data/bridge7/ledger-pro.json",
    "data/bridge7/crypto-ledger.json",
    "deploy/BRIDGE7-SHARE.md",
    "deploy/bridge7.env.share",
    "deploy/ONEX-SHARE-ALL.md",
    "internal/bridge/bridge7.go",
    "internal/bridge/bridge7_handlers.go",
    "internal/bridge/hybx_middleware.go",
    "internal/bridge/hybrix_bank.go",
    "internal/bridge/hybrix_handlers.go",
    "internal/bridge/fineract_bank.go",
    "internal/bridge/fineract_handlers.go",
    "internal/bridge/production_bootstrap.go",
    "internal/ledger/bridge7.go",
    "internal/ledger/bridge7_test.go",
    "internal/ledger/hybrix.go",
    "internal/ledger/hybrix_test.go",
    "internal/ledger/hybx_middleware.go",
    "internal/ledger/hybx_middleware_test.go",
    "internal/ledger/fineract.go",
    "internal/ledger/fineract_test.go"
)
foreach ($rel in $extra) {
    $relWin = $rel -replace '/', '\'
    $src = Join-Path $Root $relWin
    if (Test-Path $src) {
        $dest = Join-Path $stage $relWin
        $dir = Split-Path $dest -Parent
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
        Copy-Item $src $dest -Force
        if (-not $manifest.Contains($rel)) { $manifest.Add($rel) }
    }
}

$manifestPath = Join-Path $Root "deploy\ONEX-FILE-MANIFEST.txt"
$manifestSorted = $manifest | Sort-Object -Unique
@"
# OneX blockchain — share manifest
# Generated: $(Get-Date -Format o)
# Total files: $($manifestSorted.Count)
# Zip: $zipName
# Excluded: .git, .env, bin/, node_modules/, secrets

"@ | Set-Content $manifestPath -Encoding UTF8
$manifestSorted | Add-Content $manifestPath -Encoding UTF8
Copy-Item $manifestPath (Join-Path $stage "deploy\ONEX-FILE-MANIFEST.txt") -Force

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force

Write-Host ""
Write-Host "=== OneX share export ready ===" -ForegroundColor Green
Write-Host "Zip:     $((Resolve-Path $zipPath).Path)"
Write-Host "Manifest: $manifestPath"
Write-Host "Files:   $($manifestSorted.Count)"
Write-Host ""
Write-Host "Share the zip + deploy/BRIDGE7-SHARE.md (also inside zip)."
