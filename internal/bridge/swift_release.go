package bridge

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/onex-blockchain/onex/internal/ledger"
)

// SwiftReleaseRequest releases funds from NSB online bank or a Cards 101.1 card via SWIFT.
type SwiftReleaseRequest struct {
	FromAccount     string `json:"fromAccount,omitempty"`
	CardID          string `json:"cardId,omitempty"`
	Amount          string `json:"amount"`
	BeneficiaryIBAN string `json:"beneficiaryIban"`
	BeneficiaryBIC  string `json:"beneficiaryBic,omitempty"`
	BeneficiaryName string `json:"beneficiaryName,omitempty"`
	Reference       string `json:"reference,omitempty"`
	Preview         bool   `json:"preview,omitempty"`
}

func (b *Bridge) globalServerURL() string {
	host := strings.TrimSpace(os.Getenv("ONEX_PUBLIC_HOST"))
	if host != "" {
		return "http://" + host + ":9338"
	}
	domain := strings.TrimSpace(os.Getenv("ONEX_PRODUCTION_DOMAIN"))
	if domain == "" {
		domain = "onexproduction.com"
	}
	return "https://" + domain
}

// SwiftSystemStatus reports SWIFT rail readiness for the online bank.
func (b *Bridge) SwiftSystemStatus() map[string]interface{} {
	st := b.onlineBank().Status()
	swift, _ := st["swift"].(string)
	if swift == "" {
		swift = "NSBKLAL2X"
	}
	return map[string]interface{}{
		"enabled":      ledger.OnlineBankEnabled(),
		"production":   b.isProduction(),
		"bic":          swift,
		"bank":         st["name"],
		"globalServer": b.globalServerURL(),
		"rails":        []string{"swift", "sepa", "wire", "iban", "ach", "fps"},
		"api": map[string]string{
			"release": "/bridge/bank/swift/release",
			"status":  "/bridge/bank/swift/status",
		},
	}
}

// ReleaseFundsSwift sends a SWIFT payout from an online bank account.
func (b *Bridge) ReleaseFundsSwift(ctx context.Context, req SwiftReleaseRequest) (map[string]interface{}, error) {
	if err := b.ensureOnlineBank(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.CardID) != "" {
		return b.releaseCardFundsSwift(ctx, req)
	}
	from := strings.TrimSpace(req.FromAccount)
	if from == "" {
		return nil, fmt.Errorf("fromAccount or cardId required")
	}
	amt := strings.TrimSpace(req.Amount)
	iban := strings.TrimSpace(req.BeneficiaryIBAN)
	if amt == "" || iban == "" {
		return nil, fmt.Errorf("amount and beneficiaryIban required")
	}
	bic := strings.TrimSpace(req.BeneficiaryBIC)
	if bic == "" {
		bic = "CHASUS33"
	}
	name := strings.TrimSpace(req.BeneficiaryName)
	if name == "" {
		name = "Beneficiary"
	}
	ref := strings.TrimSpace(req.Reference)
	if ref == "" {
		ref = fmt.Sprintf("SWIFT-REL-%d", time.Now().Unix())
	}

	transfer := ledger.OnlineBankTransferRequest{
		FromAccount: from,
		ToIBAN:      iban,
		ToBank:      name,
		Rail:        "swift",
		Amount:      amt,
		Reference:   ref,
		Preview:     req.Preview,
	}
	res, err := b.onlineBank().Send(transfer)
	if err != nil {
		return nil, err
	}

	out := map[string]interface{}{
		"status":       "preview",
		"phase":        "black",
		"screen":       "black",
		"production":   b.isProduction(),
		"globalServer": b.globalServerURL(),
		"swiftRef":     ref,
		"bic":          bic,
		"transfer":     res,
		"preview":      req.Preview,
	}
	if req.Preview {
		return out, nil
	}

	if !req.Preview {
		_ = b.applyHybrixTransfer(transfer, res)
		_ = b.SyncLedgerBook(ctx, "")
		if b.isProduction() {
			b.ensureProductionBootstrapped(ctx, "")
		}
	}
	status := "released"
	phase := "white"
	screen := "white"
	if res != nil && res.Transaction != nil && res.Transaction.Status == "pending" {
		status = "pending"
		phase = "processing"
		screen = "black"
	}
	out["status"] = status
	out["phase"] = phase
	out["screen"] = screen
	out["preview"] = false
	if res != nil && res.Transaction != nil {
		out["swiftRef"] = res.Transaction.Reference
		out["settlement"] = res.Transaction.Settlement
	}
	return out, nil
}

func (b *Bridge) releaseCardFundsSwift(ctx context.Context, req SwiftReleaseRequest) (map[string]interface{}, error) {
	if err := b.ensureVirtualCards(); err != nil {
		return nil, err
	}
	st, err := b.cards().load()
	if err != nil {
		return nil, err
	}
	idx := -1
	var card VirtualCard
	for i := range st.Cards {
		if st.Cards[i].ID == strings.TrimSpace(req.CardID) {
			card = st.Cards[i]
			idx = i
			break
		}
	}
	if idx < 0 {
		return nil, fmt.Errorf("card not found")
	}
	b.syncCardBalance(&card)
	b.finalizeCard(&card)
	if card.Program != cardProgram1011 {
		return nil, fmt.Errorf("card is not program 101.1")
	}
	if !card.Active {
		return nil, fmt.Errorf("card not active")
	}
	amt := parseCardFloat(strings.TrimSpace(req.Amount))
	if amt <= 0 {
		return nil, fmt.Errorf("invalid amount")
	}
	if parseCardFloat(card.Available) < amt {
		return nil, fmt.Errorf("insufficient card balance")
	}
	iban := strings.TrimSpace(req.BeneficiaryIBAN)
	if iban == "" {
		return nil, fmt.Errorf("beneficiaryIban required")
	}
	bic := strings.TrimSpace(req.BeneficiaryBIC)
	if bic == "" {
		bic = "CHASUS33"
	}
	name := strings.TrimSpace(req.BeneficiaryName)
	if name == "" {
		name = "SWIFT beneficiary"
	}
	ref := strings.TrimSpace(req.Reference)
	if ref == "" {
		ref = fmt.Sprintf("VC1011-SWIFT-%d", time.Now().Unix())
	}

	if req.Preview {
		return map[string]interface{}{
			"status": "quoted", "preview": true, "phase": "black", "screen": "black",
			"production": b.isProduction(), "globalServer": b.globalServerURL(),
			"cardId": card.ID, "program": cardProgram1011, "bin": cardBIN1011,
			"amount": formatCardMoney(amt), "currency": card.Currency,
			"beneficiaryIban": iban, "beneficiaryBic": bic, "swiftRef": ref,
			"available": card.Available,
		}, nil
	}

	transfer := ledger.OnlineBankTransferRequest{
		FromAccount: card.AccountID,
		ToIBAN:      iban,
		ToBank:      name,
		Rail:        "swift",
		Amount:      formatCardMoney(amt),
		Reference:   ref,
	}
	res, err := b.onlineBank().Send(transfer)
	if err != nil {
		return nil, err
	}

	spent := parseCardFloat(card.Spent) + amt
	card.Spent = formatCardMoney(spent)
	if strings.EqualFold(card.Issuer, "hybx") {
		_ = ledger.DefaultHybrixMirrorStore().DebitMirror(card.AccountID, amt)
	}
	b.syncCardBalance(&card)
	b.finalizeCard(&card)
	st.Cards[idx] = card
	tx := VirtualCardTx{
		ID: fmt.Sprintf("vctx-%d", time.Now().UnixNano()), CardID: card.ID,
		Amount: formatCardMoney(amt), Currency: card.Currency,
		Merchant: "SWIFT release · " + iban,
		Status: "completed", Reference: ref, CreatedAt: time.Now().Unix(),
	}
	st.Transactions = append(st.Transactions, tx)
	if err := b.cards().save(st); err != nil {
		return nil, err
	}

	if b.isProduction() {
		_ = ledger.HybxRecordCardSpend(card.ID, card.AccountID, formatCardMoney(amt), card.Currency, "SWIFT release", ref)
		_ = b.applyHybrixTransfer(transfer, res)
		_ = b.SyncLedgerBook(ctx, "")
		b.ensureProductionBootstrapped(ctx, "")
	}

	phase := "white"
	screen := "white"
	status := "released"
	if res != nil && res.Transaction != nil && res.Transaction.Status == "pending" {
		phase = "processing"
		screen = "black"
		status = "pending"
	}

	return map[string]interface{}{
		"status": status, "phase": phase, "screen": screen,
		"production": b.isProduction(), "globalServer": b.globalServerURL(),
		"program": cardProgram1011, "bin": cardBIN1011,
		"card": card, "transaction": tx, "transfer": res,
		"swiftRef": ref, "beneficiaryBic": bic, "beneficiaryIban": iban,
		"settlement": settlementFromTransfer(res),
	}, nil
}

func settlementFromTransfer(res *ledger.OnlineBankTransferResult) string {
	if res == nil || res.Transaction == nil {
		return ""
	}
	return res.Transaction.Settlement
}
