package bridge

import (
	"encoding/json"
	"net/http"
)

func (s *Server) registerDeFiRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/bridge/chains", s.handleChains)
	mux.HandleFunc("/bridge/tokens", s.handleTokens)
	mux.HandleFunc("/bridge/market/prices", s.handleMarketPrices)
	mux.HandleFunc("/bridge/market/chart", s.handleMarketChart)
	mux.HandleFunc("/bridge/portfolio", s.handlePortfolio)
	mux.HandleFunc("/bridge/deposit/info", s.handleDepositInfo)
	mux.HandleFunc("/bridge/deposit", s.handleDeposit)
	mux.HandleFunc("/bridge/swap/quote", s.handleSwapQuote)
	mux.HandleFunc("/bridge/swap", s.handleSwap)
	mux.HandleFunc("/bridge/nfts", s.handleNFTs)
	mux.HandleFunc("/bridge/nfts/mint", s.handleNFTMint)
	mux.HandleFunc("/bridge/nfts/transfer", s.handleNFTTransfer)
	mux.HandleFunc("/bridge/tasks", s.handleTasks)
	mux.HandleFunc("/bridge/tasks/complete", s.handleTaskComplete)
	mux.HandleFunc("/bridge/loans", s.handleLoans)
	mux.HandleFunc("/bridge/loans/create", s.handleLoanCreate)
	mux.HandleFunc("/bridge/loans/repay", s.handleLoanRepay)
	mux.HandleFunc("/bridge/send", s.handleSendToken)
	mux.HandleFunc("/bridge/stake/pools", s.handleStakePools)
	mux.HandleFunc("/bridge/stakes", s.handleStakes)
	mux.HandleFunc("/bridge/stake", s.handleStake)
	mux.HandleFunc("/bridge/unstake", s.handleUnstake)
	mux.HandleFunc("/bridge/tokens/create", s.handleTokenCreate)
	mux.HandleFunc("/bridge/tokens/custom", s.handleTokensCustom)
	mux.HandleFunc("/bridge/onex-swap/pools", s.handleOneXSwapPools)
	mux.HandleFunc("/bridge/onex-swap/status", s.handleOneXSwapStatus)
	mux.HandleFunc("/bridge/onex-swap/activate", s.handleOneXSwapActivate)
	mux.HandleFunc("/bridge/onex-swap/quote", s.handleOneXSwapQuote)
	mux.HandleFunc("/bridge/onex-swap/swap", s.handleOneXSwapExec)
	mux.HandleFunc("/bridge/onex-swap/liquidity/add", s.handleOneXSwapAddLiq)
	mux.HandleFunc("/bridge/onex-swap/liquidity/remove", s.handleOneXSwapRemoveLiq)
	mux.HandleFunc("/bridge/onex-swap/bridge/quote", s.handleBridgeQuote)
	mux.HandleFunc("/bridge/onex-swap/bridge", s.handleBridgeExec)
	registerLegacySwapRoutes(mux, s)
	s.registerLedgerRoutes(mux)
	s.registerBankRoutes(mux)
	s.registerSwiftRoutes(mux)
	s.registerCardRoutes(mux)
	s.registerCashCodeRoutes(mux)
	s.registerBridge7Routes(mux)
	s.registerListingRoutes(mux)
	mux.HandleFunc("/swap", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/wallet/#swap", http.StatusFound)
	})
}

func (s *Server) handleChains(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.b.registry().GetChains())
}

func (s *Server) handleTokens(w http.ResponseWriter, r *http.Request) {
	chain := r.URL.Query().Get("chain")
	writeJSON(w, s.b.AllTokens(chain))
}

func (s *Server) handleMarketPrices(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, s.b.MarketPrices())
}

func (s *Server) handleMarketChart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	sym := r.URL.Query().Get("symbol")
	days := r.URL.Query().Get("days")
	pts, err := s.b.MarketChart(sym, days)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"symbol": sym, "days": days, "points": pts})
}

func (s *Server) handleStakePools(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.b.stakePools())
}

func (s *Server) handleStakes(w http.ResponseWriter, r *http.Request) {
	list, err := s.b.ListStakes()
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, list)
}

func (s *Server) handleStake(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		PoolID string `json:"poolId"`
		Amount string `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	rec, err := s.b.Stake(req.PoolID, req.Amount)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, rec)
}

func (s *Server) handleUnstake(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	res, err := s.b.Unstake(req.ID)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleTokenCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		ChainID  string `json:"chainId"`
		Name     string `json:"name"`
		Symbol   string `json:"symbol"`
		Decimals int    `json:"decimals"`
		Supply   string `json:"supply"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if req.ChainID == "" {
		req.ChainID = "onex-mainnet-1"
	}
	if req.Decimals == 0 {
		req.Decimals = 8
	}
	tok, err := s.b.CreateToken(req.ChainID, req.Name, req.Symbol, req.Decimals, req.Supply)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, tok)
}

func (s *Server) handleOneXSwapPools(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.b.OneXSwapPools())
}

func (s *Server) handleOneXSwapStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, s.b.OneXSwapStatus())
}

func (s *Server) handleOneXSwapActivate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	res, err := s.b.ActivateSwap(r.Context())
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleOneXSwapQuote(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	quote, err := s.b.OneXSwapQuote(q.Get("tokenIn"), q.Get("tokenOut"), q.Get("amount"))
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, quote)
}

func (s *Server) handleOneXSwapExec(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		TokenIn      string `json:"tokenIn"`
		TokenOut     string `json:"tokenOut"`
		Amount       string `json:"amount"`
		SlippageBps  int    `json:"slippageBps"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if req.SlippageBps == 0 {
		req.SlippageBps = 50
	}
	res, err := s.b.OneXSwapExecute(req.TokenIn, req.TokenOut, req.Amount, req.SlippageBps)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleOneXSwapAddLiq(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		Token0   string `json:"token0"`
		Token1   string `json:"token1"`
		Amount0  string `json:"amount0"`
		Amount1  string `json:"amount1"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	res, err := s.b.OneXSwapAddLiquidity(req.Token0, req.Token1, req.Amount0, req.Amount1)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleOneXSwapRemoveLiq(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		PoolID string `json:"poolId"`
		Shares string `json:"shares"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	res, err := s.b.OneXSwapRemoveLiquidity(req.PoolID, req.Shares)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleBridgeQuote(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	res, err := s.b.BridgeRoute(q.Get("tokenIn"), q.Get("tokenOut"), q.Get("amount"))
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleBridgeExec(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		TokenIn     string `json:"tokenIn"`
		TokenOut    string `json:"tokenOut"`
		Amount      string `json:"amount"`
		SlippageBps int    `json:"slippageBps"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if req.SlippageBps == 0 {
		req.SlippageBps = 50
	}
	res, err := s.b.BridgeExecute(req.TokenIn, req.TokenOut, req.Amount, req.SlippageBps)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleTokensCustom(w http.ResponseWriter, r *http.Request) {
	list, err := s.b.ListCustomTokens()
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, list)
}

func (s *Server) handlePortfolio(w http.ResponseWriter, r *http.Request) {
	p, err := s.b.GetPortfolio()
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	if !s.b.isProduction() {
		writeJSON(w, p)
		return
	}
	evm := r.URL.Query().Get("evm")
	if evm == "" {
		evm = s.b.resolvedLedgerConfig().EVMHolder
	}
	snap, _ := s.b.ReadRealLedger(r.Context(), "all", evm, s.b.LoadLatestImport())
	writeJSON(w, map[string]interface{}{
		"address":  p.Address,
		"mode":     "production",
		"portfolio": p,
		"ledger":   snap,
		"realUsd":  snap.TotalUSD,
		"entries":  len(snap.Entries),
	})
}

func (s *Server) handleDepositInfo(w http.ResponseWriter, r *http.Request) {
	chain := r.URL.Query().Get("chain")
	if chain == "" {
		http.Error(w, "chain required", 400)
		return
	}
	info, err := s.b.DepositInfo(chain)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, info)
}

func (s *Server) handleDeposit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		ChainID string `json:"chainId"`
		TokenID string `json:"tokenId"`
		Amount  string `json:"amount"`
		TxHash  string `json:"txHash"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	rec, err := s.b.RecordDeposit(req.ChainID, req.TokenID, req.Amount, req.TxHash)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, rec)
}

func (s *Server) handleSwapQuote(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	quote, err := s.b.SwapQuote(q.Get("fromChain"), q.Get("fromToken"), q.Get("toChain"), q.Get("toToken"), q.Get("amount"))
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, quote)
}

func (s *Server) handleSwap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		FromChain string `json:"fromChain"`
		FromToken string `json:"fromToken"`
		ToChain   string `json:"toChain"`
		ToToken   string `json:"toToken"`
		Amount    string `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	rec, err := s.b.SwapExecute(req.FromChain, req.FromToken, req.ToChain, req.ToToken, req.Amount)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, rec)
}

func (s *Server) handleNFTs(w http.ResponseWriter, r *http.Request) {
	p, err := s.b.GetPortfolio()
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, p.NFTs)
}

func (s *Server) handleNFTMint(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		Name, Description, ImageURL, ChainID string
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if req.ChainID == "" {
		req.ChainID = "onex-mainnet-1"
	}
	nft, err := s.b.MintNFT(req.Name, req.Description, req.ImageURL, req.ChainID)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, nft)
}

func (s *Server) handleNFTTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		ID string `json:"id"`
		To string `json:"to"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if err := s.b.TransferNFT(req.ID, req.To); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]string{"status": "transferred"})
}

func (s *Server) handleTasks(w http.ResponseWriter, r *http.Request) {
	p, err := s.b.GetPortfolio()
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, p.Tasks)
}

func (s *Server) handleTaskComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if err := s.b.CompleteTask(req.ID); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]string{"status": "completed"})
}

func (s *Server) handleLoans(w http.ResponseWriter, r *http.Request) {
	p, err := s.b.GetPortfolio()
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, p.Loans)
}

func (s *Server) handleLoanCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		Type          string  `json:"type"`
		CollateralKey string  `json:"collateralKey"`
		CollateralAmt string  `json:"collateralAmount"`
		DebtKey       string  `json:"debtKey"`
		DebtAmt       string  `json:"debtAmount"`
		APY           float64 `json:"apy"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if req.APY == 0 {
		req.APY = 5.5
	}
	loan, err := s.b.CreateLoan(req.Type, req.CollateralKey, req.CollateralAmt, req.DebtKey, req.DebtAmt, req.APY)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, loan)
}

func (s *Server) handleLoanRepay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	if err := s.b.RepayLoan(req.ID); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]string{"status": "repaid"})
}

func (s *Server) handleSendToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", 405)
		return
	}
	var req struct {
		ChainID string `json:"chainId"`
		TokenID string `json:"tokenId"`
		To      string `json:"to"`
		Amount  string `json:"amount"`
		Fee     string `json:"fee"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	res, err := s.b.SendToken(req.ChainID, req.TokenID, req.To, req.Amount, req.Fee)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

// registerLegacySwapRoutes keeps old Shiva Swap API paths working after the OneX rename.
func registerLegacySwapRoutes(mux *http.ServeMux, s *Server) {
	legacyRoutes := map[string]http.HandlerFunc{
		"/bridge/shiva-swap/pools":          s.handleOneXSwapPools,
		"/bridge/shiva-swap/quote":          s.handleOneXSwapQuote,
		"/bridge/shiva-swap/swap":           s.handleOneXSwapExec,
		"/bridge/shiva-swap/liquidity/add":  s.handleOneXSwapAddLiq,
		"/bridge/shiva-swap/liquidity/remove": s.handleOneXSwapRemoveLiq,
		"/bridge/shiva-swap/bridge/quote":   s.handleBridgeQuote,
		"/bridge/shiva-swap/bridge":         s.handleBridgeExec,
	}
	for path, h := range legacyRoutes {
		mux.HandleFunc(path, h)
	}
}
