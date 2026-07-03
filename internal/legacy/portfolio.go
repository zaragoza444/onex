package legacy

import "strconv"

// MigrateBalanceKeys rewrites legacy token keys in a balance map.
func MigrateBalanceKeys(balances map[string]string) bool {
	if len(balances) == 0 {
		return false
	}
	changed := false
	for key, val := range balances {
		nk := NormalizeTokenKey(key)
		if nk == key {
			continue
		}
		if existing, ok := balances[nk]; ok && existing != "" {
			balances[nk] = mergeAtomic(existing, val)
		} else {
			balances[nk] = val
		}
		delete(balances, key)
		changed = true
	}
	return changed
}

func mergeAtomic(a, b string) string {
	x, _ := strconv.ParseUint(a, 10, 64)
	y, _ := strconv.ParseUint(b, 10, 64)
	return strconv.FormatUint(x+y, 10)
}
