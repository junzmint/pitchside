package main

import (
	"net/http"

	"pitchside/game"
)

// registerMedicalRoutes: HTTP routes of the medical work stream (injuries, treatment, the medical team).
func registerMedicalRoutes(mux *http.ServeMux, s *game.Store) {
	mux.HandleFunc("GET /api/careers/{id}/medical", career(s, func(r *http.Request, id int) (any, error) {
		return s.Medical(r.Context(), id)
	}))
	// card (id, choice) · inject (playerId)
	mux.HandleFunc("POST /api/careers/{id}/medical", career(s, func(r *http.Request, id int) (any, error) {
		var req game.MedReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.MedicalAction(r.Context(), id, req)
	}))
}
