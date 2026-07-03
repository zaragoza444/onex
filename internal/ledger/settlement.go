package ledger

import (
	"fmt"
	"strings"
	"time"
)

// SettlementKind is how value leaves the ledger book for real-world payout.
type SettlementKind string

const (
	SettlementVault       SettlementKind = "vault"        // convert only — credit in-book vault
	SettlementInternal    SettlementKind = "internal"     // move between ledger accounts
	SettlementRealFiat    SettlementKind = "real_fiat"    // bank wire / ACH / SEPA / SWIFT
	SettlementRealCrypto  SettlementKind = "real_crypto"  // on-chain payout (BSC, ETH, OneX, …)
)

// SettlementRequest is the unified middleware input: debit ledger → convert → settle real funds/crypto.
type SettlementRequest struct {
	FromAccount string `json:"fromAccount"`
	Amount      string `json:"amount"`
	PayoutAsset string `json:"payoutAsset,omitempty"` // convert to before settlement (BNB, USDT, USD, …)
	Kind        string `json:"kind,omitempty"`        // vault | internal | real_fiat | real_crypto | auto

	// Destination (one of)
	ToAccount     string `json:"toAccount,omitempty"`
	ExternalTo    string `json:"externalTo,omitempty"`
	ExternalChain string `json:"externalChain,omitempty"`
	ExternalBank  string `json:"externalBank,omitempty"`
	BankRail      string `json:"bankRail,omitempty"`
	ExternalAddress string `json:"externalAddress,omitempty"`

	Preview bool   `json:"preview,omitempty"`
	Note    string `json:"note,omitempty"`
}

// SettlementStep tracks one phase of convert → debit → settle.
type SettlementStep struct {
	Phase  string `json:"phase"`  // quote, debit, convert, settle
	Status string `json:"status"` // pending, done, failed, skipped
	Detail string `json:"detail,omitempty"`
}

// SettlementRecord is a persisted real-fund / real-crypto settlement.
type SettlementRecord struct {
	ID                string           `json:"id"`
	Kind              SettlementKind   `json:"kind"`
	Status            string           `json:"status"` // preview, pending, submitted, on_chain, completed, failed
	FromAccount       string           `json:"fromAccount"`
	SourceAsset       string           `json:"sourceAsset"`
	SourceAmount      string           `json:"sourceAmount"`
	PayoutAsset       string           `json:"payoutAsset"`
	PayoutAmount      string           `json:"payoutAmount"`
	Destination       string           `json:"destination,omitempty"`
	DestinationLabel  string           `json:"destinationLabel,omitempty"`
	FundClass         string           `json:"fundClass,omitempty"`
	FiatUSD           float64          `json:"fiatUsd,omitempty"`
	TransferID        string           `json:"transferId,omitempty"`
	SettlementRef     string           `json:"settlementRef,omitempty"`
	Steps             []SettlementStep `json:"steps"`
	Note              string           `json:"note,omitempty"`
	CreatedAt         int64            `json:"createdAt"`
}

// SettlementResult is returned by the settlement middleware.
type SettlementResult struct {
	Status     string                `json:"status"`
	Settlement SettlementRecord      `json:"settlement"`
	Convert    *ConvertResult        `json:"convert,omitempty"`
	Transfer   *TransferRecord       `json:"transfer,omitempty"`
	External   *ExternalDestination  `json:"external,omitempty"`
}

// ResolveSettlementKind infers settlement type from request fields.
func ResolveSettlementKind(req SettlementRequest) SettlementKind {
	if k := SettlementKind(strings.ToLower(strings.TrimSpace(req.Kind))); k != "" && k != "auto" {
		return k
	}
	if strings.TrimSpace(req.ToAccount) != "" && ResolveExternalRaw(transferFromSettlement(req)) == "" {
		return SettlementInternal
	}
	ext := firstNonEmpty(req.ExternalTo, buildExternalFromParts(req))
	if ext == "" {
		return SettlementVault
	}
	dest, err := ParseExternalDestination(ext)
	if err != nil {
		return SettlementVault
	}
	switch dest.Kind {
	case ExternalBank:
		return SettlementRealFiat
	case ExternalOneX, ExternalEVM, ExternalSolana, ExternalBitcoin, ExternalTron:
		return SettlementRealCrypto
	default:
		return SettlementVault
	}
}

func transferFromSettlement(req SettlementRequest) TransferRequest {
	payout := strings.ToUpper(strings.TrimSpace(req.PayoutAsset))
	tr := TransferRequest{
		FromAccount:     req.FromAccount,
		ToAccount:       req.ToAccount,
		Amount:          req.Amount,
		ConvertTo:       payout,
		ExternalTo:      req.ExternalTo,
		ExternalChain:   req.ExternalChain,
		ExternalBank:    req.ExternalBank,
		BankRail:        req.BankRail,
		ExternalAddress: req.ExternalAddress,
		Note:            req.Note,
		Preview:         req.Preview,
	}
	if tr.ExternalTo == "" {
		tr.ExternalTo = buildExternalFromParts(req)
	}
	return tr
}

func buildExternalFromParts(req SettlementRequest) string {
	if raw := strings.TrimSpace(req.ExternalTo); raw != "" {
		return raw
	}
	if addr := strings.TrimSpace(req.ExternalAddress); addr != "" {
		if chain := strings.TrimSpace(req.ExternalChain); chain != "" {
			return chain + ":" + addr
		}
		if bank := strings.TrimSpace(req.ExternalBank); bank != "" {
			rail := strings.TrimSpace(req.BankRail)
			if rail == "" {
				rail = "swift"
			}
			return fmt.Sprintf("bank:%s:%s:%s", bank, rail, addr)
		}
	}
	return ""
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// QuoteSettlement previews convert + destination without debiting the book.
func QuoteSettlement(req SettlementRequest, prices map[string]PriceQuote, tokens map[string]TokenMeta, fromAsset string) (*SettlementResult, error) {
	if strings.TrimSpace(req.FromAccount) == "" {
		return nil, fmt.Errorf("fromAccount required")
	}
	kind := ResolveSettlementKind(req)
	steps := []SettlementStep{{Phase: "quote", Status: "done", Detail: string(kind)}}

	payout := strings.ToUpper(strings.TrimSpace(req.PayoutAsset))
	var conv *ConvertResult
	if payout != "" && payout != strings.ToUpper(strings.TrimSpace(fromAsset)) {
		cr, err := ConvertAmount(ConvertRequest{
			FromAsset: fromAsset,
			ToAsset:   payout,
			Amount:    req.Amount,
		}, prices, tokens)
		if err != nil {
			return nil, err
		}
		conv = cr
		steps = append(steps, SettlementStep{Phase: "convert", Status: "pending", Detail: cr.FromAmount + " " + cr.FromAsset + " → " + cr.ToAmount + " " + cr.ToAsset})
	}

	extRaw := ResolveExternalRaw(transferFromSettlement(req))
	var ext *ExternalDestination
	destLabel := ""
	if extRaw != "" {
		_, ext, _ = ExternalTo(extRaw, payout)
		if ext != nil {
			destLabel = ext.Label
		}
		steps = append(steps, SettlementStep{Phase: "settle", Status: "pending", Detail: destLabel})
	} else if kind == SettlementInternal {
		steps = append(steps, SettlementStep{Phase: "settle", Status: "pending", Detail: "internal ledger move"})
	} else {
		steps = append(steps, SettlementStep{Phase: "settle", Status: "skipped", Detail: "vault convert only"})
	}

	payoutAmt := req.Amount
	payoutAsset := fromAsset
	if conv != nil {
		payoutAmt = conv.ToAmount
		payoutAsset = conv.ToAsset
	}

	rec := SettlementRecord{
		ID:               "preview",
		Kind:             kind,
		Status:           "preview",
		FromAccount:      req.FromAccount,
		SourceAsset:      fromAsset,
		SourceAmount:     req.Amount,
		PayoutAsset:      payoutAsset,
		PayoutAmount:     payoutAmt,
		Destination:      extRaw,
		DestinationLabel: destLabel,
		Steps:            steps,
		Note:             req.Note,
		CreatedAt:        time.Now().Unix(),
	}
	if conv != nil {
		rec.FiatUSD = conv.FiatUSD
	}
	return &SettlementResult{Status: "preview", Settlement: rec, Convert: conv, External: ext}, nil
}

// Settle runs convert + debit + real settlement in one middleware call.
func (s *BookStore) Settle(req SettlementRequest, prices map[string]PriceQuote, tokens map[string]TokenMeta, settle func(TransferRecord, *ExternalDestination) (string, error)) (*SettlementResult, error) {
	from, err := s.GetAccount(req.FromAccount)
	if err != nil {
		return nil, err
	}
	kind := ResolveSettlementKind(req)

	if req.Preview {
		return QuoteSettlement(req, prices, tokens, from.Asset)
	}

	trReq := transferFromSettlement(req)
	// Vault-only: convert inside book without external destination
	if kind == SettlementVault && strings.TrimSpace(req.PayoutAsset) != "" {
		conv, err := s.ConvertActive(ConvertRequest{
			FromAccount: req.FromAccount,
			FromAsset:   from.Asset,
			ToAsset:     req.PayoutAsset,
			Amount:      req.Amount,
			Active:      true,
		}, prices, tokens)
		if err != nil {
			return nil, err
		}
		rec := SettlementRecord{
			ID:           fmt.Sprintf("settle-%d", time.Now().UnixNano()),
			Kind:         SettlementVault,
			Status:       "completed",
			FromAccount:  req.FromAccount,
			SourceAsset:  from.Asset,
			SourceAmount: req.Amount,
			PayoutAsset:  conv.ToAsset,
			PayoutAmount: conv.ToAmount,
			FundClass:    conv.FundClass,
			FiatUSD:      conv.FiatUSD,
			Steps: []SettlementStep{
				{Phase: "quote", Status: "done"},
				{Phase: "debit", Status: "done"},
				{Phase: "convert", Status: "done", Detail: conv.ToAmount + " " + conv.ToAsset},
				{Phase: "settle", Status: "skipped", Detail: "credited ledger vault"},
			},
			Note:      req.Note,
			CreatedAt: time.Now().Unix(),
		}
		if err := s.appendSettlement(rec); err != nil {
			return nil, err
		}
		return &SettlementResult{Status: "completed", Settlement: rec, Convert: conv}, nil
	}

	xfer, err := s.Transfer(trReq, prices, settle)
	if err != nil {
		return nil, err
	}

	steps := []SettlementStep{
		{Phase: "quote", Status: "done", Detail: string(kind)},
		{Phase: "debit", Status: "done", Detail: xfer.Transfer.Amount + " " + xfer.Transfer.Asset},
	}
	if xfer.Convert != nil {
		steps = append(steps, SettlementStep{Phase: "convert", Status: "done", Detail: xfer.Convert.ToAmount + " " + xfer.Convert.ToAsset})
	} else if trReq.ConvertTo != "" {
		steps = append(steps, SettlementStep{Phase: "convert", Status: "skipped"})
	}
	settleStatus := "pending"
	if xfer.Settlement != "" && !strings.HasPrefix(xfer.Settlement, "chain-pending:") {
		settleStatus = "done"
	} else if xfer.Transfer.Status == "on_chain" {
		settleStatus = "done"
	}
	steps = append(steps, SettlementStep{Phase: "settle", Status: settleStatus, Detail: xfer.Settlement})

	payoutAsset := from.Asset
	payoutAmt := xfer.Transfer.Amount
	if xfer.Convert != nil {
		payoutAsset = xfer.Convert.ToAsset
		payoutAmt = xfer.Convert.ToAmount
	} else if xfer.Transfer.ToAmount != "" {
		payoutAmt = xfer.Transfer.ToAmount
		if trReq.ConvertTo != "" {
			payoutAsset = trReq.ConvertTo
		}
	}

	destLabel := ""
	if xfer.External != nil {
		destLabel = xfer.External.Label
	}

	rec := SettlementRecord{
		ID:               fmt.Sprintf("settle-%d", time.Now().UnixNano()),
		Kind:             kind,
		Status:           xfer.Status,
		FromAccount:      req.FromAccount,
		SourceAsset:      from.Asset,
		SourceAmount:     req.Amount,
		PayoutAsset:      payoutAsset,
		PayoutAmount:     payoutAmt,
		Destination:      ResolveExternalRaw(trReq),
		DestinationLabel: destLabel,
		FundClass:        from.FundClass,
		TransferID:       xfer.Transfer.ID,
		SettlementRef:    xfer.Settlement,
		Steps:            steps,
		Note:             req.Note,
		CreatedAt:        time.Now().Unix(),
	}
	if xfer.Convert != nil {
		rec.FiatUSD = xfer.Convert.FiatUSD
	}
	if err := s.appendSettlement(rec); err != nil {
		return nil, err
	}
	return &SettlementResult{
		Status:     rec.Status,
		Settlement: rec,
		Convert:    xfer.Convert,
		Transfer:   &xfer.Transfer,
		External:   xfer.External,
	}, nil
}

func (s *BookStore) appendSettlement(rec SettlementRecord) error {
	if err := s.load(); err != nil {
		return err
	}
	s.mu.Lock()
	s.data.Settlements = append([]SettlementRecord{rec}, s.data.Settlements...)
	if len(s.data.Settlements) > 500 {
		s.data.Settlements = s.data.Settlements[:500]
	}
	s.mu.Unlock()
	return s.save()
}

// ListSettlements returns recent settlements newest first.
func (s *BookStore) ListSettlements(limit int) []SettlementRecord {
	if err := s.load(); err != nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 || limit > len(s.data.Settlements) {
		limit = len(s.data.Settlements)
	}
	if limit == 0 {
		return nil
	}
	out := make([]SettlementRecord, limit)
	copy(out, s.data.Settlements[:limit])
	return out
}

// SettlementCapabilities reports which real settlement rails are available.
func SettlementCapabilities(cfg Config, bank BankProviderConfig, evmSender, onexWallet bool) map[string]interface{} {
	bankProvider := bank.ResolvedProvider()
	hx := LoadHybrixConfig()
	hxSt := NewHybrixClient().Status()
	hybxOnline := false
	if v, ok := hxSt["online"].(bool); ok {
		hybxOnline = v
	}
	return map[string]interface{}{
		"service":        "onex-settlement-middleware",
		"production":     cfg.Production(),
		"convert":        true,
		"vault":          true,
		"internal":       true,
		"realFiat":       bankProvider != "" || cfg.BankFile != "",
		"realCrypto":     true,
		"bankProvider":   bankProvider,
		"evmSettlement":  evmSender,
		"onexSettlement": onexWallet,
		"hybxEnabled":    hx.Enabled,
		"hybxOnline":     hybxOnline,
		"hybxMiddleware": hx.Enabled,
		"hybxFederation": hx.Enabled,
		"hybxExchange":   "/bridge/bank/hybx/exchange",
		"fiatBatchMiddleware": true,
		"fiatBatchEndpoint":   "/bridge/ledger/middleware/fiat-settle",
		"aggregateFundClasses":  AggregateFundClasses(),
		"stablecoinMainnet":     EthereumMainnetChain,
		"kinds":          []string{string(SettlementVault), string(SettlementInternal), string(SettlementRealFiat), string(SettlementRealCrypto)},
		"payoutAssets":   []string{"USD", "EUR", "GBP", "BTC", "ETH", "USDT", "USDC", "BNB", "SOL", "ONEX", DefaultStableSymbol},
		"pipeline":       []string{"quote", "aggregate", "convert", "mint", "settle", "hybx-federate"},
	}
}
