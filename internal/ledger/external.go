package ledger

import (
	"fmt"
	"regexp"
	"strings"
)

// ExternalKind classifies an outbound transfer destination.
type ExternalKind string

const (
	ExternalOneX    ExternalKind = "onex"
	ExternalEVM     ExternalKind = "evm"
	ExternalSolana  ExternalKind = "solana"
	ExternalBitcoin ExternalKind = "bitcoin"
	ExternalTron    ExternalKind = "tron"
	ExternalBank    ExternalKind = "bank"
)

// BankRail is the settlement rail for external bank transfers.
type BankRail string

const (
	RailACH   BankRail = "ach"
	RailSEPA  BankRail = "sepa"
	RailSWIFT BankRail = "swift"
	RailWire  BankRail = "wire"
	RailIBAN  BankRail = "iban"
	RailFPS   BankRail = "fps" // UK faster payments
)

// ExternalDestination is a parsed outbound bank or chain target.
type ExternalDestination struct {
	Kind     ExternalKind `json:"kind"`
	ChainID  string       `json:"chainId,omitempty"`
	BankRail BankRail     `json:"bankRail,omitempty"`
	BankName string       `json:"bankName,omitempty"`
	Address  string       `json:"address"`
	Label    string       `json:"label"`
	AccountID string      `json:"accountId"`
}

// SupportedChain is metadata for external chain transfers.
type SupportedChain struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Symbol  string `json:"symbol"`
	Type    string `json:"type"`
	Example string `json:"example"`
}

// SupportedBank is metadata for external bank transfers.
type SupportedBank struct {
	ID      string     `json:"id"`
	Name    string     `json:"name"`
	Country string     `json:"country"`
	Rails   []BankRail `json:"rails"`
	Example string     `json:"example"`
}

// SupportedExternals lists all outbound bank and chain destinations.
func SupportedExternals() map[string]interface{} {
	return map[string]interface{}{
		"chains": SupportedChains(),
		"banks":  SupportedBanks(),
		"formats": []string{
			"chain:<chainId>:<address>",
			"<chainId>:<address>",
			"bank:<rail>:<iban-or-account>",
			"bank:<bankName>:<rail>:<account>",
			"onex:<address>",
			"0x… (EVM default ethereum)",
			"bc1… / 1… / 3… (bitcoin)",
			"T… (tron)",
			"base58 (solana)",
		},
	}
}

func SupportedChains() []SupportedChain {
	return []SupportedChain{
		{ID: "onex-mainnet-1", Name: "OneX", Symbol: "ONEX", Type: "onex", Example: "onex:64charHexOneXAddress"},
		{ID: "ethereum", Name: "Ethereum", Symbol: "ETH", Type: "evm", Example: "chain:ethereum:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"},
		{ID: "bsc", Name: "BNB Chain", Symbol: "BNB", Type: "evm", Example: "bsc:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"},
		{ID: "polygon", Name: "Polygon", Symbol: "MATIC", Type: "evm", Example: "polygon:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"},
		{ID: "arbitrum", Name: "Arbitrum", Symbol: "ETH", Type: "evm", Example: "arbitrum:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"},
		{ID: "optimism", Name: "Optimism", Symbol: "ETH", Type: "evm", Example: "optimism:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"},
		{ID: "avalanche", Name: "Avalanche", Symbol: "AVAX", Type: "evm", Example: "avalanche:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"},
		{ID: "base", Name: "Base", Symbol: "ETH", Type: "evm", Example: "base:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"},
		{ID: "solana", Name: "Solana", Symbol: "SOL", Type: "solana", Example: "solana:7EqQdEUGJPsM4JJpLXKtTn9vWCsH6jSYv2cLw9dHrFq"},
		{ID: "bitcoin", Name: "Bitcoin", Symbol: "BTC", Type: "btc", Example: "bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh"},
		{ID: "tron", Name: "TRON", Symbol: "TRX", Type: "tron", Example: "tron:TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf"},
		{ID: "alltra", Name: "ALLTRA", Symbol: "ALL", Type: "evm", Example: "alltra:0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"},
	}
}

func SupportedBanks() []SupportedBank {
	return []SupportedBank{
		{ID: "chase", Name: "JPMorgan Chase", Country: "US", Rails: []BankRail{RailACH, RailWire}, Example: "bank:chase:ach:021000021:123456789"},
		{ID: "bofa", Name: "Bank of America", Country: "US", Rails: []BankRail{RailACH, RailWire}, Example: "bank:bofa:wire:026009593:987654321"},
		{ID: "wells", Name: "Wells Fargo", Country: "US", Rails: []BankRail{RailACH, RailWire}, Example: "bank:wells:ach:121000248:111222333"},
		{ID: "hsbc", Name: "HSBC", Country: "UK", Rails: []BankRail{RailSWIFT, RailFPS, RailIBAN}, Example: "bank:hsbc:swift:HBUKGB4B:GB82WEST12345698765432"},
		{ID: "barclays", Name: "Barclays", Country: "UK", Rails: []BankRail{RailFPS, RailIBAN, RailSWIFT}, Example: "bank:barclays:iban:GB29BARC20001512345678"},
		{ID: "deutsche", Name: "Deutsche Bank", Country: "DE", Rails: []BankRail{RailSEPA, RailSWIFT, RailIBAN}, Example: "bank:deutsche:sepa:DE89370400440532013000"},
		{ID: "bnp", Name: "BNP Paribas", Country: "FR", Rails: []BankRail{RailSEPA, RailIBAN, RailSWIFT}, Example: "bank:bnp:iban:FR1420041010050500013M02606"},
		{ID: "icici", Name: "ICICI Bank", Country: "IN", Rails: []BankRail{RailSWIFT, RailWire}, Example: "bank:icici:swift:ICICINBBXXX:123456789012"},
		{ID: "emirates", Name: "Emirates NBD", Country: "AE", Rails: []BankRail{RailSWIFT, RailWire}, Example: "bank:emirates:swift:EBILAEAD:AE070331234567890123456"},
		{ID: "nsb", Name: "NSB — National Sovereign Bank", Country: "*", Rails: []BankRail{RailACH, RailSEPA, RailSWIFT, RailWire, RailIBAN, RailFPS}, Example: "bank:nsb:swift:NSBKLAL2X:US00SOVEREIGN00000001"},
		{ID: "hybx", Name: "HYBX Multi-Ledger", Country: "*", Rails: []BankRail{RailIBAN, RailSEPA, RailSWIFT, RailWire}, Example: "bank:hybx:iban:HYBX-NSB-MIRROR"},
		{ID: "fineract", Name: "HYBX Fineract Core Banking", Country: "*", Rails: []BankRail{RailIBAN, RailSEPA, RailSWIFT, RailWire, RailACH}, Example: "bank:fineract:swift:HYBXFIN:000000001"},
		{ID: "generic", Name: "Any world bank", Country: "*", Rails: []BankRail{RailACH, RailSEPA, RailSWIFT, RailWire, RailIBAN, RailFPS}, Example: "bank:swift:CHASUS33:US00BANK00000000000001"},
	}
}

var (
	evmAddrRe   = regexp.MustCompile(`^0x[0-9a-fA-F]{40}$`)
	btcAddrRe   = regexp.MustCompile(`^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$`)
	tronAddrRe  = regexp.MustCompile(`^T[1-9A-HJ-NP-Za-km-z]{33}$`)
	solAddrRe   = regexp.MustCompile(`^[1-9A-HJ-NP-Za-km-z]{32,44}$`)
	ibanRe      = regexp.MustCompile(`^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$`)
)

var chainAliases = map[string]string{
	"onex": "onex-mainnet-1", "eth": "ethereum", "ethereum": "ethereum",
	"bsc": "bsc", "bnb": "bsc", "matic": "polygon", "polygon": "polygon",
	"arb": "arbitrum", "arbitrum": "arbitrum", "op": "optimism", "optimism": "optimism",
	"avax": "avalanche", "avalanche": "avalanche", "base": "base",
	"sol": "solana", "solana": "solana", "btc": "bitcoin", "bitcoin": "bitcoin",
	"trx": "tron", "tron": "tron", "all": "alltra", "alltra": "alltra",
	"chain": "", "evm": "ethereum", "crypto": "ethereum",
}

// ParseExternalDestination parses bank or chain external transfer targets.
func ParseExternalDestination(raw string) (*ExternalDestination, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("external destination required")
	}

	lower := strings.ToLower(raw)
	if strings.HasPrefix(lower, "bank:") {
		return parseBankExternal(raw)
	}
	if strings.HasPrefix(lower, "onex:") {
		addr := strings.TrimSpace(raw[5:])
		if len(addr) < 32 {
			return nil, fmt.Errorf("invalid onex address")
		}
		return &ExternalDestination{
			Kind: ExternalOneX, ChainID: "onex-mainnet-1", Address: addr,
			Label: "OneX " + shortAddr(addr), AccountID: externalAccountIDFromDest(ExternalOneX, "onex-mainnet-1", "", addr),
		}, nil
	}
	if strings.HasPrefix(lower, "chain:") {
		parts := strings.SplitN(raw, ":", 3)
		if len(parts) < 3 {
			return nil, fmt.Errorf("use chain:<chainId>:<address>")
		}
		return parseChainExternal(parts[1], parts[2])
	}

	// chainId:address (ethereum:0x..., solana:..., bitcoin:...)
	if strings.Contains(raw, ":") {
		parts := strings.SplitN(raw, ":", 2)
		chainKey := strings.ToLower(strings.TrimSpace(parts[0]))
		if id, ok := chainAliases[chainKey]; ok && id != "" {
			return parseChainExternal(id, parts[1])
		}
		if chainKey == "bank" {
			return parseBankExternal(raw)
		}
	}

	// bare addresses
	if evmAddrRe.MatchString(raw) {
		return parseChainExternal("ethereum", raw)
	}
	if btcAddrRe.MatchString(raw) {
		return parseChainExternal("bitcoin", raw)
	}
	if tronAddrRe.MatchString(raw) {
		return parseChainExternal("tron", raw)
	}
	if solAddrRe.MatchString(raw) && !strings.HasPrefix(lower, "0x") {
		return parseChainExternal("solana", raw)
	}
	if ibanRe.MatchString(strings.ToUpper(strings.ReplaceAll(raw, " ", ""))) {
		return parseBankExternal("bank:iban:" + strings.ToUpper(strings.ReplaceAll(raw, " ", "")))
	}

	return nil, fmt.Errorf("unrecognized external format: use chain:<id>:<addr> or bank:<rail>:<account>")
}

func parseChainExternal(chainID, address string) (*ExternalDestination, error) {
	chainID = strings.ToLower(strings.TrimSpace(chainID))
	if id, ok := chainAliases[chainID]; ok && id != "" {
		chainID = id
	}
	address = strings.TrimSpace(address)
	if address == "" {
		return nil, fmt.Errorf("chain address required")
	}

	var kind ExternalKind
	switch chainID {
	case "onex-mainnet-1", "onex-testnet-1":
		kind = ExternalOneX
	case "solana":
		kind = ExternalSolana
		if !solAddrRe.MatchString(address) {
			return nil, fmt.Errorf("invalid solana address")
		}
	case "bitcoin":
		kind = ExternalBitcoin
		if !btcAddrRe.MatchString(address) {
			return nil, fmt.Errorf("invalid bitcoin address")
		}
	case "tron":
		kind = ExternalTron
		if !tronAddrRe.MatchString(address) {
			return nil, fmt.Errorf("invalid tron address")
		}
	default:
		kind = ExternalEVM
		if !evmAddrRe.MatchString(address) {
			return nil, fmt.Errorf("invalid evm address for %s", chainID)
		}
		address = strings.ToLower(address)
	}

	for _, c := range SupportedChains() {
		if c.ID == chainID {
			return &ExternalDestination{
				Kind: kind, ChainID: chainID, Address: address,
				Label: c.Name + " " + shortAddr(address),
				AccountID: externalAccountIDFromDest(kind, chainID, "", address),
			}, nil
		}
	}
	return &ExternalDestination{
		Kind: kind, ChainID: chainID, Address: address,
		Label: chainID + " " + shortAddr(address),
		AccountID: externalAccountIDFromDest(kind, chainID, "", address),
	}, nil
}

func parseBankExternal(raw string) (*ExternalDestination, error) {
	parts := strings.Split(raw, ":")
	if len(parts) < 3 {
		return nil, fmt.Errorf("use bank:<rail>:<account> or bank:<name>:<rail>:<account>")
	}

	var bankName string
	var rail BankRail
	var account string

	switch {
	case len(parts) >= 4 && isBankRail(parts[2]):
		bankName = parts[1]
		rail = BankRail(strings.ToLower(parts[2]))
		account = strings.Join(parts[3:], ":")
	case isBankRail(parts[1]):
		rail = BankRail(strings.ToLower(parts[1]))
		account = strings.Join(parts[2:], ":")
	default:
		bankName = parts[1]
		rail = RailSWIFT
		account = strings.Join(parts[2:], ":")
	}

	account = strings.TrimSpace(account)
	if account == "" {
		return nil, fmt.Errorf("bank account required")
	}
	account = strings.ToUpper(strings.ReplaceAll(account, " ", ""))

	label := string(rail) + " " + shortAddr(account)
	if bankName != "" {
		label = bankName + " " + label
	}

	return &ExternalDestination{
		Kind: ExternalBank, BankRail: rail, BankName: bankName,
		Address: account, Label: label,
		AccountID: externalAccountIDFromDest(ExternalBank, "", string(rail), account),
	}, nil
}

func isBankRail(s string) bool {
	switch BankRail(strings.ToLower(strings.TrimSpace(s))) {
	case RailACH, RailSEPA, RailSWIFT, RailWire, RailIBAN, RailFPS:
		return true
	}
	return false
}

func externalAccountIDFromDest(kind ExternalKind, chainID, rail, address string) string {
	addr := strings.ToLower(strings.TrimSpace(address))
	switch kind {
	case ExternalOneX:
		return "external:onex:" + addr
	case ExternalBank:
		if rail != "" {
			return "external:bank:" + strings.ToLower(rail) + ":" + addr
		}
		return "external:bank:" + addr
	case ExternalSolana:
		return "external:chain:solana:" + addr
	case ExternalBitcoin:
		return "external:chain:bitcoin:" + addr
	case ExternalTron:
		return "external:chain:tron:" + addr
	default:
		cid := chainID
		if cid == "" {
			cid = "ethereum"
		}
		return "external:chain:" + cid + ":" + addr
	}
}

func shortAddr(s string) string {
	s = strings.TrimSpace(s)
	if len(s) <= 12 {
		return s
	}
	return s[:6] + "…" + s[len(s)-4:]
}

// ExternalTo replaces legacy externalAccountID using full parser.
func ExternalTo(raw, asset string) (string, *ExternalDestination, error) {
	dest, err := ParseExternalDestination(raw)
	if err != nil {
		// fallback legacy
		return externalAccountID(raw, asset), nil, nil
	}
	return dest.AccountID, dest, nil
}
