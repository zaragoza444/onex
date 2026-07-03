package chains

import "testing"

func TestLoadEthereumMasterWallet(t *testing.T) {
	t.Setenv("ONEX_ETHEREUM_MASTER_WALLET", "0x587374d7d33e3e235d6a485Edc3EF83E603aeDC1")
	got := LoadEthereumMasterWallet()
	want := "0x587374d7d33e3e235d6a485Edc3EF83E603aeDC1"
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestMaskRPCURL(t *testing.T) {
	raw := "https://side-rough-telescope.ethereum-mainnet.quiknode.pro/b36288d4817e418d1d30c2f69ee917d1c829de34"
	masked := MaskRPCURL(raw)
	if masked == raw {
		t.Fatal("expected masked rpc url")
	}
	if !contains(masked, "quiknode.pro") {
		t.Fatalf("unexpected mask %s", masked)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestResolveChainRPC(t *testing.T) {
	t.Setenv("ONEX_ETHEREUM_RPC", "https://example.quiknode.pro/token")
	got := ResolveChainRPC("ethereum", "https://eth.llamarpc.com")
	if got != "https://example.quiknode.pro/token" {
		t.Fatalf("got %s", got)
	}
}
