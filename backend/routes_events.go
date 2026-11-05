package main

import (
	"net/http"

	"pitchside/game"
)

// registerEventRoutes: HTTP routes of the events work stream (use the career() helper from main.go).
func registerEventRoutes(mux *http.ServeMux, s *game.Store) {
	// every club-life decision: press | talk | youth | bid | loan_out | loan_in | captain
	mux.HandleFunc("POST /api/careers/{id}/events", career(s, func(r *http.Request, id int) (any, error) {
		var req game.EventReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.EventAction(r.Context(), id, req)
	}))
	// players other clubs will lend you
	mux.HandleFunc("GET /api/careers/{id}/events/loans", career(s, func(r *http.Request, id int) (any, error) {
		return s.LoanMarket(r.Context(), id)
	}))
}
