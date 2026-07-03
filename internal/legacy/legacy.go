package legacy

import (
	"log"
	"os"
	"path/filepath"
	"strings"
)

const legacyHome = ".shiva"
const currentHome = ".onex"

// HomeDir returns the OneX user data directory (~/.onex).
func HomeDir() string {
	if v := strings.TrimSpace(os.Getenv("ONEX_HOME_DIR")); v != "" {
		return v
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".onex"
	}
	return filepath.Join(home, currentHome)
}

// EnsureHomeMigrated copies ~/.shiva to ~/.onex when the new directory is missing.
func EnsureHomeMigrated() {
	// If we use an explicit home dir (Docker/Render), migration is not needed.
	if v := strings.TrimSpace(os.Getenv("ONEX_HOME_DIR")); v != "" {
		return
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	newPath := filepath.Join(home, currentHome)
	if _, err := os.Stat(newPath); err == nil {
		return
	}
	oldPath := filepath.Join(home, legacyHome)
	if _, err := os.Stat(oldPath); os.IsNotExist(err) {
		return
	}
	if err := copyTree(oldPath, newPath); err != nil {
		log.Printf("onex: migrate %s -> %s: %v", oldPath, newPath, err)
		return
	}
	log.Printf("onex: migrated data from %s to %s", oldPath, newPath)
}

func copyTree(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		data = []byte(RewriteText(string(data)))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode())
	})
}

// RewriteText replaces legacy Shiva / shiva-blockchain identifiers with OneX equivalents.
func RewriteText(s string) string {
	replacements := []struct{ old, new string }{
		{"Shiva Blockchain", "OneX Blockchain"},
		{"shiva blockchain", "OneX blockchain"},
		{"shiva-blockchain", "onex-blockchain"},
		{"Shiva-Blockchain", "OneX-Blockchain"},
		{"shiva-mainnet-1", "onex-mainnet-1"},
		{"shiva-testnet-1", "onex-testnet-1"},
		{".shiva", ".onex"},
		{"shiva-wallet", "onex-wallet"},
		{"shiva-bridge", "onex-bridge"},
		{"shiva-ai", "onex-ai"},
		{"shivad", "onexd"},
		{"tSHIVA", "tONEX"},
		{"sSHIVA", "sONEX"},
		{"wSHIVA", "wONEX"},
		{"SHIVA", "ONEX"},
	}
	for _, r := range replacements {
		s = strings.ReplaceAll(s, r.old, r.new)
	}
	return s
}

// NormalizeChainID maps legacy chain IDs to current names.
func NormalizeChainID(id string) string {
	switch id {
	case "shiva-mainnet-1":
		return "onex-mainnet-1"
	case "shiva-testnet-1":
		return "onex-testnet-1"
	default:
		return id
	}
}

// NormalizeToken maps legacy token IDs to current names on the given chain.
func NormalizeToken(chainID, tokenID string) (string, string) {
	chainID = NormalizeChainID(chainID)
	switch tokenID {
	case "SHIVA", "tSHIVA":
		return chainID, "ONEX"
	case "wSHIVA":
		return chainID, "wONEX"
	case "sSHIVA":
		return chainID, "sONEX"
	default:
		return chainID, tokenID
	}
}

// NormalizeTokenKey rewrites legacy portfolio balance keys.
func NormalizeTokenKey(key string) string {
	parts := strings.SplitN(key, ":", 2)
	if len(parts) != 2 {
		return RewriteText(key)
	}
	chain, token := NormalizeToken(parts[0], parts[1])
	return chain + ":" + token
}

// NormalizeRPCMethod maps legacy JSON-RPC method names.
func NormalizeRPCMethod(method string) string {
	if strings.HasPrefix(method, "shiva_") {
		return "onex_" + strings.TrimPrefix(method, "shiva_")
	}
	return method
}

// EnvOrLegacy returns the OneX env var or the legacy SHIVA equivalent.
func EnvOrLegacy(onexKey, shivaKey string) string {
	if v := strings.TrimSpace(os.Getenv(onexKey)); v != "" {
		return v
	}
	return strings.TrimSpace(os.Getenv(shivaKey))
}
