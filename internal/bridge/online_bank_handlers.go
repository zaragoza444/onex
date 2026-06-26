package bridge

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strconv"

	"github.com/onex-blockchain/onex/internal/ledger"
)

func (s *Server) registerBankRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/bridge/bank/status", s.handleOnlineBankStatus)
	mux.HandleFunc("/bridge/bank/accounts", s.handleOnlineBankAccounts)
	mux.HandleFunc("/bridge/bank/transactions", s.handleOnlineBankTransactions)
	mux.HandleFunc("/bridge/bank/ledger", s.handleOnlineBankLedger)
	mux.HandleFunc("/bridge/bank/transfer", s.handleOnlineBankTransfer)
	mux.HandleFunc("/bridge/bank/send", s.handleOnlineBankSend)
	mux.HandleFunc("/bridge/bank/deposit", s.handleOnlineBankDeposit)
	mux.HandleFunc("/bridge/bank/account", s.handleOnlineBankAccount)
	mux.HandleFunc("/bridge/bank/wire", s.handleOnlineBankWire)
	mux.HandleFunc("/bridge/bank/statement", s.handleOnlineBankStatement)
	s.registerHybrixBankRoutes(mux)
	s.registerFineractBankRoutes(mux)
}

func (b *Bridge) onlineBank() *ledger.OnlineBankStore {
	return ledger.DefaultOnlineBankStore()
}

func (b *Bridge) ensureOnlineBank() error {
	cfg := b.resolvedLedgerConfig()
	file := cfg.BankFile
	if file == "" {
		file = filepath.Join(b.projectRoot(), "configs", "bank-ledger.example.json")
	}
	return b.onlineBank().EnsureSeeded(file)
}

func (b *Bridge) OnlineBankStatus() map[string]interface{} {
	st := b.onlineBank().Status()
	st["enabled"] = ledger.OnlineBankEnabled()
	prov := ledger.LoadBankProviderConfig().Status()
	st["provider"] = prov
	st["hybx"] = ledger.NewHybrixClient().Status()
	st["hybxMiddleware"] = ledger.HybxMiddlewareStatus()
	st["fineract"] = ledger.NewFineractClient().Status()
	st["virtualCards"] = b.VirtualCardsStatus()
	st["cashCode"] = b.CashCodeStatus()
	st["swift"] = b.SwiftSystemStatus()
	return st
}

func (s *Server) handleOnlineBankStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	_ = s.b.ensureOnlineBank()
	writeJSON(w, s.b.OnlineBankStatus())
}

func (s *Server) handleOnlineBankAccounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	if err := s.b.ensureOnlineBank(); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	accts, err := s.b.onlineBank().ListAccounts()
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"accounts": accts, "count": len(accts)})
}

func (s *Server) handleOnlineBankTransactions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	if err := s.b.ensureOnlineBank(); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	limit := 50
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	txs, err := s.b.onlineBank().ListTransactionsFiltered(limit, r.URL.Query().Get("account"), r.URL.Query().Get("type"))
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"transactions": txs, "count": len(txs)})
}

func (s *Server) handleOnlineBankAccount(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	if err := s.b.ensureOnlineBank(); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "id required", http.StatusBadRequest)
		return
	}
	acct, err := s.b.onlineBank().GetAccount(id)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, acct)
}

func (s *Server) handleOnlineBankWire(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	if err := s.b.ensureOnlineBank(); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	id := r.URL.Query().Get("account")
	if id == "" {
		http.Error(w, "account required", http.StatusBadRequest)
		return
	}
	wire, err := s.b.onlineBank().WireInstructions(id)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, wire)
}

func (s *Server) handleOnlineBankStatement(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	if err := s.b.ensureOnlineBank(); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	csv, err := s.b.onlineBank().ExportTransactionsCSV(r.URL.Query().Get("account"))
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="nsb-statement.csv"`)
	_, _ = w.Write([]byte(csv))
}

func (s *Server) handleOnlineBankLedger(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	if err := s.b.ensureOnlineBank(); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	snap, err := s.b.onlineBank().BankLedger(s.b.ledgerPrices(), 100)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, snap)
}

func (s *Server) handleOnlineBankTransfer(w http.ResponseWriter, r *http.Request) {
	s.handleOnlineBankSend(w, r)
}

func (s *Server) handleOnlineBankSend(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if err := s.b.ensureOnlineBank(); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	var req ledger.OnlineBankTransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := s.b.onlineBank().Send(req)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	if !req.Preview {
		if err := s.b.applyFineractTransfer(req, res); err != nil {
			writeJSON(w, map[string]string{"error": "fineract: " + err.Error()})
			return
		}
		if err := s.b.applyHybrixTransfer(req, res); err != nil {
			writeJSON(w, map[string]string{"error": "hybx: " + err.Error()})
			return
		}
		_ = s.b.SyncLedgerBook(r.Context(), r.URL.Query().Get("evm"))
	}
	writeJSON(w, res)
}

func (s *Server) handleOnlineBankDeposit(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	if err := s.b.ensureOnlineBank(); err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	var req ledger.OnlineBankDepositRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := s.b.onlineBank().Deposit(req)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	if !req.Preview {
		if err := s.b.applyFineractDeposit(req, res); err != nil {
			writeJSON(w, map[string]string{"error": "fineract: " + err.Error()})
			return
		}
		_ = s.b.SyncLedgerBook(r.Context(), r.URL.Query().Get("evm"))
	}
	writeJSON(w, res)
}
