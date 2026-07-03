package ledger

import "testing"

func TestNormalizeFundClassM2M3M4Mint(t *testing.T) {
	cases := map[string]string{
		"m2": FundM2, "savings": FundM2,
		"m3": FundM3, "wholesale": FundM3,
		"m4": FundM4, "money_market": FundM4,
		"mint": FundMINT, "stablecoin": FundMINT,
	}
	for raw, want := range cases {
		if got := NormalizeFundClass(raw); got != want {
			t.Fatalf("%q => %q want %q", raw, got, want)
		}
	}
}

func TestRouteFiatToPoolFundClass(t *testing.T) {
	if RouteFiatToPoolFundClass(FundM0) != FundM1 {
		t.Fatal("m0 should route to m1")
	}
	if RouteFiatToPoolFundClass(FundNSB) != FundMINT {
		t.Fatal("nsb should route to mint")
	}
	if RouteFiatToPoolFundClass(FundM3) != FundM3 {
		t.Fatal("m3 should stay m3")
	}
}

func TestFiatSettlementMiddlewarePreview(t *testing.T) {
	dir := t.TempDir()
	store := NewBookStore(dir)
	store.data = &Book{Accounts: map[string]*BookAccount{
		"m1-usd": {ID: "m1-usd", Asset: "USD", Balance: "1000", FundClass: FundM1, Source: SourceBank, Mode: ModeBank},
		"m0-eur": {ID: "m0-eur", Asset: "EUR", Balance: "500", FundClass: FundM0, Source: SourceBank, Mode: ModeBank},
		"nsb-gbp": {ID: "nsb-gbp", Asset: "GBP", Balance: "200", FundClass: FundNSB, Source: SourceBank, Mode: ModeBank},
	}}
	_ = store.save()

	prices := map[string]PriceQuote{"ETH": {USD: 3000}, "USDC": {USD: 1}}
	res, err := store.RunFiatSettlementMiddleware(
		FiatSettlementMiddlewareRequest{Preview: true},
		DefaultFiatSettlementMiddlewareConfig(),
		prices,
		nil,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Preview || res.Status != "preview" {
		t.Fatalf("expected preview status got %s preview=%v", res.Status, res.Preview)
	}
	if len(res.Conversions) != 3 {
		t.Fatalf("expected 3 conversions got %d", len(res.Conversions))
	}
	if res.TotalFiatUSD <= 0 {
		t.Fatalf("expected positive total USD got %f", res.TotalFiatUSD)
	}
	if res.USDCAmount == "" || res.ETHAmount == "" {
		t.Fatalf("missing usdc/eth amounts usdc=%s eth=%s", res.USDCAmount, res.ETHAmount)
	}
	if res.MintVault != "mint:ethereum:ONEXUSD" {
		t.Fatalf("unexpected mint vault %s", res.MintVault)
	}
}

func TestFiatSettlementMiddlewareActive(t *testing.T) {
	dir := t.TempDir()
	store := NewBookStore(dir)
	store.data = &Book{Accounts: map[string]*BookAccount{
		"m1-usd": {ID: "m1-usd", Asset: "USD", Balance: "1000", FundClass: FundM1, Source: SourceBank, Mode: ModeBank},
	}}
	_ = store.save()

	prices := map[string]PriceQuote{"ETH": {USD: 3000}, "USDC": {USD: 1}}
	res, err := store.RunFiatSettlementMiddleware(
		FiatSettlementMiddlewareRequest{Preview: false, EthLoadPercent: 2},
		DefaultFiatSettlementMiddlewareConfig(),
		prices,
		nil,
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "completed" {
		t.Fatalf("expected completed got %s", res.Status)
	}
	m1, err := store.GetAccount("m1-usd")
	if err != nil {
		t.Fatal(err)
	}
	if parseHuman(m1.Balance) != 0 {
		t.Fatalf("m1-usd should be drained got %s", m1.Balance)
	}
	mint, err := store.GetAccount("mint:ethereum:ONEXUSD")
	if err != nil {
		t.Fatal(err)
	}
	if parseHuman(mint.Balance) <= 0 {
		t.Fatalf("mint vault should be credited got %s", mint.Balance)
	}
}
