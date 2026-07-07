# OneX Blockchain

Production proof-of-work blockchain: Ed25519 accounts, P2P sync, REST + JSON-RPC, embedded explorer, browser wallet (MetaMask-style UX), optional Chrome extension.

## Quick start (Windows)

```bat
build-onex.bat
run-onex.bat
```

- Explorer & wallet: http://localhost:8545/explorer/
- JSON-RPC: http://localhost:8545/rpc
- Health: http://localhost:8545/health

## OneX Wallet — full DeFi UI

**Website:** [website/](website/) · **Contact:** hello@zblockchainsystem.com · [Business email setup](docs/BUSINESS-EMAIL.md)

Open **http://127.0.0.1:9338/wallet/** for:

| Feature | Description |
|---------|-------------|
| **Portfolio** | Multi-chain & multi-token balances |
| **Send** | ONEX on-chain + portfolio tokens |
| **Deposit** | Bridge in from 13+ chains |
| **OneX Swap** | Uniswap-style AMM (x·y=k), liquidity pools, 0.3% fee |
| **Bridge tab** | Cross-chain via ONEX hub pools |
| **NFT** | Mint & view OneX NFTs |
| **Tasks** | Earn rewards (ONEX, wONEX) |
| **Loans** | Borrow / lend with collateral |
| **OneX AI** | Wallet assistant (local + optional cloud LLM) |
| **Token Platform** | Deploy tokens on 13+ chains, cross-chain wrap, CLI |

Chains: OneX, Ethereum, BSC, Polygon, Arbitrum, Optimism, Avalanche, Base, Solana, Bitcoin, TRON, ALLTRA, testnet.

See [docs/TOKEN-PLATFORM.md](docs/TOKEN-PLATFORM.md) for deploy, wrap, API, and CLI.

### Flash Coin mirror

Cross-chain **FLASH** / **wFLASH** with real ERC-20 contracts on 7 EVM mainnets. See [docs/FLASH-COIN.md](docs/FLASH-COIN.md).

```bat
powershell -File scripts\finish-flash-coin.ps1
scripts\deploy-flash-coin-live.ps1
```

Dashboard: http://127.0.0.1:9340/ (Token Lab → Flash Coin mirrors)

### OneX AI

- **Wallet tab “AI”** — chat with portfolio-aware help
- **API:** `POST /bridge/ai/chat` (wallet) · `POST /api/v1/ai/chat` (node)
- **CLI:** `onex-ai -ask "How do I swap?"` or interactive mode
- **Cloud mode:** set `ONEX_AI_API_KEY` (OpenAI-compatible endpoint via `ONEX_AI_BASE_URL`)
- **Local mode:** works without a key (built-in answers + navigation hints)

Configs: `configs/chains.json`, `tokens.json`, `swap-pairs.json`

## OneX Wallet bridge (local)

The **bridge** (`onex-bridge`) connects your wallet to the node on this PC:

| Component | URL |
|-----------|-----|
| Node | http://127.0.0.1:8545 |
| Bridge + Wallet UI | http://127.0.0.1:9338/wallet/ |
| Bridge JSON-RPC | http://127.0.0.1:9338/rpc |

```bat
run-onex-wallet.bat
```

Config: `%USERPROFILE%\.onex\bridge.json` · Wallet file: `%USERPROFILE%\.onex\wallets\default.json`

Fix desktop shortcut: `powershell -File install-wallet-shortcut.ps1`

## Wallet (like MetaMask)

OneX uses **Ed25519** (64-character hex addresses), not Ethereum. **Standard MetaMask cannot sign OneX transactions.**

| Option | How |
|--------|-----|
| **Built-in wallet** | Open `/explorer/` → **Wallet** tab → Create / Import → Connect |
| **Browser extension** | Chrome → Load unpacked → `extension/` folder |
| **CLI** | `onex wallet-create` · `onex send -wallet ~/.onex/wallets/default.json -to ADDR -amount 1` |
| **dApp API** | `window.onex.request({ method: 'onex_requestAccounts' })` |

### Add network to MetaMask (read-only chain info)

MetaMask can show the network but **will not sign** OneX txs. Use OneX Wallet for sends.

```javascript
// chainId 9001 = 0x2329 (mainnet)
await window.ethereum?.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '0x2329',
    chainName: 'OneX Mainnet',
    nativeCurrency: { name: 'OneX', symbol: 'ONEX', decimals: 8 },
    rpcUrls: ['https://your-node.example/rpc'],
    blockExplorerUrls: ['https://your-node.example/explorer/'],
  }],
});
```

## Production deployment

Full guide: **[DEPLOY.md](DEPLOY.md)**

### Docker (node + wallet bridge)

```bash
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d --build
```

- Node: `http://HOST:8545` · Wallet: `http://HOST:9338/wallet/`
- TLS: `docker compose -f docker-compose.prod.yml --profile proxy up -d`

### Docker (node only)

```bash
docker compose up -d onexd
```

Testnet + faucet:

```bash
export ONEX_FAUCET_PRIVATE_KEY=<hex>
docker compose --profile testnet up -d onexd-testnet
```

### TLS + API key

```bash
onexd -tls-cert /etc/onex/tls/fullchain.pem -tls-key /etc/onex/tls/privkey.pem -api-key "$ONEX_API_KEY"
```

Environment (see `.env.example`):

- `ONEX_FAUCET_PRIVATE_KEY` — testnet faucet
- `ONEX_API_KEY` — protect `POST /api/v1/tx` and `/rpc`
- `ONEX_CORS_ORIGINS` — browser wallet origins

### systemd + nginx

- `deploy/onexd.service` — node unit file
- `deploy/nginx.conf` — reverse proxy (use with `docker compose --profile proxy`)

## JSON-RPC methods

| Method | Description |
|--------|-------------|
| `onex_chainId` | String chain id |
| `eth_chainId` | `0x2329` (network id 9001) |
| `onex_getBalance` | Balance + nonce |
| `onex_getTransactionCount` | Account nonce |
| `onex_sendTransaction` | Submit signed tx |
| `eth_getBalance` / `eth_getTransactionCount` | Hex-encoded compat |

## Networks

| Network | Chain ID | Network ID | Genesis |
|---------|----------|------------|---------|
| Mainnet | onex-mainnet-1 | 9001 | `configs/genesis.json` |
| Testnet | onex-testnet-1 | 9002 | `configs/genesis-testnet.json` |

## Build

```bash
make build
make test
make run-testnet   # :8547, mining + faucet
```

## Mobile apps (Android & iOS)

Expo WebView wrapper in [`mobile/`](mobile/) — see [mobile/PUBLISH.md](mobile/PUBLISH.md).

## Publish to [Anakatech Gitea](https://git.anakatech.llc/) & GitHub

1. Create empty repo **onex** on https://git.anakatech.llc/ (and optionally on GitHub).
2. Copy `remotes.env.example` → `remotes.env` (defaults to Anakatech URLs).
3. Push:

```powershell
git push -u gitea main
# optional mirror:
.\scripts\publish-remotes.ps1 `
  -GitHub "https://github.com/zaragoza444/onex.git" `
  -Gitea "https://git.anakatech.llc/zaragoza/onex.git"
```

CI: `.gitea/workflows/ci.yml` (Anakatech) and `.github/workflows/ci.yml` (GitHub).

## Layout

- `cmd/onexd` — node
- `cmd/onex` — CLI wallet
- `cmd/onex-bridge` — wallet bridge + OKX-style DeFi UI
- `internal/api` — REST, explorer, middleware
- `internal/bridge` — portfolio, swap, staking, static wallet
- `internal/rpc` — JSON-RPC
- `extension/` — OneX Wallet (Chrome)
- `deploy/` — nginx, systemd
