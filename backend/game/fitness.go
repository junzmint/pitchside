package game

import (
	"context"
	"math"
	"math/rand"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- squad care: fitness, rotation, injuries

// Care holds the user's per-player fitness choices.
type Care struct {
	Load    map[int]string `json:"load"`              // player id → rest | recovery | intense (missing: follow the team plan)
	Rush    map[int]bool   `json:"rush"`              // players one week from fitness cleared to play anyway
	Rotate  int            `json:"rotate"`            // 0: off; otherwise starters below this fitness are rested before a match
	Develop int            `json:"develop,omitempty"` // development rotation: 0 off, 1 light, 2 medium, 3 heavy (devRotate)
	AutoXI  bool           `json:"autoXi"`            // the assistant picks the strongest available eleven before every match
	Bring   map[int]bool   `json:"bring,omitempty"`   // bench players to bring on first, so they get minutes and improve (autoSubs)
	Breaks  map[int]int    `json:"breaks,omitempty"`  // player id → season he last broke his limit (club.go)
}

var PlayerLoads = map[string]bool{"rest": true, "recovery": true, "intense": true}
var RotateOptions = map[int]bool{0: true, 50: true, 60: true, 70: true}

const (
	SubsMax       = 5
	RushPenalty   = 0.85 // a player rushed back plays at this share of his level
	RushInjury    = 0.08 // extra chance of breaking down again
	MidweekDrain  = 1.25 // fixture congestion: two games in one week
	MidweekInjury = 0.006
	SubsPlanned   = 3   // changes made for fresh legs (or to bring someone on); the last two are kept for the exhausted and the hurt
	BringMax      = 5   // bench players you can mark to bring on at a time
	BringFloor    = 0.6 // a marked player stays on the bench if he is below this share of the man he would replace (Effective)
)

// applyCare marks the user's players with their training load, whether they were rushed back, and the order in
// which the bench players you want to see play come on.
func applyCare(c *Career, squad []*Player) {
	var bring []*Player
	for _, p := range squad {
		p.Load = c.Care.Load[p.ID]
		p.Rushed = p.Injury == 1 && c.Care.Rush[p.ID]
		p.BrokeLimit = c.Care.Breaks[p.ID] == c.Season
		p.Bring = 0
		if c.Care.Bring[p.ID] {
			bring = append(bring, p)
		}
	}
	// whoever has waited longest for a game first, so marking several players shares the minutes out; then the
	// one with the most room to grow, then the younger
	sort.SliceStable(bring, func(i, j int) bool {
		a, b := bring[i], bring[j]
		if wa, wb := c.Events.Bench[a.ID], c.Events.Bench[b.ID]; wa != wb {
			return wa > wb
		}
		if ga, gb := a.Potential-a.Overall, b.Potential-b.Overall; ga != gb {
			return ga > gb
		}
		if a.Age != b.Age {
			return a.Age < b.Age
		}
		return a.ID < b.ID
	})
	for i, p := range bring {
		p.Bring = i + 1
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
	for id := range c.Care.Bring {
		if have[id] == nil {
			delete(c.Care.Bring, id)
		}
	}
	for id, season := range c.Care.Breaks {
		if have[id] == nil || season != c.Season {
			delete(c.Care.Breaks, id)
		}
	}
}

type CareReq struct {
	Load  *string `json:"load"`  // "" (follow the team plan) | rest | recovery | intense; nil: unchanged
	Rush  *bool   `json:"rush"`  // nil: unchanged
	Bring *bool   `json:"bring"` // bring him on first from the bench; nil: unchanged
}

// SetCare changes one player's training load, clears him to play while carrying a knock, or marks him to be
// brought on first from the bench.
func (s *Store) SetCare(ctx context.Context, careerID, playerID int, req CareReq) error {
	if req.Load != nil && *req.Load != "" && !PlayerLoads[*req.Load] {
		return userErr("bad_load", "Unknown training load")
	}
	return s.tx(ctx, func(q pgx.Tx) error {
		// queue behind a matchday being played: saving a career read before it would undo the day
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
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
		if req.Load != nil {
			if *req.Load == "" {
				delete(c.Care.Load, playerID)
			} else {
				c.Care.Load[playerID] = *req.Load
			}
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
		if req.Bring != nil {
			if c.Care.Bring == nil {
				c.Care.Bring = map[int]bool{}
			}
			if *req.Bring {
				if !c.Care.Bring[playerID] && len(c.Care.Bring) >= BringMax {
					return userErr("bring_max", "You can mark at most 5 players to bring on")
				}
				c.Care.Bring[playerID] = true
			} else {
				delete(c.Care.Bring, playerID)
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

// SetDevelop sets the development rotation (0 off … 3 heavy): see devRotate.
func (s *Store) SetDevelop(ctx context.Context, careerID, level int) error {
	if level < 0 || level >= len(DevRotation) {
		return userErr("bad_rotation", "Unknown rotation setting")
	}
	return s.tx(ctx, func(q pgx.Tx) error {
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		c.Care.Develop = level
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
	Bring  bool    `json:"bring,omitempty"` // a substitution: he came on because you marked him to bring on
	Why    string  `json:"why,omitempty"`   // a change before kick-off: "dev" for development rotation (else tired)
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

// ---------------------------------------------------------------- development rotation

// DevRotation: the levels of the development rotation (Care.Develop): starters swapped per match, how close
// the newcomer must be to the man rested (Effective), and after how many matches without a game the reserve
// keeper starts (0: never).
var DevRotation = [4]struct {
	Swaps  int
	Floor  float64
	Keeper int
}{{}, {1, 0.9, 0}, {2, 0.85, 5}, {3, 0.8, 4}}

// devRotate: rotation for development. Before a match the bench players who have waited longest for a game
// (waited: Events.Bench) start in place of the most tired starter of their line (a keeper for the keeper, now
// and then), so the whole squad plays and improves; a newcomer far below the man he would rest stays out.
// Deterministic: the pre-match screen shows the same changes the match then makes.
func devRotate(level int, starters []*Player, roles []string, bench []*Player, waited map[int]int) (notes []SwapNote) {
	if level <= 0 || level >= len(DevRotation) {
		return nil
	}
	cfg := DevRotation[level]
	var cands []*Player
	for _, b := range bench {
		if b.Injury == 0 && !b.Rushed && b.Fitness >= 70 {
			cands = append(cands, b)
		}
	}
	// longest wait first, then the most room to grow, then the younger
	sort.SliceStable(cands, func(i, j int) bool {
		a, b := cands[i], cands[j]
		if waited[a.ID] != waited[b.ID] {
			return waited[a.ID] > waited[b.ID]
		}
		if ga, gb := a.Potential-a.Overall, b.Potential-b.Overall; ga != gb {
			return ga > gb
		}
		if a.Age != b.Age {
			return a.Age < b.Age
		}
		return a.ID < b.ID
	})
	changed := map[int]bool{}
	for _, in := range cands {
		if len(notes) >= cfg.Swaps {
			break
		}
		gk := in.Position == "GK"
		if gk && (cfg.Keeper == 0 || waited[in.ID] < cfg.Keeper) {
			continue
		}
		slot := -1
		for i, role := range roles {
			out := starters[i]
			if out == nil || changed[i] || (role == "GK") != gk || (!gk && RoleCat(role) != in.Position) {
				continue
			}
			if Effective(in, role) < Effective(out, role)*cfg.Floor {
				continue
			}
			// the most tired; between equally fresh men, the one whose rest costs the side least
			if slot < 0 || out.Fitness < starters[slot].Fitness ||
				(out.Fitness == starters[slot].Fitness && Effective(out, role) < Effective(starters[slot], roles[slot])) {
				slot = i
			}
		}
		if slot < 0 {
			continue
		}
		out := starters[slot]
		starters[slot] = in
		changed[slot] = true
		notes = append(notes, SwapNote{Out: out.Name, In: in.Name, OutFit: math.Round(out.Fitness), InFit: math.Round(in.Fitness), Why: "dev"})
	}
	return notes
}

// bigTie: a match the development rotation leaves alone: cup ties from the quarter-finals on and European
// knockout ties.
func bigTie(f *Fixture) bool {
	if f == nil {
		return false
	}
	switch f.Comp {
	case "cup":
		return f.Stage == "QF" || f.Stage == "SF" || f.Stage == "F"
	case "cl":
		return !strings.HasPrefix(f.Stage, "G")
	}
	return false
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

// autoSubs: the bench comes on for tired or rushed players, and for fresh legs late on. On your team the bench
// players you marked (Player.Bring, in that order) come on first: around the hour, each for the most tired man in
// his line (a keeper for the keeper), unless he is far below him (BringFloor). They use the SubsPlanned changes
// before anyone else does; the last two stay for the exhausted and the hurt.
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
	ready := func(b *Player) bool { return !used[b.ID] && !b.Rushed && b.Fitness >= 60 }
	var marked []*Player
	for _, b := range sh.Bench {
		if b.Bring > 0 {
			marked = append(marked, b)
		}
	}
	sort.SliceStable(marked, func(i, j int) bool { return marked[i].Bring < marked[j].Bring })
	changed := map[int]bool{}
	add := func(slot int, in *Player, min int) {
		used[in.ID], changed[slot] = true, true
		sh.Subs = append(sh.Subs, Sub{Slot: slot, Out: sh.Starters[slot], In: in, Minute: min})
	}
	// fits: he can take this slot without the side falling apart (BringFloor of the man he replaces)
	fits := func(b *Player, slot int) bool {
		role := sh.Roles[slot]
		return Effective(b, role) >= Effective(sh.Starters[slot], role)*BringFloor
	}

	// 1. the exhausted and the rushed come off; a marked player of that line takes the place if he can (three of
	// them at most, as many as step 2 could bring on)
	brought := 0
	for _, c := range cs {
		if !c.need || len(sh.Subs) >= SubsMax {
			continue
		}
		var in *Player
		for _, b := range marked {
			if brought < SubsPlanned && ready(b) && b.Position == RoleCat(sh.Roles[c.slot]) && fits(b, c.slot) {
				in = b
				brought++
				break
			}
		}
		if in == nil {
			in = bestSub(sh, c.slot, ready, 0.75)
		}
		if in != nil {
			add(c.slot, in, 52+r.Intn(16))
		}
	}
	// 2. the players you marked, for the most tired man in their line (failing that, any place they can fill)
	for _, b := range marked {
		if len(sh.Subs) >= SubsPlanned {
			break
		}
		if !ready(b) {
			continue
		}
		slot := -1
		if b.Position == "GK" {
			for i, role := range sh.Roles {
				if role == "GK" && sh.Starters[i] != nil && !changed[i] && fits(b, i) {
					slot = i
				}
			}
		} else {
			for pass := 0; pass < 2 && slot < 0; pass++ {
				for _, c := range cs {
					if !changed[c.slot] && (pass == 1 || RoleCat(sh.Roles[c.slot]) == b.Position) && fits(b, c.slot) {
						slot = c.slot
						break
					}
				}
			}
		}
		if slot >= 0 {
			add(slot, b, 55+r.Intn(16))
		}
	}
	// 3. fresh legs for the most tired, from anyone nearly as good
	for _, c := range cs {
		if len(sh.Subs) >= SubsPlanned {
			break
		}
		if c.need || changed[c.slot] {
			continue
		}
		if in := bestSub(sh, c.slot, ready, 0.9); in != nil {
			add(c.slot, in, 60+r.Intn(20))
		}
	}
}

// bestSub: the outfield bench player who would play the slot best, if he is at least floor of the man there now.
func bestSub(sh *TeamSheet, slot int, ready func(*Player) bool, floor float64) *Player {
	role := sh.Roles[slot]
	var best *Player
	bestR := 0.0
	for _, b := range sh.Bench {
		if !ready(b) || b.Position == "GK" {
			continue
		}
		if v := Effective(b, role); v > bestR {
			best, bestR = b, v
		}
	}
	if best == nil || bestR < Effective(sh.Starters[slot], role)*floor {
		return nil
	}
	return best
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
