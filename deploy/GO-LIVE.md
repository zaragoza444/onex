# Go live — OneX production platform

## What ships in this repo

| Component | Local | Production |
|-----------|-------|------------|
| Marketing site | http://127.0.0.1:8080/ | https://zblockchainsystem.com/ |
| Wallet + DeFi | http://127.0.0.1:9338/wallet/ | https://zblockchainsystem.com/wallet/ |
| Online Bank + Virtual cards | Wallet → Bank tab | Same |
| Real Ledger | Wallet → Ledger tab | Same |
| GitHub Pages | — | https://zaragoza444.github.io/onex/ |
| Business email | — | hello@ / business@ / support@ @zblockchainsystem.com |

## Quick local run

```bat
build-onex.bat
run-onex.bat
run-onex-wallet.bat
cd website && python -m http.server 8080
```

## VPS go-live (one command in web console)

If SSH times out, use your host **web console**:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/zaragoza444/onex/main/scripts/vps-go-live.sh || git clone https://github.com/zaragoza444/onex.git ~/onex && bash ~/onex/scripts/vps-go-live.sh)"
```

With HTTPS domain:

```bash
ONEX_DEPLOY_DOMAIN=zblockchainsystem.com CERTBOT_EMAIL=hello@zblockchainsystem.com bash ~/onex/scripts/vps-go-live.sh
```

Windows preflight:

```powershell
$env:SSH_PASS='password'; .\scripts\run-vps-go-live.ps1 -VpsIp 51.75.64.28 -Domain zblockchainsystem.com
```

## DNS + email

- **DNS:** `deploy/dns-records.md` — A records `@` and `www` → VPS IP
- **Email:** `docs/BUSINESS-EMAIL.md` — Cloudflare Email Routing or Google Workspace

## GitHub Pages

1. Push `main` to GitHub
2. Repo variable `ONEX_BRIDGE_PUBLIC_URL` = `http://YOUR_VPS:9338` or `https://zblockchainsystem.com`
3. Workflow **GitHub Pages** deploys `docs/` (marketing + wallet)

Sync before push:

```powershell
.\scripts\sync-all-docs.ps1
```

## Firewall (VPS)

Ports: 22, 80, 443, 9338, 8545, 9340, 30303 — opened automatically by `scripts/vps-go-live.sh`

## After deploy

- Wallet: `/wallet/`
- Contact: `/contact.html`
- Cards API: `/bridge/cards/status`
- Production: `/bridge/production/status`
- Set `ONEX_API_KEY` from deploy output in wallet Settings
