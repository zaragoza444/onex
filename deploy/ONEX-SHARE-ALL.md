# OneX blockchain — full share pack

Everything needed to deploy, wire Bridge7/HYBX, and run the wallet bridge.

---

## 1. One-click export (your PC)

From repo root:

```powershell
.\scripts\export-onex-share.ps1
```

Creates:

| Output | Path |
|--------|------|
| **Zip (send this)** | `dist\onex-blockchain-share-YYYYMMDD-HHMM.zip` |
| **File list** | `deploy\ONEX-FILE-MANIFEST.txt` |

Excludes secrets: `.env`, `bsc-launcher/.env`, `.git`, `bin/`, `node_modules/`.

---

## 2. Repo layout (349+ tracked files)

| Folder | Purpose |
|--------|---------|
| `cmd/` | `onexd`, `onex`, `onex-bridge` binaries |
| `internal/` | Core: bridge, ledger, HYBX, Bridge7, virtual cards |
| `configs/` | Ledger JSON, seeds, Bridge7 paths |
| `data/bridge7/` | Production ledger files (local copy, gitignored) |
| `deploy/` | systemd, nginx, env templates, this doc |
| `scripts/` | VPS go-live, export, deploy preflight |
| `website/` + `docs/` | Marketing site + synced static wallet |
| `internal/bridge/static/wallet/` | Live wallet UI source |
| `bsc-launcher/` | Token lab / BSC deploy |
| `mobile/` | Expo wallet app |
| `docker-compose*.yml` | Docker production stack |

Full path list: **`deploy/ONEX-FILE-MANIFEST.txt`**

---

## 3. Bridge7 files (minimum handoff)

```
configs/bridge7.paths.json
data/bridge7/local-ledger-2026.json
data/bridge7/ledger-pro.json
data/bridge7/crypto-ledger.json
deploy/bridge7.env.share
deploy/BRIDGE7-SHARE.md
```

Env snippet: **`deploy/bridge7.env.share`**

---

## 4. Production env templates

| File | Use |
|------|-----|
| `deploy/env.onexproduction.example` | VPS / Docker production |
| `deploy/env.ali-ecosystem.example` | IP-based deploy |
| `deploy/env.dbis-138.example` | DBIS-138 chain |
| `.env.example` | Local dev |

---

## 5. Deploy docs

| File | Use |
|------|-----|
| `deploy/GO-LIVE.md` | Go-live checklist |
| `deploy/DEPLOY-onexproduction.md` | onexproduction.com |
| `deploy/DEPLOY-dbis-138.md` | DBIS-138 |
| `scripts/vps-go-live.sh` | One-shot VPS setup |
| `scripts/deploy-onexproduction.ps1` | DNS/HTTPS preflight from Windows |

---

## 6. Key API endpoints (bridge :9338)

```
GET  /health
GET  /bridge/production/status
GET  /bridge/bridge7/status
GET  /bridge/bridge7/ledgers
POST /bridge/bridge7/sync
GET  /bridge/bank/hybx/middleware/status
GET  /wallet/
```

---

## 7. Paths on this PC

```
c:\home\ubuntu\onex-blockchain\
c:\home\ubuntu\onex-blockchain\dist\                    ← zip after export
c:\home\ubuntu\onex-blockchain\deploy\ONEX-FILE-MANIFEST.txt
c:\home\ubuntu\onex-blockchain\deploy\ONEX-SHARE-ALL.md  ← this file
```

---

## 8. Git remote (optional)

```bash
git clone https://github.com/zaragoza444/onex.git
# or your Gitea mirror — see remotes.example.env
```

For a full tree without git: use the zip from `export-onex-share.ps1`.
