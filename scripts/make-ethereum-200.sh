#!/usr/bin/env bash
# Force /bridge/ethereum/status -> 200 on this VPS.
# Run on server: curl -fsSL https://raw.githubusercontent.com/zaragoza444/onex/main/scripts/make-ethereum-200.sh | bash
set -euo pipefail

export PATH="/usr/local/go/bin:$HOME/go/bin:$PATH"
GITHUB="${GITHUB_REPO:-https://github.com/zaragoza444/onex.git}"
STATUS_URL="http://127.0.0.1:9338/bridge/ethereum/status"
HEALTH_URL="http://127.0.0.1:9338/health"

http_code() {
  curl -s -o /dev/null -w "%{http_code}" "$1" 2>/dev/null || echo "000"
}

find_repo() {
  local d line bin repo
  if systemctl cat onex-bridge 2>/dev/null | grep -q '^ExecStart='; then
    line=$(systemctl cat onex-bridge | grep '^ExecStart=' | head -1)
    bin=$(echo "$line" | sed 's/^ExecStart=//' | awk '{print $1}')
    repo=$(dirname "$(dirname "$bin")")
    if [ -f "$repo/cmd/onex-bridge/main.go" ]; then
      echo "$repo"
      return 0
    fi
  fi
  for d in "$HOME/onex" "$HOME/onex-blockchain" "/opt/onex"; do
    if [ -f "$d/cmd/onex-bridge/main.go" ]; then
      echo "$d"
      return 0
    fi
  done
  return 1
}

ensure_repo() {
  local repo="$1"
  if [ ! -d "$repo/.git" ]; then
    git clone "$GITHUB" "$repo"
  fi
  cd "$repo"
  git fetch origin main
  git reset --hard origin/main
  echo "Commit: $(git log -1 --oneline)"
}

merge_quiknode_env() {
  local qn="/etc/onex/quiknode.env" envf="/etc/onex/onex.env"
  [ -f "$qn" ] || return 0
  sudo mkdir -p /etc/onex
  sudo touch "$envf"
  set -a
  # shellcheck disable=SC1090
  source "$qn"
  set +a
  for key in ONEX_ETHEREUM_RPC ONEX_QUICKNODE_API_KEY ONEX_ETHEREUM_MASTER_WALLET ONEX_EVM_HOLDER; do
    val="${!key:-}"
    [ -n "$val" ] || continue
    if sudo grep -q "^${key}=" "$envf" 2>/dev/null; then
      sudo sed -i "s|^${key}=.*|${key}=${val}|" "$envf"
    else
      echo "${key}=${val}" | sudo tee -a "$envf" >/dev/null
    fi
  done
}

build_and_restart_systemd() {
  local repo="$1" bin="$repo/bin/onex-bridge"
  cd "$repo"
  merge_quiknode_env
  echo "==> go build -> $bin"
  go build -o "$bin" ./cmd/onex-bridge
  if systemctl cat onex-bridge 2>/dev/null | grep -q '^ExecStart='; then
    line=$(systemctl cat onex-bridge | grep '^ExecStart=' | head -1)
    svc_bin=$(echo "$line" | sed 's/^ExecStart=//' | awk '{print $1}')
    if [ "$svc_bin" != "$bin" ] && [ -n "$svc_bin" ]; then
      echo "==> sync binary to systemd path: $svc_bin"
      sudo install -m 755 "$bin" "$svc_bin"
    fi
  fi
  sudo systemctl daemon-reload
  sudo systemctl restart onex-bridge
  sleep 4
}

build_and_restart_docker() {
  local repo="$1"
  cd "$repo"
  merge_quiknode_env
  echo "==> docker compose rebuild onex-bridge"
  if [ -f docker-compose.prod.yml ]; then
    sudo docker compose -f docker-compose.prod.yml build onex-bridge
    sudo docker compose -f docker-compose.prod.yml up -d onex-bridge
  else
    sudo docker compose build onex-bridge
    sudo docker compose up -d onex-bridge
  fi
  sleep 8
}

uses_systemd_bridge() {
  systemctl is-active onex-bridge >/dev/null 2>&1
}

uses_docker_bridge() {
  docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -qE 'onex.*9338|9338.*onex'
}

echo "==> make-ethereum-200"
if [ "$(http_code "$STATUS_URL")" = "200" ]; then
  echo "Already 200"
  curl -sf "$STATUS_URL"
  echo ""
  exit 0
fi

REPO="$(find_repo)" || REPO="$HOME/onex"
mkdir -p "$REPO"
ensure_repo "$REPO"

if uses_systemd_bridge; then
  build_and_restart_systemd "$REPO"
elif uses_docker_bridge; then
  build_and_restart_docker "$REPO"
else
  build_and_restart_systemd "$REPO"
fi

code=$(http_code "$STATUS_URL")
echo "==> $STATUS_URL -> HTTP $code"
curl -sf "$HEALTH_URL" && echo " health OK" || echo " health FAIL"
if [ "$code" = "200" ]; then
  curl -sf "$STATUS_URL"
  echo ""
  echo "SUCCESS: ethereum status is 200"
  exit 0
fi

echo "FAILED: still HTTP $code"
echo "Debug:"
systemctl status onex-bridge --no-pager 2>/dev/null | head -20 || true
docker ps 2>/dev/null | head -5 || true
journalctl -u onex-bridge -n 30 --no-pager 2>/dev/null || true
exit 1
