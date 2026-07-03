# Bridge7 — share / handoff pack

**OneX Bridge7** merges three external ledgers into the real production ledger:

| Source | File |
|--------|------|
| local-ledger-2026 | `data/bridge7/local-ledger-2026.json` |
| ledger-pro | `data/bridge7/ledger-pro.json` |
| crypto-ledger | `data/bridge7/crypto-ledger.json` |

Path manifest (single config to wire everything):

**`configs/bridge7.paths.json`**

```json
{
  "enabled": true,
  "projectRoot": ".",
  "localLedger2026": "data/bridge7/local-ledger-2026.json",
  "ledgerPro": "data/bridge7/ledger-pro.json",
  "cryptoLedger": "data/bridge7/crypto-ledger.json"
}
```

---

## Files to copy (attach or `scp`)

From repo root `onex-blockchain/`:

```
configs/bridge7.paths.json
data/bridge7/local-ledger-2026.json
data/bridge7/ledger-pro.json
data/bridge7/crypto-ledger.json
```

Optional reference configs:

```
configs/local-ledger-2026.example.json
configs/ledger-pro.example.json
configs/crypto-ledger.example.json
configs/bridge7.example.json
```

---

## Environment (paste into `.env` or `/etc/onex/onex.env`)

```env
ONEX_BRIDGE7_ENABLED=1
ONEX_BRIDGE7_PATHS_FILE=configs/bridge7.paths.json
ONEX_PROJECT_ROOT=/opt/onex
ONEX_LOCAL_LEDGER_2026_FILE=data/bridge7/local-ledger-2026.json
ONEX_LEDGER_PRO_FILE=data/bridge7/ledger-pro.json
ONEX_CRYPTO_LEDGER_FILE=data/bridge7/crypto-ledger.json
```

On VPS, set `ONEX_PROJECT_ROOT` to the repo install path (`/opt/onex` or `~/onex`).

Full production template: `deploy/env.onexproduction.example`

---

## API (after bridge is running on port 9338)

| Method | URL | Purpose |
|--------|-----|---------|
| GET | `/bridge/bridge7/status` | Health + loaded ledger summary |
| GET | `/bridge/bridge7/ledgers` | Per-file entry counts |
| POST | `/bridge/bridge7/sync` | Merge into real ledger |
| POST | `/bridge/bridge7/import` | Import from request body |

**Verify (local or VPS):**

```bash
curl -s http://127.0.0.1:9338/bridge/bridge7/status | jq .
curl -s http://127.0.0.1:9338/bridge/bridge7/ledgers | jq .
curl -s -X POST http://127.0.0.1:9338/bridge/bridge7/sync | jq .
```

**PowerShell (Windows):**

```powershell
Invoke-RestMethod http://127.0.0.1:9338/bridge/bridge7/status
```

**Expected status (healthy):**

- `enabled`: true  
- `ledgers`: `["local-ledger-2026","ledger-pro","crypto-ledger"]`  
- each `sources[].loaded`: true  
- `entries`: 15 (with default seed data)

Wallet UI: `http://HOST:9338/wallet/` → **Real Ledger** → **Bridge7**

---

## VPS deploy (quick)

```bash
cd /opt/onex   # or ~/onex
git pull
mkdir -p data/bridge7 configs
# copy bridge7.paths.json + data/bridge7/*.json if not in git pull
cp deploy/env.onexproduction.example .env   # edit ONEX_API_KEY, Fineract creds
docker compose -f docker-compose.prod.yml up -d --build
curl -s http://127.0.0.1:9338/bridge/bridge7/status | jq .
```

One-shot script: `bash scripts/vps-go-live.sh`  
Preflight from PC: `.\scripts\deploy-onexproduction.ps1 -VpsIp YOUR_IP`

Systemd restart after env change:

```bash
sudo systemctl restart onex-bridge
```

---

## Repo paths on this PC

```
c:\home\ubuntu\onex-blockchain\deploy\BRIDGE7-SHARE.md          (this file)
c:\home\ubuntu\onex-blockchain\configs\bridge7.paths.json
c:\home\ubuntu\onex-blockchain\data\bridge7\
```

---

*Generated for OneX / NSB production handoff — Bridge7 v1*
