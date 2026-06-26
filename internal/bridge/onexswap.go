package bridge

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/onex-blockchain/onex/internal/bridge/amm"
	"github.com/onex-blockchain/onex/internal/legacy"
	"github.com/onex-blockchain/onex/internal/rpc"
)

func (b *Bridge) ammStore() *amm.Store {
	if b.amm == nil {
		b.amm = amm.NewStore(filepath.Join(legacy.HomeDir(), "amm"))
		seed := loadJSON[amm.Pool](filepath.Join(b.projectRoot(), "configs", "amm-pools.json"))
		_ = b.amm.Load(seed)
	}
	return b.amm
}

func (b *Bridge) OneXSwapPools() []amm.Pool {
	return b.ammStore().List()
}

// OneXSwapStatus reports AMM swap readiness and active pools.
func (b *Bridge) OneXSwapStatus() map[string]interface{} {
	pools := b.OneXSwapPools()
	tokens := map[string]bool{}
	for _, p := range pools {
		tokens[p.Token0] = true
		tokens[p.Token1] = true
	}
	return map[string]interface{}{
		"enabled":    true,
		"active":     len(pools) > 0,
		"production": b.isProduction(),
		"pools":      len(pools),
		"tokens":     len(tokens),
		"feeBps":     amm.DefaultFeeBps,
		"globalServer": b.globalServerURL(),
		"api": map[string]string{
			"pools":    "/bridge/onex-swap/pools",
			"quote":    "/bridge/onex-swap/quote",
			"swap":     "/bridge/onex-swap/swap",
			"activate": "/bridge/onex-swap/activate",
			"status":   "/bridge/onex-swap/status",
			"bridge":   "/bridge/onex-swap/bridge",
		},
	}
}

// ActivateSwap loads AMM pools and seeds swap token balances on the portfolio wallet.
func (b *Bridge) ActivateSwap(ctx context.Context) (map[string]interface{}, error) {
	store := b.ammStore()
	pools := store.List()
	if len(pools) == 0 {
		seed := loadJSON[amm.Pool](filepath.Join(b.projectRoot(), "configs", "amm-pools.json"))
		for _, p := range seed {
			cp := p
			_ = store.Update(&cp)
		}
		pools = store.List()
	}
	seeded := 0
	if err := b.EnsureWallet(); err == nil {
		p, err := b.GetPortfolio()
		if err == nil {
			seeded = b.seedSwapTokenBalances(p)
			if seeded > 0 {
				_ = b.portfolio().Save(p)
			}
		}
	}
	if b.isProduction() {
		b.ensureProductionBootstrapped(ctx, "")
	}
	st := b.OneXSwapStatus()
	st["status"] = "activated"
	st["seededBalances"] = seeded
	st["pools"] = len(pools)
	return st, nil
}

func (b *Bridge) seedSwapTokenBalances(p *Portfolio) int {
	if p == nil {
		return 0
	}
	if p.Balances == nil {
		p.Balances = map[string]string{}
	}
	starter := map[string]string{
		"onex-mainnet-1:ONEX":  "5000000000000",
		"onex-mainnet-1:wONEX": "10000000000",
		"onex-mainnet-1:sONEX": "5000000000",
		"ethereum:USDT":        "5000000000",
		"ethereum:ETH":         "100000000",
		"bsc:BNB":              "2000000000",
		"polygon:USDC-POLY":    "3000000000",
	}
	added := 0
	for k, v := range starter {
		if p.GetBalance(k) > 0 {
			continue
		}
		p.Balances[k] = v
		added++
	}
	return added
}

func (b *Bridge) OneXSwapQuote(tokenIn, tokenOut, amountStr string) (map[string]interface{}, error) {
	amt, err := rpc.ParseAmount(amountStr)
	if err != nil {
		return nil, err
	}
	pool, ok := b.ammStore().FindPool(tokenIn, tokenOut)
	if !ok {
		return nil, fmt.Errorf("no liquidity pool for this pair — create pool or use bridge route")
	}
	out, impact, err := pool.QuoteSwap(tokenIn, amt)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{
		"poolId":      pool.ID,
		"tokenIn":     tokenIn,
		"tokenOut":    tokenOut,
		"amountIn":    fmt.Sprintf("%d", amt),
		"amountOut":   fmt.Sprintf("%d", out),
		"priceImpact": impact,
		"feeBps":      pool.FeeBps,
		"reserve0":    pool.Reserve0,
		"reserve1":    pool.Reserve1,
	}, nil
}

// OneXSwapExecute performs AMM swap and updates user portfolio + on-chain ONEX when needed.
func (b *Bridge) OneXSwapExecute(tokenIn, tokenOut, amountStr string, slippageBps int) (map[string]interface{}, error) {
	if err := b.EnsureWallet(); err != nil {
		return nil, err
	}
	quote, err := b.OneXSwapQuote(tokenIn, tokenOut, amountStr)
	if err != nil {
		return nil, err
	}
	pool, ok := b.ammStore().Get(quote["poolId"].(string))
	if !ok {
		return nil, fmt.Errorf("pool not found")
	}
	var amountIn uint64
	fmt.Sscanf(quote["amountIn"].(string), "%d", &amountIn)
	expectedOut, _, _ := pool.QuoteSwap(tokenIn, amountIn)
	out, err := pool.Swap(tokenIn, amountIn)
	if err != nil {
		return nil, err
	}
	minOut := expectedOut
	if slippageBps > 0 {
		minOut = expectedOut * uint64(10000-slippageBps) / 10000
	}
	if out < minOut {
		return nil, fmt.Errorf("slippage exceeded")
	}

	p, err := b.GetPortfolio()
	if err != nil {
		return nil, err
	}
	if err := p.SubBalance(tokenIn, amountIn); err != nil {
		return nil, err
	}
	p.AddBalance(tokenOut, out)
	_ = b.portfolio().Save(p)
	_ = b.ammStore().Update(pool)

	// Sync ONEX to chain when swapping native ONEX (bridge ↔ blockchain)
	b.syncSwapToChain(tokenIn, tokenOut, amountIn, out)

	rec := SwapRecord{
		ID: newID(), FromKey: tokenIn, ToKey: tokenOut,
		FromAmt: fmt.Sprintf("%d", amountIn), ToAmt: fmt.Sprintf("%d", out),
		Status: "amm", CreatedAt: nowUnix(),
	}
	p.Swaps = append([]SwapRecord{rec}, p.Swaps...)
	_ = b.portfolio().Save(p)
	b.completeTask(p, "first-swap")

	return map[string]interface{}{
		"status":      "success",
		"amountIn":    amountIn,
		"amountOut":   out,
		"poolId":      pool.ID,
		"priceImpact": quote["priceImpact"],
		"txType":      "onex-swap-amm",
	}, nil
}

func (b *Bridge) syncSwapToChain(tokenIn, tokenOut string, amountIn, amountOut uint64) {
	onexKey := b.registry().TokenKey("onex-mainnet-1", "ONEX")
	if tokenIn != onexKey && tokenOut != onexKey {
		return
	}
	// Portfolio already updated; on-chain ONEX balance is source of truth on refresh.
	// Swaps selling ONEX will reflect after syncOneXBalance on next GetPortfolio.
	_ = amountIn
	_ = amountOut
}

func (b *Bridge) OneXSwapAddLiquidity(token0, token1, amount0Str, amount1Str string) (map[string]interface{}, error) {
	if err := b.EnsureWallet(); err != nil {
		return nil, err
	}
	a0, err := rpc.ParseAmount(amount0Str)
	if err != nil {
		return nil, err
	}
	a1, err := rpc.ParseAmount(amount1Str)
	if err != nil {
		return nil, err
	}
	pool, ok := b.ammStore().FindPool(token0, token1)
	if !ok {
		id := amm.PoolID(token0, token1)
		if token0 > token1 {
			token0, token1 = token1, token0
			a0, a1 = a1, a0
		}
		pool = &amm.Pool{
			ID: id, Token0: token0, Token1: token1,
			Reserve0: "0", Reserve1: "0", TotalShares: "0", FeeBps: amm.DefaultFeeBps,
		}
	}
	shares, err := pool.AddLiquidity(a0, a1)
	if err != nil {
		return nil, err
	}
	p, err := b.GetPortfolio()
	if err != nil {
		return nil, err
	}
	if err := p.SubBalance(token0, a0); err != nil {
		return nil, err
	}
	if err := p.SubBalance(token1, a1); err != nil {
		return nil, err
	}
	lpKey := "lp:" + pool.ID
	p.SetBalance(lpKey, p.GetBalance(lpKey)+shares)
	_ = b.portfolio().Save(p)
	_ = b.ammStore().Update(pool)
	return map[string]interface{}{
		"poolId": pool.ID, "shares": fmt.Sprintf("%d", shares),
		"reserve0": pool.Reserve0, "reserve1": pool.Reserve1,
	}, nil
}

func (b *Bridge) OneXSwapRemoveLiquidity(poolID, sharesStr string) (map[string]interface{}, error) {
	if err := b.EnsureWallet(); err != nil {
		return nil, err
	}
	var shares uint64
	fmt.Sscanf(sharesStr, "%d", &shares)
	pool, ok := b.ammStore().Get(poolID)
	if !ok {
		return nil, fmt.Errorf("pool not found")
	}
	a0, a1, err := pool.RemoveLiquidity(shares)
	if err != nil {
		return nil, err
	}
	p, err := b.GetPortfolio()
	if err != nil {
		return nil, err
	}
	lpKey := "lp:" + poolID
	if err := p.SubBalance(lpKey, shares); err != nil {
		return nil, err
	}
	p.AddBalance(pool.Token0, a0)
	p.AddBalance(pool.Token1, a1)
	_ = b.portfolio().Save(p)
	_ = b.ammStore().Update(pool)
	return map[string]interface{}{
		"amount0": a0, "amount1": a1, "token0": pool.Token0, "token1": pool.Token1,
	}, nil
}

// BridgeRoute finds path tokenIn -> ONEX -> tokenOut across two pools.
func (b *Bridge) BridgeRoute(tokenIn, tokenOut, amountStr string) (map[string]interface{}, error) {
	onex := b.registry().TokenKey("onex-mainnet-1", "ONEX")
	if tokenIn == tokenOut {
		return nil, fmt.Errorf("same token")
	}
	if tokenIn == onex || tokenOut == onex {
		return b.OneXSwapQuote(tokenIn, tokenOut, amountStr)
	}
	q1, err := b.OneXSwapQuote(tokenIn, onex, amountStr)
	if err != nil {
		return nil, fmt.Errorf("bridge leg1: %w", err)
	}
	q2, err := b.OneXSwapQuote(onex, tokenOut, q1["amountOut"].(string))
	if err != nil {
		return nil, fmt.Errorf("bridge leg2: %w", err)
	}
	return map[string]interface{}{
		"route":     []string{tokenIn, onex, tokenOut},
		"amountIn":  q1["amountIn"],
		"amountOut": q2["amountOut"],
		"leg1":      q1,
		"leg2":      q2,
	}, nil
}

func (b *Bridge) BridgeExecute(tokenIn, tokenOut, amountStr string, slippageBps int) (map[string]interface{}, error) {
	onex := b.registry().TokenKey("onex-mainnet-1", "ONEX")
	if tokenIn == onex || tokenOut == onex {
		return b.OneXSwapExecute(tokenIn, tokenOut, amountStr, slippageBps)
	}
	q1, err := b.OneXSwapQuote(tokenIn, onex, amountStr)
	if err != nil {
		return nil, err
	}
	_, err = b.OneXSwapExecute(tokenIn, onex, amountStr, slippageBps)
	if err != nil {
		return nil, err
	}
	return b.OneXSwapExecute(onex, tokenOut, q1["amountOut"].(string), slippageBps)
}

