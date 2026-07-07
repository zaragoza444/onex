# Run full VPS go-live when SSH works, or print web-console command.
param(
    [string]$VpsIp = "51.75.64.28",
    [string]$Domain = "",
    [switch]$ForceRemote
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $root "..")

Write-Host "=== OneX VPS go-live ===" -ForegroundColor Cyan

# Quick reachability
$sshOk = $false
try {
    $tcp = New-Object System.Net.Sockets.TcpClient
    $iar = $tcp.BeginConnect($VpsIp, 22, $null, $null)
    $wait = $iar.AsyncWaitHandle.WaitOne(5000, $false)
    if ($wait -and $tcp.Connected) { $sshOk = $true }
    $tcp.Close()
} catch {}

if (-not $sshOk) {
    Write-Host "SSH port 22 on $VpsIp is not reachable from this PC." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "The VPS may be stopped or the cloud firewall blocks access." -ForegroundColor Yellow
    Write-Host "Start the server in your host panel (OVH / Hetzner / etc.), then run ONE command in the web console:" -ForegroundColor Cyan
    Write-Host ""
    $domainEnv = if ($Domain) { "ONEX_DEPLOY_DOMAIN=$Domain CERTBOT_EMAIL=hello@zblockchainsystem.com " } else { "" }
    Write-Host "  ${domainEnv}bash -c `"`$(curl -fsSL https://raw.githubusercontent.com/zaragoza444/onex/main/scripts/vps-go-live.sh || git clone https://github.com/zaragoza444/onex.git ~/onex && bash ~/onex/scripts/vps-go-live.sh)`"" -ForegroundColor White
    Write-Host ""
    Write-Host "Or if repo already on server:" -ForegroundColor Cyan
    Write-Host "  cd ~/onex && git pull && bash scripts/vps-go-live.sh" -ForegroundColor White
    Write-Host ""
    Write-Host "DNS (registrar / Cloudflare): A record @ and www -> $VpsIp" -ForegroundColor Cyan
    Write-Host "  deploy/dns-records.md"
    exit 1
}

if ($env:SSH_PASS -or $ForceRemote) {
    if (-not $env:SSH_PASS) {
        Write-Host "Set SSH_PASS for password auth: `$env:SSH_PASS='your-password'" -ForegroundColor Yellow
        exit 1
    }
    $env:SSH_HOST = $VpsIp
    $env:ALI_PUBLIC_HOST = $VpsIp
    $env:LOCAL_SYNC = "1"
    if ($Domain) { $env:ONEX_DEPLOY_DOMAIN = $Domain }
    python scripts/deploy-ali-ecosystem.py
    if ($LASTEXITCODE -eq 0) {
        ssh -o StrictHostKeyChecking=no "ubuntu@${VpsIp}" "cd ~/onex && bash scripts/vps-go-live.sh"
    }
} else {
    Write-Host "SSH reachable. Deploy with:" -ForegroundColor Green
    Write-Host "  `$env:SSH_PASS='your-password'; .\scripts\run-vps-go-live.ps1 -VpsIp $VpsIp" -ForegroundColor White
    Write-Host "Or:" -ForegroundColor Green
    Write-Host "  ssh ubuntu@${VpsIp}" -ForegroundColor White
    Write-Host "  cd ~/onex && git pull && bash scripts/vps-go-live.sh" -ForegroundColor White
}

Write-Host ""
Write-Host "After deploy, verify DNS:" -ForegroundColor Cyan
Write-Host "  Resolve-DnsName zblockchainsystem.com -Type A"
