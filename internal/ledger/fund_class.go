package ledger

import "strings"

// Money-supply / bank fund classes for fiat ledger conversion.
const (
	FundM0   = "m0"
	FundM1   = "m1"
	FundM2   = "m2"
	FundM3   = "m3"
	FundM4   = "m4"
	FundMINT = "mint"
	FundNSB  = "nsb"
)

// AggregateFundClasses are monetary tiers used by fiat settlement middleware.
func AggregateFundClasses() []string {
	return []string{FundM1, FundM2, FundM3, FundM4, FundMINT}
}

// NormalizeFundClass maps aliases to m0–m4, mint, or nsb.
func NormalizeFundClass(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "m0", "mb", "base", "narrow", "cash", "physical", "central":
		return FundM0
	case "m1", "broad", "demand", "checking", "transactional":
		return FundM1
	case "m2", "near_money", "nearmoney", "savings", "retail_savings":
		return FundM2
	case "m3", "institutional", "wholesale", "time_deposits":
		return FundM3
	case "m4", "market", "repo", "commercial_paper", "money_market":
		return FundM4
	case "mint", "stablecoin", "stable", "mainnet_mint", "mainnet":
		return FundMINT
	case "nsb", "national_sovereign_bank", "nationalsovereignbank", "sovereign_bank", "sovereign",
		"national_savings", "nationalsavings", "savings_bank":
		return FundNSB
	}
	if strings.Contains(s, "nsb") || strings.Contains(s, "national sovereign") ||
		strings.Contains(s, "sovereign bank") || strings.Contains(s, "national savings") {
		return FundNSB
	}
	if strings.Contains(s, "m2") {
		return FundM2
	}
	if strings.Contains(s, "m3") {
		return FundM3
	}
	if strings.Contains(s, "m4") {
		return FundM4
	}
	return s
}

func isFundClassSource(src string) bool {
	switch NormalizeFundClass(src) {
	case FundM0, FundM1, FundM2, FundM3, FundM4, FundMINT, FundNSB:
		return true
	}
	return false
}

// RouteFiatToPoolFundClass maps a source fund class to an aggregate pool tier (M1–M4, MINT).
func RouteFiatToPoolFundClass(source string) string {
	switch NormalizeFundClass(source) {
	case FundM1:
		return FundM1
	case FundM2:
		return FundM2
	case FundM3:
		return FundM3
	case FundM4:
		return FundM4
	case FundMINT, FundNSB:
		return FundMINT
	case FundM0:
		return FundM1
	default:
		return FundM1
	}
}

func poolAccountID(fc string) string {
	return "pool:" + NormalizeFundClass(fc)
}

func mintVaultID(chain, symbol string) string {
	chain = strings.ToLower(strings.TrimSpace(chain))
	if chain == "" {
		chain = "ethereum"
	}
	symbol = strings.ToUpper(strings.TrimSpace(symbol))
	if symbol == "" {
		symbol = "ONEXUSD"
	}
	return "mint:" + chain + ":" + symbol
}

func filterEntriesByFundClass(entries []Entry, fc string) []Entry {
	want := NormalizeFundClass(fc)
	if want == "" {
		return entries
	}
	out := make([]Entry, 0, len(entries))
	for _, e := range entries {
		if strings.EqualFold(e.FundClass, want) {
			out = append(out, e)
		}
	}
	return out
}

func resolveBankFundClass(acct BankAccount, id string) string {
	for _, raw := range []string{acct.FundClass, acct.MoneySupply, acct.Bank, acct.Type, id} {
		if fc := NormalizeFundClass(raw); isFundClassSource(raw) || fc == FundM0 || fc == FundM1 ||
			fc == FundM2 || fc == FundM3 || fc == FundM4 || fc == FundMINT || fc == FundNSB {
			return fc
		}
	}
	lower := strings.ToLower(id)
	switch {
	case strings.HasPrefix(lower, "m0-"), strings.Contains(lower, ":m0"), strings.Contains(lower, "_m0"):
		return FundM0
	case strings.HasPrefix(lower, "m1-"), strings.Contains(lower, ":m1"), strings.Contains(lower, "_m1"):
		return FundM1
	case strings.HasPrefix(lower, "m2-"), strings.Contains(lower, ":m2"), strings.Contains(lower, "_m2"):
		return FundM2
	case strings.HasPrefix(lower, "m3-"), strings.Contains(lower, ":m3"), strings.Contains(lower, "_m3"):
		return FundM3
	case strings.HasPrefix(lower, "m4-"), strings.Contains(lower, ":m4"), strings.Contains(lower, "_m4"):
		return FundM4
	case strings.HasPrefix(lower, "mint-"), strings.Contains(lower, ":mint"), strings.Contains(lower, "_mint"):
		return FundMINT
	case strings.HasPrefix(lower, "nsb-"), strings.Contains(lower, "nsb"):
		return FundNSB
	}
	if strings.EqualFold(acct.Bank, "nsb") ||
		strings.Contains(strings.ToLower(acct.Name), "nsb") ||
		strings.Contains(strings.ToLower(acct.Name), "sovereign") {
		return FundNSB
	}
	return ""
}
