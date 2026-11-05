package main

import (
	"net/http"

	"pitchside/game"
)

// registerExploreRoutes: HTTP routes of the explore work stream (use the career() helper from main.go).
func registerExploreRoutes(mux *http.ServeMux, s *game.Store) {
	mux.HandleFunc("GET /api/careers/{id}/explore", career(s, func(r *http.Request, id int) (any, error) {
		return s.ExploreFull(r.Context(), id)
	}))
	mux.HandleFunc("GET /api/careers/{id}/explore/album", career(s, func(r *http.Request, id int) (any, error) {
		return s.Album(r.Context(), id)
	}))
	mux.HandleFunc("POST /api/careers/{id}/explore/missions", career(s, func(r *http.Request, id int) (any, error) {
		var req game.MissionReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.StartMission(r.Context(), id, req)
	}))
	mux.HandleFunc("POST /api/careers/{id}/explore/seen", career(s, func(r *http.Request, id int) (any, error) {
		return nil, s.MarkExploreSeen(r.Context(), id)
	}))
	mux.HandleFunc("POST /api/careers/{id}/explore/finds/{pid}/star", career(s, func(r *http.Request, id int) (any, error) {
		pid, err := intParam(r, "pid")
		if err != nil {
			return nil, err
		}
		return nil, s.StarFind(r.Context(), id, pid)
	}))
	mux.HandleFunc("POST /api/careers/{id}/explore/claim", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			Key string `json:"key"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.ClaimAchievements(r.Context(), id, req.Key)
	}))
	mux.HandleFunc("POST /api/careers/{id}/explore/title", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			Key string `json:"key"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.SetTitle(r.Context(), id, req.Key)
	}))
	mux.HandleFunc("POST /api/careers/{id}/explore/celebrations/ack", career(s, func(r *http.Request, id int) (any, error) {
		var req struct {
			ID int `json:"id"`
		}
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return nil, s.AckCelebration(r.Context(), id, req.ID)
	}))
}
