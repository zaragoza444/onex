# Production deployment

Run OneX blockchain + OKX-style wallet bridge on a server (Docker or systemd).

**OneX Production Platform (`zblockchainsystem.com`):** [deploy/GO-LIVE.md](deploy/GO-LIVE.md), `scripts/vps-go-live.sh`, `scripts/connect-bridge.ps1`.

**Go live (public VPS + GitHub Pages):** [deploy/GO-LIVE.md](deploy/GO-LIVE.md), `scripts/go-live.ps1`

**ALI / ALLTRA ecosystem VPS (`ubuntu@51.75.64.28`):** `scripts/deploy-ali-ecosystem.py` (remote SSH), `scripts/deploy-ali-ecosystem.sh` (run on server), `deploy/env.ali-ecosystem.example`.

```powershell
# From Windows (requires SSH_PASS + port 22 reachable)
set SSH_PASS=your-ubuntu-password
scripts\deploy-ali-ecosystem.bat
```

```bash
# On the VPS directly
bash scripts/deploy-ali-ecosystem.sh
```

| Service | Port | URL |
|---------|------|-----|
| Wallet + Real Ledger | 9338 | `http://51.75.64.28:9338/wallet/` |
| Ledger tab | 9338 | `http://51.75.64.28:9338/wallet/#ledger` |
| Node API | 8545 | `http://51.75.64.28:8545/health` |
| Token Lab | 9340 | `http://51.75.64.28:9340/` |

Set `ONEX_BRIDGE_PUBLIC_URL=http://51.75.64.28:9338` in GitHub Pages variables so the static wallet at https://zaragoza444.github.io/onex/wallet/ connects to this bridge.

## Docker (recommended)

```bash
git clone <your-repo-url> onex
cd onex
cp .env.example .env
# Edit .env: ONEX_API_KEY, ONEX_CORS_ORIGINS=https://your-domain.com

docker compose -f docker-compose.prod.yml up -d --build
```

| Service | Port | URL |
|---------|------|-----|
| Node API + explorer | 8545 | `http://HOST:8545/explorer/` |
| Wallet (bridge) | 9338 | `http://HOST:9338/wallet/` |

With TLS reverse proxy:

```bash
mkdir -p deploy/certs
# Place fullchain.pem + privkey.pem in deploy/certs/
docker compose -f docker-compose.prod.yml --profile proxy up -d
```

- Wallet: `https://your-domain/wallet/`
- Explorer: `https://your-domain/explorer/`

## systemd (bare metal)

```bash
sudo mkdir -p /opt/onex/bin /var/lib/onex /var/lib/onex-bridge/wallets
sudo cp bin/onexd bin/onex bin/onex-bridge /opt/onex/bin/
sudo cp -r configs /opt/onex/
sudo cp deploy/onexd.service deploy/onex-bridge.service /etc/systemd/system/
sudo cp .env.example /etc/onex/onex.env
# Edit /etc/onex/onex.env

sudo systemctl daemon-reload
sudo systemctl enable --now onexd onex-bridge
```

## Security checklist

- Set `ONEX_API_KEY` on the node for `POST /api/v1/tx` and `/rpc`
- Restrict `ONEX_CORS_ORIGINS` to your wallet domain
- Use TLS (`--profile proxy` or nginx in front)
- Never commit `.env`, wallet JSON, or private keys
- Testnet faucet: set `ONEX_FAUCET_PRIVATE_KEY` only on testnet hosts

## OneX Wallet mobile apps

React Native (Expo) WebView app in [`mobile/`](mobile/).

1. Deploy backend with HTTPS (`https://YOUR_DOMAIN/wallet/`).
2. Set `EXPO_PUBLIC_WALLET_URL` in `mobile/.env` (see `mobile/.env.example`).
3. Build and publish: **[mobile/PUBLISH.md](mobile/PUBLISH.md)**.

```bash
cd mobile && npm install && eas build --platform all --profile production
```

## Publish to GitHub + Gitea

```powershell
# Windows
.\scripts\publish-remotes.ps1 -GitHub "git@github.com:USER/onex.git" -Gitea "git@git.example.com:USER/onex.git"
```

```bash
# Linux
./scripts/publish-remotes.sh git@github.com:USER/onex.git git@git.example.com:USER/onex.git
```

Create empty repos on GitHub and Gitea first, then run the script.
