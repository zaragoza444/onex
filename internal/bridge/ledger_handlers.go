package bridge

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/onex-blockchain/onex/internal/ledger"
)

func (s *Server) registerLedgerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/bridge/ledger/status", s.handleLedgerStatus)
	mux.HandleFunc("/bridge/ledger/real", s.handleLedgerReal)
	mux.HandleFunc("/bridge/ledger/read", s.handleLedgerRead)
	mux.HandleFunc("/bridge/ledger/convert", s.handleLedgerConvert)
	mux.HandleFunc("/bridge/ledger/import", s.handleLedgerImport)
	mux.HandleFunc("/bridge/ledger/accounts", s.handleLedgerAccounts)
	mux.HandleFunc("/bridge/ledger/transfer", s.handleLedgerTransfer)
	mux.HandleFunc("/bridge/ledger/transfers", s.handleLedgerTransfers)
	mux.HandleFunc("/bridge/ledger/destinations", s.handleLedgerDestinations)
	mux.HandleFunc("/bridge/ledger/settle", s.handleLedgerSettle)
	mux.HandleFunc("/bridge/ledger/settlements", s.handleLedgerSettlements)
	mux.HandleFunc("/bridge/ledger/settlement/capabilities", s.handleSettlementCapabilities)
	mux.HandleFunc("/bridge/ledger/middleware/fiat-settle", s.handleFiatSettlementMiddleware)
	mux.HandleFunc("/bridge/ledger/receivers", s.handleLedgerReceivers)
	mux.HandleFunc("/bridge/ledger/assets", s.handleLedgerAssets)
	// Legacy pre-OneX API paths (deprecated)
	mux.HandleFunc("/bridge/shiva-ledger/status", s.handleLedgerStatus)
	mux.HandleFunc("/bridge/shiva-ledger/real", s.handleLedgerReal)
	mux.HandleFunc("/bridge/shiva-ledger/read", s.handleLedgerRead)
	mux.HandleFunc("/bridge/shiva-ledger/convert", s.handleLedgerConvert)
	mux.HandleFunc("/bridge/shiva-ledger/import", s.handleLedgerImport)
	mux.HandleFunc("/bridge/shiva-ledger/accounts", s.handleLedgerAccounts)
	mux.HandleFunc("/bridge/shiva-ledger/transfer", s.handleLedgerTransfer)
	mux.HandleFunc("/bridge/shiva-ledger/transfers", s.handleLedgerTransfers)
	mux.HandleFunc("/bridge/shiva-ledger/destinations", s.handleLedgerDestinations)
	mux.HandleFunc("/bridge/shiva-ledger/settle", s.handleLedgerSettle)
	mux.HandleFunc("/bridge/shiva-ledger/settlements", s.handleLedgerSettlements)
	mux.HandleFunc("/bridge/shiva-ledger/settlement/capabilities", s.handleSettlementCapabilities)
	mux.HandleFunc("/bridge/shiva-ledger/middleware/fiat-settle", s.handleFiatSettlementMiddleware)
}

func (s *Server) handleLedgerStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, s.b.LedgerStatus())
}

func (s *Server) handleLedgerReal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	evm := r.URL.Query().Get("evm")
	snap, err := s.b.ReadRealLedger(r.Context(), "all", evm, s.b.LoadLatestImport())
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	_ = s.b.SyncLedgerBook(r.Context(), evm)
	writeJSON(w, snap)
}

func (s *Server) handleLedgerRead(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	source := r.URL.Query().Get("source")
	evm := r.URL.Query().Get("evm")
	snap, err := s.b.ReadRealLedger(r.Context(), source, evm, s.b.LoadLatestImport())
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, snap)
}

func (s *Server) handleLedgerConvert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req ledger.ConvertRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := s.b.ConvertLedger(r.Context(), r.URL.Query().Get("evm"), req)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleLedgerImport(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	evm := r.URL.Query().Get("evm")

	var meta struct {
		Active       *bool  `json:"active"`
		Preview      bool   `json:"preview"`
		FiatCurrency string `json:"fiatCurrency"`
	}
	_ = json.Unmarshal(body, &meta)

	req := ledger.ImportRequest{
		Preview:      meta.Preview,
		FiatCurrency: meta.FiatCurrency,
		Raw:          body,
	}
	if meta.Active != nil {
		req.Active = *meta.Active
	} else if q := r.URL.Query().Get("preview"); q == "1" || q == "true" || meta.Preview {
		req.Preview = true
		req.Active = false
	} else {
		req.Active = true
	}
	if r.URL.Query().Get("preview") == "1" || r.URL.Query().Get("preview") == "true" {
		req.Preview = true
		req.Active = false
	}

	res, err := s.b.ImportActiveLedger(r.Context(), evm, req)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleLedgerAccounts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	evm := r.URL.Query().Get("evm")
	accts, err := s.b.ListLedgerAccounts(r.Context(), evm)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"accounts": accts, "count": len(accts)})
}

func (s *Server) handleLedgerTransfer(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req ledger.TransferRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := s.b.TransferLedger(r.Context(), r.URL.Query().Get("evm"), req)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleLedgerTransfers(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	list, err := s.b.ListLedgerTransfers(r.Context(), r.URL.Query().Get("evm"), 25)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"transfers": list, "count": len(list)})
}

func (s *Server) handleLedgerDestinations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, s.b.ListExternalDestinations())
}

func (s *Server) handleLedgerSettle(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req ledger.SettlementRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := s.b.SettleLedger(r.Context(), r.URL.Query().Get("evm"), req)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleLedgerSettlements(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	list, err := s.b.ListLedgerSettlements(r.Context(), r.URL.Query().Get("evm"), 25)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, map[string]interface{}{"settlements": list, "count": len(list)})
}

func (s *Server) handleSettlementCapabilities(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, s.b.SettlementCapabilities())
}

func (s *Server) handleFiatSettlementMiddleware(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req ledger.FiatSettlementMiddlewareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := s.b.FiatSettlementMiddleware(r.Context(), r.URL.Query().Get("evm"), req)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, res)
}

func (s *Server) handleLedgerReceivers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.b.ListReceiverWallets()
		if err != nil {
			writeJSON(w, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, map[string]interface{}{"receivers": list, "count": len(list)})
	case http.MethodPost:
		var req struct {
			Label   string `json:"label"`
			ChainID string `json:"chainId"`
			Address string `json:"address"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		wlt, err := s.b.SaveReceiverWallet(req.Label, req.ChainID, req.Address)
		if err != nil {
			writeJSON(w, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, wlt)
	default:
		http.Error(w, "GET or POST only", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleLedgerAssets(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		kind := r.URL.Query().Get("kind")
		list, err := s.b.ListExternalAssets(kind)
		if err != nil {
			writeJSON(w, map[string]string{"error": err.Error()})
			return
		}
		wallets, banks := 0, 0
		for _, a := range list {
			if a.Kind == AssetKindBank {
				banks++
			} else {
				wallets++
			}
		}
		writeJSON(w, map[string]interface{}{
			"assets": list, "count": len(list),
			"wallets": wallets, "banks": banks,
		})
	case http.MethodPost:
		var req ExternalAsset
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		a, err := s.b.SaveExternalAsset(req)
		if err != nil {
			writeJSON(w, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, a)
	default:
		http.Error(w, "GET or POST only", http.StatusMethodNotAllowed)
	}
}
