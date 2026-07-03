package ledger

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/onex-blockchain/onex/internal/legacy"
)

const defaultHybrixURL = "https://api.hybrix.io"

// HybrixConfig configures the HYBX / hybrix multi-ledger bridge.
type HybrixConfig struct {
	Enabled   bool
	BaseURL   string
	PublicURL string
}

func LoadHybrixConfig() HybrixConfig {
	base := strings.TrimRight(strings.TrimSpace(legacy.EnvOrLegacy("ONEX_HYBRIX_URL", "ONEX_HYBX_URL")), "/")
	if base == "" {
		base = defaultHybrixURL
	}
	public := strings.TrimRight(strings.TrimSpace(legacy.EnvOrLegacy("ONEX_HYBX_PUBLIC_URL", "ONEX_HYBRIX_PUBLIC_URL")), "/")
	if public == "" {
		public = base
	}
	v := strings.ToLower(strings.TrimSpace(legacy.EnvOrLegacy("ONEX_HYBRIX_ENABLED", "ONEX_HYBX_ENABLED")))
	enabled := true
	if v == "0" || v == "false" || v == "off" {
		enabled = false
	}
	if v == "1" || v == "true" || v == "on" {
		enabled = true
	}
	if enabled && !OnlineBankEnabled() {
		enabled = false
	}
	return HybrixConfig{Enabled: enabled, BaseURL: base, PublicURL: public}
}

// HybrixMirrorAccount links an NSB online bank account to a HYBX virtual account.
type HybrixMirrorAccount struct {
	NSBAccountID  string `json:"nsbAccountId"`
	HybrixAccountID string `json:"hybxAccountId"`
	Symbol        string `json:"symbol"`
	MirroredBalance string `json:"mirroredBalance"`
	LastSync      int64  `json:"lastSync"`
}

type hybrixMirrorFile struct {
	Provider  string                `json:"provider"`
	BaseURL   string                `json:"baseUrl"`
	Accounts  []HybrixMirrorAccount `json:"accounts"`
	UpdatedAt int64                 `json:"updatedAt"`
}

type HybrixMirrorStore struct {
	mu   sync.Mutex
	path string
}

func DefaultHybrixMirrorStore() *HybrixMirrorStore {
	return &HybrixMirrorStore{path: filepath.Join(legacy.HomeDir(), "hybrix-bank-mirror.json")}
}

func (s *HybrixMirrorStore) load() (*hybrixMirrorFile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			cfg := LoadHybrixConfig()
			return &hybrixMirrorFile{Provider: "HYBX", BaseURL: cfg.BaseURL}, nil
		}
		return nil, err
	}
	var f hybrixMirrorFile
	return &f, json.Unmarshal(data, &f)
}

func (s *HybrixMirrorStore) save(f *hybrixMirrorFile) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	f.UpdatedAt = time.Now().Unix()
	raw, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, raw, 0o600)
}

func currencyToHybrixSymbol(currency string) string {
	c := strings.ToLower(strings.TrimSpace(currency))
	switch c {
	case "usd", "eur", "gbp", "cny", "jpy", "chf", "btc", "eth", "hy":
		return c
	default:
		return c
	}
}

func hybrixAccountID(nsbID string) string {
	return "nsb-" + strings.ToLower(strings.TrimSpace(nsbID))
}

// HybrixClient calls the public hybrix REST API.
type HybrixClient struct {
	cfg HybrixConfig
}

func NewHybrixClient() *HybrixClient {
	return &HybrixClient{cfg: LoadHybrixConfig()}
}

type hybrixResp struct {
	Error    int             `json:"error"`
	Info     string          `json:"info"`
	ID       string          `json:"id"`
	Progress float64         `json:"progress"`
	Data     json.RawMessage `json:"data"`
	Request  string          `json:"request"`
}

func (c *HybrixClient) get(path string) (json.RawMessage, error) {
	if !c.cfg.Enabled {
		return nil, fmt.Errorf("hybx disabled")
	}
	url := c.cfg.BaseURL + path
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("hybx http %d", resp.StatusCode)
	}
	var first hybrixResp
	if err := json.Unmarshal(raw, &first); err != nil {
		return raw, nil
	}
	if first.Error != 0 {
		return nil, fmt.Errorf("hybx: %s", first.Info)
	}
	// Two-stage: data is process id
	if first.Info == "Command process ID." && len(first.Data) > 0 {
		var procID string
		if err := json.Unmarshal(first.Data, &procID); err == nil && procID != "" {
			return c.pollProc(procID)
		}
	}
	return first.Data, nil
}

func (c *HybrixClient) pollProc(id string) (json.RawMessage, error) {
	client := &http.Client{Timeout: 8 * time.Second}
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		url := c.cfg.BaseURL + "/proc/" + id
		resp, err := client.Get(url)
		if err != nil {
			return nil, err
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		resp.Body.Close()
		var pr hybrixResp
		if err := json.Unmarshal(raw, &pr); err != nil {
			return nil, err
		}
		if pr.Progress >= 1 {
			return pr.Data, nil
		}
		time.Sleep(400 * time.Millisecond)
	}
	return nil, fmt.Errorf("hybx: process timeout")
}

func (c *HybrixClient) ListAssets() ([]string, error) {
	data, err := c.get("/asset")
	if err != nil {
		return nil, err
	}
	var assets []string
	if err := json.Unmarshal(data, &assets); err != nil {
		// sometimes wrapped
		var wrap map[string]interface{}
		if json.Unmarshal(data, &wrap) == nil {
			if arr, ok := wrap["assets"].([]interface{}); ok {
				for _, a := range arr {
					if s, ok := a.(string); ok {
						assets = append(assets, s)
					}
				}
			}
		}
	}
	return assets, nil
}

func (c *HybrixClient) Status() map[string]interface{} {
	cfg := c.cfg
	st := map[string]interface{}{
		"enabled": cfg.Enabled, "provider": "HYBX", "name": "HYBX",
		"baseUrl": cfg.BaseURL, "publicUrl": cfg.PublicURL,
		"online": false, "assets": 0, "apiDocs": cfg.BaseURL + "/asset",
	}
	if !cfg.Enabled {
		return st
	}
	assets, err := c.ListAssets()
	if err != nil {
		st["error"] = err.Error()
		return st
	}
	st["online"] = true
	st["assets"] = len(assets)
	st["sampleAssets"] = sampleStrings(assets, 12)
	mirror, _ := DefaultHybrixMirrorStore().load()
	if mirror != nil {
		st["mirroredAccounts"] = len(mirror.Accounts)
	}
	return st
}

func sampleStrings(in []string, n int) []string {
	if len(in) <= n {
		return in
	}
	return in[:n]
}

// SyncMirrorsFromOnlineBank maps NSB accounts to HYBX virtual accounts and syncs balances.
func SyncMirrorsFromOnlineBank(bank *OnlineBankStore) ([]HybrixMirrorAccount, error) {
	cfg := LoadHybrixConfig()
	if !cfg.Enabled {
		return nil, fmt.Errorf("hybx disabled")
	}
	accts, err := bank.ListAccounts()
	if err != nil {
		return nil, err
	}
	store := DefaultHybrixMirrorStore()
	st, err := store.load()
	if err != nil {
		return nil, err
	}
	st.Provider = "HYBX"
	st.BaseURL = cfg.BaseURL
	byNSB := map[string]int{}
	for i, m := range st.Accounts {
		byNSB[m.NSBAccountID] = i
	}
	now := time.Now().Unix()
	for _, a := range accts {
		sym := currencyToHybrixSymbol(a.Currency)
		hid := hybrixAccountID(a.ID)
		m := HybrixMirrorAccount{
			NSBAccountID: a.ID, HybrixAccountID: hid, Symbol: sym,
			MirroredBalance: a.Balance, LastSync: now,
		}
		if idx, ok := byNSB[a.ID]; ok {
			st.Accounts[idx] = m
		} else {
			st.Accounts = append(st.Accounts, m)
		}
	}
	if err := store.save(st); err != nil {
		return nil, err
	}
	return st.Accounts, nil
}

// HybrixConvertRequest moves value between NSB and HYBX mirror.
type HybrixConvertRequest struct {
	Direction   string `json:"direction"` // nsb-to-hybx | hybx-to-nsb
	NSBAccount  string `json:"nsbAccount"`
	Amount      string `json:"amount"`
	Preview     bool   `json:"preview,omitempty"`
}

func HybrixConvert(bank *OnlineBankStore, req HybrixConvertRequest) (map[string]interface{}, error) {
	cfg := LoadHybrixConfig()
	if !cfg.Enabled {
		return nil, fmt.Errorf("hybx disabled")
	}
	dir := strings.ToLower(strings.TrimSpace(req.Direction))
	if dir == "" {
		dir = "nsb-to-hybx"
	}
	amt, err := strconv.ParseFloat(strings.TrimSpace(req.Amount), 64)
	if err != nil || amt <= 0 {
		return nil, fmt.Errorf("invalid amount")
	}
	store := DefaultHybrixMirrorStore()
	st, err := store.load()
	if err != nil {
		return nil, err
	}
	var mirror *HybrixMirrorAccount
	idx := -1
	for i := range st.Accounts {
		if st.Accounts[i].NSBAccountID == strings.TrimSpace(req.NSBAccount) {
			mirror = &st.Accounts[i]
			idx = i
			break
		}
	}
	if mirror == nil {
		return nil, fmt.Errorf("mirror account not found — run sync first")
	}
	mBal, _ := strconv.ParseFloat(strings.TrimSpace(mirror.MirroredBalance), 64)
	if req.Preview {
		return map[string]interface{}{
			"status": "quoted", "preview": true, "direction": dir,
			"amount": formatFloat(amt), "symbol": mirror.Symbol,
			"nsbAccount": mirror.NSBAccountID, "hybxAccount": mirror.HybrixAccountID,
			"mirrorBalance": mirror.MirroredBalance,
		}, nil
	}
	ref := fmt.Sprintf("HYBX-%d", time.Now().Unix())
	switch dir {
	case "nsb-to-hybx", "to-hybx":
		_, err = bank.DebitAccount(mirror.NSBAccountID, formatFloat(amt), ref+" · HYBX mirror")
		if err != nil {
			return nil, err
		}
		mirror.MirroredBalance = formatFloat(mBal + amt)
	case "hybx-to-nsb", "from-hybx":
		if mBal < amt {
			return nil, fmt.Errorf("insufficient hybx mirror balance")
		}
		_, err = bank.Deposit(OnlineBankDepositRequest{
			ToAccount: mirror.NSBAccountID, Amount: formatFloat(amt),
			Source: "hybx", Reference: ref,
		})
		if err != nil {
			return nil, err
		}
		mirror.MirroredBalance = formatFloat(mBal - amt)
	default:
		return nil, fmt.Errorf("direction must be nsb-to-hybx or hybx-to-nsb")
	}
	mirror.LastSync = time.Now().Unix()
	st.Accounts[idx] = *mirror
	if err := store.save(st); err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"status": "completed", "direction": dir, "amount": formatFloat(amt),
		"symbol": mirror.Symbol, "mirrorBalance": mirror.MirroredBalance,
		"reference": ref,
	}, nil
}

func (s *HybrixMirrorStore) ListMirrors() ([]HybrixMirrorAccount, error) {
	st, err := s.load()
	if err != nil {
		return nil, err
	}
	out := make([]HybrixMirrorAccount, len(st.Accounts))
	copy(out, st.Accounts)
	return out, nil
}

// DebitMirror reduces mirrored balance when HYBX virtual card spends against an NSB account.
func (s *HybrixMirrorStore) DebitMirror(nsbAccountID string, amount float64) error {
	if amount <= 0 {
		return nil
	}
	st, err := s.load()
	if err != nil {
		return err
	}
	for i := range st.Accounts {
		if st.Accounts[i].NSBAccountID != strings.TrimSpace(nsbAccountID) {
			continue
		}
		mBal, _ := strconv.ParseFloat(strings.TrimSpace(st.Accounts[i].MirroredBalance), 64)
		st.Accounts[i].MirroredBalance = formatFloat(math.Max(0, mBal-amount))
		st.Accounts[i].LastSync = time.Now().Unix()
		return s.save(st)
	}
	return nil
}

// InitiateHybrixTransfer is implemented in hybx_middleware.go (HybxFederateOutbound).
