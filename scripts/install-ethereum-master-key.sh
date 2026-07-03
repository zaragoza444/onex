#!/usr/bin/env bash
# Install Ethereum master signing key on VPS (required for on-chain transfers when sender has no gas).
# Usage on VPS:
#   bash scripts/install-ethereum-master-key.sh /path/to/64hex.key
#   bash scripts/install-ethereum-master-key.sh   # reads from stdin (hidden)
set -euo pipefail

DEST="${HOME}/.onex/ethereum-master.key"
ENV_FILE="/etc/onex/quiknode.env"

install_key() {
  local hex="$1"
  hex="${hex#0x}"
  if [ "${#hex}" -ne 64 ]; then
    echo "error: need 64 hex char private key for master wallet 0x587374…aeDC1"
    exit 1
  fi
  mkdir -p "$(dirname "$DEST")"
  printf '%s' "$hex" > "$DEST"
  chmod 600 "$DEST"
  echo "installed $DEST"
  sudo touch "$ENV_FILE"
  if sudo grep -q '^ONEX_ETHEREUM_MASTER_KEY=' "$ENV_FILE" 2>/dev/null; then
    sudo sed -i "s|^ONEX_ETHEREUM_MASTER_KEY=.*|ONEX_ETHEREUM_MASTER_KEY=${hex}|" "$ENV_FILE"
  else
    echo "ONEX_ETHEREUM_MASTER_KEY=${hex}" | sudo tee -a "$ENV_FILE" >/dev/null
  fi
  sudo chmod 600 "$ENV_FILE"
  if ! sudo grep -q '^ONEX_ETHEREUM_MASTER_KEY=' /etc/onex/onex.env 2>/dev/null; then
    echo "ONEX_ETHEREUM_MASTER_KEY=${hex}" | sudo tee -a /etc/onex/onex.env >/dev/null
  else
    sudo sed -i "s|^ONEX_ETHEREUM_MASTER_KEY=.*|ONEX_ETHEREUM_MASTER_KEY=${hex}|" /etc/onex/onex.env
  fi
  sudo systemctl restart onex-bridge
  sleep 4
  curl -sf --max-time 12 http://127.0.0.1:9338/bridge/ethereum/status | head -c 400
  echo
  echo "Then fund sender (optional): curl -X POST http://127.0.0.1:9338/bridge/ethereum/fund-sender -H X-OneX-Api-Key:..."
}

if [ "${1:-}" != "" ] && [ -f "$1" ]; then
  install_key "$(tr -d '\r\n ' < "$1")"
elif [ "${1:-}" != "" ]; then
  install_key "$(echo "$1" | tr -d '\r\n ')"
else
  read -r -s -p "Paste master wallet private key (64 hex): " hex
  echo
  install_key "$(echo "$hex" | tr -d '\r\n ')"
fi
