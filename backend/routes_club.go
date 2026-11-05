package main

import (
	"net/http"

	"pitchside/game"
)

// registerClubRoutes: HTTP routes of the club work stream (fans, pre-season tour, Deadline Day,
// Legends wall). Deadline Day bids are answered through the events route (action "bid").
func registerClubRoutes(mux *http.ServeMux, s *game.Store) {
	mux.HandleFunc("GET /api/careers/{id}/clublife", career(s, func(r *http.Request, id int) (any, error) {
		return s.ClubLifeInfo(r.Context(), id)
	}))
	// tour (key: far | local | camp) · bargain (playerId) · honour (playerId, choice: retire | keep)
	mux.HandleFunc("POST /api/careers/{id}/clublife", career(s, func(r *http.Request, id int) (any, error) {
		var req game.ClubReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.ClubAction(r.Context(), id, req)
	}))
}
