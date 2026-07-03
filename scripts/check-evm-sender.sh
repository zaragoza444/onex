#!/usr/bin/env bash
# Print EVM sender address and remind operator to fund it for on-chain settlement.
set -euo pipefail

KEY="${HOME}/.onex/evm-sender.key"
if [ ! -f "$KEY" ]; then
  echo "No sender key at $KEY — start onex-bridge once to generate it."
  exit 1
fi

ADDR=$(curl -sf --max-time 8 http://127.0.0.1:9338/bridge/ethereum/status | python3 -c "import sys,json; print(json.load(sys.stdin).get('senderWallet',''))" 2>/dev/null || true)
BAL=$(curl -sf --max-time 8 http://127.0.0.1:9338/bridge/ethereum/status | python3 -c "import sys,json; print(json.load(sys.stdin).get('senderBalanceEth','0'))" 2>/dev/null || echo "0")

echo "EVM sender: ${ADDR:-unknown}"
echo "Balance:    ${BAL} ETH"
echo ""
if python3 -c "import sys; sys.exit(0 if float('${BAL}' or 0) > 0.00001 else 1)" 2>/dev/null; then
  echo "Sender is funded — on-chain ETH/USDC transfers are ready."
else
  echo "Fund sender with ≥0.002 ETH on Ethereum mainnet for gas:"
  echo "  ${ADDR}"
  echo ""
  echo "Master wallet (treasury): check GET /bridge/ethereum/status"
  echo "After funding, verify: curl -sf http://127.0.0.1:9338/bridge/health/green"
fi
