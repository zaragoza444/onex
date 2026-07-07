#!/usr/bin/env bash
# One-shot go-live on Ubuntu VPS — run as ubuntu (web console or SSH).
#   curl -fsSL https://raw.githubusercontent.com/zaragoza444/onex/main/scripts/vps-go-live.sh | bash
# Or after git clone:
#   bash scripts/vps-go-live.sh
set -euo pipefail

REPO="${ONEX_REPO:-$HOME/onex}"
GITHUB="${GITHUB_REPO:-https://github.com/zaragoza444/onex.git}"
DOMAIN="${ONEX_DEPLOY_DOMAIN:-}"
CERT_EMAIL="${CERTBOT_EMAIL:-hello@zblockchainsystem.com}"
DEPLOY_MODE="${ONEX_DEPLOY_MODE:-auto}"   # auto | systemd | docker

detect_ip() {
  curl -sf --max-time 5 https://api.ipify.org 2>/dev/null || \
  curl -sf --max-time 5 https://ifconfig.me/ip 2>/dev/null || \
  hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1"
}

HOST_IP="$(detect_ip)"
echo "==> OneX VPS go-live"
echo "    Public IP: $HOST_IP"
echo "    Domain:    ${DOMAIN:-<none — IP-only>}"
echo ""

echo "==> Firewall (UFW)"
if command -v ufw >/dev/null 2>&1; then
  sudo ufw allow 22/tcp comment 'SSH' || true
  sudo ufw allow 80/tcp comment 'HTTP' || true
  sudo ufw allow 443/tcp comment 'HTTPS' || true
  sudo ufw allow 9338/tcp comment 'OneX wallet bridge' || true
  sudo ufw allow 8545/tcp comment 'OneX node API' || true
  sudo ufw allow 9340/tcp comment 'Token Lab' || true
  sudo ufw allow 30303/tcp comment 'OneX P2P' || true
  if sudo ufw status | grep -q inactive; then
    echo "y" | sudo ufw enable || true
  fi
  sudo ufw reload || true
  sudo ufw status numbered || true
else
  echo "    ufw not installed — open ports 22,80,443,9338,8545 in cloud firewall"
fi

echo ""
echo "==> Source code"
if [ ! -d "$REPO/.git" ]; then
  git clone "$GITHUB" "$REPO"
fi
cd "$REPO"
git fetch origin main 2>/dev/null || git fetch origin master 2>/dev/null || true
git reset --hard "origin/main" 2>/dev/null || git reset --hard "origin/master" 2>/dev/null || true

USE_DOCKER=0
if [ "$DEPLOY_MODE" = "docker" ]; then
  USE_DOCKER=1
elif [ "$DEPLOY_MODE" = "auto" ] && command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  USE_DOCKER=1
fi

if [ "$USE_DOCKER" = "1" ] && [ -f docker-compose.prod.yml ]; then
  echo "==> Docker production stack (node + bridge + nginx + website)"
  if [ ! -f .env ]; then
    cp deploy/env.production.example .env
    KEY="$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)"
    sed -i "s/CHANGE_ME_LONG_RANDOM_SECRET/$KEY/" .env 2>/dev/null || \
      sed -i '' "s/CHANGE_ME_LONG_RANDOM_SECRET/$KEY/" .env 2>/dev/null || true
    echo "    Created .env with random ONEX_API_KEY"
  fi
  if [ -n "$DOMAIN" ]; then
    export ONEX_PRODUCTION_DOMAIN="$DOMAIN"
    if [ ! -f deploy/certs/fullchain.pem ]; then
      echo "==> TLS for $DOMAIN"
      sudo docker compose -f docker-compose.prod.yml --profile proxy down 2>/dev/null || true
      sudo certbot certonly --standalone -d "$DOMAIN" -d "www.$DOMAIN" \
        --non-interactive --agree-tos -m "$CERT_EMAIL" || echo "WARN: certbot failed — check DNS A record -> $HOST_IP"
      sudo mkdir -p deploy/certs
      sudo cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" deploy/certs/ 2>/dev/null || true
      sudo cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" deploy/certs/ 2>/dev/null || true
    fi
  fi
  docker compose -f docker-compose.prod.yml --profile proxy up -d --build
  sleep 10
  curl -sf http://127.0.0.1:9338/health && echo " bridge OK" || echo " bridge FAIL"
  curl -sf http://127.0.0.1:9338/bridge/bridge7/status | head -c 200 && echo " ... bridge7 OK" || echo " bridge7 FAIL"
  if [ -n "$DOMAIN" ] && [ -f deploy/certs/fullchain.pem ]; then
    echo "Site:   https://$DOMAIN/"
    echo "Wallet: https://$DOMAIN/wallet/"
  else
    echo "Wallet: http://${HOST_IP}:9338/wallet/"
    echo "Site:   http://${HOST_IP}:9338/wallet/  (or configure DOMAIN=zblockchainsystem.com)"
  fi
else
  echo "==> Systemd stack (go, onexd + bridge + token lab)"
  export ALI_DEPLOY_ROOT="$REPO"
  export ALI_PUBLIC_HOST="$HOST_IP"
  bash "$REPO/scripts/deploy-ali-ecosystem.sh"
fi

echo ""
echo "==> Marketing site"
if [ -d "$REPO/website" ] && ! curl -sf "http://127.0.0.1/" >/dev/null 2>&1; then
  if command -v nginx >/dev/null 2>&1; then
    sudo tee /etc/nginx/sites-available/onex-site >/dev/null <<NGX
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;
  root ${REPO}/website;
  index index.html;
  location / { try_files \$uri \$uri/ /index.html; }
  location /wallet/ {
    proxy_pass http://127.0.0.1:9338/wallet/;
    proxy_set_header Host \$host;
  }
  location /bridge/ {
    proxy_pass http://127.0.0.1:9338/bridge/;
    proxy_set_header Host \$host;
  }
  location /explorer/ {
    proxy_pass http://127.0.0.1:8545/explorer/;
    proxy_set_header Host \$host;
  }
}
NGX
    sudo ln -sf /etc/nginx/sites-available/onex-site /etc/nginx/sites-enabled/onex-site
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo nginx -t && sudo systemctl reload nginx
    echo "    nginx serving website at http://${HOST_IP}/"
  else
    echo "    install nginx to serve website at / (optional: sudo apt install nginx)"
  fi
fi

echo ""
echo "=== DONE ==="
echo "Wallet:  http://${HOST_IP}:9338/wallet/"
echo "Contact: http://${HOST_IP}/contact.html (if nginx) or website/contact.html"
echo ""
if [ -n "$DOMAIN" ]; then
  echo "DNS: ensure A record $DOMAIN -> $HOST_IP (see deploy/dns-records.md)"
  echo "Email: enable Cloudflare Email Routing (docs/BUSINESS-EMAIL.md)"
fi
echo "Re-check DNS: Resolve-DnsName $DOMAIN -Type A"
