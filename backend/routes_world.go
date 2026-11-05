package main

import (
	"net/http"
	"strconv"
	"strings"

	"pitchside/game"
)

// registerWorldRoutes: the world news feed (AI transfers, sackings, storylines, awards) and the
// stage stream's routes (routes_stage.go).
func registerWorldRoutes(mux *http.ServeMux, s *game.Store) {
	// ?kind=story,award limits the feed to those kinds
	mux.HandleFunc("GET /api/careers/{id}/news", career(s, func(r *http.Request, id int) (any, error) {
		limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
		var kinds []string
		for _, k := range strings.Split(r.URL.Query().Get("kind"), ",") {
			if k = strings.TrimSpace(k); k != "" {
				kinds = append(kinds, k)
			}
		}
		return s.News(r.Context(), id, limit, kinds...)
	}))
	registerStageRoutes(mux, s)
}
