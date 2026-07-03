package bridge

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"sync"

	"github.com/onex-blockchain/onex/internal/bridge/chains"
	"github.com/onex-blockchain/onex/internal/legacy"
)

type ChainInfo struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	NetworkID uint64 `json:"networkId"`
	Symbol    string `json:"symbol"`
	Native    bool   `json:"native"`
	RPC       string `json:"rpc"`
	Explorer  string `json:"explorer"`
	Color     string `json:"color"`
	Type      string `json:"type"`
}

type TokenInfo struct {
	ID       string `json:"id"`
	ChainID  string `json:"chainId"`
	Name     string `json:"name"`
	Symbol   string `json:"symbol"`
	Decimals int    `json:"decimals"`
	Native   bool   `json:"native"`
}

type SwapPair struct {
	From string `json:"from"`
	To   string `json:"to"`
	Rate string `json:"rate"`
}

type Registry struct {
	mu    sync.RWMutex
	Root  string
	Chains []ChainInfo
	Tokens []TokenInfo
	Pairs  []SwapPair
}

func NewRegistry(root string) *Registry {
	r := &Registry{Root: root}
	r.Reload()
	return r
}

func (r *Registry) Reload() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Chains = loadJSON[ChainInfo](filepath.Join(r.Root, "configs", "chains.json"))
	r.Tokens = loadJSON[TokenInfo](filepath.Join(r.Root, "configs", "tokens.json"))
	r.Pairs = loadJSON[SwapPair](filepath.Join(r.Root, "configs", "swap-pairs.json"))
}

func loadJSON[T any](path string) []T {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var out []T
	_ = json.Unmarshal(data, &out)
	return out
}

func (r *Registry) GetChains() []ChainInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]ChainInfo, len(r.Chains))
	copy(out, r.Chains)
	for i := range out {
		out[i].RPC = chains.ResolveChainRPC(out[i].ID, out[i].RPC)
	}
	return out
}

func (r *Registry) GetTokens(chainID string) []TokenInfo {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var out []TokenInfo
	for _, t := range r.Tokens {
		if chainID == "" || t.ChainID == chainID {
			out = append(out, t)
		}
	}
	return out
}

// GetTokensMerged includes custom user-created tokens (caller must merge first via Bridge).
func (r *Registry) appendToken(t TokenInfo) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, x := range r.Tokens {
		if x.ChainID == t.ChainID && x.ID == t.ID {
			return
		}
	}
	r.Tokens = append(r.Tokens, t)
}

func (r *Registry) TokenKey(chainID, tokenID string) string {
	chainID, tokenID = legacy.NormalizeToken(chainID, tokenID)
	return chainID + ":" + tokenID
}

func (r *Registry) FindToken(chainID, tokenID string) *TokenInfo {
	chainID, tokenID = legacy.NormalizeToken(chainID, tokenID)
	r.mu.RLock()
	defer r.mu.RUnlock()
	for i := range r.Tokens {
		if r.Tokens[i].ChainID == chainID && r.Tokens[i].ID == tokenID {
			t := r.Tokens[i]
			return &t
		}
	}
	return nil
}

func (r *Registry) SwapRate(fromKey, toKey string) (float64, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, p := range r.Pairs {
		if p.From == fromKey && p.To == toKey {
			rate, err := strconv.ParseFloat(p.Rate, 64)
			if err == nil {
				return rate, true
			}
		}
	}
	return 0, false
}
