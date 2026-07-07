package bridge

import (
	"context"
	"os"
	"path/filepath"

	"github.com/onex-blockchain/onex/internal/ledger"
	"github.com/onex-blockchain/onex/internal/types"
)

func (b *Bridge) ledgerConfig() ledger.Config {
	return ledger.LoadConfig()
}

func (b *Bridge) ledgerPrices() map[string]ledger.PriceQuote {
	raw := b.MarketPrices()
	out := make(map[string]ledger.PriceQuote, len(raw))
	for sym, q := range raw {
		out[sym] = ledger.PriceQuote{USD: q.USD}
	}
	return out
}

func (b *Bridge) ledgerTokens() []ledger.TokenMeta {
	tokens := b.AllTokens("")
	out := make([]ledger.TokenMeta, 0, len(tokens))
	for _, t := range tokens {
		out = append(out, ledger.TokenMeta{
			ChainID:  t.ChainID,
			TokenID:  t.ID,
			Symbol:   t.Symbol,
			Decimals: t.Decimals,
			Native:   t.Native,
		})
	}
	return out
}

func (b *Bridge) ledgerChains() []ledger.EVMChain {
	chains := b.registry().GetChains()
	out := make([]ledger.EVMChain, 0, len(chains))
	for _, c := range chains {
		out = append(out, ledger.EVMChain{ID: c.ID, RPC: c.RPC, Type: c.Type})
	}
	return out
}

func (b *Bridge) tokenMetaMap() map[string]ledger.TokenMeta {
	m := make(map[string]ledger.TokenMeta)
	for _, t := range b.ledgerTokens() {
		m[t.Symbol] = t
	}
	return m
}

// LedgerStatus returns production middleware readiness.
func (b *Bridge) LedgerStatus() map[string]interface{} {
	st := b.resolvedLedgerConfig().Status()
	st["settlement"] = b.SettlementCapabilities()
	return st
}

// ReadRealLedger aggregates bank, on-chain, and optional portfolio ledgers into real fiat/crypto values.
func (b *Bridge) ReadRealLedger(ctx context.Context, source, evmHolder string, importJSON []byte) (ledger.Snapshot, error) {
	cfg := b.resolvedLedgerConfig()
	in := ledger.ReadInput{
		Config:     cfg,
		Source:     source,
		EVMHolder:  evmHolder,
		Tokens:     b.ledgerTokens(),
		Chains:     b.ledgerChains(),
		Prices:     b.ledgerPrices(),
		ImportJSON: importJSON,
	}

	if err := b.EnsureWallet(); err == nil {
		in.WalletAddr = b.WalletAddress()
		bal, _, err := b.node.Balance(types.Address(in.WalletAddr))
		if err == nil {
			in.OnexAtomic = formatUint(bal)
		}
		p, err := b.GetPortfolio()
		if err == nil && p != nil {
			in.Portfolio = p.Balances
		}
	}

	return ledger.NewEngine().Read(ctx, in), nil
}

// SaveLedgerImport persists imported ledger JSON for later reads.
func (b *Bridge) SaveLedgerImport(data []byte) (string, error) {
	dir := b.ledgerConfig().ImportDir
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	name := "import-" + newID() + ".json"
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", err
	}
	return path, nil
}

// LoadLatestImport returns the most recently saved import file, if any.
func (b *Bridge) LoadLatestImport() []byte {
	dir := b.ledgerConfig().ImportDir
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) == 0 {
		return nil
	}
	var latest os.DirEntry
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		if latest == nil || e.Name() > latest.Name() {
			latest = e
		}
	}
	if latest == nil {
		return nil
	}
	data, err := os.ReadFile(filepath.Join(dir, latest.Name()))
	if err != nil {
		return nil
	}
	return data
}

func formatUint(n uint64) string {
	if n == 0 {
		return "0"
	}
	var buf [32]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
