#!/usr/bin/env bash
set -euo pipefail
KEY=$(sudo awk -F= '/^ONEX_API_KEY=/{print $2; exit}' /etc/onex/onex.env | tr -d '\r\n')
code=$(curl -s -o /tmp/tr.json -w "%{http_code}" --max-time 15 -X POST 'http://127.0.0.1:9338/bridge/ethereum/transfer' \
  -H 'Content-Type: application/json' \
  -H "X-OneX-Api-Key: ${KEY}" \
  -d '{"to":"0x587374d7d33e3e235d6a485Edc3EF83E603aeDC1","amount":"0.0001","asset":"ETH","preview":true}')
echo "preview HTTP:${code}"
head -c 400 /tmp/tr.json
echo
curl -sf --max-time 8 http://127.0.0.1:9338/bridge/ethereum/status | python3 -c "import sys,json;d=json.load(sys.stdin);print('sender',d.get('senderBalanceEth'),'ETH master',d.get('masterBalanceEth'),'ETH')"
