package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/onex-blockchain/onex/internal/bridge/chains"
	"github.com/onex-blockchain/onex/internal/ledger"
)

var productionBootstrapMu sync.Mutex

func (b *Bridge) ensureProductionBootstrapped(ctx context.Context, evmHolder string) {
	if !b.isProduction() {
		return
	}
	b.prodBoot.Do(func() {
		b.BootstrapProduction(ctx, evmHolder)
	})
}

// BootstrapProduction initializes every real subsystem for production: bank, HYBX, Fineract,
// virtual cards, ledger import, and unified ledger book.
func (b *Bridge) BootstrapProduction(ctx context.Context, evmHolder string) map[string]interface{} {
	productionBootstrapMu.Lock()
	defer productionBootstrapMu.Unlock()

	steps := make([]map[string]string, 0, 12)
	add := func(phase, status, detail string) {
		steps = append(steps, map[string]string{"phase": phase, "status": status, "detail": detail})
	}
	ok := true

	if !b.isProduction() {
		return map[string]interface{}{
			"ok": false, "production": false,
			"detail": "set ONEX_LEDGER_MODE=production",
			"steps":  steps,
		}
	}

	if err := b.ensureOnlineBank(); err != nil {
		add("bank", "failed", err.Error())
		ok = false
	} else {
		accts, _ := b.onlineBank().ListAccounts()
		add("bank", "done", itoa(len(accts))+" NSB accounts live")
	}

	if path, err := b.ensureProductionLedgerImport(); err != nil {
		add("import", "failed", err.Error())
		ok = false
	} else if path != "" {
		add("import", "done", filepath.Base(path))
	} else {
		add("import", "done", "import active")
	}

	if ledger.LoadFineractConfig().Configured() {
		if synced, err := b.SyncFineractAccounts(); err != nil {
			add("fineract", "warn", err.Error())
		} else {
			add("fineract", "done", itoa(len(synced))+" accounts synced")
		}
	} else {
		add("fineract", "skipped", "not configured")
	}

	if ledger.LoadHybrixConfig().Enabled {
		hybxCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
		err := b.SyncHybxMiddleware(hybxCtx, evmHolder)
		cancel()
		if err != nil {
			add("hybx", "warn", err.Error())
		} else {
			cards, _ := b.IssueHybxVirtualCards()
			add("hybx", "done", "middleware · "+itoa(len(cards))+" HYBX cards")
		}
	} else {
		add("hybx", "skipped", "set ONEX_HYBX_ENABLED=1")
	}

	if vc := b.VirtualCardsStatus(); vc != nil {
		active, _ := vc["active"].(int)
		add("cards", "done", itoa(active)+" production virtual cards")
	}
	if cards, err := b.IssueCards1011(); err != nil {
		add("cards1011", "warn", err.Error())
	} else {
		add("cards1011", "done", itoa(len(cards))+" online · BIN 1011 · Apple Pay · Google Pay · 2D · wire")
	}

	swift := b.SwiftSystemStatus()
	bic, global := "NSBKLAL2X", b.globalServerURL()
	if swift != nil {
		if v, ok := swift["bic"].(string); ok && v != "" {
			bic = v
		}
		if v, ok := swift["globalServer"].(string); ok && v != "" {
			global = v
		}
	}
	add("swift", "done", "SWIFT "+bic+" · global "+global)

	if swap, err := b.ActivateSwap(ctx); err != nil {
		add("swap", "warn", err.Error())
	} else {
		pools, _ := swap["pools"].(int)
		add("swap", "done", itoa(pools)+" pools · token swap active")
	}

	if chains.LoadEthereumRPC() != "" && chains.LoadEthereumMasterKeySilent() {
		if res, err := chains.FundEVMSenderIfNeeded(ctx); err != nil {
			add("ethereum", "warn", err.Error())
		} else if st, _ := res["status"].(string); st == "completed" {
			add("ethereum", "done", "funded EVM sender · tx "+fmt.Sprint(res["txHash"]))
		} else {
			add("ethereum", "done", fmt.Sprint(res["reason"]))
		}
	} else if chains.LoadEthereumRPC() != "" {
		add("ethereum", "warn", "set ONEX_ETHEREUM_MASTER_KEY to fund sender or sign transfers")
	}

	if ledger.CashCodeEnabled() {
		if err := b.ensureCashCodeEscrow("USD"); err != nil {
			add("cashcode", "warn", err.Error())
		} else {
			cc := b.CashCodeStatus()
			active, _ := cc["active"].(int)
			add("cashcode", "done", "escrow · "+itoa(active)+" active codes")
		}
	} else {
		add("cashcode", "skipped", "disabled")
	}

	if err := b.SyncLedgerBook(ctx, evmHolder); err != nil {
		add("ledger", "failed", err.Error())
		ok = false
	} else {
		snap, _ := b.ReadRealLedger(ctx, "all", evmHolder, b.LoadLatestImport())
		add("ledger", "done", itoa(len(snap.Entries))+" entries valued")
	}

	if ledger.LoadBridge7Config().Enabled {
		if b7, err := b.SyncBridge7(ctx, evmHolder); err != nil {
			add("bridge7", "warn", err.Error())
		} else if b7 != nil {
			n := 0
			if v, ok := b7["entries"].(int); ok {
				n = v
			}
			add("bridge7", "done", itoa(n)+" entries · local-ledger-2026 · ledger-pro · crypto-ledger")
		}
	}

	return map[string]interface{}{
		"ok": ok, "production": true, "steps": steps,
	}
}

func (b *Bridge) ensureProductionLedgerImport() (string, error) {
	if b.LoadLatestImport() != nil {
		return "", nil
	}
	cfg := b.resolvedLedgerConfig()
	bankCfg := ledger.LoadBankProviderConfig()
	if bankCfg.FilePath == "" && cfg.BankFile != "" {
		bankCfg.FilePath = cfg.BankFile
	}
	if bankCfg.FilePath == "" {
		bankCfg.FilePath = filepath.Join(b.projectRoot(), "configs", "bank-ledger.example.json")
	}
	entries, err := ledger.ReadBankLedger(ledger.BankConfig{FilePath: bankCfg.FilePath})
	if err != nil || len(entries) == 0 {
		return "", err
	}
	payload := map[string]interface{}{
		"source": "production-bootstrap", "mode": "production",
		"entries": entries, "importedAt": time.Now().Unix(),
	}
	raw, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return "", err
	}
	dir := cfg.ImportDir
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "production-seed.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		return "", err
	}
	return path, nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [16]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
