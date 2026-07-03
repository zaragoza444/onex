#!/usr/bin/env bash
# Patch /etc/onex/onex.env with QuickNode Ethereum mainnet + rebuild bridge.
# Run ON the VPS as ubuntu:
#   cd ~/onex && git pull && bash scripts/patch-quiknode-vps.sh
set -euo pipefail

REPO="${ONEX_REPO:-$HOME/onex}"
ENV_FILE="/etc/onex/onex.env"
QN_FILE="/etc/onex/quiknode.env"

# Load persisted QuickNode secrets if present
if [ -f "$QN_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$QN_FILE"
  set +a
fi

cd "$REPO"
git fetch origin main 2>/dev/null || true
git reset --hard origin/main 2>/dev/null || true

export PATH="/usr/local/go/bin:$HOME/go/bin:$PATH"

# QuickNode secrets — prefer /etc/onex/quiknode.env (never commit this file)
if [ -f "$QN_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$QN_FILE"
  set +a
fi

: "${ONEX_ETHEREUM_RPC:?Set ONEX_ETHEREUM_RPC in $QN_FILE or environment}"
: "${ONEX_ETHEREUM_MASTER_WALLET:?Set ONEX_ETHEREUM_MASTER_WALLET in $QN_FILE or environment}"

sudo mkdir -p /etc/onex
if [ ! -f "$ENV_FILE" ]; then
  sudo touch "$ENV_FILE"
fi

upsert_env() {
  local key="$1" val="$2"
  if sudo grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sudo sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" | sudo tee -a "$ENV_FILE" >/dev/null
  fi
}

upsert_env "ONEX_ETHEREUM_RPC" "$ONEX_ETHEREUM_RPC"
upsert_env "ONEX_ETHEREUM_MASTER_WALLET" "$ONEX_ETHEREUM_MASTER_WALLET"
upsert_env "ONEX_EVM_HOLDER" "${ONEX_EVM_HOLDER:-$ONEX_ETHEREUM_MASTER_WALLET}"
if [ -n "${ONEX_QUICKNODE_API_KEY:-}" ]; then
  upsert_env "ONEX_QUICKNODE_API_KEY" "$ONEX_QUICKNODE_API_KEY"
fi

echo "==> build onex-bridge"
go build -o "$REPO/bin/onex-bridge" ./cmd/onex-bridge

echo "==> restart bridge"
sudo systemctl daemon-reload
sudo systemctl restart onex-bridge
sleep 3

echo "==> verify"
curl -sf "http://127.0.0.1:9338/health" && echo " bridge OK"
curl -sf "http://127.0.0.1:9338/bridge/ethereum/status" | head -c 600
echo ""
systemctl is-active onex-bridge
