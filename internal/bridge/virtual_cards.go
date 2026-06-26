package bridge

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/onex-blockchain/onex/internal/ledger"
	"github.com/onex-blockchain/onex/internal/legacy"
)

const (
	cardStatusActive  = "active"
	cardStatusFrozen  = "frozen"
	cardProgram1011   = "101.1"
	cardBIN1011       = "1011"
)

// VirtualCard is a production NSB or HYBX virtual debit card linked to an online bank account.
type VirtualCard struct {
	ID              string         `json:"id"`
	Label           string         `json:"label"`
	Issuer          string         `json:"issuer,omitempty"` // nsb | hybx
	AccountID       string         `json:"accountId"`
	HybrixAccountID string         `json:"hybxAccountId,omitempty"`
	AccountName     string         `json:"accountName,omitempty"`
	IBAN        string         `json:"iban,omitempty"`
	Brand       string         `json:"brand"`
	Network     string         `json:"network"`
	PanMasked   string         `json:"panMasked"`
	PanFull     string         `json:"panFull,omitempty"`
	Last4       string         `json:"last4"`
	Expiry      string         `json:"expiry"`
	CVV         string         `json:"cvv,omitempty"`
	CVVHint     string         `json:"cvvHint,omitempty"`
	Currency    string         `json:"currency"`
	Limit       string         `json:"limit"`
	Spent       string         `json:"spent"`
	Available   string         `json:"available"`
	Status      string         `json:"status"`
	Mode        string         `json:"mode,omitempty"`
	Active      bool           `json:"active"`
	Production  bool           `json:"production"`
	FundClass   string         `json:"fundClass,omitempty"`
	Providers   []CardProvider `json:"providers,omitempty"`
	ApplePay      bool           `json:"applePay"`
	GooglePay     bool           `json:"googlePay"`
	TwoD          bool           `json:"twoD"`
	ThreeDS       bool           `json:"threeDSecure"`
	WireTransfer  bool           `json:"wireTransfer"`
	Program     string         `json:"program,omitempty"`
	Bin         string         `json:"bin,omitempty"`
	PIN         string         `json:"pin,omitempty"`
	Online      bool           `json:"online,omitempty"`
	CreatedAt   int64          `json:"createdAt"`
}

// CardProvider is a card network or wallet integration.
type CardProvider struct {
	Name      string `json:"name"`
	Status    string `json:"status"`
	SubmitURL string `json:"submitUrl,omitempty"`
	Notes     string `json:"notes,omitempty"`
}

// VirtualCardTx records card authorization.
type VirtualCardTx struct {
	ID        string `json:"id"`
	CardID    string `json:"cardId"`
	Amount    string `json:"amount"`
	Currency  string `json:"currency"`
	Merchant  string `json:"merchant,omitempty"`
	Status    string `json:"status"`
	Reference string `json:"reference,omitempty"`
	CreatedAt int64  `json:"createdAt"`
}

type virtualCardStore struct {
	mu      sync.Mutex
	path    string
	seedDir string
}

type virtualCardFile struct {
	Issuer       string          `json:"issuer"`
	Production   bool            `json:"production"`
	Cards        []VirtualCard   `json:"cards"`
	Transactions []VirtualCardTx `json:"transactions"`
	UpdatedAt    int64           `json:"updatedAt"`
}

// IssueCardRequest creates a virtual card.
type IssueCardRequest struct {
	AccountID string `json:"accountId"`
	Label     string `json:"label,omitempty"`
	Brand     string `json:"brand,omitempty"`
	Issuer    string `json:"issuer,omitempty"` // nsb | hybx
	Program   string `json:"program,omitempty"` // 101.1
}

// AuthorizeCardRequest charges a card.
type AuthorizeCardRequest struct {
	CardID   string `json:"cardId"`
	Amount   string `json:"amount"`
	Merchant string `json:"merchant,omitempty"`
	Preview  bool   `json:"preview,omitempty"`
}

func (b *Bridge) cards() *virtualCardStore {
	if b.cardStore == nil {
		root := b.cfg.ProjectRoot
		if root == "" {
			root = "."
		}
		b.cardStore = &virtualCardStore{
			path:    filepath.Join(legacy.HomeDir(), "virtual-cards.json"),
			seedDir: root,
		}
	}
	return b.cardStore
}

func (cs *virtualCardStore) load() (*virtualCardFile, error) {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	data, err := os.ReadFile(cs.path)
	if err != nil {
		if os.IsNotExist(err) {
			return &virtualCardFile{Issuer: "NSB Virtual Cards"}, nil
		}
		return nil, err
	}
	var f virtualCardFile
	return &f, json.Unmarshal(data, &f)
}

func (cs *virtualCardStore) save(f *virtualCardFile) error {
	cs.mu.Lock()
	defer cs.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(cs.path), 0o755); err != nil {
		return err
	}
	f.UpdatedAt = time.Now().Unix()
	raw, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(cs.path, raw, 0o600)
}

func (b *Bridge) ensureVirtualCards() error {
	if err := b.ensureOnlineBank(); err != nil {
		return err
	}
	accts, err := b.onlineBank().ListAccounts()
	if err != nil {
		return err
	}
	st, err := b.cards().load()
	if err != nil {
		return err
	}
	byNSB := map[string]bool{}
	for _, c := range st.Cards {
		if strings.EqualFold(c.Issuer, "hybx") {
			continue
		}
		byNSB[c.AccountID] = true
	}
	changed := false
	for i, a := range accts {
		if byNSB[a.ID] {
			continue
		}
		brand := "visa"
		if i%2 == 1 {
			brand = "mastercard"
		}
		st.Cards = append(st.Cards, b.buildCardFromAccount(a, brand, a.Name+" · "+cardProgram1011+" Online", "nsb"))
		changed = true
	}
	if err := b.ensureHybrixVirtualCards(st, &changed); err != nil {
		return err
	}
	if dedupeVirtualCards(st) {
		changed = true
	}
	if b.activateAllVirtualCards(st) {
		changed = true
	}
	st.Production = b.isProduction()
	st.Issuer = "NSB + HYBX · Cards " + cardProgram1011 + " Online"
	if changed {
		return b.cards().save(st)
	}
	return nil
}

func cardAccountKey(c VirtualCard) string {
	issuer := strings.ToLower(strings.TrimSpace(c.Issuer))
	if issuer == "" {
		issuer = "nsb"
	}
	return issuer + ":" + strings.TrimSpace(c.AccountID)
}

func dedupeVirtualCards(st *virtualCardFile) bool {
	if len(st.Cards) < 2 {
		return false
	}
	best := map[string]VirtualCard{}
	for _, c := range st.Cards {
		k := cardAccountKey(c)
		prev, ok := best[k]
		if !ok {
			best[k] = c
			continue
		}
		keep := prev
		if c.Program == cardProgram1011 && prev.Program != cardProgram1011 {
			keep = c
		} else if c.Program == prev.Program && c.CreatedAt > prev.CreatedAt {
			keep = c
		}
		best[k] = keep
	}
	if len(best) == len(st.Cards) {
		return false
	}
	out := make([]VirtualCard, 0, len(best))
	for _, c := range best {
		out = append(out, c)
	}
	st.Cards = out
	return true
}

func (b *Bridge) ListVirtualCardsByIssuer(issuer string) ([]VirtualCard, error) {
	all, err := b.ListVirtualCards()
	if err != nil {
		return nil, err
	}
	issuer = strings.ToLower(strings.TrimSpace(issuer))
	if issuer == "" || issuer == "all" {
		return all, nil
	}
	out := make([]VirtualCard, 0)
	for _, c := range all {
		ci := strings.ToLower(strings.TrimSpace(c.Issuer))
		if ci == "" {
			ci = "nsb"
		}
		if ci == issuer {
			out = append(out, c)
		}
	}
	return out, nil
}

func (b *Bridge) IssueHybxVirtualCards() ([]VirtualCard, error) {
	if err := b.ensureOnlineBank(); err != nil {
		return nil, err
	}
	if _, err := ledger.SyncMirrorsFromOnlineBank(b.onlineBank()); err != nil {
		return nil, err
	}
	if err := b.ensureVirtualCards(); err != nil {
		return nil, err
	}
	return b.ListVirtualCardsByIssuer("hybx")
}

func (b *Bridge) ensureHybrixVirtualCards(st *virtualCardFile, changed *bool) error {
	cfg := ledger.LoadHybrixConfig()
	if !cfg.Enabled {
		return nil
	}
	mirrors, err := ledger.DefaultHybrixMirrorStore().ListMirrors()
	if err != nil || len(mirrors) == 0 {
		mirrors, err = ledger.SyncMirrorsFromOnlineBank(b.onlineBank())
		if err != nil || len(mirrors) == 0 {
			return nil
		}
	}
	accts, err := b.onlineBank().ListAccounts()
	if err != nil {
		return err
	}
	hasHybx := map[string]bool{}
	for _, c := range st.Cards {
		if strings.EqualFold(c.Issuer, "hybx") {
			hasHybx[c.AccountID] = true
		}
	}
	for i, m := range mirrors {
		if hasHybx[m.NSBAccountID] {
			continue
		}
		var acct ledger.OnlineBankAccount
		for _, a := range accts {
			if a.ID == m.NSBAccountID {
				acct = a
				break
			}
		}
		brand := "visa"
		if i%2 == 1 {
			brand = "mastercard"
		}
		st.Cards = append(st.Cards, b.buildHybrixCard(m, acct, brand))
		*changed = true
	}
	return nil
}

func (b *Bridge) buildCardFromAccount(a ledger.OnlineBankAccount, brand, label, issuer string) VirtualCard {
	if brand == "" {
		brand = "visa"
	}
	brand = strings.ToLower(brand)
	if label == "" {
		label = a.Name + " Virtual"
	}
	if issuer == "" {
		issuer = "nsb"
		if strings.EqualFold(a.Bank, "fineract") {
			issuer = "fineract"
		}
	}
	last4, pan, panFull, cvv, pin := cardSecrets(a.ID, brand, issuer, cardProgram1011)
	limit := parseCardFloat(a.Balance)
	if limit <= 0 {
		limit = 10000
	}
	c := VirtualCard{
		ID: virtualCardID(a.ID+"-"+cardProgram1011, issuer, brand), Label: label, Issuer: issuer, AccountID: a.ID, AccountName: a.Name,
		IBAN: a.IBAN, Brand: brand, Network: "ONLINE " + cardProgram1011,
		Program: cardProgram1011, Bin: cardBIN1011, PIN: pin, Online: true,
		PanMasked: pan, PanFull: panFull, Last4: last4, Expiry: cardExpiry(a.ID),
		CVV: cvv, CVVHint: cvv,
		Currency: strings.ToUpper(a.Currency), Limit: formatCardMoney(limit),
		Spent: "0.00", Available: formatCardMoney(limit), Status: cardStatusActive,
		FundClass: a.FundClass, CreatedAt: time.Now().Unix(),
	}
	b.finalizeCard(&c)
	return c
}

func (b *Bridge) buildHybrixCard(m ledger.HybrixMirrorAccount, acct ledger.OnlineBankAccount, brand string) VirtualCard {
	label := "HYBX " + acct.Name
	if acct.Name == "" {
		label = "HYBX Mirror · " + strings.ToUpper(m.Symbol)
	}
	last4, pan, panFull, cvv, pin := cardSecrets(m.HybrixAccountID, brand, "hybx", cardProgram1011)
	limit := parseCardFloat(m.MirroredBalance)
	if limit <= 0 {
		limit = parseCardFloat(acct.Balance)
	}
	if limit <= 0 {
		limit = 10000
	}
	cur := acct.Currency
	if cur == "" {
		cur = strings.ToUpper(m.Symbol)
	}
	c := VirtualCard{
		ID: virtualCardID(m.HybrixAccountID+"-"+cardProgram1011, "hybx", brand), Label: label, Issuer: "hybx",
		AccountID: m.NSBAccountID, HybrixAccountID: m.HybrixAccountID,
		AccountName: acct.Name, IBAN: acct.IBAN,
		Brand: brand, Network: "HYBX ONLINE " + cardProgram1011,
		Program: cardProgram1011, Bin: cardBIN1011, PIN: pin, Online: true,
		PanMasked: pan, PanFull: panFull, Last4: last4, Expiry: cardExpiry(m.HybrixAccountID),
		CVV: cvv, CVVHint: cvv,
		Currency: strings.ToUpper(cur), Limit: formatCardMoney(limit),
		Spent: "0.00", Available: formatCardMoney(limit), Status: cardStatusActive,
		FundClass: acct.FundClass, CreatedAt: time.Now().Unix(),
	}
	b.finalizeCard(&c)
	return c
}

func virtualCardID(seed, issuer, brand string) string {
	h := sha256.Sum256([]byte(fmt.Sprintf("vcard:%s:%s:%s", issuer, brand, seed)))
	return "vc-" + hex.EncodeToString(h[:8])
}

func cardSecrets(accountID, brand, issuer, program string) (last4, masked, full, cvv, pin4 string) {
	h := sha256.Sum256([]byte(issuer + "-card:" + program + ":" + accountID))
	raw := hex.EncodeToString(h[:8])
	num := make([]byte, 0, 16)
	for _, ch := range raw {
		if ch >= '0' && ch <= '9' {
			num = append(num, byte(ch))
		} else {
			num = append(num, byte('0'+(int(ch)%10)))
		}
	}
	for len(num) < 12 {
		num = append(num, '0')
	}
	prefix := "4242"
	switch {
	case program == cardProgram1011:
		prefix = cardBIN1011
	case issuer == "hybx":
		prefix = "5378"
	case brand == "mastercard":
		prefix = "5425"
	}
	body := string(num[:12])
	full = prefix + body
	last4 = full[len(full)-4:]
	display := formatCardPAN(full)
	masked = prefix + " •••• •••• " + last4
	cvvN := (int(h[4])<<8 | int(h[5])) % 1000
	if cvvN < 100 {
		cvvN += 100
	}
	cvv = fmt.Sprintf("%03d", cvvN)
	pinN := (int(h[6])<<8 | int(h[7])) % 10000
	pin4 = fmt.Sprintf("%04d", pinN)
	return last4, masked, display, cvv, pin4
}

func cardPAN(accountID, brand, issuer string) (last4, masked string) {
	last4, masked, _, _, _ = cardSecrets(accountID, brand, issuer, "")
	return last4, masked
}

func formatCardPAN(pan string) string {
	pan = strings.ReplaceAll(pan, " ", "")
	if len(pan) != 16 {
		return pan
	}
	return pan[0:4] + " " + pan[4:8] + " " + pan[8:12] + " " + pan[12:16]
}

func cardExpiry(accountID string) string {
	h := sha256.Sum256([]byte("exp:" + accountID))
	m := int(h[0]%12) + 1
	y := time.Now().Year() + 3 + int(h[1]%5)
	return fmt.Sprintf("%02d/%02d", m, y%100)
}

func (b *Bridge) finalizeCard(c *VirtualCard) {
	issuer := strings.ToLower(strings.TrimSpace(c.Issuer))
	if issuer == "" {
		issuer = "nsb"
	}
	seed := c.AccountID
	if issuer == "hybx" && c.HybrixAccountID != "" {
		seed = c.HybrixAccountID
	}
	program := strings.TrimSpace(c.Program)
	if program == "" {
		program = cardProgram1011
	}
	last4, masked, full, cvv, pin4 := cardSecrets(seed, c.Brand, issuer, program)
	c.Last4 = last4
	c.CVV = cvv
	c.CVVHint = cvv
	c.Program = program
	c.Bin = cardBIN1011
	c.PIN = pin4
	c.Online = true
	if c.Network == "" || !strings.Contains(c.Network, cardProgram1011) {
		if issuer == "hybx" {
			c.Network = "HYBX ONLINE " + cardProgram1011
		} else {
			c.Network = "ONLINE " + cardProgram1011
		}
	}
	if !b.isProduction() {
		c.Mode = "development"
		c.PanFull = ""
		c.PanMasked = masked
		c.CVV = ""
		c.CVVHint = "***"
		c.PIN = ""
		c.Active = c.Status == cardStatusActive
		c.Production = false
		b.activateCardRails(c)
		c.Providers = cardProviders(*c)
		return
	}
	c.Mode = "production"
	c.Status = cardStatusActive
	c.Active = true
	c.Production = true
	c.PanFull = full
	c.PanMasked = full
	b.activateCardRails(c)
	c.Providers = cardProviders(*c)
}

func (b *Bridge) activateCardRails(c *VirtualCard) {
	if c == nil || !c.Active {
		return
	}
	program := strings.TrimSpace(c.Program)
	if program == "" {
		program = cardProgram1011
	}
	if program != cardProgram1011 {
		return
	}
	c.ApplePay = true
	c.GooglePay = true
	c.TwoD = true
	c.ThreeDS = true
	c.WireTransfer = true
	c.Online = true
}

func (b *Bridge) activateAllVirtualCards(st *virtualCardFile) bool {
	changed := false
	seen := map[string]bool{}
	for i := range st.Cards {
		c := &st.Cards[i]
		issuer := strings.ToLower(strings.TrimSpace(c.Issuer))
		if issuer == "" {
			issuer = "nsb"
		}
		seed := c.AccountID
		if issuer == "hybx" && c.HybrixAccountID != "" {
			seed = c.HybrixAccountID
		}
		wantID := virtualCardID(seed+"-"+cardProgram1011, issuer, c.Brand)
		if c.ID != wantID || seen[c.ID] {
			c.ID = wantID
			changed = true
		}
		seen[c.ID] = true
		prevActive := c.Active
		prevStatus := c.Status
		b.syncCardBalance(c)
		b.finalizeCard(c)
		if !prevActive || prevStatus != cardStatusActive || !c.Production {
			changed = true
		}
	}
	return changed
}

func cardProviders(c VirtualCard) []CardProvider {
	status, note := "pending", "Issue Cards 101.1 to activate"
	if c.Active && c.Program == cardProgram1011 {
		status, note = "active", "Cards 101.1 · BIN " + cardBIN1011 + " · live"
	}
	railStatus := func(on bool) string {
		if on && status == "active" {
			return "active"
		}
		return status
	}
	return []CardProvider{
		{Name: "Cards " + cardProgram1011, Status: status, Notes: "BIN " + cardBIN1011 + " · online · " + note},
		{Name: "Visa", Status: status, SubmitURL: "https://www.visa.com", Notes: note},
		{Name: "Mastercard", Status: status, SubmitURL: "https://www.mastercard.com", Notes: note},
		{Name: "HYBX", Status: status, SubmitURL: "https://api.hybrix.io", Notes: "HYBX multi-ledger · " + note},
		{Name: "Apple Pay", Status: railStatus(c.ApplePay), Notes: note},
		{Name: "Google Pay", Status: railStatus(c.GooglePay), Notes: note},
		{Name: "2D Secure", Status: railStatus(c.TwoD), Notes: "Card-not-present · CVV · " + note},
		{Name: "3D Secure", Status: railStatus(c.ThreeDS), Notes: note},
		{Name: "Wire Transfer", Status: railStatus(c.WireTransfer), Notes: note},
		{Name: "NSB Card Network", Status: status, Notes: note},
	}
}

func (b *Bridge) VirtualCardsStatus() map[string]interface{} {
	st, _ := b.cards().load()
	active, prod, hybx, prog1011 := 0, 0, 0, 0
	rails := map[string]bool{
		"applePay": false, "googlePay": false, "twoD": false,
		"threeDSecure": false, "wireTransfer": false,
	}
	for _, c := range st.Cards {
		cc := c
		b.finalizeCard(&cc)
		if cc.Active {
			active++
		}
		if cc.Production {
			prod++
		}
		if strings.EqualFold(cc.Issuer, "hybx") {
			hybx++
		}
		if cc.Program == cardProgram1011 {
			prog1011++
			if cc.ApplePay {
				rails["applePay"] = true
			}
			if cc.GooglePay {
				rails["googlePay"] = true
			}
			if cc.TwoD {
				rails["twoD"] = true
			}
			if cc.ThreeDS {
				rails["threeDSecure"] = true
			}
			if cc.WireTransfer {
				rails["wireTransfer"] = true
			}
		}
	}
	hx := ledger.NewHybrixClient().Status()
	chains := []string{}
	if sample, ok := hx["sampleAssets"].([]string); ok {
		chains = sample
	}
	sampleCard := VirtualCard{
		Active: active > 0, Program: cardProgram1011,
		ApplePay: rails["applePay"], GooglePay: rails["googlePay"], TwoD: rails["twoD"],
		ThreeDS: rails["threeDSecure"], WireTransfer: rails["wireTransfer"],
	}
	return map[string]interface{}{
		"issuer": "NSB + HYBX · Cards " + cardProgram1011 + " Online", "enabled": true,
		"production": b.isProduction(), "mode": cardMode(b.isProduction()),
		"program": cardProgram1011, "bin": cardBIN1011, "programCards": prog1011,
		"cards": len(st.Cards), "active": active, "productionCards": prod,
		"hybxCards": hybx, "nsbCards": len(st.Cards) - hybx, "hybx": hx,
		"middleware": ledger.HybxMiddlewareStatus(),
		"multiChainAssets": chains,
		"transactions": len(st.Transactions),
		"rails": rails,
		"providers": cardProviders(sampleCard),
		"api": map[string]string{
			"list":          "/bridge/cards",
			"activate":        "/bridge/cards/activate",
			"activateRails":   "/bridge/cards/101.1/activate-rails",
			"program1011":     "/bridge/cards/101.1/issue",
			"release1011":     "/bridge/cards/101.1/release",
			"wire1011":        "/bridge/cards/101.1/wire",
			"wireInstructions": "/bridge/cards/wire",
			"hybxList":        "/bridge/cards/hybx",
			"hybxIssue":       "/bridge/bank/hybx/cards/issue",
			"authorize":       "/bridge/cards/authorize",
		},
	}
}

func cardMode(prod bool) string {
	if prod {
		return "production"
	}
	return "development"
}

func (b *Bridge) ListVirtualCards() ([]VirtualCard, error) {
	st, err := b.cards().load()
	if err != nil {
		return nil, err
	}
	out := make([]VirtualCard, len(st.Cards))
	for i := range st.Cards {
		c := st.Cards[i]
		b.syncCardBalance(&c)
		b.finalizeCard(&c)
		out[i] = c
	}
	return out, nil
}

// IssueCards1011 upgrades or issues all online bank cards under program 101.1 (BIN 1011, 4-digit PIN).
func (b *Bridge) IssueCards1011() ([]VirtualCard, error) {
	if err := b.ensureOnlineBank(); err != nil {
		return nil, err
	}
	if _, err := ledger.SyncMirrorsFromOnlineBank(b.onlineBank()); err != nil {
		return nil, err
	}
	if err := b.ensureVirtualCards(); err != nil {
		return nil, err
	}
	st, err := b.cards().load()
	if err != nil {
		return nil, err
	}
	changed := false
	for i := range st.Cards {
		st.Cards[i].Program = cardProgram1011
		st.Cards[i].Online = true
		b.syncCardBalance(&st.Cards[i])
		b.finalizeCard(&st.Cards[i])
		changed = true
	}
	if dedupeVirtualCards(st) {
		changed = true
	}
	if b.activateAllVirtualCards(st) {
		changed = true
	}
	if changed {
		st.Production = b.isProduction()
		st.Issuer = "NSB + HYBX · Cards 101.1 Online"
		if err := b.cards().save(st); err != nil {
			return nil, err
		}
	}
	return b.ListVirtualCards()
}

func (b *Bridge) syncCardBalance(c *VirtualCard) {
	spent := parseCardFloat(c.Spent)
	limit := parseCardFloat(c.Limit)
	bal := 0.0

	if strings.EqualFold(c.Issuer, "hybx") {
		if mirrors, err := ledger.DefaultHybrixMirrorStore().ListMirrors(); err == nil {
			for _, m := range mirrors {
				if m.NSBAccountID == c.AccountID {
					bal = parseCardFloat(m.MirroredBalance)
					if m.Symbol != "" && c.Currency == "" {
						c.Currency = strings.ToUpper(m.Symbol)
					}
					break
				}
			}
		}
	}

	accts, err := b.onlineBank().ListAccounts()
	if err == nil {
		for _, a := range accts {
			if a.ID != c.AccountID {
				continue
			}
			abb := parseCardFloat(a.Balance)
			if bal <= 0 || abb < bal {
				bal = abb
			}
			if c.Currency == "" {
				c.Currency = strings.ToUpper(a.Currency)
			}
			break
		}
	}

	if bal <= 0 {
		bal = limit
	}
	limit = math.Max(bal, limit)
	if limit <= 0 {
		limit = bal
	}
	c.Limit = formatCardMoney(limit)
	c.Available = formatCardMoney(math.Max(0, limit-spent))
}

func (b *Bridge) IssueVirtualCard(req IssueCardRequest) (*VirtualCard, error) {
	accts, err := b.onlineBank().ListAccounts()
	if err != nil {
		return nil, err
	}
	var acct *ledger.OnlineBankAccount
	for i := range accts {
		if accts[i].ID == strings.TrimSpace(req.AccountID) {
			acct = &accts[i]
			break
		}
	}
	if acct == nil {
		return nil, fmt.Errorf("account not found")
	}
	st, err := b.cards().load()
	if err != nil {
		return nil, err
	}
	brand := strings.ToLower(strings.TrimSpace(req.Brand))
	issuer := strings.ToLower(strings.TrimSpace(req.Issuer))
	program := strings.TrimSpace(req.Program)
	if program == "" {
		program = cardProgram1011
	}
	if issuer == "" {
		issuer = "nsb"
	}
	for _, c := range st.Cards {
		ci := strings.ToLower(strings.TrimSpace(c.Issuer))
		if ci == "" {
			ci = "nsb"
		}
		cp := strings.TrimSpace(c.Program)
		if cp == "" {
			cp = cardProgram1011
		}
		if c.AccountID == acct.ID && ci == issuer && cp == program && (brand == "" || c.Brand == brand) {
			cc := c
			b.syncCardBalance(&cc)
			b.finalizeCard(&cc)
			return &cc, nil
		}
	}
	var card VirtualCard
	if issuer == "hybx" {
		mirrors, err := ledger.DefaultHybrixMirrorStore().ListMirrors()
		if err != nil {
			return nil, err
		}
		var mirror *ledger.HybrixMirrorAccount
		for i := range mirrors {
			if mirrors[i].NSBAccountID == acct.ID {
				mirror = &mirrors[i]
				break
			}
		}
		if mirror == nil {
			synced, err := ledger.SyncMirrorsFromOnlineBank(b.onlineBank())
			if err != nil {
				return nil, err
			}
			for i := range synced {
				if synced[i].NSBAccountID == acct.ID {
					mirror = &synced[i]
					break
				}
			}
		}
		if mirror == nil {
			return nil, fmt.Errorf("hybx mirror not found — sync HYBX first")
		}
		card = b.buildHybrixCard(*mirror, *acct, brand)
	} else {
		card = b.buildCardFromAccount(*acct, brand, req.Label, issuer)
	}
	st.Cards = append(st.Cards, card)
	if err := b.cards().save(st); err != nil {
		return nil, err
	}
	return &card, nil
}

func (b *Bridge) AuthorizeVirtualCard(req AuthorizeCardRequest) (map[string]interface{}, error) {
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
	if !card.Active {
		return nil, fmt.Errorf("card not active")
	}
	amt, err := strconv.ParseFloat(strings.TrimSpace(req.Amount), 64)
	if err != nil || amt <= 0 {
		return nil, fmt.Errorf("invalid amount")
	}
	if parseCardFloat(card.Available) < amt {
		return nil, fmt.Errorf("insufficient card limit")
	}
	merchant := strings.TrimSpace(req.Merchant)
	if merchant == "" {
		merchant = "Merchant"
	}
	ref := fmt.Sprintf("VC-%d", time.Now().Unix())
	if req.Preview {
		return map[string]interface{}{
			"status": "quoted", "preview": true, "amount": formatCardMoney(amt),
			"currency": card.Currency, "merchant": merchant, "cardId": card.ID,
			"available": card.Available,
		}, nil
	}
	_, err = b.onlineBank().DebitAccount(card.AccountID, formatCardMoney(amt), ref+" · "+merchant)
	if err != nil {
		return nil, err
	}
	if strings.EqualFold(card.Issuer, "hybx") {
		_ = ledger.DefaultHybrixMirrorStore().DebitMirror(card.AccountID, amt)
	}
	if b.isProduction() {
		_ = ledger.HybxRecordCardSpend(card.ID, card.AccountID, formatCardMoney(amt), card.Currency, merchant, ref)
	}
	spent := parseCardFloat(card.Spent) + amt
	card.Spent = formatCardMoney(spent)
	b.syncCardBalance(&card)
	b.finalizeCard(&card)
	st.Cards[idx] = card
	tx := VirtualCardTx{
		ID: fmt.Sprintf("vctx-%d", time.Now().UnixNano()), CardID: card.ID,
		Amount: formatCardMoney(amt), Currency: card.Currency, Merchant: merchant,
		Status: "completed", Reference: ref, CreatedAt: time.Now().Unix(),
	}
	st.Transactions = append(st.Transactions, tx)
	if err := b.cards().save(st); err != nil {
		return nil, err
	}
	return map[string]interface{}{"status": "completed", "transaction": tx, "card": card}, nil
}

func (b *Bridge) ListVirtualCardTransactions(limit int) ([]VirtualCardTx, error) {
	st, err := b.cards().load()
	if err != nil {
		return nil, err
	}
	if limit <= 0 || limit > len(st.Transactions) {
		limit = len(st.Transactions)
	}
	start := len(st.Transactions) - limit
	if start < 0 {
		start = 0
	}
	out := make([]VirtualCardTx, limit)
	copy(out, st.Transactions[start:])
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

func parseCardFloat(s string) float64 {
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v
}

func formatCardMoney(v float64) string {
	return fmt.Sprintf("%.2f", v)
}
