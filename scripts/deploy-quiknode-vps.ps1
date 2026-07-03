# Deploy QuickNode + Ethereum middleware to VPS 51.75.64.28
# Usage:
#   $env:SSH_PASS='your-ubuntu-password'
#   .\scripts\deploy-quiknode-vps.ps1
param(
    [string]$VpsIp = "51.75.64.28"
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location (Join-Path $root "..")

# Load .env (QuickNode vars)
$envFile = Join-Path (Get-Location) ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#=]+)=(.*)$') {
            $k = $Matches[1].Trim()
            $v = $Matches[2].Trim().Trim('"').Trim("'")
            if (-not [string]::IsNullOrWhiteSpace($k) -and -not $env:$k) {
                Set-Item -Path "env:$k" -Value $v
            }
        }
    }
}

if (-not $env:SSH_PASS) {
    Write-Host "SSH_PASS required. Example:" -ForegroundColor Yellow
    Write-Host "  `$env:SSH_PASS='your-password'; .\scripts\deploy-quiknode-vps.ps1" -ForegroundColor White
    exit 1
}

$env:SSH_HOST = $VpsIp
$env:LOCAL_SYNC = "1"
Write-Host "Deploying to $VpsIp (LOCAL_SYNC + QuickNode from .env)..." -ForegroundColor Cyan
python scripts/deploy-ali-ecosystem.py
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Verify:" -ForegroundColor Green
    Write-Host "  http://${VpsIp}:9338/bridge/ethereum/status"
    Write-Host "  http://${VpsIp}:9338/wallet/#ledger"
}
