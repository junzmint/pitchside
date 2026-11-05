package main

import (
	"net/http"

	"pitchside/game"
)

// registerPlayRoutes: HTTP routes of the modes work stream (quick match, training ground).
// LAN play has its own relay in lan.go.
func registerPlayRoutes(mux *http.ServeMux, s *game.Store) {
	// every team a quick match can use: the 240 league clubs and the Legends XIs (static data)
	mux.HandleFunc("GET /api/play/teams", wrap(func(r *http.Request) (any, error) { return game.QuickTeams(), nil }))
	// a live-match setup for any two teams; nothing is saved
	mux.HandleFunc("POST /api/play/quick", authed(s, func(r *http.Request) (any, error) {
		var req game.QuickReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return game.QuickMatch(req)
	}))
	// training ground: a gold medal earns the career +1 TP, at most once per matchday
	mux.HandleFunc("GET /api/careers/{id}/play/drill", career(s, func(r *http.Request, id int) (any, error) {
		return s.DrillRewardInfo(r.Context(), id)
	}))
	mux.HandleFunc("POST /api/careers/{id}/play/drill", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			Drill string `json:"drill"`
			Score int    `json:"score"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.ClaimDrillReward(r.Context(), id, req.Drill, req.Score)
	}))
}
