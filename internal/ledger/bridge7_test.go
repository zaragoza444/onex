package ledger

import (
	"os"
	"path/filepath"
	"testing"
)

func bridge7TestRoot(t *testing.T) string {
	t.Helper()
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	return root
}

func bridge7CIPathsFile(t *testing.T) string {
	t.Helper()
	p := filepath.Join(bridge7TestRoot(t), "configs", "bridge7.ci.paths.json")
	if _, err := os.Stat(p); err != nil {
		t.Skip("bridge7 CI paths file missing:", p)
	}
	return p
}

func TestParseBridge7Ledgers(t *testing.T) {
	root := filepath.Join("..", "..", "configs")
	local := filepath.Join(root, "local-ledger-2026.example.json")
	pro := filepath.Join(root, "ledger-pro.example.json")
	crypto := filepath.Join(root, "crypto-ledger.example.json")

	for _, p := range []string{local, pro, crypto} {
		if _, err := os.Stat(p); err != nil {
			t.Skip("example config missing:", p)
		}
	}

	localData, _ := os.ReadFile(local)
	rows, err := ParseLocalLedger2026(localData)
	if err != nil || len(rows) < 2 {
		t.Fatalf("local-ledger-2026: %v (%d rows)", err, len(rows))
	}

	proData, _ := os.ReadFile(pro)
	rows, err = ParseLedgerPro(proData)
	if err != nil || len(rows) < 2 {
		t.Fatalf("ledger-pro: %v (%d rows)", err, len(rows))
	}

	cryptoData, _ := os.ReadFile(crypto)
	rows, err = ParseCryptoLedger(cryptoData)
	if err != nil || len(rows) < 2 {
		t.Fatalf("crypto-ledger: %v (%d rows)", err, len(rows))
	}
}

func TestLoadBridge7Entries(t *testing.T) {
	root := bridge7TestRoot(t)
	pathsFile := bridge7CIPathsFile(t)
	os.Setenv("ONEX_BRIDGE7_ENABLED", "1")
	os.Setenv("ONEX_PROJECT_ROOT", root)
	os.Setenv("ONEX_BRIDGE7_PATHS_FILE", pathsFile)
	os.Unsetenv("ONEX_LOCAL_LEDGER_2026_FILE")
	os.Unsetenv("ONEX_LEDGER_PRO_FILE")
	os.Unsetenv("ONEX_CRYPTO_LEDGER_FILE")
	t.Cleanup(func() {
		os.Unsetenv("ONEX_BRIDGE7_ENABLED")
		os.Unsetenv("ONEX_PROJECT_ROOT")
		os.Unsetenv("ONEX_BRIDGE7_PATHS_FILE")
		os.Unsetenv("ONEX_LOCAL_LEDGER_2026_FILE")
		os.Unsetenv("ONEX_LEDGER_PRO_FILE")
		os.Unsetenv("ONEX_CRYPTO_LEDGER_FILE")
	})
	entries, err := LoadBridge7Entries()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) < 5 {
		t.Fatalf("expected merged entries, got %d", len(entries))
	}
}

func TestLoadBridge7ConfigFromPathsFile(t *testing.T) {
	pathsFile := bridge7CIPathsFile(t)
	os.Setenv("ONEX_BRIDGE7_PATHS_FILE", pathsFile)
	os.Unsetenv("ONEX_LOCAL_LEDGER_2026_FILE")
	os.Unsetenv("ONEX_LEDGER_PRO_FILE")
	os.Unsetenv("ONEX_CRYPTO_LEDGER_FILE")
	os.Unsetenv("ONEX_PROJECT_ROOT")
	t.Cleanup(func() {
		os.Unsetenv("ONEX_BRIDGE7_PATHS_FILE")
	})
	cfg := LoadBridge7Config()
	if !cfg.Enabled {
		t.Fatal("expected enabled from paths file")
	}
	for _, p := range []string{cfg.LocalLedger2026, cfg.LedgerPro, cfg.CryptoLedger} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("resolved path missing %q: %v", p, err)
		}
	}
}
