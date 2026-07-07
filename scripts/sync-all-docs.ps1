# Sync wallet UI + marketing site into docs/ for GitHub/Gitea Pages
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

& (Join-Path $root "scripts\sync-wallet-docs.ps1")

$siteSrc = Join-Path $root "website"
$docs = Join-Path $root "docs"
foreach ($dir in @("css", "js", "assets")) {
    $s = Join-Path $siteSrc $dir
    $d = Join-Path $docs $dir
    if (Test-Path $s) {
        New-Item -ItemType Directory -Force -Path $d | Out-Null
        Copy-Item -Path (Join-Path $s "*") -Destination $d -Recurse -Force
    }
}

$indexSrc = Join-Path $siteSrc "index.html"
$contactSrc = Join-Path $siteSrc "contact.html"
if (Test-Path $indexSrc) {
    $html = Get-Content $indexSrc -Raw
    $html = $html -replace "walletPath: '/wallet/'", "walletUrl: 'wallet/',`n      walletPath: 'wallet/'"
    $html = $html -replace 'href="/wallet/"', 'href="wallet/"'
    $html = $html -replace 'href="/explorer/"', 'href="https://zblockchainsystem.com/explorer/"'
    Set-Content -Path (Join-Path $docs "index.html") -Value $html -NoNewline
}
if (Test-Path $contactSrc) {
    $html = Get-Content $contactSrc -Raw
    $html = $html -replace "walletPath: '/wallet/'", "walletUrl: 'wallet/',`n      walletPath: 'wallet/'"
    $html = $html -replace 'href="/wallet/"', 'href="wallet/"'
    Set-Content -Path (Join-Path $docs "contact.html") -Value $html -NoNewline
}

Write-Host "Synced marketing site to docs/ (index.html, contact.html, css, js, assets)"
