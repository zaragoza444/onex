package bridge

import (
	"net/http"
)

func (s *Server) registerProductionRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/bridge/production/status", s.handleProductionStatus)
	mux.HandleFunc("/bridge/production/connect", s.handleProductionConnect)
	mux.HandleFunc("/bridge/production/bootstrap", s.handleProductionBootstrap)
	mux.HandleFunc("/bridge/health/green", s.handleGreenHealth)
}

func (s *Server) handleGreenHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	writeJSON(w, s.b.GreenHealth(r.Context(), r.URL.Query().Get("evm")))
}

func (s *Server) handleProductionStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	evm := r.URL.Query().Get("evm")
	writeJSON(w, s.b.ProductionPlatformStatus(r.Context(), evm))
}

func (s *Server) handleProductionConnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodPost {
		http.Error(w, "GET or POST only", http.StatusMethodNotAllowed)
		return
	}
	evm := r.URL.Query().Get("evm")
	if r.Method == http.MethodPost {
		writeJSON(w, s.b.BootstrapProduction(r.Context(), evm))
		return
	}
	st := s.b.ProductionPlatformStatus(r.Context(), evm)
	st["green"] = s.b.GreenHealth(r.Context(), evm)
	origin := requestOrigin(r)
	if origin != "" {
		st["bridgeUrl"] = origin
	}
	writeJSON(w, st)
}

func (s *Server) handleProductionBootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	evm := r.URL.Query().Get("evm")
	res := s.b.BootstrapProduction(r.Context(), evm)
	res["green"] = s.b.GreenHealth(r.Context(), evm)
	writeJSON(w, res)
}

func requestOrigin(r *http.Request) string {
	if o := r.Header.Get("X-Forwarded-Proto"); o != "" {
		host := r.Header.Get("X-Forwarded-Host")
		if host == "" {
			host = r.Host
		}
		return o + "://" + host
	}
	if r.TLS != nil {
		return "https://" + r.Host
	}
	if r.Host != "" {
		return "http://" + r.Host
	}
	return ""
}
