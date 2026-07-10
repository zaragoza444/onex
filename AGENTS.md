# AGENTS.md

## Cursor Cloud specific instructions

OneX is a self-contained Go 1.22 proof-of-work blockchain plus a DeFi wallet bridge. All persistence is flat JSON files on disk (no external database). The startup `update_script` runs `go mod download`; dependencies are otherwise fetched automatically by `go build`.

### Core services (run for end-to-end testing)

| Service | Run command | Purpose / notes |
|---------|-------------|-----------------|
| `onexd` (node) | `./bin/onexd -datadir ./data/node1 -api :8545 -listen :30303 -mine -miner <addr>` | Blockchain node: REST (`/api/v1/...`), JSON-RPC (`/rpc`), block explorer + browser wallet (`/explorer/`), P2P. `/health` returns `{"status":"ok"}`. |
| `onex-bridge` (wallet UI) | `ONEX_LEDGER_MODE=simulated ONEX_PROJECT_ROOT=/workspace ./bin/onex-bridge -node http://127.0.0.1:8545 -listen :9338` | Serves the full DeFi wallet UI at `/wallet/` and a JSON-RPC proxy. Depends on `onexd`. For local dev set `ONEX_LEDGER_MODE=simulated` (see gotcha below). |

Build everything with `make build` (outputs to `bin/`). `bsc-launcher` is a separate optional product (`go build -o bin/bsc-launcher ./bsc-launcher/server`, serves `:9340`) and is NOT built by the Makefile.

### Build / lint / test

- Build: `make build` (or `go build ./cmd/...`).
- Lint: `go vet ./cmd/... ./internal/...` (passes clean).
- Test: `go test ./internal/...` (all packages pass; the bridge7 ledger tests use tracked CI fixtures via `configs/bridge7.ci.paths.json`).

### Non-obvious gotchas

- **Run the bridge in non-production ledger mode for local dev**: set `ONEX_LEDGER_MODE=simulated` (any value other than `production`/`prod`). The mode is `production` by default, which runs a synchronous startup bootstrap (`BootstrapProduction`) that expects real external bank/Fineract/HYBX/SWIFT/global-server integrations; the HTTP server only begins listening after the bootstrap returns, so in an offline dev VM the bridge appears to hang at `production bootstrap…` and `/health` refuses connections. Non-production mode skips the bootstrap and the bridge starts immediately.
- **OneX Swap (AMM) needs activation + seeded balances.** Call `POST /bridge/onex-swap/activate` once; it loads the AMM pools and seeds starter balances (e.g. ~100 wONEX, ~50 sONEX) onto the wallet portfolio. The swap `amount` is in human units. Native `onex-mainnet-1:ONEX` balance comes from on-chain (0 on a fresh chain), so swap **from** a seeded token like `wONEX`/`sONEX` (not from `ONEX`) unless you first fund/mine ONEX to the wallet.
- The node defaults to **mainnet** genesis (`configs/genesis.json`, chain `onex-mainnet-1`, network id 9001). Testnet is `-genesis ./configs/genesis-testnet.json` (id 9002) and supports `-faucet`.
- The bridge's AMM/swap pools and portfolio token IDs are keyed to `onex-mainnet-1`. Run the node on the default mainnet genesis (not testnet) so wallet DeFi features line up with on-chain ONEX.
- To get spendable ONEX, mine: run `onexd` with `-mine -miner <64-hex address>`; the miner address accrues block rewards every few seconds.
- The bridge resolves its chain binding from the node at request time. After restarting `onexd` (especially switching genesis or wiping the datadir), restart `onex-bridge` so cached portfolio/chain state refreshes.
- ONEX accounts are **Ed25519** with 64-hex addresses (not Ethereum-signable). Wallet key files store 128-hex (privkey||pubkey); the explorer Wallet tab "Import" accepts the first 64 hex of that string.
- Two browser entry points: built-in explorer + wallet at `http://127.0.0.1:8545/explorer/` (Wallet tab → Import / Send), and the full DeFi wallet at `http://127.0.0.1:9338/wallet/`.
- CLI helpers: `./bin/onex wallet-create -out PATH`, `./bin/onex balance -address HEX -api http://127.0.0.1:8545`, `./bin/onex send -wallet PATH -to HEX -amount N -api http://127.0.0.1:8545`.
- `.githooks/post-commit` auto-pushes via PowerShell and is a no-op on Linux; ignore it.
