#!/usr/bin/env bash
set -euo pipefail
KEY=$(sudo awk -F= '/^ONEX_API_KEY=/{print $2; exit}' /etc/onex/onex.env | tr -d '\r\n')
HDR=(-H "Content-Type: application/json" -H "X-OneX-Api-Key: ${KEY}")

echo "==> status"
curl -sf --max-time 12 http://127.0.0.1:9338/bridge/ethereum/status
echo

echo "==> fund-sender (if master key set)"
code=$(curl -s -o /tmp/fund.json -w "%{http_code}" --max-time 60 -X POST http://127.0.0.1:9338/bridge/ethereum/fund-sender "${HDR[@]}")
echo "HTTP:${code}"
cat /tmp/fund.json
echo

echo "==> status after fund"
curl -sf --max-time 12 http://127.0.0.1:9338/bridge/ethereum/status
echo

echo "==> live transfer 0.00001 ETH to master (smoke test)"
code=$(curl -s -o /tmp/live.json -w "%{http_code}" --max-time 120 -X POST http://127.0.0.1:9338/bridge/ethereum/transfer "${HDR[@]}" \
  -d '{"to":"0x587374d7d33e3e235d6a485Edc3EF83E603aeDC1","amount":"0.00001","asset":"ETH","preview":false}')
echo "HTTP:${code}"
cat /tmp/live.json
echo

echo "==> green health evm/settlement"
curl -sf --max-time 15 http://127.0.0.1:9338/bridge/health/green | python3 -c "
import sys,json
d=json.load(sys.stdin)
for c in d.get('checks',[]):
  if c.get('id') in ('evm','settlement','ethereum'):
    print(c['id'], c['status'], c.get('detail','')[:80])
"
