#!/usr/bin/env bash
# One-shot QuickNode go-live on VPS web console (ubuntu@51.75.64.28).
# 1. Create /etc/onex/quiknode.env from configs/quiknode.env.example (fill in your values)
# 2. Run: bash scripts/vps-quiknode-console.sh
set -euo pipefail

QN_FILE="/etc/onex/quiknode.env"
if [ ! -f "$QN_FILE" ]; then
  echo "Create $QN_FILE first (see configs/quiknode.env.example)"
  exit 1
fi

REPO="${HOME}/onex"
if [ ! -d "$REPO/.git" ]; then
  git clone https://github.com/zaragoza444/onex.git "$REPO"
fi
cd "$REPO"
git fetch origin main
git reset --hard origin/main
bash scripts/patch-quiknode-vps.sh

IP="$(curl -sf --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
echo "PUBLIC: http://${IP}:9338/bridge/ethereum/status"
