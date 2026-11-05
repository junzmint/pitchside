package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"log"

	"pitchside/game"
)

//go:embed seed.json
var seedJSON []byte

type seedFile struct {
	Users []struct {
		Username string       `json:"username"`
		Password string       `json:"password"`
		Careers  []seedCareer `json:"careers"`
	} `json:"users"`
}

type seedCareer struct {
	League        string             `json:"league"`
	ClubIndex     int                `json:"clubIndex"`
	Division      int                `json:"division"`
	Custom        *game.CustomClub   `json:"custom"`
	Sponsor       *int               `json:"sponsor"`
	SimulateDays  int                `json:"simulateDays"`
	CustomPlayers []game.TemplateReq `json:"customPlayers"`
}

// runSeed loads demo accounts and careers from seed.json. Users that already exist are skipped,
// so it is safe to run more than once.
func runSeed(ctx context.Context, s *game.Store) error {
	var f seedFile
	if err := json.Unmarshal(seedJSON, &f); err != nil {
		return fmt.Errorf("seed.json: %w", err)
	}
	for _, u := range f.Users {
		user, _, err := s.Register(ctx, u.Username, u.Password)
		if err != nil {
			if ue, ok := game.IsUserErr(err); ok && ue.Code == "username_taken" {
				log.Printf("seed: user %q exists, skipped", u.Username)
				continue
			}
			return fmt.Errorf("seed user %s: %w", u.Username, err)
		}
		for i, c := range u.Careers {
			id, err := s.NewCareer(ctx, user.ID, game.NewCareerReq{League: c.League, ClubIndex: c.ClubIndex, Division: c.Division, Custom: c.Custom})
			if err != nil {
				return fmt.Errorf("seed career %s#%d: %w", u.Username, i, err)
			}
			if c.Sponsor != nil {
				if err := s.ChooseSponsor(ctx, id, *c.Sponsor); err != nil {
					return fmt.Errorf("seed sponsor: %w", err)
				}
			}
			for _, p := range c.CustomPlayers {
				if err := s.CreateTemplate(ctx, id, p); err != nil {
					return fmt.Errorf("seed custom player %s: %w", p.Name, err)
				}
			}
			for d := 0; d < c.SimulateDays; d++ {
				if _, err := s.PlayDay(ctx, id, game.MatchResultReq{Mode: "sim"}); err != nil {
					return fmt.Errorf("seed simulate: %w", err)
				}
			}
			log.Printf("seed: %s · career %d (%s) · %d matchday(s) played", u.Username, id, c.League, c.SimulateDays)
		}
	}
	game.Analyze(ctx, s.DB)
	return nil
}

// seedIfEmpty runs the seed on a brand-new database (no users yet).
func seedIfEmpty(ctx context.Context, s *game.Store) {
	var n int
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n); err != nil || n > 0 {
		return
	}
	log.Printf("seed: empty database, loading demo data…")
	if err := runSeed(ctx, s); err != nil {
		log.Printf("seed failed: %v", err)
	}
}
