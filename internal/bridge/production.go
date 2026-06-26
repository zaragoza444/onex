package bridge

import (
	"context"
	"os"
	"strings"

	"github.com/onex-blockchain/onex/internal/ledger"
)

// ProductionPlatformStatus is the unified production bridge (ledger + token platform + node).
func (b *Bridge) ProductionPlatformStatus(ctx context.Context, evmHolder string) map[string]interface{} {
	ledgerStatus := b.LedgerStatus()
	platform, _ := b.PlatformStatus()

	var snap ledger.Snapshot
	if s, err := b.ReadRealLedger(ctx, "all", evmHolder, b.LoadLatestImport()); err == nil {
		snap = s
	}

	nodeOK := b.node != nil
	if b.node != nil {
		nodeOK = b.node.Ping() == nil
	}

	onlineBank := ledger.DefaultOnlineBankStore().Status()
	hybx := ledger.NewHybrixClient().Status()
	hybxMW := ledger.HybxMiddlewareStatus()
	fineract := ledger.NewFineractClient().Status()
	virtualCards := b.VirtualCardsStatus()
	bridge7 := ledger.Bridge7Status()

	domain := strings.TrimSpace(os.Getenv("ONEX_PRODUCTION_DOMAIN"))
	if domain == "" {
		domain = "onexproduction.com"
	}
	publicHost := strings.TrimSpace(os.Getenv("ONEX_PUBLIC_HOST"))
	publicWallet := "https://" + domain + "/wallet/"
	greenHealth := "https://" + domain + "/bridge/health/green"
	if publicHost != "" {
		publicWallet = "http://" + publicHost + ":9338/wallet/"
		greenHealth = "http://" + publicHost + ":9338/bridge/health/green"
	}

	mode := strings.TrimSpace(b.ledgerConfig().Mode)
	if mode == "" {
		mode = "demo"
	}
	if b.isProduction() {
		mode = "production"
	}

	return map[string]interface{}{
		"service":        "onex-production-platform",
		"mode":           mode,
		"production":     b.isProduction(),
		"domain":         domain,
		"nodeReady":      nodeOK,
		"ledger":         ledgerStatus,
		"ledgerTotalUsd": snap.TotalUSD,
		"ledgerEntries":  len(snap.Entries),
		"platform":       platform,
		"onlineBank":     onlineBank,
		"hybx":           hybx,
		"hybxMiddleware": hybxMW,
		"fineract":       fineract,
		"virtualCards":   virtualCards,
		"bridge7":        bridge7,
		"urls": map[string]string{
			"wallet":      "/wallet/",
			"ledger":      "/wallet/#ledger",
			"platform":    "/wallet/#discover",
			"onlineBank":  "/wallet/#onlinebank",
			"fineract":    "https://fineract.hybxfinance.com/fineract-provider/swagger-ui/index.html",
			"tokenLab":    "/bridge/platform/tokens",
			"status":      "/bridge/production/status",
			"greenHealth": "/bridge/health/green",
		},
		"public": map[string]string{
			"host":   publicHost,
			"wallet": publicWallet,
			"ledger": strings.TrimSuffix(publicWallet, "/") + "/#ledger",
			"green":  greenHealth,
			"status": "https://" + domain + "/bridge/production/status",
		},
		"api": map[string]string{
			"status":       "/bridge/production/status",
			"connect":      "/bridge/production/connect",
			"green":        "/bridge/health/green",
			"ledger":       "/bridge/ledger/real",
			"platform":     "/bridge/platform/status",
			"portfolio":    "/bridge/portfolio",
			"transfer":     "/bridge/ledger/transfer",
			"onlineBank":   "/bridge/bank/status",
			"swift":        "/bridge/bank/swift/status",
			"swiftRelease": "/bridge/bank/swift/release",
			"hybx":         "/bridge/bank/hybx/status",
			"fineract":     "/bridge/bank/fineract/status",
			"virtualCards": "/bridge/cards/status",
			"hybxCards":    "/bridge/cards/hybx",
			"cardsIssue":   "/bridge/cards/issue",
			"hybxIssue":    "/bridge/bank/hybx/cards/issue",
			"hybxExchange": "/bridge/bank/hybx/exchange",
			"hybxMiddleware": "/bridge/bank/hybx/middleware/status",
			"bootstrap":      "/bridge/production/bootstrap",
			"bridge7":        "/bridge/bridge7/status",
			"bridge7Sync":    "/bridge/bridge7/sync",
		},
	}
}
