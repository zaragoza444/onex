package bridge

import (
	"context"

	"github.com/onex-blockchain/onex/internal/ledger"
)

func (b *Bridge) FiatSettlementMiddleware(ctx context.Context, evmHolder string, req ledger.FiatSettlementMiddlewareRequest) (*ledger.FiatSettlementMiddlewareResult, error) {
	if err := b.SyncLedgerBook(ctx, evmHolder); err != nil {
		return nil, err
	}
	cfg := ledger.LoadFiatSettlementMiddlewareConfig()
	settle := func(rec ledger.TransferRecord, dest *ledger.ExternalDestination) (string, error) {
		return b.settleLedgerExternal(rec, dest)
	}
	return b.ledgerBook().RunFiatSettlementMiddleware(req, cfg, b.ledgerPrices(), b.tokenMetaMap(), settle)
}
