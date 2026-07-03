package bridge

import (
	"context"
	"fmt"
	"strings"

	"github.com/onex-blockchain/onex/internal/bridge/chains"
	"github.com/onex-blockchain/onex/internal/ledger"
	"github.com/onex-blockchain/onex/internal/legacy"
	"github.com/onex-blockchain/onex/internal/rpc"
	"github.com/onex-blockchain/onex/internal/types"
)

func (b *Bridge) ledgerBook() *ledger.BookStore {
	if b.book == nil {
		b.book = ledger.NewBookStore(legacy.HomeDir())
	}
	return b.book
}

func (b *Bridge) SyncLedgerBook(ctx context.Context, evmHolder string) error {
	snap, err := b.ReadRealLedger(ctx, "all", evmHolder, b.LoadLatestImport())
	if err != nil {
		return err
	}
	return b.ledgerBook().SyncFromSnapshot(snap)
}

func (b *Bridge) ListLedgerAccounts(ctx context.Context, evmHolder string) ([]ledger.BookAccount, error) {
	if err := b.SyncLedgerBook(ctx, evmHolder); err != nil {
		return nil, err
	}
	return b.ledgerBook().ListAccounts()
}

func (b *Bridge) TransferLedger(ctx context.Context, evmHolder string, req ledger.TransferRequest) (*ledger.TransferResult, error) {
	if err := b.SyncLedgerBook(ctx, evmHolder); err != nil {
		return nil, err
	}
	settle := func(rec ledger.TransferRecord, dest *ledger.ExternalDestination) (string, error) {
		if ledger.ResolveExternalRaw(req) == "" {
			return "", nil
		}
		return b.settleLedgerExternal(rec, dest)
	}
	return b.ledgerBook().Transfer(req, b.ledgerPrices(), settle)
}

func (b *Bridge) settleLedgerExternal(rec ledger.TransferRecord, dest *ledger.ExternalDestination) (string, error) {
	if dest == nil {
		return "pending-settlement", nil
	}
	amtStr := rec.ToAmount
	if amtStr == "" {
		amtStr = rec.Amount
	}
	switch dest.Kind {
	case ledger.ExternalOneX:
		atomic, err := rpc.ParseAmount(amtStr)
		if err != nil {
			return "", err
		}
		fee, _ := rpc.ParseAmount("0.001")
		res, err := b.Send(types.Address(strings.ToLower(dest.Address)), atomic, fee)
		if err != nil {
			return "", err
		}
		return res["status"], nil
	case ledger.ExternalEVM, ledger.ExternalSolana, ledger.ExternalBitcoin, ledger.ExternalTron:
		if ref, ok := b.settleViaHybx(rec, dest); ok {
			if dest.Kind == ledger.ExternalEVM {
				if live, err := b.settleLedgerEVM(rec, dest); err == nil && !strings.HasPrefix(live, "chain-pending:") {
					return live, nil
				}
			}
			return ref, nil
		}
		if dest.Kind == ledger.ExternalEVM {
			return b.settleLedgerEVM(rec, dest)
		}
		return fmt.Sprintf("chain-pending:%s:%s", dest.ChainID, dest.Address), nil
	case ledger.ExternalBank:
		if ledger.LoadHybrixConfig().Enabled && b.isProduction() {
			amtStr := rec.ToAmount
			if amtStr == "" {
				amtStr = rec.Amount
			}
			_, _ = ledger.HybxFederateOutbound(ledger.BankTransferRequest{
				Rail: dest.BankRail, BankName: dest.BankName, Account: dest.Address,
				Amount: amtStr, Asset: rec.Asset, Reference: rec.ID,
			}, rec.ID)
		}
		if ref, ok := b.settleViaHybx(rec, dest); ok {
			return ref, nil
		}
		return ledger.InitiateBankTransfer(ledger.BankTransferRequest{
			Rail: dest.BankRail, BankName: dest.BankName, Account: dest.Address,
			Amount: amtStr, Asset: rec.Asset, Reference: rec.ID,
		})
	}
	return "pending-settlement", nil
}

func (b *Bridge) settleLedgerEVM(rec ledger.TransferRecord, dest *ledger.ExternalDestination) (string, error) {
	var chainInfo *ChainInfo
	for _, c := range b.registry().GetChains() {
		if c.ID == dest.ChainID {
			ch := c
			chainInfo = &ch
			break
		}
	}
	if chainInfo == nil || chainInfo.RPC == "" || chainInfo.Type != "evm" {
		return fmt.Sprintf("chain-pending:%s:%s", dest.ChainID, dest.Address), nil
	}

	keyHex, err := chains.LoadBridgeSenderKey()
	if err != nil {
		return fmt.Sprintf("chain-pending:%s:%s", dest.ChainID, dest.Address), nil
	}

	asset := strings.ToUpper(strings.TrimSpace(rec.Asset))
	if c := strings.ToUpper(strings.TrimSpace(rec.ConvertTo)); c != "" {
		asset = c
	}
	amt := rec.ToAmount
	if amt == "" {
		amt = rec.Amount
	}

	decimals, contract, native := b.evmSendMeta(dest.ChainID, asset)
	rpcURL := chains.ResolveChainRPC(chainInfo.ID, chainInfo.RPC)
	txHash, err := chains.SendEVMTransfer(context.Background(), chains.EVMSendInput{
		RPCURL:        rpcURL,
		ChainID:       chainInfo.NetworkID,
		PrivateKeyHex: keyHex,
		ToAddress:     dest.Address,
		Asset:         asset,
		AmountHuman:   amt,
		TokenDecimals: decimals,
		Contract:      contract,
	})
	if err != nil {
		return "", fmt.Errorf("evm settlement (%s): %w", dest.ChainID, err)
	}
	_ = native
	explorer := strings.TrimSuffix(chainInfo.Explorer, "/")
	if explorer != "" {
		return fmt.Sprintf("%s/tx/%s", explorer, txHash), nil
	}
	return "tx:" + txHash, nil
}

func (b *Bridge) evmSendMeta(chainID, symbol string) (decimals int, contract string, native bool) {
	sym := strings.ToUpper(strings.TrimSpace(symbol))
	if t := b.registry().FindToken(chainID, sym); t != nil {
		if t.Native {
			return t.Decimals, "", true
		}
		return t.Decimals, ledger.KnownContract(chainID, sym), false
	}
	for _, id := range []string{sym + "-BSC", sym + "-POLY", sym + "-ARB", sym + "-OP", sym + "-BASE"} {
		if t := b.registry().FindToken(chainID, id); t != nil {
			return t.Decimals, ledger.KnownContract(chainID, sym), t.Native
		}
	}
	if c := ledger.KnownContract(chainID, sym); c != "" {
		return 18, c, false
	}
	// Default native coin decimals per chain
	switch chainID {
	case "bsc":
		if sym == "BNB" || sym == "" {
			return 18, "", true
		}
	case "ethereum", "arbitrum", "optimism", "base":
		if sym == "ETH" {
			return 18, "", true
		}
	case "polygon":
		if sym == "MATIC" {
			return 18, "", true
		}
	case "avalanche":
		if sym == "AVAX" {
			return 18, "", true
		}
	case "dbis-138":
		if sym == "ETH" || sym == "" {
			return 18, "", true
		}
	}
	return 18, "", true
}

func (b *Bridge) ListLedgerTransfers(ctx context.Context, evmHolder string, limit int) ([]ledger.TransferRecord, error) {
	if err := b.SyncLedgerBook(ctx, evmHolder); err != nil {
		return nil, err
	}
	return b.ledgerBook().ListTransfers(limit), nil
}

func (b *Bridge) ListExternalDestinations() map[string]interface{} {
	return ledger.SupportedExternals()
}

func (b *Bridge) ImportActiveLedger(ctx context.Context, evmHolder string, req ledger.ImportRequest) (*ledger.ImportResult, error) {
	prices := b.ledgerPrices()
	cfg := b.resolvedLedgerConfig()
	fiat := cfg.FiatCurrency
	if req.FiatCurrency != "" {
		fiat = req.FiatCurrency
	}

	entries, err := ledger.ParseAnyLedger(req.Raw)
	if err != nil {
		return nil, err
	}
	valued := ledger.ValueImportEntries(entries, prices, fiat)
	importUSD, byAsset := ledger.SummarizeImport(valued)

	res := &ledger.ImportResult{
		Entries:   len(valued),
		ImportUSD: importUSD,
		ByAsset:   byAsset,
		Imported:  valued,
	}

	if req.Preview {
		res.Status = "preview"
		res.TotalUSD = importUSD
		return res, nil
	}

	path, err := b.SaveLedgerImport(req.Raw)
	if err != nil {
		return nil, err
	}
	res.Path = path

	snap, _ := b.ReadRealLedger(ctx, "all", evmHolder, req.Raw)
	res.Snapshot = snap
	res.TotalUSD = snap.TotalUSD

	if req.Active {
		synced, err := b.ledgerBook().SyncImportEntries(valued)
		if err != nil {
			return nil, err
		}
		res.AccountsSynced = synced
		_ = b.SyncLedgerBook(ctx, evmHolder)
		res.Status = "active"
	} else {
		_ = b.SyncLedgerBook(ctx, evmHolder)
		res.Status = "imported"
	}

	return res, nil
}

func (b *Bridge) ImportAnyLedger(data []byte) ([]ledger.Entry, string, error) {
	entries, err := ledger.ParseAnyLedger(data)
	if err != nil {
		return nil, "", err
	}
	path, err := b.SaveLedgerImport(data)
	if err != nil {
		return nil, "", err
	}
	return entries, path, nil
}
