package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/onex-blockchain/onex/internal/bridge/chains"
)
type EthereumTransferRequest struct {
	To      string `json:"to"`
	Amount  string `json:"amount"`
	Asset   string `json:"asset"` // ETH, USDC, USDT, …
	Preview bool   `json:"preview,omitempty"`
	Note    string `json:"note,omitempty"`
}

// EthereumTransferResult is the outcome of an Ethereum mainnet transfer.
type EthereumTransferResult struct {
	Status      string `json:"status"`
	Preview     bool   `json:"preview,omitempty"`
	From        string `json:"from,omitempty"`
	To          string `json:"to,omitempty"`
	Asset       string `json:"asset,omitempty"`
	Amount      string `json:"amount,omitempty"`
	TxHash      string `json:"txHash,omitempty"`
	ExplorerURL string `json:"explorerUrl,omitempty"`
	RPC         string `json:"rpc,omitempty"`
	Note        string `json:"note,omitempty"`
}

func (b *Bridge) EthereumStatus(ctx context.Context) chains.EthereumRPCStatus {
	return chains.ProbeEthereumRPC(ctx)
}

func (b *Bridge) EthereumBlock(ctx context.Context, number string, fullTx bool) (json.RawMessage, error) {
	return chains.GetEthereumBlock(ctx, number, fullTx)
}

func (b *Bridge) EthereumTransaction(ctx context.Context, hash string) (json.RawMessage, error) {
	return chains.GetEthereumTransaction(ctx, hash)
}

func (b *Bridge) EthereumTransactionReceipt(ctx context.Context, hash string) (json.RawMessage, error) {
	return chains.GetEthereumTransactionReceipt(ctx, hash)
}

func (b *Bridge) EthereumTransfer(ctx context.Context, req EthereumTransferRequest) (*EthereumTransferResult, error) {
	to := chains.FormatAddress(strings.TrimSpace(req.To))
	if to == "" {
		to = chains.LoadEthereumMasterWallet()
	}
	if !chains.IsAddressHex(to) {
		return nil, fmt.Errorf("valid to address required (or set ONEX_ETHEREUM_MASTER_WALLET)")
	}
	amt := strings.TrimSpace(req.Amount)
	if amt == "" || amt == "0" {
		return nil, fmt.Errorf("amount required")
	}
	asset := strings.ToUpper(strings.TrimSpace(req.Asset))
	if asset == "" {
		asset = "ETH"
	}

	rpcURL := chains.LoadEthereumRPC()
	if rpcURL == "" {
		return nil, fmt.Errorf("ONEX_ETHEREUM_RPC not configured — set your QuickNode endpoint")
	}

	fromAddr, err := chains.BridgeSenderAddress()
	if err != nil {
		return nil, fmt.Errorf("evm sender not configured: set ONEX_EVM_SENDER_KEY (64 hex private key)")
	}
	signerSource := "sender"

	decimals, contract, _ := b.evmSendMeta("ethereum", asset)

	if req.Preview {
		if signer, serr := chains.ResolveEthereumSigner(ctx); serr == nil {
			fromAddr = signer.Address
			signerSource = signer.Source
		}
		return &EthereumTransferResult{
			Status:  "preview",
			Preview: true,
			From:    fromAddr,
			To:      to,
			Asset:   asset,
			Amount:  amt,
			RPC:     chains.MaskRPCURL(rpcURL),
			Note:    strings.TrimSpace(req.Note + " · signer:" + signerSource),
		}, nil
	}

	signer, err := chains.ResolveEthereumSigner(ctx)
	if err != nil {
		return nil, err
	}
	fromAddr = signer.Address

	txHash, err := chains.SendEVMTransfer(ctx, chains.EVMSendInput{
		RPCURL:        rpcURL,
		ChainID:       chains.EthereumMainnetChainID,
		PrivateKeyHex: signer.PrivateKeyHex,
		ToAddress:     to,
		Asset:         asset,
		AmountHuman:   amt,
		TokenDecimals: decimals,
		Contract:      contract,
	})
	if err != nil {
		return nil, err
	}

	explorer := "https://etherscan.io"
	for _, c := range b.registry().GetChains() {
		if c.ID == "ethereum" && c.Explorer != "" {
			explorer = strings.TrimSuffix(c.Explorer, "/")
			break
		}
	}

	return &EthereumTransferResult{
		Status:      "completed",
		From:        fromAddr,
		To:          to,
		Asset:       asset,
		Amount:      amt,
		TxHash:      txHash,
		ExplorerURL: fmt.Sprintf("%s/tx/%s", explorer, txHash),
		RPC:         chains.MaskRPCURL(rpcURL),
		Note:        req.Note,
	}, nil
}

func (b *Bridge) FundEVMSender(ctx context.Context) (map[string]interface{}, error) {
	return chains.FundEVMSenderIfNeeded(ctx)
}
