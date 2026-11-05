package main

import (
	"net/http"

	"pitchside/game"
)

// registerStaffRoutes: HTTP routes of the staff work stream (the staff room, game/staff_*.go).
func registerStaffRoutes(mux *http.ServeMux, s *game.Store) {
	mux.HandleFunc("GET /api/careers/{id}/staff", career(s, func(r *http.Request, id int) (any, error) {
		return s.StaffRoom(r.Context(), id)
	}))
	// decide (id, choice) · mentor (coachId, playerId) · unmentor (playerId) · hire (coachId, years) · fire (coachId) · bonus (coachId)
	mux.HandleFunc("POST /api/careers/{id}/staff", career(s, func(r *http.Request, id int) (any, error) {
		var req game.StaffReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.StaffAction(r.Context(), id, req)
	}))
}
