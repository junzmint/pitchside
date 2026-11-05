package game

import (
	"context"
	"math"
	"math/rand"
	"sort"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- squad care: fitness, rotation, injuries

// Care holds the user's per-player fitness choices.
type Care struct {
	Load   map[int]string `json:"load"`             // player id → rest | recovery | intense (missing: follow the team plan)
	Rush   map[int]bool   `json:"rush"`             // players one week from fitness cleared to play anyway
	Rotate int            `json:"rotate"`           // 0: off; otherwise starters below this fitness are rested before a match
	AutoXI bool           `json:"autoXi"`           // the assistant picks the strongest available eleven before every match
	Breaks map[int]int    `json:"breaks,omitempty"` // player id → season he last broke his limit (club.go)
}

var PlayerLoads = map[string]bool{"rest": true, "recovery": true, "intense": true}
var RotateOptions = map[int]bool{0: true, 50: true, 60: true, 70: true}

const (
	SubsMax       = 5
	RushPenalty   = 0.85 // a player rushed back plays at this share of his level
	RushInjury    = 0.08 // extra chance of breaking down again
	MidweekDrain  = 1.25 // fixture congestion: two games in one week
	MidweekInjury = 0.006
)

// applyCare marks the user's players with their training load and whether they were rushed back.
func applyCare(c *Career, squad []*Player) {
	for _, p := range squad {
		p.Load = c.Care.Load[p.ID]
		p.Rushed = p.Injury == 1 && c.Care.Rush[p.ID]
		p.BrokeLimit = c.Care.Breaks[p.ID] == c.Season
	}
}

// pruneCare forgets settings for players who left or have healed.
func pruneCare(c *Career, squad []*Player) {
	have := map[int]*Player{}
	for _, p := range squad {
		if p.ClubID != nil && *p.ClubID == c.UserClubID {
			have[p.ID] = p
		}
	}
	for id := range c.Care.Load {
		if have[id] == nil {
			delete(c.Care.Load, id)
		}
	}
	for id := range c.Care.Rush {
		if p := have[id]; p == nil || p.Injury == 0 {
			delete(c.Care.Rush, id)
		}
	}
	for id, season := range c.Care.Breaks {
		if have[id] == nil || season != c.Season {
			delete(c.Care.Breaks, id)
		}
	}
}

type CareReq struct {
	Load string `json:"load"` // "" | rest | recovery | intense
	Rush *bool  `json:"rush"`
}

// SetCare changes one player's training load or clears him to play while carrying a knock.
func (s *Store) SetCare(ctx context.Context, careerID, playerID int, req CareReq) error {
	if req.Load != "" && !PlayerLoads[req.Load] {
		return userErr("bad_load", "Unknown training load")
	}
	return s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		p, err := getPlayer(ctx, q, careerID, playerID)
		if err != nil {
			return err
		}
		if p.ClubID == nil || *p.ClubID != c.UserClubID {
			return userErr("not_yours", "This player is not at your club")
		}
		if c.Care.Load == nil {
			c.Care.Load = map[int]string{}
		}
		if c.Care.Rush == nil {
			c.Care.Rush = map[int]bool{}
		}
		if req.Load == "" {
			delete(c.Care.Load, playerID)
		} else {
			c.Care.Load[playerID] = req.Load
		}
		if req.Rush != nil {
			if *req.Rush {
				if p.Injury != 1 {
					return userErr("rush_only_last_week", "Only a player in his last week out can be rushed back")
				}
				c.Care.Rush[playerID] = true
			} else {
				delete(c.Care.Rush, playerID)
			}
		}
		return saveCareer(ctx, q, c)
	})
}

// SetAutoXI lets the assistant pick the team (on) or leaves it to the manager (off).
func (s *Store) SetAutoXI(ctx context.Context, careerID int, on bool) error {
	return s.tx(ctx, func(q pgx.Tx) error {
		// queue behind a matchday being played: saving a career read before it would undo the day
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		c.Care.AutoXI = on
		if on {
			club, err := getClub(ctx, q, c.UserClubID)
			if err != nil {
				return err
			}
			squad, err := queryPlayers(ctx, q, `career_id=$1 AND club_id=$2`, careerID, club.ID)
			if err != nil {
				return err
			}
			club.Lineup = BestLineup(squad, club.Formation)
			if err := saveClub(ctx, q, club); err != nil {
				return err
			}
		}
		return saveCareer(ctx, q, c)
	})
}

// SetRotation turns automatic squad rotation on (a fitness threshold) or off (0).
func (s *Store) SetRotation(ctx context.Context, careerID, threshold int) error {
	if !RotateOptions[threshold] {
		return userErr("bad_rotation", "Unknown rotation setting")
	}
	return s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		c.Care.Rotate = threshold
		return saveCareer(ctx, q, c)
	})
}

// ---------------------------------------------------------------- rotation before kick-off

type SwapNote struct {
	Out    string  `json:"out"`
	In     string  `json:"in"`
	OutFit float64 `json:"outFit"`
	InFit  float64 `json:"inFit"`
	Minute int     `json:"minute,omitempty"`
}

// rotate rests tired starters, bringing in the best fresh player for the same slot.
func rotate(threshold int, starters []*Player, roles []string, bench []*Player) (notes []SwapNote) {
	if threshold <= 0 {
		return nil
	}
	used := map[int]bool{}
	for _, p := range starters {
		if p != nil {
			used[p.ID] = true
		}
	}
	for i, p := range starters {
		if p == nil || p.Fitness >= float64(threshold) {
			continue
		}
		var best *Player
		bestR := 0.0
		for _, b := range bench {
			if used[b.ID] || b.Rushed || b.Fitness < float64(threshold) || (roles[i] == "GK") != (b.Position == "GK") {
				continue
			}
			if r := Effective(b, roles[i]); r > bestR {
				best, bestR = b, r
			}
		}
		// don't swap a star for someone far worse just because he is tired
		if best == nil || bestR < Effective(p, roles[i])*0.82 {
			continue
		}
		used[best.ID] = true
		starters[i] = best
		notes = append(notes, SwapNote{Out: p.Name, In: best.Name, OutFit: math.Round(p.Fitness), InFit: math.Round(best.Fitness)})
	}
	return notes
}

// ---------------------------------------------------------------- substitutions

type Sub struct {
	Slot   int
	Out    *Player
	In     *Player
	Minute int
}

type SubReq struct {
	Out    int `json:"out"`
	In     int `json:"in"`
	Minute int `json:"minute"`
}

func projectedEnd(p *Player, drain float64) float64 {
	return p.Fitness - drain*(1.15-p.Physical/250)
}

// autoSubs: the bench comes on for tired or rushed players, and for fresh legs late on.
func autoSubs(r *rand.Rand, sh *TeamSheet, drain float64) {
	type cand struct {
		slot int
		end  float64
		need bool
	}
	var cs []cand
	for i, p := range sh.Starters {
		if p == nil || sh.Roles[i] == "GK" {
			continue
		}
		end := projectedEnd(p, drain)
		cs = append(cs, cand{i, end, end < 50 || p.Rushed})
	}
	// players who must come off first (exhausted or carrying a knock), then the most tired
	sort.Slice(cs, func(a, b int) bool {
		if cs[a].need != cs[b].need {
			return cs[a].need
		}
		return cs[a].end < cs[b].end
	})
	used := map[int]bool{}
	for _, p := range sh.Starters {
		if p != nil {
			used[p.ID] = true
		}
	}
	for _, c := range cs {
		if len(sh.Subs) >= SubsMax || (!c.need && len(sh.Subs) >= 3) {
			break
		}

		out := sh.Starters[c.slot]
		role := sh.Roles[c.slot]
		var best *Player
		bestR := 0.0
		for _, b := range sh.Bench {
			if used[b.ID] || b.Rushed || b.Position == "GK" || b.Fitness < 60 {
				continue
			}
			if v := Effective(b, role); v > bestR {
				best, bestR = b, v
			}
		}
		floor := 0.9
		if c.need {
			floor = 0.75
		}
		if best == nil || bestR < Effective(out, role)*floor {
			continue
		}
		used[best.ID] = true
		min := 60 + r.Intn(20)
		if c.need {
			min = 52 + r.Intn(16)
		}
		sh.Subs = append(sh.Subs, Sub{Slot: c.slot, Out: out, In: best, Minute: min})
	}
}

// liveSubs validates the changes the user made during a live match.
func liveSubs(sh *TeamSheet, reqs []SubReq) {
	slot := map[int]int{}
	occupant := map[int]*Player{}
	for i, p := range sh.Starters {
		if p != nil {
			slot[p.ID] = i
			occupant[i] = p
		}
	}
	bench := map[int]*Player{}
	for _, b := range sh.Bench {
		bench[b.ID] = b
	}
	for _, s := range reqs {
		i, ok := slot[s.Out]
		in := bench[s.In]
		if !ok || in == nil || len(sh.Subs) >= SubsMax {
			continue
		}
		m := max(1, min(89, s.Minute))
		sh.Subs = append(sh.Subs, Sub{Slot: i, Out: occupant[i], In: in, Minute: m})
		delete(slot, s.Out)
		delete(bench, s.In)
		slot[s.In] = i // a substitute can be replaced again
		occupant[i] = in
	}
}

// creditSubs hands some goals and assists of substituted players to the men who replaced them.
func creditSubs(r *rand.Rand, res *SimResult, sheets ...*TeamSheet) {
	repl := map[int]Sub{}
	for _, sh := range sheets {
		for _, s := range sh.Subs {
			repl[s.Out.ID] = s
		}
	}
	swap := func(id int) int {
		if s, ok := repl[id]; ok && r.Float64() < float64(90-s.Minute)/90 {
			return s.In.ID
		}
		return id
	}
	for i := range res.Scorers {
		res.Scorers[i] = swap(res.Scorers[i])
		if i < len(res.Assists) && res.Assists[i] != 0 {
			if a := swap(res.Assists[i]); a != res.Scorers[i] {
				res.Assists[i] = a
			}
		}
	}
}

// ---------------------------------------------------------------- fixture congestion

// congested: a midweek game, i.e. the club also played yesterday and one of the two is a cup game.
func (w *world) congested(clubID int, f *Fixture) bool {
	d := f.Day
	if d < 2 || d > len(Calendar) {
		return false
	}
	if Calendar[d-1].Comp == "league" && Calendar[d-2].Comp == "league" {
		return false
	}
	for _, g := range w.fixtures {
		if g.Day == d-1 && g.Played && (g.HomeID == clubID || g.AwayID == clubID) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- medical centre

func medicalRisk(lvl int) float64 { return 1 - 0.08*float64(max(1, lvl)-1) }
