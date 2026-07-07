package ledger

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/onex-blockchain/onex/internal/legacy"
)

// Config holds production ledger middleware settings.
type Config struct {
	Mode         string // "production" or "demo"
	BankFile     string
	BankAPIURL   string
	BankAPIKey   string
	ImportDir    string
	EVMHolder    string // optional 0x address for real EVM reads
	FiatCurrency string
}

func LoadConfig() Config {
	cfg := Config{
		Mode:         strings.ToLower(strings.TrimSpace(legacy.EnvOrLegacy("ONEX_LEDGER_MODE", "SHIVA_LEDGER_MODE"))),
		BankFile:     legacy.EnvOrLegacy("ONEX_BANK_LEDGER_FILE", "SHIVA_BANK_LEDGER_FILE"),
		BankAPIURL:   legacy.EnvOrLegacy("ONEX_BANK_LEDGER_URL", "SHIVA_BANK_LEDGER_URL"),
		BankAPIKey:   legacy.EnvOrLegacy("ONEX_BANK_API_KEY", "SHIVA_BANK_API_KEY"),
		ImportDir:    legacy.EnvOrLegacy("ONEX_LEDGER_IMPORT_DIR", "SHIVA_LEDGER_IMPORT_DIR"),
		EVMHolder:    legacy.EnvOrLegacy("ONEX_EVM_HOLDER", "SHIVA_EVM_HOLDER"),
		FiatCurrency: legacy.EnvOrLegacy("ONEX_LEDGER_FIAT", "SHIVA_LEDGER_FIAT"),
	}
	if cfg.ImportDir == "" {
		cfg.ImportDir = legacy.HomeDir() + string(os.PathSeparator) + "ledger-import"
	}
	if cfg.FiatCurrency == "" {
		cfg.FiatCurrency = "USD"
	}
	if cfg.Mode == "" {
		cfg.Mode = "production"
	}
	return cfg
}

func (c Config) Production() bool {
	return c.Mode == "production" || c.Mode == "prod"
}

// Status reports middleware readiness for production ledger reads.
func (c Config) Status() map[string]interface{} {
	bank := LoadBankProviderConfig()
	if bank.FilePath == "" && c.BankFile != "" {
		bank.FilePath = c.BankFile
	}
	bankReady := bank.ResolvedProvider() != ""
	if !bankReady && c.BankFile != "" {
		bankReady = true
	}
	dc := strings.TrimSpace(legacy.EnvOrLegacy("ONEX_DEFAULT_BRIDGE_CHAIN", "ONEX_DEFAULT_BRIDGE_CHAIN"))
	if dc == "" {
		dc = "bsc"
	}
	return map[string]interface{}{
		"service":      "onex-ledger-middleware",
		"mode":         c.Mode,
		"production":   c.Production(),
		"bankReady":    bankReady,
		"bank":         bank.Status(),
		"onlineBank":   DefaultOnlineBankStore().Status(),
		"evmHolder":    c.EVMHolder != "",
		"importDir":    c.ImportDir,
		"fiatCurrency": c.FiatCurrency,
		"sources":      []string{"bank", "m0", "m1", "nsb", "onex", "evm", "portfolio", "import", "bridge7"},
		"fundClasses":  []string{FundM0, FundM1, FundNSB},
		"fundClassLabels": map[string]string{
			FundM0:  "M0 — base money",
			FundM1:  "M1 — demand deposits",
			FundNSB: "NSB — National Sovereign Bank",
		},
		"settlement": SettlementCapabilities(c, bank, false, false),
		"importActive":       true,
		"defaultBridgeChain": dc,
	}
}

// ReadInput bundles dependencies for a unified ledger read.
type ReadInput struct {
	Config       Config
	Source       string // all, bank, onex, evm, portfolio, import
	WalletAddr   string
	EVMHolder    string
	OnexAtomic   string
	Portfolio    map[string]string // tokenKey -> atomic
	Tokens       []TokenMeta
	Chains       []EVMChain
	Prices       map[string]PriceQuote
	ImportJSON   []byte
}

// Engine normalizes ledgers from any source into real fiat/crypto entries.
type Engine struct{}

func NewEngine() *Engine {
	return &Engine{}
}

func (e *Engine) Read(ctx context.Context, in ReadInput) Snapshot {
	src := strings.ToLower(strings.TrimSpace(in.Source))
	if src == "" {
		src = "all"
	}
	fiat := strings.ToUpper(strings.TrimSpace(in.Config.FiatCurrency))
	if fiat == "" {
		fiat = "USD"
	}

	var entries []Entry
	prod := in.Config.Production()

	if src == "all" || src == "bank" {
		bankCfg := LoadBankProviderConfig()
		if bankCfg.FilePath == "" && in.Config.BankFile != "" {
			bankCfg.FilePath = in.Config.BankFile
		}
		bank, _ := ReadBankLedgerWithProvider(bankCfg)
		entries = append(entries, bank...)
	}

	if src == "all" || src == "onex" {
		if in.OnexAtomic != "" && in.OnexAtomic != "0" {
			entries = append(entries, Entry{
				ID:        "onex-native",
				Source:    SourceOneX,
				Mode:      ModeReal,
				ChainID:   "onex-mainnet-1",
				Asset:     "ONEX",
				TokenKey:  "onex-mainnet-1:ONEX",
				Atomic:    in.OnexAtomic,
				Human:     atomicToHumanStr(in.OnexAtomic, 8),
				Account:   in.WalletAddr,
				Timestamp: time.Now().Unix(),
				Reference: "onex_chain",
			})
		}
	}

	holder := in.EVMHolder
	if holder == "" {
		holder = in.Config.EVMHolder
	}
	if (src == "all" || src == "evm") && holder != "" {
		evm, _ := ReadEVMEntries(ctx, in.Chains, holder, in.Tokens)
		entries = append(entries, evm...)
	}

	if (src == "all" || src == "portfolio") && !prod && len(in.Portfolio) > 0 {
		now := time.Now().Unix()
		for key, atomic := range in.Portfolio {
			if atomic == "" || atomic == "0" {
				continue
			}
			chainID, tokenID := splitTokenKey(key)
			sym := tokenID
			for _, t := range in.Tokens {
				if t.ChainID == chainID && t.TokenID == tokenID {
					sym = t.Symbol
					break
				}
			}
			entries = append(entries, Entry{
				ID:        "portfolio-" + key,
				Source:    SourcePortfolio,
				Mode:      ModeSimulated,
				ChainID:   chainID,
				Asset:     sym,
				TokenKey:  key,
				Atomic:    atomic,
				Human:     atomicToHumanStr(atomic, decimalsForSymbol(sym)),
				Account:   in.WalletAddr,
				Timestamp: now,
				Reference: "portfolio_store",
			})
		}
	}

	if (src == "all" || src == "import") && len(in.ImportJSON) > 0 {
		imp, _ := ParseImportLedger(in.ImportJSON)
		entries = append(entries, imp...)
	}

	if src == "all" || src == "bridge7" {
		if b7 := LoadBridge7Config(); b7.Enabled {
			if rows, err := LoadBridge7Entries(); err == nil {
				entries = append(entries, rows...)
			}
		}
	}

	for i := range entries {
		entries[i].FiatCurrency = fiat
		entries[i] = ValueEntry(entries[i], in.Prices)
	}

	if isFundClassSource(src) {
		entries = filterEntriesByFundClass(entries, src)
	}

	modeLabel := in.Config.Mode
	if modeLabel == "" {
		modeLabel = "production"
	}
	snap := Summarize(entries, modeLabel)
	snap.At = time.Now().Unix()
	return snap
}

func (e *Engine) Convert(req ConvertRequest, prices map[string]PriceQuote, tokens map[string]TokenMeta) (*ConvertResult, error) {
	return ConvertAmount(req, prices, tokens)
}

func splitTokenKey(key string) (chainID, tokenID string) {
	parts := strings.SplitN(key, ":", 2)
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", key
}
