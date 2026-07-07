# OneX Wallet — production go-live

Primary Git host: **[Anakatech Gitea](https://git.anakatech.llc/)** (`git.anakatech.llc`).

## One command (Gitea + optional GitHub)

```powershell
# 1. Copy and edit remotes
copy remotes.env.example remotes.env
# GITEA_URL defaults to https://git.anakatech.llc/zaragoza/onex.git

# 2. Publish
.\scripts\publish-production.ps1
```

With bridge URL (Render):

```powershell
.\scripts\publish-production.ps1 -BridgeUrl "https://your-onex-bridge.onrender.com"
```

## What gets published

| Target | Result |
|--------|--------|
| **Anakatech Gitea** | Repo `zaragoza/onex`, `.gitea/workflows/pages.yml` for Pages |
| **Wallet UI** | `https://git.anakatech.llc/pages/zaragoza/onex/wallet/` |
| **GitHub** (optional) | Mirror `zaragoza444/onex`, Actions Pages |
| **Bridge API** | Deploy [`render.yaml`](../render.yaml) on Render (or Docker prod) |

## After first push

### GitHub → Gitea auto-mirror (recommended)

After every push to GitHub `main`, the workflow [`.github/workflows/mirror-gitea.yml`](../.github/workflows/mirror-gitea.yml) mirrors to Anakatech Gitea (creates repo if missing).

**One-time GitHub setup** (repo `zaragoza444/onex`):

1. On https://git.anakatech.llc/ → **Settings → Applications** → **Generate New Token** (scope: `write:repository`, user **zaragoza**).
2. GitHub repo → **Settings → Secrets and variables → Actions**:
   - **Secret:** `GITEA_TOKEN` = your Gitea token
   - **Variables (optional):** `GITEA_HOST` = `https://git.anakatech.llc`, `GITEA_USER` = `zaragoza`, `GITEA_REPO` = `onex`
3. Push to `main` or run **Actions → Mirror to Gitea → Run workflow**.

**Local dual push** (optional):

```powershell
copy remotes.env.example remotes.env
# Set GITEA_TOKEN in remotes.env
.\scripts\setup-git-push.ps1
git pushall
```

### Gitea (Anakatech)

1. Create empty repo **onex** at https://git.anakatech.llc/ (if it does not exist).
2. Push: `git push -u gitea main`
3. Repo → **Settings → Pages** → enable Actions deploy.
4. Set variable `ONEX_BRIDGE_PUBLIC_URL` if using split hosting (Render bridge).

### GitHub Pages (optional mirror)

1. Repo → **Settings → Pages** → source **GitHub Actions**
2. **Actions → GitHub Pages** → confirm green run
3. Optional variable: `ONEX_BRIDGE_PUBLIC_URL`

### OneX Production Platform

Deploy full stack to **zblockchainsystem.com** (or your domain): [deploy/GO-LIVE.md](deploy/GO-LIVE.md)

```powershell
.\scripts\connect-bridge.ps1 -BridgeUrl "https://zblockchainsystem.com" -GitHubVariable
```

Unified API: `GET /bridge/production/status` (ledger + token platform + node).

### Bridge (required for send/swap/wallet sync)

1. [Render Blueprints](https://dashboard.render.com/blueprints) → connect repo → apply `render.yaml`
2. Copy **onex-bridge** HTTPS URL
3. Run: `.\scripts\connect-bridge.ps1 -BridgeUrl "https://..." -GitHubVariable`

### Mobile app

Default wallet URL: `https://git.anakatech.llc/pages/zaragoza/onex/wallet/` (`mobile/.env.example`)

## CORS

Set on bridge (`ONEX_CORS_ORIGINS`):

```env
ONEX_CORS_ORIGINS=https://git.anakatech.llc,https://zaragoza444.github.io
```

## Local production stack

```powershell
docker compose -f docker-compose.prod.yml up -d --build
```

See [DEPLOY.md](DEPLOY.md) and [docs/HOSTING.md](docs/HOSTING.md).
