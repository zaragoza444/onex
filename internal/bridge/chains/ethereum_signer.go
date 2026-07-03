package chains

import (
	"context"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/onex-blockchain/onex/internal/legacy"
)

const minSenderGasEth = 0.00005
const fundSenderAmountEth = "0.003"

// LoadEthereumMasterKey returns the master treasury private key (64 hex chars).
func LoadEthereumMasterKey() (string, error) {
	for _, k := range []string{
		"ONEX_ETHEREUM_MASTER_KEY",
		"ONEX_ETHEREUM_MASTER_PRIVATE_KEY",
	} {
		v := strings.TrimSpace(os.Getenv(k))
		if IsPrivateKeyHex(v) {
			return strings.TrimPrefix(v, "0x"), nil
		}
	}
	path := filepath.Join(legacy.HomeDir(), "ethereum-master.key")
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("set ONEX_ETHEREUM_MASTER_KEY or %s", path)
	}
	hexKey := strings.TrimPrefix(strings.TrimSpace(string(data)), "0x")
	if !IsPrivateKeyHex(hexKey) {
		return "", fmt.Errorf("invalid master key in %s", path)
	}
	return hexKey, nil
}

// LoadEthereumMasterKeySilent returns true when a master signing key is configured.
func LoadEthereumMasterKeySilent() bool {
	_, err := LoadEthereumMasterKey()
	return err == nil
}

func addressFromPrivateKey(hexKey string) (string, error) {
	key, err := crypto.HexToECDSA(strings.TrimPrefix(strings.TrimSpace(hexKey), "0x"))
	if err != nil {
		return "", err
	}
	return FormatAddress(crypto.PubkeyToAddress(key.PublicKey).Hex()), nil
}

func ethBalanceAt(ctx context.Context, rpcURL, addr string) (*big.Int, error) {
	client, err := ethclientDial(ctx, rpcURL)
	if err != nil {
		return nil, err
	}
	defer client.Close()
	return client.BalanceAt(ctx, common.HexToAddress(FormatAddress(addr)), nil)
}

func ethBalancePositiveWei(wei *big.Int) bool {
	if wei == nil {
		return false
	}
	min := new(big.Int).SetUint64(50_000_000_000_000) // ~0.00005 ETH
	return wei.Cmp(min) > 0
}

// EthereumSigner is the key + address used for mainnet transfers.
type EthereumSigner struct {
	PrivateKeyHex string
	Address       string
	Source        string // sender | master
}

// ResolveEthereumSigner picks a funded signing key (sender first, then master treasury).
func ResolveEthereumSigner(ctx context.Context) (*EthereumSigner, error) {
	rpcURL := LoadEthereumRPC()
	if rpcURL == "" {
		return nil, fmt.Errorf("ONEX_ETHEREUM_RPC not configured")
	}

	if key, err := LoadBridgeSenderKey(); err == nil {
		addr, err := BridgeSenderAddress()
		if err == nil {
			if bal, berr := ethBalanceAt(ctx, rpcURL, addr); berr == nil && ethBalancePositiveWei(bal) {
				return &EthereumSigner{PrivateKeyHex: key, Address: addr, Source: "sender"}, nil
			}
		}
	}

	masterKey, err := LoadEthereumMasterKey()
	if err != nil {
		return nil, fmt.Errorf("evm sender needs gas — fund %s or set ONEX_ETHEREUM_MASTER_KEY",
			mustSenderAddress())
	}
	masterAddr, err := addressFromPrivateKey(masterKey)
	if err != nil {
		return nil, err
	}
	if want := LoadEthereumMasterWallet(); want != "" && !strings.EqualFold(masterAddr, want) {
		return nil, fmt.Errorf("ONEX_ETHEREUM_MASTER_KEY address %s does not match ONEX_ETHEREUM_MASTER_WALLET %s",
			masterAddr, want)
	}
	bal, err := ethBalanceAt(ctx, rpcURL, masterAddr)
	if err != nil {
		return nil, err
	}
	if !ethBalancePositiveWei(bal) {
		return nil, fmt.Errorf("master wallet %s has no ETH for gas", masterAddr)
	}
	return &EthereumSigner{PrivateKeyHex: masterKey, Address: masterAddr, Source: "master"}, nil
}

func mustSenderAddress() string {
	addr, err := BridgeSenderAddress()
	if err != nil {
		return "evm sender"
	}
	return addr
}

// FundEVMSenderIfNeeded sends ETH from master treasury to the bridge sender when sender is empty.
func FundEVMSenderIfNeeded(ctx context.Context) (map[string]interface{}, error) {
	rpcURL := LoadEthereumRPC()
	if rpcURL == "" {
		return nil, fmt.Errorf("ONEX_ETHEREUM_RPC not configured")
	}
	senderAddr, err := BridgeSenderAddress()
	if err != nil {
		return nil, err
	}
	if bal, err := ethBalanceAt(ctx, rpcURL, senderAddr); err == nil && ethBalancePositiveWei(bal) {
		return map[string]interface{}{
			"status": "skipped", "reason": "sender already funded", "sender": senderAddr,
		}, nil
	}
	masterKey, err := LoadEthereumMasterKey()
	if err != nil {
		return nil, err
	}
	masterAddr, err := addressFromPrivateKey(masterKey)
	if err != nil {
		return nil, err
	}
	if want := LoadEthereumMasterWallet(); want != "" && !strings.EqualFold(masterAddr, want) {
		return nil, fmt.Errorf("master key mismatch")
	}
	txHash, err := SendEVMTransfer(ctx, EVMSendInput{
		RPCURL:        rpcURL,
		ChainID:       EthereumMainnetChainID,
		PrivateKeyHex: masterKey,
		ToAddress:     senderAddr,
		Asset:         "ETH",
		AmountHuman:   fundSenderAmountEth,
	})
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"status": "completed", "from": masterAddr, "to": senderAddr,
		"amountEth": fundSenderAmountEth, "txHash": txHash,
		"explorerUrl": "https://etherscan.io/tx/" + txHash,
	}, nil
}

func ethclientDial(ctx context.Context, rpcURL string) (*ethclient.Client, error) {
	return ethclient.DialContext(ctx, rpcURL)
}
