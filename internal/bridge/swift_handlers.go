package bridge

import (
	"encoding/json"
	"net/http"
)

func (s *Server) registerSwiftRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/bridge/bank/swift/status", s.handleSwiftStatus)
	mux.HandleFunc("/bridge/bank/swift/release", s.handleSwiftRelease)
}

func (s *Server) handleSwiftStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "GET only", http.StatusMethodNotAllowed)
		return
	}
	_ = s.b.ensureOnlineBank()
	writeJSON(w, s.b.SwiftSystemStatus())
}

func (s *Server) handleSwiftRelease(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req SwiftReleaseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	res, err := s.b.ReleaseFundsSwift(r.Context(), req)
	if err != nil {
		writeJSON(w, map[string]string{"error": err.Error(), "phase": "black", "screen": "black"})
		return
	}
	writeJSON(w, res)
}
