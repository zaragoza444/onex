package bridge

import (
	"context"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/onex-blockchain/onex/internal/bridge/chains"
	"github.com/onex-blockchain/onex/internal/ledger"
)

func checkStatus(ok bool) string {
	if ok {
		return "green"
	}
	return "red"
}

func checkStatusSoft(ok bool) string {
	if ok {
		return "green"
	}
	return "amber"
}

func nodeOptional() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("ONEX_NODE_OPTIONAL")))
	return v == "1" || v == "true" || v == "on"
}

// GreenHealth returns a unified all-systems status for UI and ops.
func (b *Bridge) GreenHealth(ctx context.Context, evmHolder string) map[string]interface{} {
	// Production bootstrap runs in background from cmd/onex-bridge; do not block health here.

	ledgerSt := b.LedgerStatus()
	settle := b.SettlementCapabilities()

	nodeOK := false
	if b.node != nil {
		nodeOK = b.node.Ping() == nil
	}
	nodeCheckOK := nodeOK || (b.isProduction() && nodeOptional())

	ob := ledger.DefaultOnlineBankStore().Status()
	bankOK := false
	if ob != nil {
		if v, ok := ob["online"].(bool); ok && v {
			if n, ok := ob["accounts"].(int); ok && n > 0 {
				bankOK = true
			}
		}
	}
	if !bankOK {
		if v, ok := ledgerSt["bankReady"].(bool); ok {
			bankOK = v
		}
	}

	prodOK := b.isProduction()

	importOK := true
	if v, ok := ledgerSt["importActive"].(bool); ok {
		importOK = v
	}

	dbisOK := false
	if dbisRPC := strings.TrimSpace(os.Getenv("DBIS138_RPC_URL")); dbisRPC != "" {
		dbisOK = true
	} else {
		for _, c := range b.registry().GetChains() {
			if c.RPC != "" && (c.ID == "dbis-138" || c.Type == "evm") {
				dbisOK = true
				break
			}
		}
	}

	evmSender := chains.LoadBridgeSenderKeySilent()
	eth := chains.ProbeEthereumRPC(ctx)
	evmSenderFunded := evmSender && ethBalancePositive(eth.SenderBalance)
	masterCanSign := eth.MasterKeySet && ethBalancePositive(eth.MasterBalance)
	hybxOnline := false
	if ledger.LoadHybrixConfig().Enabled {
		hybxCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		done := make(chan bool, 1)
		go func() {
			_, err := ledger.NewHybrixClient().ListAssets()
			done <- err == nil
		}()
		select {
		case hybxOnline = <-done:
		case <-hybxCtx.Done():
			hybxOnline = false
		}
		cancel()
	}
	evmOK := evmSenderFunded || masterCanSign || hybxOnline
	evmStatus := checkStatusSoft(evmSenderFunded || masterCanSign)
	if !evmSenderFunded && !masterCanSign && hybxOnline {
		evmStatus = "amber"
	} else if !evmSenderFunded && !masterCanSign && evmSender {
		evmStatus = "amber"
	}
	evmDetail := "HYBX chain settlement"
	if masterCanSign && eth.MasterWallet != "" {
		evmDetail = "master " + eth.MasterWallet + " · " + eth.MasterBalance + " ETH"
	} else if evmSender {
		if addr, err := chains.BridgeSenderAddress(); err == nil {
			evmDetail = "sender " + addr
		} else {
			evmDetail = "EVM sender key set"
		}
		if eth.Configured && eth.Online {
			evmDetail += " · block " + itoa(int(eth.BlockNumber))
		}
		if !evmSenderFunded {
			if eth.SenderBalance != "" {
				evmDetail += " · " + eth.SenderBalance + " ETH (needs gas)"
			} else {
				evmDetail += " · fund sender or set ONEX_ETHEREUM_MASTER_KEY"
			}
		}
	} else if !hybxOnline {
		evmDetail = "set ONEX_ETHEREUM_MASTER_KEY or fund EVM sender"
	}

	snap, _ := b.ReadRealLedger(ctx, "all", evmHolder, b.LoadLatestImport())
	ledgerHasValue := snap.TotalUSD > 0 || len(snap.Entries) > 0
	if !ledgerHasValue && ob != nil {
		if n, ok := ob["accounts"].(int); ok && n > 0 {
			ledgerHasValue = true
		}
	}

	hybxEnabled := ledger.LoadHybrixConfig().Enabled
	hybxMW := hybxEnabled && hybxOnline

	fineractOK := false
	fineractDetail := "not configured"
	if fx := ledger.NewFineractClient().Status(); fx != nil {
		if v, ok := fx["enabled"].(bool); ok && v {
			fineractOK = true
			fineractDetail = "configured"
			if on, ok := fx["online"].(bool); ok && on {
				fineractDetail = "online"
			} else if b.isProduction() {
				fineractDetail = "configured · production"
			}
		}
	}

	cardsOK := false
	cardsDetail := "no cards"
	if vc := b.VirtualCardsStatus(); vc != nil {
		if n, ok := vc["active"].(int); ok && n > 0 {
			cardsOK = true
			hybxN, _ := vc["hybxCards"].(int)
			cardsDetail = itoa(n) + " active"
			if hybxN > 0 {
				cardsDetail += " · " + itoa(hybxN) + " HYBX"
			}
		}
	}

	platformOK := false
	platformDetail := "token platform"
	if ps, err := b.PlatformStatus(); err == nil {
		if ps.TotalTokens > 0 {
			platformOK = true
			platformDetail = itoa(ps.TotalTokens) + " tokens"
		} else if b.isProduction() {
			platformOK = true
			platformDetail = "ready"
		}
	}

	settleProd, _ := settle["production"].(bool)
	settleEvm, _ := settle["evmSettlement"].(bool)
	settleFunded, _ := settle["evmSenderFunded"].(bool)
	settleFunded = settleFunded || masterCanSign
	settleReady := settleProd && bankOK && (settleFunded || hybxOnline)
	settleStatus := checkStatusSoft(settleReady)
	if settleReady && !settleFunded {
		settleStatus = "amber"
	}
	settleDetail := "convert → settle → HYBX"
	if !settleProd {
		settleDetail = "development mode"
	} else if !settleEvm && !hybxOnline {
		settleDetail = "configure EVM sender or HYBX"
	}

	ethDetail := "QuickNode RPC"
	if eth.Configured {
		if eth.Online {
			ethDetail = "block " + itoa(int(eth.BlockNumber))
			if eth.SenderWallet != "" {
				ethDetail += " · sender " + eth.SenderBalance + " ETH"
			}
		} else if eth.Error != "" {
			ethDetail = eth.Error
		} else {
			ethDetail = "RPC unreachable"
		}
	} else {
		ethDetail = "set ONEX_ETHEREUM_RPC"
	}

	checks := []map[string]interface{}{
		{"id": "bridge", "label": "Bridge API", "status": "green", "ok": true, "detail": "online"},
		{"id": "ledger", "label": "Ledger middleware", "status": checkStatusSoft(prodOK || ledgerHasValue), "ok": prodOK || ledgerHasValue, "detail": map[bool]string{true: "production mode", false: "development mode"}[prodOK]},
		{"id": "bank", "label": "Bank / fiat ledger", "status": checkStatus(bankOK), "ok": bankOK, "detail": "NSB online bank"},
		{"id": "import", "label": "Active import", "status": checkStatus(importOK), "ok": importOK, "detail": "real valuation import"},
		{"id": "settlement", "label": "Settlement", "status": settleStatus, "ok": settleReady, "detail": settleDetail},
		{"id": "ethereum", "label": "Ethereum mainnet", "status": checkStatusSoft(eth.Configured && eth.Online), "ok": eth.Configured && eth.Online, "detail": ethDetail},
		{"id": "dbis138", "label": "DBIS chain 138", "status": checkStatus(dbisOK), "ok": dbisOK, "detail": "EVM chains configured"},
		{"id": "node", "label": "OneX node", "status": checkStatusSoft(nodeCheckOK), "ok": nodeCheckOK, "detail": map[bool]string{true: "online", false: "optional offline"}[nodeOK]},
		{"id": "evm", "label": "EVM settlement", "status": evmStatus, "ok": evmOK, "detail": evmDetail},
		{"id": "value", "label": "Real valuation", "status": checkStatusSoft(ledgerHasValue), "ok": ledgerHasValue, "detail": "ledger + bank valued"},
		{"id": "hybx", "label": "HYBX bridge", "status": checkStatusSoft(hybxOnline), "ok": hybxOnline, "detail": "api.hybrix.io live"},
		{"id": "hybx-mw", "label": "HYBX exchange middleware", "status": checkStatusSoft(hybxMW), "ok": hybxMW, "detail": "banks · chains · platform"},
		{"id": "fineract", "label": "Fineract core bank", "status": checkStatusSoft(fineractOK), "ok": fineractOK, "detail": fineractDetail},
		{"id": "cards", "label": "Virtual cards", "status": checkStatusSoft(cardsOK), "ok": cardsOK, "detail": cardsDetail},
		{"id": "platform", "label": "Token platform", "status": checkStatusSoft(platformOK), "ok": platformOK, "detail": platformDetail},
	}

	bridge7OK := false
	bridge7Detail := "disabled"
	if b7 := ledger.Bridge7Status(); b7 != nil {
		if v, ok := b7["enabled"].(bool); ok && v {
			if n, ok := b7["entries"].(int); ok && n > 0 {
				bridge7OK = true
				bridge7Detail = itoa(n) + " entries · 3 ledgers"
			} else {
				bridge7Detail = "configured"
				bridge7OK = b.isProduction()
			}
		}
	}
	checks = append(checks, map[string]interface{}{
		"id": "bridge7", "label": "Bridge7 ledgers", "status": checkStatusSoft(bridge7OK),
		"ok": bridge7OK, "detail": bridge7Detail,
	})

	cashOK := false
	cashDetail := "disabled"
	if ledger.CashCodeEnabled() {
		cc := b.CashCodeStatus()
		if cc != nil {
			cashOK = true
			if active, ok := cc["active"].(int); ok {
				cashDetail = itoa(active) + " active codes"
			} else {
				cashDetail = "escrow ready"
			}
		}
	}
	checks = append(checks, map[string]interface{}{
		"id": "cashcode", "label": "Cash codes", "status": checkStatusSoft(cashOK || !ledger.CashCodeEnabled()),
		"ok": cashOK || !ledger.CashCodeEnabled(), "detail": cashDetail,
	})

	allGreen := true
	for _, c := range checks {
		if st, _ := c["status"].(string); st == "red" {
			allGreen = false
			break
		}
	}

	overall := "green"
	if !allGreen {
		overall = "amber"
	}

	return map[string]interface{}{
		"service":    "onex-green-health",
		"status":     overall,
		"allGreen":   allGreen,
		"production": prodOK,
		"checks":     checks,
		"ledgerUsd":  snap.TotalUSD,
		"settlement": settle,
		"ledger":     ledgerSt,
		"ethereum": map[string]interface{}{
			"configured":     eth.Configured,
			"online":         eth.Online,
			"blockNumber":    eth.BlockNumber,
			"senderWallet":   eth.SenderWallet,
			"senderBalance":  eth.SenderBalance,
			"senderFunded":   evmSenderFunded,
			"masterWallet":   eth.MasterWallet,
			"masterBalance":  eth.MasterBalance,
		},
	}
}

func ethBalancePositive(raw string) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "0" {
		return false
	}
	f, err := strconv.ParseFloat(raw, 64)
	return err == nil && f > 0.00001
}
