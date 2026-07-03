package legacy

import "testing"

func TestNormalizeTokenKey(t *testing.T) {
	got := NormalizeTokenKey("shiva-mainnet-1:SHIVA")
	want := "onex-mainnet-1:ONEX"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestNormalizeRPCMethod(t *testing.T) {
	if got := NormalizeRPCMethod("shiva_getBalance"); got != "onex_getBalance" {
		t.Fatalf("got %q", got)
	}
}

func TestRewriteTextBranding(t *testing.T) {
	if got := RewriteText("Shiva Blockchain repo at shiva-blockchain/"); got != "OneX Blockchain repo at onex-blockchain/" {
		t.Fatalf("got %q", got)
	}
}

func TestMigrateBalanceKeys(t *testing.T) {
	bal := map[string]string{
		"shiva-mainnet-1:SHIVA": "100",
		"ethereum:ETH":          "50",
	}
	if !MigrateBalanceKeys(bal) {
		t.Fatal("expected migration")
	}
	if bal["onex-mainnet-1:ONEX"] != "100" {
		t.Fatalf("balance: %v", bal)
	}
	if _, ok := bal["shiva-mainnet-1:SHIVA"]; ok {
		t.Fatal("legacy key remains")
	}
}
