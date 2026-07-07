package bridge

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/onex-blockchain/onex/internal/bridge/chains"
	"github.com/onex-blockchain/onex/internal/ledger"
)

func (b *Bridge) defaultBridgeChain() string {
	if v := strings.TrimSpace(os.Getenv("ONEX_DEFAULT_BRIDGE_CHAIN")); v != "" {
		return v
	}
	return "bsc"
}

func (b *Bridge) ConvertLedger(ctx context.Context, evmHolder string, req ledger.ConvertRequest) (*ledger.ConvertResult, error) {
	prices := b.ledgerPrices()
	tokens := b.tokenMetaMap()

	if !req.Active && strings.TrimSpace(req.FromAccount) == "" {
		res, err := ledger.NewEngine().Convert(req, prices, tokens)
		if res != nil {
			if res.Status == "" {
				res.Status = "quoted"
			}
			b.attachConvertExtras(res, req, nil, "")
		}
		return res, err
	}

	if err := b.SyncLedgerBook(ctx, evmHolder); err != nil {
		return nil, err
	}

	conv, err := b.ledgerBook().ConvertActive(req, prices, tokens)
	if err != nil {
		return nil, err
	}

	payoutAsset := strings.ToUpper(strings.TrimSpace(req.ToAsset))
	var tokenInfo *ledger.ConvertTokenInfo
	if req.CreateContract || req.TokenDeploy != nil {
		td := resolveConvertTokenDeploy(req)
		supply := td.Supply
		if supply == "" {
			supply = conv.ToAmount
		}
		if supply == "" || supply == "0" {
			supply = "1000000"
		}
		decimals := td.Decimals
		if decimals <= 0 {
			decimals = 18
		}
		pt, depErr := b.DeployPlatformToken(td.ChainID, td.Name, td.Symbol, decimals, supply)
		if depErr != nil {
			return nil, fmt.Errorf("token deploy: %w", depErr)
		}
		tokenInfo = &ledger.ConvertTokenInfo{
			ChainID:         pt.ChainID,
			Symbol:          pt.Symbol,
			Name:            pt.Name,
			ContractAddress: pt.ContractAddress,
			DeployStatus:    pt.DeployStatus,
			DeployTxHash:    pt.DeployTxHash,
		}
		payoutAsset = strings.ToUpper(pt.Symbol)
	}

	var settlementRef string
	receiverAddr := chains.FormatAddress(strings.TrimSpace(req.ReceiverAddress))
	receiverChain := strings.TrimSpace(req.ReceiverChain)
	if receiverChain == "" {
		receiverChain = b.defaultBridgeChain()
	}
	if req.Active && receiverAddr != "" && !chains.IsAddressHex(receiverAddr) {
		return nil, fmt.Errorf("invalid receiver address")
	}
	if req.Active && req.SettleToReceiver && receiverAddr != "" {
		vaultID := "book:" + strings.ToUpper(strings.TrimSpace(req.ToAsset))
		extTo := receiverChain + ":" + receiverAddr
		settleFn := func(rec ledger.TransferRecord, dest *ledger.ExternalDestination) (string, error) {
			return b.settleLedgerExternal(rec, dest)
		}
		xfer, err := b.ledgerBook().Transfer(ledger.TransferRequest{
			FromAccount: vaultID,
			Amount:      conv.ToAmount,
			ExternalTo:  extTo,
			ConvertTo:   payoutAsset,
			Note:        "convert-settle",
		}, prices, settleFn)
		if err != nil {
			return nil, fmt.Errorf("settle to receiver: %w", err)
		}
		settlementRef = xfer.Settlement
		if xfer.Transfer.TxRef != "" && settlementRef == "" {
			settlementRef = xfer.Transfer.TxRef
		}
	}

	if req.SaveReceiver && receiverAddr != "" {
		label := strings.TrimSpace(req.ReceiverLabel)
		_, _ = b.SaveReceiverWallet(label, receiverChain, receiverAddr)
	}

	b.attachConvertExtras(conv, req, tokenInfo, settlementRef)
	return conv, nil
}

func resolveConvertTokenDeploy(req ledger.ConvertRequest) ledger.ConvertTokenDeploy {
	td := ledger.ConvertTokenDeploy{}
	if req.TokenDeploy != nil {
		td = *req.TokenDeploy
	}
	if td.ChainID == "" {
		td.ChainID = strings.TrimSpace(req.ReceiverChain)
	}
	if td.ChainID == "" {
		td.ChainID = "bsc"
	}
	if td.Symbol == "" {
		td.Symbol = strings.ToUpper(strings.TrimSpace(req.ToAsset))
	}
	if td.Name == "" {
		td.Name = td.Symbol + " Token"
	}
	return td
}

func (b *Bridge) attachConvertExtras(res *ledger.ConvertResult, req ledger.ConvertRequest, token *ledger.ConvertTokenInfo, settlementRef string) {
	if res == nil {
		return
	}
	res.TokenDeploy = token
	res.SettlementRef = settlementRef
	addr := chains.FormatAddress(strings.TrimSpace(req.ReceiverAddress))
	if addr != "" {
		chain := strings.TrimSpace(req.ReceiverChain)
		if chain == "" {
			chain = b.defaultBridgeChain()
		}
		res.Receiver = &ledger.ConvertReceiverInfo{
			ChainID: chain,
			Address: addr,
			Label:   strings.TrimSpace(req.ReceiverLabel),
		}
	}
}
