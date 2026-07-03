#!/usr/bin/env python3
"""Deploy full OneX stack (node + wallet bridge + ledger) to ALI/ALLTRA ecosystem VPS."""
import os
import posixpath
import secrets
import sys
import tarfile
import tempfile
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
HOST = os.environ.get("SSH_HOST", "51.75.64.28")
USER = os.environ.get("SSH_USER", "ubuntu")
REMOTE = os.environ.get("ALI_DEPLOY_ROOT", "/home/ubuntu/onex")
GITHUB = os.environ.get(
    "GITHUB_REPO", "https://github.com/zaragoza444/onex.git"
)
LOCAL_SYNC = os.environ.get("LOCAL_SYNC", "").lower() in ("1", "true", "yes")

# Skip bulky local trees that are not needed on the VPS.
SKIP_TOP = {
    ".git",
    "go",
    "mobile",
    "bin",
    "dist",
    "node_modules",
    "__pycache__",
    "contracts",
    ".idea",
    ".vscode",
    ".claude",
    "tmp",
}
SKIP_NAMES = {".env", ".DS_Store", "Thumbs.db"}
SKIP_SUFFIX = {".exe", ".pyc", ".dll", ".so", ".dylib", ".zip", ".test"}


def should_include(rel: Path) -> bool:
    if rel.name in SKIP_NAMES:
        return False
    if rel.suffix.lower() in SKIP_SUFFIX:
        return False
    parts = rel.parts
    if not parts:
        return False
    if parts[0] in SKIP_TOP:
        return False
    if "node_modules" in parts or "__pycache__" in parts:
        return False
    if parts[0] == "data":
        return len(parts) == 1 or parts[1] == "bridge7"
    return True


def build_archive() -> tuple[str, int]:
    files: list[Path] = []
    for item in ROOT.rglob("*"):
        if not item.is_file():
            continue
        rel = item.relative_to(ROOT)
        if should_include(rel):
            files.append(rel)

    fd, archive_path = tempfile.mkstemp(suffix=".tar.gz")
    os.close(fd)
    with tarfile.open(archive_path, "w:gz") as tar:
        for rel in sorted(files):
            tar.add(ROOT / rel, arcname=rel.as_posix())
    return archive_path, len(files)


def upload_archive(sftp: paramiko.SFTPClient, archive_path: str) -> None:
    remote_tar = "/tmp/onex-deploy.tar.gz"
    total = os.path.getsize(archive_path)
    sent = [0]
    last_pct = [-1]

    def progress(done: int, _size: int) -> None:
        sent[0] = done
        pct = int(done * 100 / total) if total else 100
        if pct >= last_pct[0] + 5 or done == total:
            last_pct[0] = pct
            print(f"  upload {pct}% ({done // 1024} KB)", flush=True)

    print(f"Uploading archive ({total // 1024} KB)...", flush=True)
    sftp.put(archive_path, remote_tar, callback=progress)
    return remote_tar


def safe_write(text: str, *, stream) -> None:
    enc = getattr(stream, "encoding", None) or "utf-8"
    if hasattr(stream, "buffer"):
        stream.buffer.write(text.encode(enc, errors="replace"))
        stream.flush()
    else:
        stream.write(text.encode(enc, errors="replace").decode(enc, errors="replace"))
        stream.flush()


def stream_command(client: paramiko.SSHClient, script: str) -> tuple[str, int]:
    _, stdout, _ = client.exec_command(script, get_pty=True)
    chunks: list[str] = []
    channel = stdout.channel
    while True:
        if channel.recv_ready():
            data = channel.recv(4096).decode("utf-8", errors="replace")
            safe_write(data, stream=sys.stdout)
            chunks.append(data)
        if channel.recv_stderr_ready():
            data = channel.recv_stderr(4096).decode("utf-8", errors="replace")
            safe_write(data, stream=sys.stderr)
            chunks.append(data)
        if channel.exit_status_ready():
            while channel.recv_ready():
                data = channel.recv(4096).decode("utf-8", errors="replace")
                safe_write(data, stream=sys.stdout)
                chunks.append(data)
            break
        time.sleep(0.1)
    return "".join(chunks), channel.recv_exit_status()


def load_local_env() -> None:
    """Load ROOT/.env into os.environ (does not override existing vars)."""
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


def quiknode_env_block() -> str:
    rpc = os.environ.get("ONEX_ETHEREUM_RPC", "")
    qn = os.environ.get("ONEX_QUICKNODE_API_KEY", "")
    master = os.environ.get("ONEX_ETHEREUM_MASTER_WALLET", "")
    holder = os.environ.get("ONEX_EVM_HOLDER", master)
    lines = []
    if rpc:
        lines.append(f"ONEX_ETHEREUM_RPC={rpc}")
    if qn:
        lines.append(f"ONEX_QUICKNODE_API_KEY={qn}")
    if master:
        lines.append(f"ONEX_ETHEREUM_MASTER_WALLET={master}")
    if holder:
        lines.append(f"ONEX_EVM_HOLDER={holder}")
    return "\n".join(lines)


def remote_script(api_key: str, *, local_sync: bool) -> str:
    sync_block = ""
    if not local_sync:
        sync_block = f"""
if [ ! -d "$REPO/.git" ]; then
  if [ -d "$REPO" ] && [ "$(ls -A "$REPO" 2>/dev/null | head -1)" ]; then
    cd "$REPO"
    git init
    git remote add origin "$GITHUB" 2>/dev/null || git remote set-url origin "$GITHUB"
    git fetch origin main
    git reset --hard origin/main
  else
    git clone "$GITHUB" "$REPO"
    cd "$REPO"
  fi
else
  cd "$REPO"
  git remote set-url origin "$GITHUB" 2>/dev/null || git remote add origin "$GITHUB"
  git fetch origin main
  git reset --hard origin/main
fi
"""
    else:
        sync_block = f"""
mkdir -p "$REPO"
cd "$REPO"
"""
    return f"""set -e
export PATH=/usr/local/go/bin:$HOME/go/bin:$PATH
REPO={REMOTE}
GITHUB={GITHUB}
{sync_block}

if ! command -v go >/dev/null 2>&1; then
  echo "ERROR: Go is not installed on the VPS"
  exit 1
fi

mkdir -p "$HOME/.onex/wallets" "$HOME/.onex/portfolios" "$HOME/.onex/ledger-import" bin data/bridge7

EXISTING_API_KEY=""
if [ -f /etc/onex/onex.env ]; then
  EXISTING_API_KEY="$(grep '^ONEX_API_KEY=' /etc/onex/onex.env | cut -d= -f2- || true)"
fi
DEPLOY_API_KEY="${{EXISTING_API_KEY:-{api_key}}}"

for pair in local-ledger-2026:configs/local-ledger-2026.example.json ledger-pro:configs/ledger-pro.example.json crypto-ledger:configs/crypto-ledger.example.json; do
  name="${{pair%%:*}}"
  src="${{pair##*:}}"
  dst="data/bridge7/${{name}}.json"
  if [ ! -f "$dst" ] && [ -f "$src" ]; then
    cp "$src" "$dst"
  fi
done

echo "==> build binaries"
go build -o "$REPO/bin/onexd" ./cmd/onexd
go build -o "$REPO/bin/onex-bridge" ./cmd/onex-bridge
go build -o "$REPO/bin/bsc-launcher" ./bsc-launcher/server

sudo mkdir -p /etc/onex
sudo tee /etc/onex/onex.env >/dev/null <<EOF
ONEX_API_KEY=$DEPLOY_API_KEY
ONEX_CORS_ORIGINS=http://{HOST}:9338,http://{HOST}:8545,https://onexproduction.com,https://www.onexproduction.com,https://zaragoza444.github.io,https://zaragoza444.github.io/onex,https://git.anakatech.llc,https://explorer.d-bis.org
ONEX_LEDGER_MODE=production
ONEX_ONLINE_BANK=1
ONEX_NODE_OPTIONAL=1
ONEX_HYBX_ENABLED=1
ONEX_HYBX_URL=https://api.hybrix.io
ONEX_FINERACT_ENABLED=1
ONEX_BANK_LEDGER_FILE=$REPO/configs/bank-ledger.example.json
ONEX_BRIDGE7_ENABLED=1
ONEX_BRIDGE7_PATHS_FILE=$REPO/configs/bridge7.paths.json
ONEX_LOCAL_LEDGER_2026_FILE=$REPO/data/bridge7/local-ledger-2026.json
ONEX_LEDGER_PRO_FILE=$REPO/data/bridge7/ledger-pro.json
ONEX_CRYPTO_LEDGER_FILE=$REPO/data/bridge7/crypto-ledger.json
ONEX_CASHCODE_ENABLED=1
ONEX_PROJECT_ROOT=$REPO
ONEX_HOME_DIR=$HOME/.onex
ONEX_NODE_URL=http://127.0.0.1:8545
ONEX_BRIDGE_LISTEN=0.0.0.0:9338
ONEX_DEFAULT_BRIDGE_CHAIN=dbis-138
ONEX_PUBLIC_HOST={HOST}
DBIS138_RPC_URL=https://rpc-core.d-bis.org
DBIS138_EXPLORER=https://explorer.d-bis.org
DBIS138_CHAIN_ID=138
{quiknode_env_block()}
EOF

sudo tee /etc/systemd/system/onexd.service >/dev/null <<UNIT
[Unit]
Description=OneX blockchain node (ALI ecosystem)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory={REMOTE}
ExecStart={REMOTE}/bin/onexd -datadir {REMOTE}/data -genesis {REMOTE}/configs/genesis.json -seeds {REMOTE}/configs/seeds-mainnet.json -api :8545 -listen :30303
EnvironmentFile=/etc/onex/onex.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo tee /etc/systemd/system/onex-bridge.service >/dev/null <<UNIT
[Unit]
Description=OneX Wallet bridge + Real Ledger (ALI ecosystem)
After=network-online.target onexd.service
Wants=onexd.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory={REMOTE}
ExecStart={REMOTE}/bin/onex-bridge -node http://127.0.0.1:8545 -listen 0.0.0.0:9338 -config /home/ubuntu/.onex/bridge.json -wallet /home/ubuntu/.onex/wallets/default.json
EnvironmentFile=/etc/onex/onex.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

if [ -f "$REPO/bsc-launcher/.env.production.example" ] && [ ! -f "$REPO/bsc-launcher/.env" ]; then
  cp "$REPO/bsc-launcher/.env.production.example" "$REPO/bsc-launcher/.env"
fi
mkdir -p "$REPO/data/token-lab"
tee "$REPO/bsc-launcher/.env" >/dev/null <<TLENV
BSC_LAUNCHER_ENV=production
BSC_LAUNCHER_LISTEN=:9340
BSC_LAUNCHER_DATA_DIR=$REPO/data/token-lab
BSC_LAUNCHER_ROOT=$REPO/bsc-launcher
BSC_LAUNCHER_API_KEY=$DEPLOY_API_KEY
BSC_LAUNCHER_CORS_ORIGINS=http://{HOST}:9340,http://{HOST}
BSC_RPC_URL=https://bsc-dataseed.binance.org
BSCSCAN_API_KEY=
BSC_LAUNCHER_RATE_LIMIT=10
TLENV
sudo tee /etc/systemd/system/onex-token-lab.service >/dev/null <<UNIT
[Unit]
Description=OneX Token Lab (BSC Launcher)
After=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory={REMOTE}
EnvironmentFile={REMOTE}/bsc-launcher/.env
Environment=BSC_LAUNCHER_ROOT={REMOTE}/bsc-launcher
Environment=BSC_LAUNCHER_DATA_DIR={REMOTE}/data/token-lab
ExecStart={REMOTE}/bin/bsc-launcher
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable onexd onex-bridge onex-token-lab
sudo systemctl restart onexd
sleep 3
sudo systemctl restart onex-bridge onex-token-lab
sleep 3

echo "==> health"
curl -sf http://127.0.0.1:8545/health && echo " onexd OK" || echo " onexd FAIL"
curl -sf http://127.0.0.1:9338/health && echo " bridge OK" || echo " bridge FAIL"
curl -sf http://127.0.0.1:9338/bridge/health/green | head -c 300; echo
curl -sf http://127.0.0.1:9338/bridge/ledger/status | head -c 200; echo
curl -sf http://127.0.0.1:9338/bridge/ethereum/status | head -c 400; echo
curl -sf http://127.0.0.1:9340/health && echo " token-lab OK" || echo " token-lab FAIL"
curl -sf -X POST http://127.0.0.1:9338/bridge/cards/101.1/issue -H "Content-Type: application/json" -d '{{}}' | head -c 400; echo
systemctl is-active onexd onex-bridge onex-token-lab
echo "PUBLIC_WALLET=http://{HOST}:9338/wallet/"
echo "PUBLIC_LEDGER=http://{HOST}:9338/wallet/#ledger"
echo "PUBLIC_GREEN=http://{HOST}:9338/bridge/health/green"
echo "GITHUB_PAGES=https://zaragoza444.github.io/onex/wallet/?bridge=http://{HOST}:9338"
echo "PUBLIC_TOKEN_LAB=http://{HOST}:9340/"
"""


def main() -> int:
    load_local_env()
    password = os.environ.get("SSH_PASS")
    if not password:
        print("SSH_PASS required (ubuntu@51.75.64.28)", file=sys.stderr)
        return 1

    api_key = os.environ.get("ONEX_API_KEY") or secrets.token_urlsafe(32)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    print(f"Connecting to {USER}@{HOST}...", flush=True)
    client.connect(HOST, username=USER, password=password, timeout=45)

    if LOCAL_SYNC:
        print("Building deploy archive (excluding go/, mobile/, bin/)...", flush=True)
        archive_path, nfiles = build_archive()
        size_mb = os.path.getsize(archive_path) / (1024 * 1024)
        print(f"Archive ready: {nfiles} files, {size_mb:.1f} MB", flush=True)
        try:
            sftp = client.open_sftp()
            remote_tar = upload_archive(sftp, archive_path)
            sftp.close()
            extract = f"""
set -e
mkdir -p {REMOTE}
tar -xzf {remote_tar} -C {REMOTE}
rm -f {remote_tar}
echo "Extracted to {REMOTE}"
"""
            out, code = stream_command(client, extract)
            if code != 0:
                print("Extract failed", file=sys.stderr)
                return 1
        finally:
            os.unlink(archive_path)

    print("Running remote build + systemd...", flush=True)
    out, code = stream_command(
        client, remote_script(api_key, local_sync=LOCAL_SYNC)
    )
    client.close()

    if "bridge OK" in out and "active" in out:
        print("\n=== PUBLIC LINKS ===")
        print(f"Wallet:    http://{HOST}:9338/wallet/")
        print(f"Ledger:    http://{HOST}:9338/wallet/#ledger")
        print(f"Bridge API: http://{HOST}:9338/bridge/ledger/status")
        print(f"Token Lab: http://{HOST}:9340/")
        print(f"Node:      http://{HOST}:8545/health")
        if not os.environ.get("ONEX_API_KEY"):
            print(f"\nGenerated ONEX_API_KEY (save it): {api_key}")
        return 0
    print(f"Deploy finished with exit code {code}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
