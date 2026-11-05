package game

import (
	"math/rand"
	"sync"
)

// ---------------------------------------------------------------- coach perks

// Every coach has one special skill (two from skill 15), picked from what suits his role. Perks
// are derived from the coach's id, so they never change and need no storage.
var rolePerks = map[string][]string{
	"head":        {"motivator", "tactician", "big_match", "negotiator"},
	"attack":      {"finishing", "set_piece", "youth_dev"},
	"defense":     {"organiser", "set_piece", "youth_dev"},
	"fitness":     {"recovery", "injury_prevention", "veteran_care"},
	"goalkeeping": {"shot_stopper", "youth_dev"},
	"physio":      {"quick_heal", "injury_prevention", "veteran_care"},
	"scout":       {"talent_eye", "negotiator"},
	"doctor":      {"diagnostician", "surgeon", "injury_prevention"}, // medical stream (medical.go)
}

// AllPerks lists every perk (for the UI).
var AllPerks = []string{"motivator", "tactician", "big_match", "negotiator", "finishing", "set_piece", "youth_dev",
	"organiser", "recovery", "injury_prevention", "veteran_care", "shot_stopper", "quick_heal", "talent_eye", "diagnostician", "surgeon"}

// perkCache keeps every answer of perksFor: seeding a math/rand source is slow and every world load asks
// for the perks of every coach in the country, so working them out each time cost a quarter of a request.
var perkCache sync.Map // perkKey → []string

type perkKey struct {
	id, nameLen int
	role        string
	two         bool
}

func perksFor(c *Coach) []string {
	opts := rolePerks[c.Role]
	if len(opts) == 0 || c.ID == 0 {
		return []string{}
	}
	n := 1
	if c.Skill >= 15 {
		n = 2
	}
	key := perkKey{c.ID, len(c.Name), c.Role, n == 2}
	if v, ok := perkCache.Load(key); ok {
		return append([]string{}, v.([]string)...)
	}
	r := rand.New(rand.NewSource(int64(c.ID)*7919 + int64(len(c.Name))*31))
	idx := r.Perm(len(opts))
	out := []string{}
	for i := 0; i < n && i < len(idx); i++ {
		out = append(out, opts[idx[i]])
	}
	perkCache.Store(key, out)
	return append([]string{}, out...)
}

// Perks is the set of perks a club's staff brings.
type Perks map[string]bool

func perksOf(coaches []*Coach) Perks {
	ps := Perks{}
	for _, c := range coaches {
		for _, p := range c.Perks {
			ps[p] = true
		}
	}
	return ps
}

func (w *world) perks(clubID int) Perks { return perksOf(w.coaches[clubID]) }

// applyPerkRating: the staff's specialities in the simulated match.
func applyPerkRating(r *TeamRating, ps Perks, bigGame bool) {
	m := 1.0
	if ps["motivator"] {
		m += 0.01
	}
	if ps["big_match"] && bigGame {
		m += 0.03
	}
	if ps["finishing"] {
		r.Attack *= 1.02
	}
	if ps["set_piece"] {
		r.Attack *= 1.01
		r.Defense *= 1.01
	}
	if ps["organiser"] {
		r.Defense *= 1.02
	}
	if ps["shot_stopper"] {
		r.Defense *= 1.015
	}
	r.Attack, r.Midfield, r.Defense, r.Overall = r.Attack*m, r.Midfield*m, r.Defense*m, r.Overall*m
}

// perkTraining: how a perk changes a player's daily training gain.
func perkGain(ps Perks, p *Player, attr string) float64 {
	g := 1.0
	if ps["youth_dev"] && p.Age <= 21 {
		g *= 1.25
	}
	if ps["finishing"] && attr == "shooting" {
		g *= 1.3
	}
	if ps["shot_stopper"] && attr == "goalkeeping" {
		g *= 1.3
	}
	return g
}

func perkRecovery(ps Perks, p *Player) float64 {
	rec := 0.0
	if ps["recovery"] {
		rec += 4
	}
	if ps["veteran_care"] && p.Age >= 30 {
		rec += 3
	}
	return rec
}

func perkInjury(ps Perks) float64 {
	if ps["injury_prevention"] {
		return 0.85
	}
	return 1
}

func perkList(ps Perks) []string {
	out := []string{}
	for _, p := range AllPerks {
		if ps[p] {
			out = append(out, p)
		}
	}
	return out
}
