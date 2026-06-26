package bridge

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/onex-blockchain/onex/internal/ledger"
)

// CardWireRequest sends a wire transfer from a Cards 101.1 virtual card.
type CardWireRequest struct {
	CardID          string `json:"cardId"`
	Amount          string `json:"amount"`
	BeneficiaryIBAN string `json:"beneficiaryIban"`
	BeneficiaryName string `json:"beneficiaryName,omitempty"`
	Reference       string `json:"reference,omitempty"`
	Preview         bool   `json:"preview,omitempty"`
}

func (b *Bridge) findVirtualCard(cardID string) (*VirtualCard, int, *virtualCardFile, error) {
	st, err := b.cards().load()
	if err != nil {
		return nil, -1, nil, err
	}
	for i := range st.Cards {
		if st.Cards[i].ID == strings.TrimSpace(cardID) {
			c := st.Cards[i]
			b.syncCardBalance(&c)
			b.finalizeCard(&c)
			return &c, i, st, nil
		}
	}
	return nil, -1, st, fmt.Errorf("card not found")
}

// ActivateRails1011 enables Apple Pay, Google Pay, 2D, 3DS, and wire on all 101.1 cards.
func (b *Bridge) ActivateRails1011() ([]VirtualCard, error) {
	cards, err := b.IssueCards1011()
	if err != nil {
		return nil, err
	}
	st, err := b.cards().load()
	if err != nil {
		return nil, err
	}
	for i := range st.Cards {
		st.Cards[i].Status = cardStatusActive
		st.Cards[i].Active = true
		st.Cards[i].Program = cardProgram1011
		b.syncCardBalance(&st.Cards[i])
		b.finalizeCard(&st.Cards[i])
	}
	if err := b.cards().save(st); err != nil {
		return nil, err
	}
	return cards, nil
}

// CardWireInstructions returns wire receive details for a virtual card's linked account.
func (b *Bridge) CardWireInstructions(cardID string) (map[string]interface{}, error) {
	if err := b.ensureVirtualCards(); err != nil {
		return nil, err
	}
	card, _, _, err := b.findVirtualCard(cardID)
	if err != nil {
		return nil, err
	}
	if !card.WireTransfer {
		return nil, fmt.Errorf("wire transfer not active on this card")
	}
	wire, err := b.onlineBank().WireInstructions(card.AccountID)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"cardId": card.ID, "program": card.Program, "bin": card.Bin,
		"applePay": card.ApplePay, "googlePay": card.GooglePay,
		"twoD": card.TwoD, "threeDSecure": card.ThreeDS, "wireTransfer": card.WireTransfer,
		"accountId": wire.AccountID, "accountName": wire.AccountName,
		"iban": wire.IBAN, "swift": wire.SWIFT, "bankName": wire.BankName,
		"currency": wire.Currency, "reference": wire.Reference,
	}, nil
}

// WireTransferCard sends a wire payout from a Cards 101.1 virtual card balance.
func (b *Bridge) WireTransferCard(ctx context.Context, req CardWireRequest) (map[string]interface{}, error) {
	if err := b.ensureVirtualCards(); err != nil {
		return nil, err
	}
	card, idx, st, err := b.findVirtualCard(req.CardID)
	if err != nil {
		return nil, err
	}
	if card.Program != cardProgram1011 {
		return nil, fmt.Errorf("card is not program 101.1")
	}
	if !card.Active || !card.WireTransfer {
		return nil, fmt.Errorf("wire transfer not active on this card")
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
	name := strings.TrimSpace(req.BeneficiaryName)
	if name == "" {
		name = "Wire beneficiary"
	}
	ref := strings.TrimSpace(req.Reference)
	if ref == "" {
		ref = fmt.Sprintf("VC1011-WIRE-%d", time.Now().Unix())
	}

	if req.Preview {
		return map[string]interface{}{
			"status": "quoted", "preview": true, "rail": "wire",
			"cardId": card.ID, "program": cardProgram1011, "bin": cardBIN1011,
			"amount": formatCardMoney(amt), "currency": card.Currency,
			"beneficiaryIban": iban, "beneficiaryName": name, "wireRef": ref,
			"available": card.Available,
			"rails": map[string]bool{
				"applePay": card.ApplePay, "googlePay": card.GooglePay,
				"twoD": card.TwoD, "threeDSecure": card.ThreeDS, "wireTransfer": card.WireTransfer,
			},
		}, nil
	}

	transfer := ledger.OnlineBankTransferRequest{
		FromAccount: card.AccountID,
		ToIBAN:      iban,
		ToBank:      name,
		Rail:        "wire",
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
	b.syncCardBalance(card)
	b.finalizeCard(card)
	st.Cards[idx] = *card
	tx := VirtualCardTx{
		ID: fmt.Sprintf("vctx-%d", time.Now().UnixNano()), CardID: card.ID,
		Amount: formatCardMoney(amt), Currency: card.Currency,
		Merchant: "Wire transfer · " + iban,
		Status: "completed", Reference: ref, CreatedAt: time.Now().Unix(),
	}
	st.Transactions = append(st.Transactions, tx)
	if err := b.cards().save(st); err != nil {
		return nil, err
	}

	if b.isProduction() {
		_ = ledger.HybxRecordCardSpend(card.ID, card.AccountID, formatCardMoney(amt), card.Currency, "Wire transfer", ref)
		_ = b.applyHybrixTransfer(transfer, res)
		_ = b.SyncLedgerBook(ctx, "")
		b.ensureProductionBootstrapped(ctx, "")
	}

	status := "sent"
	if res != nil && res.Transaction != nil && res.Transaction.Status == "pending" {
		status = "pending"
	}

	return map[string]interface{}{
		"status": status, "rail": "wire", "preview": false,
		"program": cardProgram1011, "bin": cardBIN1011,
		"card": card, "transaction": tx, "transfer": res,
		"wireRef": ref, "beneficiaryIban": iban, "beneficiaryName": name,
		"settlement": settlementFromTransfer(res),
		"rails": map[string]bool{
			"applePay": card.ApplePay, "googlePay": card.GooglePay,
			"twoD": card.TwoD, "threeDSecure": card.ThreeDS, "wireTransfer": card.WireTransfer,
		},
	}, nil
}
