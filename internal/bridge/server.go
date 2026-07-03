package bridge

import (
	"embed"
	"encoding/json"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/onex-blockchain/onex/internal/rpc"
	"github.com/onex-blockchain/onex/internal/types"
	"github.com/onex-blockchain/onex/internal/wallet"
)

//go:embed static/wallet/*
var walletFS embed.FS

type Server struct {
	b *Bridge
}

func NewServer(b *Bridge) *Server {
	return &Server{b: b}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"status": "ok", "service": "onex-bridge"})
	})
	mux.HandleFunc("/bridge/status", s.handleStatus)
	mux.HandleFunc("/bridge/wallet/load", s.handleWalletLoad)
	mux.HandleFunc("/bridge/wallet/create", s.handleWalletCreate)
	mux.HandleFunc("/bridge/wallet/balance", s.handleWalletBalance)
	mux.HandleFunc("/bridge/wallet/send", s.handleWalletSend)
	mux.HandleFunc("/rpc", s.handleRPC)
	s.registerDeFiRoutes(mux)
	s.registerPlatformRoutes(mux)
	s.registerProductionRoutes(mux)
	s.registerAIRoutes(mux)

	sub, _ := fs.Sub(walletFS, "static/wallet")
	mux.Handle("/wallet/", http.StripPrefix("/wallet/", http.FileServer(http.FS(sub))))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.Redirect(w, r, "/wallet/", http.StatusFound)
			return
		}
		http.NotFound(w, r)
	})
	mw := newMiddleware(
		splitCSVEnv("ONEX_CORS_ORIGINS"),
		strings.TrimSpace(os.Getenv("ONEX_API_KEY")),
	)
	return mw.wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mux.ServeHTTP(w, r)
	}))
}

type middleware struct {
	corsOrigins []string
	apiKey      string
	limiter     *rateLimiter
}

func newMiddleware(corsOrigins []string, apiKey string) *middleware {
	return &middleware{
		corsOrigins: corsOrigins,
		apiKey:      apiKey,
		limiter:     newRateLimiter(240, time.Minute),
	}
}

func (m *middleware) wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		m.setSecurityHeaders(w)
		if m.handleCORS(w, r) {
			return
		}
		if !m.limiter.allow(remoteIP(r)) {
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		if m.apiKey != "" && needsAPIKey(r) && !sameOriginRequest(r) {
			if r.Header.Get("X-OneX-Api-Key") != m.apiKey && r.Header.Get("Authorization") != "Bearer "+m.apiKey {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

func (m *middleware) setSecurityHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
}

func (m *middleware) handleCORS(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	if len(m.corsOrigins) == 0 || originAllowed(origin, m.corsOrigins) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-OneX-Api-Key")
		w.Header().Set("Access-Control-Max-Age", "86400")
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

func originAllowed(origin string, allowed []string) bool {
	o := strings.TrimSpace(origin)
	for _, a := range allowed {
		a = strings.TrimSpace(a)
		if a == "" {
			continue
		}
		if a == "*" || strings.EqualFold(a, o) {
			return true
		}
		// GitHub Pages and similar: allow any origin on *.github.io when a github.io host is listed.
		if strings.Contains(a, "github.io") && strings.Contains(o, "github.io") {
			return true
		}
		// Anakatech Gitea Pages and subdomains when git.anakatech.llc is listed.
		if strings.Contains(a, "anakatech.llc") && strings.Contains(o, "anakatech.llc") {
			return true
		}
	}
	return false
}

// sameOriginRequest allows the embedded wallet (same host as bridge) without exposing the API key in JS.
func sameOriginRequest(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return false
	}
	ou, err := url.Parse(origin)
	if err != nil || ou.Host == "" {
		return false
	}
	return strings.EqualFold(hostOnly(ou.Host), hostOnly(r.Host))
}

func hostOnly(h string) string {
	h = strings.TrimSpace(h)
	if strings.HasPrefix(h, "[") {
		if i := strings.Index(h, "]"); i > 0 {
			return strings.ToLower(h[:i+1])
		}
	}
	if i := strings.LastIndex(h, ":"); i > 0 {
		return strings.ToLower(h[:i])
	}
	return strings.ToLower(h)
}

func needsAPIKey(r *http.Request) bool {
	if r.Method != http.MethodPost {
		return false
	}
	switch r.URL.Path {
	case "/rpc",
		"/bridge/send",
		"/bridge/deposit",
		"/bridge/swap",
		"/bridge/nfts/mint",
		"/bridge/nfts/transfer",
		"/bridge/tasks/complete",
		"/bridge/loans/create",
		"/bridge/loans/repay",
		"/bridge/stake",
		"/bridge/unstake",
		"/bridge/tokens/create",
		"/bridge/platform/deploy",
		"/bridge/platform/wrap",
		"/bridge/onex-swap/swap",
		"/bridge/onex-swap/liquidity/add",
		"/bridge/onex-swap/liquidity/remove",
		"/bridge/onex-swap/bridge",
		"/bridge/ethereum/transfer",
		"/bridge/ethereum/fund-sender",
		"/bridge/quiknode/transfer":
		return true
	default:
		return false
	}
}

func remoteIP(r *http.Request) string {
	if x := r.Header.Get("X-Forwarded-For"); x != "" {
		return strings.TrimSpace(strings.Split(x, ",")[0])
	}
	if x := r.Header.Get("X-Real-IP"); x != "" {
		return strings.TrimSpace(x)
	}
	return strings.Split(r.RemoteAddr, ":")[0]
}

type rateLimiter struct {
	mu     sync.Mutex
	limit  int
	window time.Duration
	counts map[string][]time.Time
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	return &rateLimiter{limit: limit, window: window, counts: make(map[string][]time.Time)}
}

func (rl *rateLimiter) allow(key string) bool {
	now := time.Now()
	cutoff := now.Add(-rl.window)
	rl.mu.Lock()
	defer rl.mu.Unlock()
	var kept []time.Time
	for _, t := range rl.counts[key] {
		if t.After(cutoff) {
			kept = append(kept, t)
		}
	}
	if len(kept) >= rl.limit {
		rl.counts[key] = kept
		return false
	}
	kept = append(kept, now)
	rl.counts[key] = kept
	return true
}

func splitCSVEnv(key string) []string {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	st, _ := s.b.Status()
	writeJSON(w, st)
}

func (s *Server) handleWalletLoad(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Path string `json:"path"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	path := req.Path
	if path == "" {
		path = s.b.Config().WalletPath
	}
	if err := s.b.LoadWallet(path); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]string{"address": s.b.WalletAddress(), "path": path})
}

func (s *Server) handleWalletCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	path := s.b.Config().WalletPath
	wlt, err := wallet.Create(path)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	_ = s.b.LoadWallet(path)
	writeJSON(w, map[string]string{"address": string(wlt.Address), "path": path})
}

func (s *Server) handleWalletBalance(w http.ResponseWriter, r *http.Request) {
	addr, bal, nonce, err := s.b.WalletBalance()
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"address": addr, "balance": bal, "nonce": nonce})
}

func (s *Server) handleWalletSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		To     string `json:"to"`
		Amount string `json:"amount"`
		Fee    string `json:"fee"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	amount, err := rpc.ParseAmount(req.Amount)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	feeStr := req.Fee
	if feeStr == "" {
		feeStr = "0.001"
	}
	fee, err := rpc.ParseAmount(feeStr)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	res, err := s.b.Send(types.Address(strings.ToLower(normalizeAddr(req.To))), amount, fee)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleRPC(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	var req struct {
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
		ID     interface{}     `json:"id"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, err.Error(), 400)
		return
	}
	walletMethods := strings.HasPrefix(req.Method, "onex_") ||
		req.Method == "eth_requestAccounts" || req.Method == "eth_accounts"
	if walletMethods {
		result, err := s.b.HandleWalletRPC(req.Method, req.Params)
		if err != nil {
			writeJSON(w, map[string]interface{}{
				"jsonrpc": "2.0", "id": req.ID,
				"error": map[string]interface{}{"code": -32000, "message": err.Error()},
			})
			return
		}
		writeJSON(w, map[string]interface{}{"jsonrpc": "2.0", "id": req.ID, "result": result})
		return
	}
	out, code, err := s.b.node.ProxyRPC(body)
	if err != nil {
		writeJSON(w, map[string]interface{}{
			"jsonrpc": "2.0", "id": req.ID,
			"error": map[string]interface{}{"code": -32000, "message": err.Error()},
		})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = w.Write(out)
}

func writeJSON(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) Start(addr string) error {
	log.Printf("onex-bridge: wallet UI http://127.0.0.1%s/wallet/", addr)
	log.Printf("onex-bridge: JSON-RPC http://127.0.0.1%s/rpc -> %s", addr, s.b.Config().NodeURL)
	return http.ListenAndServe(addr, s.Handler())
}
