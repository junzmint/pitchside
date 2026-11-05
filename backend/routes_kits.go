package main

import (
	"net/http"

	"pitchside/game"
)

// registerKitRoutes: the club's kits — see them, design them, or go back to the defaults.
func registerKitRoutes(mux *http.ServeMux, s *game.Store) {
	mux.HandleFunc("GET /api/careers/{id}/kits", career(s, func(r *http.Request, id int) (any, error) {
		return s.KitsInfo(r.Context(), id)
	}))
	mux.HandleFunc("PUT /api/careers/{id}/kits", career(s, func(r *http.Request, id int) (any, error) {
		var req game.KitsReq
		if err := decode(r, &req); err != nil {
			return nil, err
		}
		return s.SaveKits(r.Context(), id, req)
	}))
	mux.HandleFunc("DELETE /api/careers/{id}/kits", career(s, func(r *http.Request, id int) (any, error) {
		return s.SaveKits(r.Context(), id, game.KitsReq{})
	}))
}
