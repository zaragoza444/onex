package bridge

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (s *Server) registerEthereumRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/bridge/ethereum/status", s.handleEthereumStatus)
	mux.HandleFunc("/bridge/ethereum/block", s.handleEthereumBlock)
	mux.HandleFunc("/bridge/ethereum/tx", s.handleEthereumTransaction)
	mux.HandleFunc("/bridge/ethereum/transfer", s.handleEthereumTransfer)
	mux.HandleFunc("/bridge/ethereum/fund-sender", s.handleEthereumFundSender)
	// Legacy alias
	mux.HandleFunc("/bridge/quiknode/status", s.handleEthereumStatus)
	mux.HandleFunc("/bridge/quiknode/block", s.handleEthereumBlock)
	mux.HandleFunc("/bridge/quiknode/tx", s.handleEthereumTransaction)
	mux.HandleFunc("/bridge/quiknode/transfer", s.handleEthereumTransfer)
}

func (s *Server) handleEthereumStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, s.b.EthereumStatus(r.Context()))
}

func (s *Server) handleEthereumBlock(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	number := strings.TrimSpace(r.URL.Query().Get("number"))
	if number == "" {
		number = "latest"
	}
	fullTx := r.URL.Query().Get("full") != "false"
	block, err := s.b.EthereumBlock(r.Context(), number, fullTx)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"data": []json.RawMessage{block}})
}

func (s *Server) handleEthereumTransaction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	hash := strings.TrimSpace(r.URL.Query().Get("hash"))
	if hash == "" {
		http.Error(w, "hash query parameter required", http.StatusBadRequest)
		return
	}
	tx, err := s.b.EthereumTransaction(r.Context(), hash)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	receipt, recErr := s.b.EthereumTransactionReceipt(r.Context(), hash)
	out := map[string]interface{}{"data": tx}
	if recErr == nil {
		out["receipt"] = receipt
	}
	writeJSON(w, out)
}

func (s *Server) handleEthereumTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req EthereumTransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := s.b.EthereumTransfer(r.Context(), req)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleEthereumFundSender(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	res, err := s.b.FundEVMSender(r.Context())
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}
