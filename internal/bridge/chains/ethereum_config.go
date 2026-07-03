package chains

import (
	"context"
	"fmt"
	"math/big"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

const EthereumMainnetChainID uint64 = 1

// LoadEthereumRPC returns the QuickNode / custom Ethereum mainnet JSON-RPC URL.
func LoadEthereumRPC() string {
	for _, k := range []string{
		"ONEX_ETHEREUM_RPC",
		"ONEX_QUICKNODE_ETHEREUM_RPC",
		"QUICKNODE_ETHEREUM_RPC",
		"ETHEREUM_RPC_URL",
	} {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

// LoadQuickNodeAPIKey returns the QuickNode dashboard API key (QN_…).
func LoadQuickNodeAPIKey() string {
	for _, k := range []string{
		"ONEX_QUICKNODE_API_KEY",
		"QUICKNODE_API_KEY",
	} {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v
		}
	}
	return ""
}

// LoadEthereumMasterWallet is the OneX Ethereum master / treasury address.
func LoadEthereumMasterWallet() string {
	for _, k := range []string{
		"ONEX_ETHEREUM_MASTER_WALLET",
		"ONEX_EVM_HOLDER",
		"ONEX_MASTER_WALLET",
	} {
		if v := FormatAddress(os.Getenv(k)); IsAddressHex(v) {
			return v
		}
	}
	return ""
}

// ResolveChainRPC applies env overrides for known chains.
func ResolveChainRPC(chainID, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(chainID)) {
	case "ethereum", "eth", "mainnet":
		if v := LoadEthereumRPC(); v != "" {
			return v
		}
	}
	return strings.TrimSpace(fallback)
}

// MaskRPCURL hides path tokens in RPC URLs for API responses.
func MaskRPCURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return "configured"
	}
	if u.Path != "" && u.Path != "/" {
		u.Path = "/***"
	}
	return u.String()
}

// EthereumRPCStatus reports connectivity to Ethereum mainnet via QuickNode.
type EthereumRPCStatus struct {
	Configured      bool   `json:"configured"`
	RPC             string `json:"rpc,omitempty"`
	Provider        string `json:"provider,omitempty"`
	ChainID         uint64 `json:"chainId"`
	BlockNumber     uint64 `json:"blockNumber,omitempty"`
	Online          bool   `json:"online"`
	Error           string `json:"error,omitempty"`
	QuickNodeAPIKey bool   `json:"quicknodeApiKeyConfigured"`
	MasterWallet    string `json:"masterWallet,omitempty"`
	SenderWallet    string `json:"senderWallet,omitempty"`
	MasterBalance   string `json:"masterBalanceEth,omitempty"`
	SenderBalance   string `json:"senderBalanceEth,omitempty"`
	MasterKeySet    bool   `json:"masterKeyConfigured,omitempty"`
}

func ProbeEthereumRPC(ctx context.Context) EthereumRPCStatus {
	st := EthereumRPCStatus{
		ChainID:         EthereumMainnetChainID,
		Provider:        "quicknode",
		QuickNodeAPIKey: LoadQuickNodeAPIKey() != "",
		MasterWallet:    LoadEthereumMasterWallet(),
		MasterKeySet:    LoadEthereumMasterKeySilent(),
	}
	rpcURL := LoadEthereumRPC()
	if rpcURL == "" {
		st.Error = "set ONEX_ETHEREUM_RPC to your QuickNode endpoint"
		return st
	}
	st.Configured = true
	st.RPC = MaskRPCURL(rpcURL)

	if addr, err := BridgeSenderAddress(); err == nil {
		st.SenderWallet = addr
	}

	client, err := ethclient.DialContext(ctx, rpcURL)
	if err != nil {
		st.Error = err.Error()
		return st
	}
	defer client.Close()

	block, err := client.BlockNumber(ctx)
	if err != nil {
		st.Error = err.Error()
		return st
	}
	st.BlockNumber = block
	st.Online = true

	if st.MasterWallet != "" {
		if bal, err := client.BalanceAt(ctx, common.HexToAddress(st.MasterWallet), nil); err == nil {
			st.MasterBalance = weiToEthString(bal)
		}
	}
	if st.SenderWallet != "" {
		if bal, err := client.BalanceAt(ctx, common.HexToAddress(st.SenderWallet), nil); err == nil {
			st.SenderBalance = weiToEthString(bal)
		}
	}
	return st
}

func weiToEthString(wei *big.Int) string {
	if wei == nil {
		return "0"
	}
	eth := new(big.Float).Quo(new(big.Float).SetInt(wei), big.NewFloat(1e18))
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.8f", eth), "0"), ".")
}

// DialEthereum returns an ethclient connected to the configured QuickNode RPC.
func DialEthereum(ctx context.Context) (*ethclient.Client, string, error) {
	rpcURL := LoadEthereumRPC()
	if rpcURL == "" {
		return nil, "", fmt.Errorf("ONEX_ETHEREUM_RPC not configured")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	client, err := ethclient.DialContext(ctx, rpcURL)
	if err != nil {
		return nil, "", fmt.Errorf("ethereum rpc connect: %w", err)
	}
	return client, rpcURL, nil
}
