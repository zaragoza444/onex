package bridge

import (
	"context"

	"github.com/onex-blockchain/onex/internal/bridge/chains"
	"github.com/onex-blockchain/onex/internal/ledger"
)

func (b *Bridge) SettlementCapabilities() map[string]interface{} {
	cfg := b.resolvedLedgerConfig()
	bank := ledger.LoadBankProviderConfig()
	if bank.FilePath == "" && cfg.BankFile != "" {
		bank.FilePath = cfg.BankFile
	}
	evmSender := chains.LoadBridgeSenderKeySilent()
	onexWallet := b.WalletAddress() != ""
	caps := ledger.SettlementCapabilities(cfg, bank, evmSender, onexWallet)
	if evmSender {
		if addr, err := chains.BridgeSenderAddress(); err == nil {
			caps["evmSenderAddress"] = addr
		}
	}
	eth := chains.ProbeEthereumRPC(context.Background())
	senderFunded := (evmSender && ethBalancePositive(eth.SenderBalance)) ||
		(eth.MasterKeySet && ethBalancePositive(eth.MasterBalance))
	caps["evmSenderFunded"] = senderFunded
	caps["ethereumMainnet"] = map[string]interface{}{
		"configured":       eth.Configured,
		"online":           eth.Online,
		"provider":         eth.Provider,
		"masterWallet":     eth.MasterWallet,
		"masterKeySet":     eth.MasterKeySet,
		"masterBalance":    eth.MasterBalance,
		"senderWallet":     eth.SenderWallet,
		"senderBalance":    eth.SenderBalance,
		"senderFunded":     senderFunded,
		"blockNumber":      eth.BlockNumber,
		"transferAPI":      "/bridge/ethereum/transfer",
		"fundSenderAPI":    "/bridge/ethereum/fund-sender",
		"statusAPI":        "/bridge/ethereum/status",
		"blockAPI":      "/bridge/ethereum/block?number=latest&full=true",
		"txAPI":         "/bridge/ethereum/tx?hash=0x…",
	}
	return caps
}
func (b *Bridge) SettleLedger(ctx context.Context, evmHolder string, req ledger.SettlementRequest) (*ledger.SettlementResult, error) {
	if err := b.SyncLedgerBook(ctx, evmHolder); err != nil {
		return nil, err
	}
	settle := func(rec ledger.TransferRecord, dest *ledger.ExternalDestination) (string, error) {
		if ledger.ResolveExternalRaw(transferReqFromSettlement(req)) == "" {
			return "", nil
		}
		return b.settleLedgerExternal(rec, dest)
	}
	return b.ledgerBook().Settle(req, b.ledgerPrices(), b.tokenMetaMap(), settle)
}

func (b *Bridge) ListLedgerSettlements(ctx context.Context, evmHolder string, limit int) ([]ledger.SettlementRecord, error) {
	if err := b.SyncLedgerBook(ctx, evmHolder); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 25
	}
	return b.ledgerBook().ListSettlements(limit), nil
}

func transferReqFromSettlement(req ledger.SettlementRequest) ledger.TransferRequest {
	return ledger.TransferRequest{
		FromAccount:     req.FromAccount,
		ToAccount:       req.ToAccount,
		Amount:          req.Amount,
		ConvertTo:       req.PayoutAsset,
		ExternalTo:      req.ExternalTo,
		ExternalChain:   req.ExternalChain,
		ExternalBank:    req.ExternalBank,
		BankRail:        req.BankRail,
		ExternalAddress: req.ExternalAddress,
	}
}
