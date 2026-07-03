#!/usr/bin/env bash
# Enable full production mode on a VPS running onex-bridge (systemd).
# Run on server: bash scripts/enable-production-vps.sh
set -euo pipefail

export PATH="/usr/local/go/bin:$HOME/go/bin:$PATH"
ENV_FILE="/etc/onex/onex.env"
REPO="${ONEX_REPO:-$HOME/onex}"

upsert_env() {
  local key="$1" val="$2"
  sudo mkdir -p /etc/onex
  sudo touch "$ENV_FILE"
  if sudo grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sudo sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" | sudo tee -a "$ENV_FILE" >/dev/null
  fi
}

echo "==> production env"
upsert_env "ONEX_LEDGER_MODE" "production"
upsert_env "ONEX_ONLINE_BANK" "1"
upsert_env "ONEX_NODE_OPTIONAL" "1"
upsert_env "ONEX_BANK_LEDGER_FILE" "configs/bank-ledger.example.json"
upsert_env "ONEX_HYBX_ENABLED" "1"
upsert_env "ONEX_HYBX_URL" "https://api.hybrix.io"
upsert_env "ONEX_CASHCODE_ENABLED" "1"
upsert_env "ONEX_BRIDGE7_ENABLED" "0"
upsert_env "ONEX_PRODUCTION_DOMAIN" "onexproduction.com"
upsert_env "ONEX_PUBLIC_HOST" "51.75.64.28"

if [ -f /etc/onex/quiknode.env ]; then
  while IFS='=' read -r key val; do
    case "$key" in
      ONEX_ETHEREUM_RPC|ONEX_QUICKNODE_API_KEY|ONEX_ETHEREUM_MASTER_WALLET|ONEX_EVM_HOLDER)
        [ -n "$val" ] && upsert_env "$key" "$val"
        ;;
    esac
  done < <(sudo grep -E '^(ONEX_ETHEREUM_RPC|ONEX_QUICKNODE_API_KEY|ONEX_ETHEREUM_MASTER_WALLET|ONEX_EVM_HOLDER)=' /etc/onex/quiknode.env 2>/dev/null || true)
fi

if [ -d "$REPO/.git" ] && [ "${ONEX_SKIP_GIT_PULL:-0}" != "1" ]; then
  cd "$REPO"
  git fetch origin main 2>/dev/null || true
  git reset --hard origin/main 2>/dev/null || true
fi
if [ -d "$REPO" ]; then
  cd "$REPO"
  echo "==> build onex-bridge"
  go build -o "$REPO/bin/onex-bridge" ./cmd/onex-bridge
  if systemctl cat onex-bridge 2>/dev/null | grep -q '^ExecStart='; then
    svc_bin=$(systemctl cat onex-bridge | grep '^ExecStart=' | head -1 | sed 's/^ExecStart=//' | awk '{print $1}')
    if [ -n "$svc_bin" ] && [ "$svc_bin" != "$REPO/bin/onex-bridge" ]; then
      sudo install -m 755 "$REPO/bin/onex-bridge" "$svc_bin"
    fi
  fi
fi

echo "==> restart onex-bridge"
sudo systemctl daemon-reload
sudo systemctl restart onex-bridge
sleep 5

echo "==> verify"
curl -sf "http://127.0.0.1:9338/health" && echo " health OK"
curl -sf "http://127.0.0.1:9338/bridge/production/status" | head -c 800
echo ""
curl -sf "http://127.0.0.1:9338/bridge/health/green" | head -c 600
echo ""
systemctl is-active onex-bridge
