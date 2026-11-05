package main

import (
	"net/http"
	"strconv"

	"pitchside/game"
)

// registerStageRoutes: HTTP routes of the stage work stream (Golden Ball night, the summer
// international tournament, cup draw ceremonies). Registered from registerWorldRoutes.
func registerStageRoutes(mux *http.ServeMux, s *game.Store) {
	// what the pop-up host should show next: an award night, a tournament, a cup draw
	mux.HandleFunc("GET /api/careers/{id}/stage/pending", career(s, func(r *http.Request, id int) (any, error) {
		return s.StagePending(r.Context(), id)
	}))
	mux.HandleFunc("POST /api/careers/{id}/stage/ack", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			Kind string `json:"kind"`
			ID   int    `json:"id"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.StageAck(r.Context(), id, req.Kind, req.ID)
	}))
	// award history (every Golden Ball night) and past tournaments
	mux.HandleFunc("GET /api/careers/{id}/stage/awards", career(s, func(r *http.Request, id int) (any, error) {
		return s.StageAwards(r.Context(), id)
	}))
	mux.HandleFunc("GET /api/careers/{id}/stage/awards/{season}", career(s, func(r *http.Request, id int) (any, error) {
		season, err := intParam(r, "season")
		if err != nil {
			return nil, err
		}
		return s.StageAwardNight(r.Context(), id, season)
	}))
	// one tournament (season = the season it followed; 0 or "latest" = the most recent)
	mux.HandleFunc("GET /api/careers/{id}/stage/tournament/{season}", career(s, func(r *http.Request, id int) (any, error) {
		season, _ := strconv.Atoi(r.PathValue("season"))
		return s.StageTournament(r.Context(), id, season)
	}))
}
