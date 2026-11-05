package game

import (
	"context"
	"math"
	"math/rand"
	"sort"
	"sync"
)

// ---------------------------------------------------------------- player growth
//
// Players improve mostly by playing. A day of training adds a little; minutes on the pitch add
// the most, more for a good game and in a big one. A teenager who starts every week climbs about
// six overall points a season, one who comes off the bench a few, one nobody picks barely moves.
// Growth slows as a player nears his potential and stops after 31 (legends keep a slow creep).

func ageFactor(age int) float64 {
	switch {
	case age <= 20:
		return 1.3
	case age <= 23:
		return 1.0
	case age <= 26:
		return 0.7
	case age <= 29:
		return 0.4
	case age <= 31:
		return 0.15
	}
	return 0
}

var attrCoach = map[string]string{"shooting": "attack", "dribbling": "attack", "passing": "attack",
	"defending": "defense", "physical": "fitness", "pace": "fitness", "goalkeeping": "goalkeeping"}

func keyAttrs(pos string) []string {
	growthOnce.Do(initGrowth)
	if k, ok := keyAttrsOf[pos]; ok {
		return k
	}
	var out []string
	for _, a := range AttrNames {
		if templates[pos][a] > -15 {
			out = append(out, a)
		}
	}
	return out
}

// Key attributes and growth pace per position, worked out once. Growth spreads two points over
// the key attributes; a keeper has two of them and a midfielder six, so without a correction
// keepers would grow two and a half times faster. growthNorm evens that out: every position's
// overall rises at the same pace (the defenders' and forwards' 0.4 per point).
var (
	keyAttrsOf = map[string][]string{}
	growthNorm = map[string]float64{}
	growthOnce sync.Once
)

func initGrowth() {
	for pos := range templates {
		var keys []string
		for _, a := range AttrNames {
			if templates[pos][a] > -15 {
				keys = append(keys, a)
			}
		}
		keyAttrsOf[pos] = keys
		w := 0.0 // how far one point on every key attribute moves the overall
		for _, a := range keys {
			p := &Player{}
			*p.Attr(a) = 1
			w += OverallAs(p, pos)
		}
		growthNorm[pos] = 1
		if w > 0 && len(keys) > 0 {
			growthNorm[pos] = 0.4 / (2 / float64(len(keys)) * w)
		}
	}
}

func growthScale(pos string) float64 {
	growthOnce.Do(initGrowth)
	if v, ok := growthNorm[pos]; ok {
		return v
	}
	return 1
}

// Growth units. TrainBase is one unit for a normal player (legends: 0.9, see growthUnit). Each
// day's training gives TrainShare of a unit; a full 90 minutes gives MatchShare, scaled by the
// match rating (perfGrowth) and the occasion (compGrowth). A substitute counts his minutes plus
// SubLift for the experience of coming on. TrainCondSoft: above this, better conditions (load,
// facility, coaches, perks) add only 20% of their effect.
const (
	TrainBase     = 0.20
	TrainShare    = 0.25
	MatchShare    = 0.85
	SubLift       = 0.1
	TrainCondSoft = 1.25
)

// Morale after every match: ±6 for a win or a loss, then 8% of the way back to 65.
const (
	MoraleRest  = 65.0
	MoraleDrift = 0.08
)

// Training loads: the team plan (light | normal | hard) or a player's own (rest | recovery | intense).
var trainGain = map[string]float64{"rest": 0, "recovery": 0.35, "light": 0.6, "normal": 1, "hard": 1.45, "intense": 1.7}
var trainRecovery = map[string]float64{"rest": 18, "recovery": 12, "light": 8, "normal": 0, "hard": -8, "intense": -12}
var trainRisk = map[string]float64{"rest": 0, "recovery": 0.0005, "light": 0.001, "normal": 0.004, "hard": 0.012, "intense": 0.02}

// compGrowth: a European night teaches more than a league game; a friendly half as much.
func compGrowth(comp string) float64 {
	switch comp {
	case "cl":
		return 1.2
	case "friendly":
		return 0.5
	}
	return 1
}

// perfGrowth: a good game (7+) lifts a player more than a poor one.
func perfGrowth(rating float64) float64 { return clamp(1+(rating-6.5)*0.2, 0.7, 1.4) }

// Potential is where a player is heading, not a wall: growth slows as he nears it and goes on past it,
// more slowly the further past (PastPotential, fading by e every PastPotentialFade points), up to the 99 cap.
// Icons (110 cap) keep more pace past theirs. A high potential makes growth easy; it never guarantees it.
var (
	PastPotential     = 0.3
	PastPotentialFade = 5.0
	IconPastPotential = 0.3
	IconPastFade      = 6.0
)

// gapFactor: how much room to grow a player has, from how far he is below (or past) his potential.
func gapFactor(p *Player, ovr float64) float64 {
	gap := float64(p.Potential) - ovr
	if isLegend(p) {
		return math.Max(clamp(gap/8, 0, 1.4), IconPastPotential*math.Exp(math.Min(0, gap)/IconPastFade))
	}
	return math.Max(clamp(gap/12, 0, 1.2), PastPotential*math.Exp(math.Min(0, gap)/PastPotentialFade))
}

// growthUnit: how far one unit moves this player — most for a gifted teenager far from his
// potential, less near it and past it, and with age.
func growthUnit(p *Player) float64 {
	ovr := OverallAs(p, p.Position)
	gapF := gapFactor(p, ovr)
	af := ageFactor(p.Age)
	base := TrainBase
	if isLegend(p) {
		// ageless, but slow to improve: legends keep their own creep towards the modern ceiling
		af, base = LegendGrowth, 0.9
	}
	return base * af * gapF * devFactor(p) * growthScale(p.Position) * (1 + p.GrowBoost)
}

// grow spreads units of growth over the player's key attributes (more on his focus), scaled by
// the conditions: load (inten), facility level, coaches and perks, with diminishing returns at
// the top so the best set-up adds about a third instead of doubling growth.
func grow(r *rand.Rand, p *Player, coaches []*Coach, inten float64, isUser bool, lvl int, units float64) {
	pts := growthUnit(p) * units
	if pts <= 0 || inten <= 0 {
		return
	}
	lvlF := 1 + 0.1*float64(max(1, lvl)-1)
	ps := perksOf(coaches)
	gain := func(a string, share float64) {
		cf := 1.0
		if isUser {
			cf = 0.4
			if sk := coachSkill(coaches, attrCoach[a]); sk > 0 {
				cf = 0.4 + float64(sk)/12
			}
		}
		cond := inten * lvlF * cf * perkGain(ps, p, a)
		if cond > TrainCondSoft {
			cond = TrainCondSoft + (cond-TrainCondSoft)*0.2
		}
		v := p.Attr(a)
		*v = math.Min(attrCap(p), *v+pts*share*cond*(0.7+r.Float64()*0.6))
	}
	keys := keyAttrs(p.Position)
	if isUser && p.Focus != "balanced" && p.Attr(p.Focus) != nil {
		gain(p.Focus, 1.6)
		for _, a := range keys {
			gain(a, 0.7/float64(len(keys)))
		}
	} else {
		for _, a := range keys {
			gain(a, 2.0/float64(len(keys)))
		}
	}
}

// train: one matchday on the training ground. Injured players only recover; the rest improve a
// little (playing is what really brings them on, see matchGrowth) and get their legs back.
func train(r *rand.Rand, p *Player, coaches []*Coach, intensity string, isUser bool, facility ...int) {
	lvl := 1
	if len(facility) > 0 && facility[0] > 1 {
		lvl = facility[0]
	}
	if p.Injury > 0 {
		p.Fitness = clamp(p.Fitness+12, 25, 100)
		return
	}
	inten, ok := trainGain[intensity]
	if !ok || !isUser {
		inten = 1
	}
	grow(r, p, coaches, inten, isUser, lvl, TrainShare)
	// (ageing happens once a season, see ageDecline)
	rec := 16.0
	if isUser {
		rec = 10 + float64(coachSkill(coaches, "fitness"))*0.5 + 1.5*float64(lvl-1)
		rec += trainRecovery[intensity]
		rec += perkRecovery(perksOf(coaches), p)
	}
	if rec > 0 {
		rec /= staminaAge(p) // older legs recover slower
	}
	p.Fitness = clamp(p.Fitness+rec, 25, 100)
}

// matchGrowth: what a game teaches. share is the part of the 90 minutes he was on the pitch,
// rating his match rating, comp the competition. Returns the growth units earned.
func matchGrowth(r *rand.Rand, p *Player, coaches []*Coach, isUser bool, lvl int, share, rating float64, comp string, sub bool) float64 {
	if sub {
		share += SubLift
	}
	units := MatchShare * math.Min(1, share) * perfGrowth(rating) * compGrowth(comp)
	grow(r, p, coaches, 1, isUser, lvl, units)
	return units
}

// worldSeasonGrowth: a season of development for a club outside the playable leagues, whose games
// are not simulated: its best eleven are taken to play most of the season, the next five some
// games and the rest a few. Every day is one training session plus that share of a game.
func worldSeasonGrowth(r *rand.Rand, squad []*Player) {
	sorted := append([]*Player{}, squad...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return OverallAs(sorted[i], sorted[i].Position) > OverallAs(sorted[j], sorted[j].Position)
	})
	days := float64(len(Calendar))
	for i, p := range sorted {
		games := 34.0
		switch {
		case i >= 16:
			games = 3
		case i >= 11:
			games = 12
		}
		units := TrainShare + MatchShare*games/days
		for range len(Calendar) {
			grow(r, p, nil, 1, false, 1, units)
		}
	}
}

// seasonApps fills Player.Apps: games this season for the club, in every competition.
func seasonApps(ctx context.Context, q DBTX, c *Career, clubID int, squad []*Player) error {
	rows, err := q.Query(ctx, `SELECT player_id, SUM(apps)::int FROM player_stats WHERE career_id=$1 AND season=$2 AND club_id=$3 GROUP BY player_id`,
		c.ID, c.Season, clubID)
	if err != nil {
		return err
	}
	defer rows.Close()
	apps := map[int]int{}
	for rows.Next() {
		var id, n int
		if err := rows.Scan(&id, &n); err != nil {
			return err
		}
		apps[id] = n
	}
	for _, p := range squad {
		p.Apps = apps[p.ID]
	}
	return rows.Err()
}
