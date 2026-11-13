package game

import (
	"math"
	"sort"
)

// Formations: slot roles, in the order the frontend draws them.
var Formations = map[string][]string{
	"4-4-2":   {"GK", "LB", "CB", "CB", "RB", "LM", "CM", "CM", "RM", "ST", "ST"},
	"4-3-3":   {"GK", "LB", "CB", "CB", "RB", "CM", "DM", "CM", "LW", "ST", "RW"},
	"4-2-3-1": {"GK", "LB", "CB", "CB", "RB", "DM", "DM", "LM", "AM", "RM", "ST"},
	"3-5-2":   {"GK", "CB", "CB", "CB", "LWB", "CM", "DM", "CM", "RWB", "ST", "ST"},
	"5-3-2":   {"GK", "LWB", "CB", "CB", "CB", "RWB", "CM", "CM", "CM", "ST", "ST"},
}

// Slot coordinates (x: own goal 0 → 1, y: left 0 → right 1); mirrors frontend/src/formations.ts.
var Slots = map[string][][2]float64{
	"4-4-2":   {{0.04, 0.5}, {0.22, 0.14}, {0.19, 0.38}, {0.19, 0.62}, {0.22, 0.86}, {0.48, 0.14}, {0.44, 0.39}, {0.44, 0.61}, {0.48, 0.86}, {0.76, 0.4}, {0.76, 0.6}},
	"4-3-3":   {{0.04, 0.5}, {0.22, 0.14}, {0.19, 0.38}, {0.19, 0.62}, {0.22, 0.86}, {0.46, 0.3}, {0.36, 0.5}, {0.46, 0.7}, {0.74, 0.15}, {0.8, 0.5}, {0.74, 0.85}},
	"4-2-3-1": {{0.04, 0.5}, {0.22, 0.14}, {0.19, 0.38}, {0.19, 0.62}, {0.22, 0.86}, {0.36, 0.38}, {0.36, 0.62}, {0.6, 0.16}, {0.6, 0.5}, {0.6, 0.84}, {0.82, 0.5}},
	"3-5-2":   {{0.04, 0.5}, {0.2, 0.28}, {0.18, 0.5}, {0.2, 0.72}, {0.42, 0.1}, {0.47, 0.33}, {0.37, 0.5}, {0.47, 0.67}, {0.42, 0.9}, {0.76, 0.4}, {0.76, 0.6}},
	"5-3-2":   {{0.04, 0.5}, {0.27, 0.1}, {0.2, 0.3}, {0.18, 0.5}, {0.2, 0.7}, {0.27, 0.9}, {0.45, 0.3}, {0.42, 0.5}, {0.45, 0.7}, {0.74, 0.4}, {0.74, 0.6}},
}

func RoleCat(role string) string {
	switch role {
	case "GK":
		return "GK"
	case "CB", "LB", "RB", "LWB", "RWB":
		return "DF"
	case "DM", "CM", "LM", "RM", "AM":
		return "MF"
	default:
		return "FW"
	}
}

func OverallAs(p *Player, cat string) float64 {
	switch cat {
	case "GK":
		return p.Goalkeeping*0.82 + p.Physical*0.09 + p.Passing*0.09
	case "DF":
		return p.Defending*0.45 + p.Physical*0.2 + p.Pace*0.15 + p.Passing*0.14 + p.Dribbling*0.06
	case "MF":
		return p.Passing*0.34 + p.Dribbling*0.2 + p.Defending*0.14 + p.Shooting*0.12 + p.Pace*0.1 + p.Physical*0.1
	default:
		return p.Shooting*0.4 + p.Dribbling*0.24 + p.Pace*0.2 + p.Physical*0.1 + p.Passing*0.06
	}
}

var catOrder = map[string]int{"GK": 0, "DF": 1, "MF": 2, "FW": 3}

// NaturalRole: a player's preferred position. A legend card plays where his real-life self did (legendRole,
// from the legend data), a modern star where his real-life self plays (starRole, from the club data); everyone
// else's is read from his attributes (attrRole).
func NaturalRole(p *Player) string {
	if r := legendRole(p); r != "" {
		return r
	}
	if r := starRole(p); r != "" {
		return r
	}
	return attrRole(p)
}

// attrRole reads a player's preferred position from his attributes (side from his id).
func attrRole(p *Player) string {
	side := "L"
	if p.ID%2 == 1 {
		side = "R"
	}
	switch p.Position {
	case "GK":
		return "GK"
	case "DF":
		if p.Pace > 70 && p.Pace >= p.Defending-4 {
			return side + "B"
		}
		return "CB"
	case "MF":
		switch {
		case p.Defending >= p.Passing-2 && p.Defending >= p.Shooting+8:
			return "DM"
		case p.Shooting >= p.Passing-3 && p.Dribbling >= p.Passing-4:
			return "AM"
		case p.Pace >= p.Passing && p.Dribbling >= p.Passing-3:
			return side + "M"
		}
		return "CM"
	default:
		if p.Pace >= p.Shooting && p.Dribbling >= p.Shooting-4 {
			return side + "W"
		}
		return "ST"
	}
}

// roles that play the same job well
var roleCompat = map[string][]string{
	"LB": {"LWB"}, "RB": {"RWB"}, "LM": {"LW"}, "RM": {"RW"}, "LW": {"LM"}, "RW": {"RM"},
	"CM": {"DM", "AM"}, "DM": {"CM"}, "AM": {"CM"},
}

func roleFits(natural, slot string) bool {
	if natural == slot {
		return true
	}
	for _, r := range roleCompat[natural] {
		if r == slot {
			return true
		}
	}
	return false
}

func fitFactor(p *Player, role string) float64 {
	cat := RoleCat(role)
	if cat == p.Position {
		if roleFits(NaturalRole(p), role) {
			return 1
		}
		return 0.96
	}
	if cat == "GK" || p.Position == "GK" {
		return 0.55
	}
	if roleFits(NaturalRole(p), role) {
		return 1 // a winger on the flank of a midfield four (LW in an LM slot), or the other way round
	}
	if d := catOrder[cat] - catOrder[p.Position]; d == 1 || d == -1 {
		return 0.92
	}
	return 0.84
}

// Effective rating of a player in a slot: position fit, fitness and morale.
func Effective(p *Player, role string) float64 {
	r := OverallAs(p, RoleCat(role)) * fitFactor(p, role)
	r *= 0.75 + 0.25*p.Fitness/100
	r *= 0.97 + 0.06*p.Morale/100
	if p.Rushed {
		r *= RushPenalty
	}
	if p.Rust > 0 { // back from injury but not yet match sharp
		r *= 1 - math.Min(0.3, p.Rust)
	}
	return r
}

func ValueOf(p *Player) int64 {
	ovr := OverallAs(p, p.Position)
	v := 1_000_000 * math.Pow(1.145, ovr-60)
	switch {
	case p.Age <= 23:
		v *= 1 + math.Max(0, float64(p.Potential)-ovr)/25
	case p.Age >= 35:
		v *= 0.25
	case p.Age >= 33:
		v *= 0.4
	case p.Age >= 30:
		v *= 0.7
	}
	if v < 50_000 {
		v = 50_000
	}
	return int64(math.Round(v/10_000)) * 10_000
}

// WageOf: weekly wage. Wages are the biggest cost of a club (roughly half its income for a mid-table side).
// Stars earn more, but less than in proportion to their price (≈ value^0.8).
func WageOf(value int64) int64 {
	w := int64(0.2 * math.Pow(float64(value), 0.8))
	if w < 1000 {
		w = 1000
	}
	return w / 500 * 500
}

// available: he can play today: fit (or cleared to play through a knock) and not rested by you (lineup_lock.go).
func available(p *Player) bool { return (p.Injury == 0 || p.Rushed) && !p.Resting }

// BestLineup greedily picks the strongest fit XI for a formation, skipping injured players.
func BestLineup(players []*Player, formation string) []int {
	return BestLineupHeld(players, formation, nil)
}

// BestLineupHeld: BestLineup around the starters you locked in (held: slot → player id, lineup_lock.go): each one
// who can play keeps his slot, the other versions of a locked legend sit out, and the rest is picked as usual.
func BestLineupHeld(players []*Player, formation string, held map[int]int) []int {
	roles := Formations[formation]
	m := len(roles)
	fixed, out := heldPlayers(players, m, held)
	var avail []*Player
	for _, p := range players {
		if available(p) && !out[p.ID] {
			avail = append(avail, p)
		}
	}
	avail = onePerPerson(avail) // legend_versions.go: one version of a legend per match (the club version first)
	// each player's worth in each slot: his effective rating, a little more in his natural role
	// (chemistry rewards it, and a winger at centre-forward looks wrong even when he rates well)
	score := make([][]float64, len(avail))
	for i, p := range avail {
		score[i] = make([]float64, m)
		nat := NaturalRole(p)
		for s, role := range roles {
			v := Effective(p, role)
			if roleFits(nat, role) {
				v += 1.5
			}
			score[i][s] = v
		}
	}
	// greedy first: keeper, forwards, defenders, then midfielders
	order := make([]int, m)
	for i := range order {
		order[i] = i
	}
	pri := map[string]int{"GK": 0, "FW": 1, "DF": 2, "MF": 3}
	sort.SliceStable(order, func(a, b int) bool { return pri[RoleCat(roles[order[a]])] < pri[RoleCat(roles[order[b]])] })
	pick := make([]int, m) // index into avail, -1 when nobody is left
	used := make([]bool, len(avail))
	for _, slot := range order {
		if fixed[slot] != nil {
			pick[slot] = -1
			continue
		}
		best, bestV := -1, -1.0
		for i := range avail {
			if !used[i] && score[i][slot] > bestV {
				best, bestV = i, score[i][slot]
			}
		}
		pick[slot] = best
		if best >= 0 {
			used[best] = true
		}
	}
	// then improve: swap two starters' slots, or bring in a bench player, while the total rises
	for pass := 0; pass < 4; pass++ {
		better := false
		for a := 0; a < m; a++ {
			for b := a + 1; b < m; b++ {
				i, j := pick[a], pick[b]
				if fixed[a] != nil || fixed[b] != nil {
					continue
				}
				if i >= 0 && j >= 0 && score[i][b]+score[j][a] > score[i][a]+score[j][b]+0.01 {
					pick[a], pick[b] = j, i
					better = true
				}
			}
		}
		for s := 0; s < m; s++ {
			if fixed[s] != nil {
				continue
			}
			for i := range avail {
				if used[i] {
					continue
				}
				cur := -1.0
				if pick[s] >= 0 {
					cur = score[pick[s]][s]
				}
				if score[i][s] > cur+0.01 {
					if pick[s] >= 0 {
						used[pick[s]] = false
					}
					pick[s], used[i] = i, true
					better = true
				}
			}
		}
		if !better {
			break
		}
	}
	ids := make([]int, m)
	for s := range ids {
		ids[s] = -1
		if fixed[s] != nil {
			ids[s] = fixed[s].ID
		} else if pick[s] >= 0 {
			ids[s] = avail[pick[s]].ID
		}
	}
	return ids
}

// ---------------------------------------------------------------- chemistry

type SlotChem struct {
	StyleFit bool    `json:"styleFit"`
	Chem     float64 `json:"chem"` // 0..10
	Fit      float64 `json:"fit"`
	Links    float64 `json:"links"`
	Together float64 `json:"together"`
}

type Chemistry struct {
	Team        int        `json:"team"` // 0..100
	Familiarity float64    `json:"familiarity"`
	Slots       []SlotChem `json:"slots"`
}

func neighbours(formation string, i, j int) bool {
	s := Slots[formation]
	if i >= len(s) || j >= len(s) {
		return false
	}
	dx, dy := s[i][0]-s[j][0], s[i][1]-s[j][1]
	return math.Hypot(dx*1.3, dy) < 0.34
}

func sharedPast(a, b []int, current int) bool {
	for _, x := range a {
		if x == current {
			continue
		}
		for _, y := range b {
			if x == y {
				return true
			}
		}
	}
	return false
}

// TeamChemistry: position fit (0–4) + links with formation neighbours via nation or
// a shared former club (0–3) + matches played for the club (0–3), plus formation familiarity.
// TeamChemistry also rewards players whose traits suit the head coach's style, and leaders lift
// their neighbours.
func TeamChemistry(starters []*Player, formation string, formWeeks, clubID int, styleTraits ...string) Chemistry {
	roles := Formations[formation]
	ch := Chemistry{Slots: make([]SlotChem, len(roles))}
	var sum float64
	for i, p := range starters {
		if p == nil || i >= len(roles) {
			continue
		}
		var sc SlotChem
		switch f := fitFactor(p, roles[i]); {
		case f == 1:
			sc.Fit = 4
		case f >= 0.95:
			sc.Fit = 3
		case f >= 0.9:
			sc.Fit = 2
		}
		for j, q := range starters {
			if j == i || q == nil || !neighbours(formation, i, j) {
				continue
			}
			if q.Nation == p.Nation {
				sc.Links += 1
			}
			if sharedPast(p.History, q.History, clubID) {
				sc.Links += 1.5
			}
			if hasTrait(q, "leader") {
				sc.Links += 0.5
			}
		}
		for _, t := range styleTraits {
			if hasTrait(p, t) {
				sc.Links += 1 // fits the coach's way of playing
				sc.StyleFit = true
				break
			}
		}
		// homecoming: a legend card from this club's own era links with the whole badge
		if isHomeCard(p, clubID) {
			sc.Links += 1.5
		}
		sc.Links = math.Min(3, sc.Links)
		sc.Together = math.Min(3, float64(p.Tenure)/4)
		sc.Chem = sc.Fit + sc.Links + sc.Together
		ch.Slots[i] = sc
		sum += sc.Chem
	}
	ch.Familiarity = math.Min(1, float64(formWeeks)/5)
	ch.Team = int(math.Round(clamp(sum/float64(len(roles))*8.5+ch.Familiarity*15, 0, 100)))
	return ch
}

// ChemMultiplier: 50 chemistry is neutral, 100 gives +6%, 0 gives −6%.
func ChemMultiplier(team int) float64 { return 0.94 + 0.12*float64(team)/100 }

type TeamRating struct {
	Attack   float64 `json:"attack"`
	Midfield float64 `json:"midfield"`
	Defense  float64 `json:"defense"`
	Overall  float64 `json:"overall"`
}

func RateTeam(starters []*Player, roles []string, t Tactic, headCoach int, chem int) TeamRating {
	var a, aw, m, mw, d, dw, all float64
	for i, p := range starters {
		if p == nil {
			continue
		}
		e := Effective(p, roles[i])
		all += e
		switch RoleCat(roles[i]) {
		case "GK":
			d += e * 1.4
			dw += 1.4
		case "DF":
			d += e
			dw += 1
			m += e * 0.2
			mw += 0.2
			a += e * 0.1
			aw += 0.1
		case "MF":
			m += e
			mw += 1
			a += e * 0.5
			aw += 0.5
			d += e * 0.4
			dw += 0.4
		case "FW":
			a += e
			aw += 1
			m += e * 0.2
			mw += 0.2
		}
	}
	div := func(x, w float64) float64 {
		if w == 0 {
			return 30
		}
		return x / w
	}
	cm := ChemMultiplier(chem)
	r := TeamRating{Attack: div(a, aw) * cm, Midfield: div(m, mw) * cm, Defense: div(d, dw) * cm, Overall: all / 11 * cm}
	switch t.Mentality {
	case "attacking":
		r.Attack += 3
		r.Defense -= 3
	case "defensive":
		r.Attack -= 3
		r.Defense += 3
	}
	switch t.Pressing {
	case "high":
		r.Midfield += 2
		r.Defense -= 1
	case "low":
		r.Defense += 1.5
		r.Midfield -= 1.5
	}
	switch t.Passing {
	case "short":
		r.Midfield += 1.5
		r.Attack -= 0.5
	case "direct":
		r.Attack += 1.5
		r.Midfield -= 1.5
	}
	bonus := float64(headCoach) / 5
	r.Attack += bonus
	r.Defense += bonus
	r.Midfield += bonus
	return r
}
