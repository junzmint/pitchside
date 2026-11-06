package game

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"os"
	"sort"
	"strings"
	"testing"
)

// ---------------------------------------------------------------- calibration of the pre-match odds
//
// Does the chance the match page shows come true in the simulated match? The four competition leagues are
// built the way a new career builds them (career.go NewCareer): squads from GenSquad around each club's stars,
// the head coach and the staff with their perks, the computer's eleven (BestLineup), chemistry and coach fit
// exactly as world.sheet works them out, with fitness and morale spread as in mid-season. Every pair of clubs
// gets the odds the page shows (MatchSetup.Odds: MatchOdds on world.matchSheets, in whole percentages) and is
// then played many times by Simulate on the same sheets, the way PlayDay plays it. The table compares, bucket by
// bucket of the shown win chance, the shown and the actual share of wins, draws and defeats.
//
//	go test ./game -run TestSimCalibration -v                            the quick table (also run by go test)
//	PITCHSIDE_CALIBRATION=1 go test ./game -run TestSimCalibrationReport -v   every league fixture, 300 runs each

func calWorld(seed int64) *world {
	r := rand.New(rand.NewSource(seed))
	w := &world{career: &Career{}, byID: map[int]*Club{}, players: map[int][]*Player{}, coaches: map[int][]*Coach{},
		life: &ClubLife{}} // no fans to load: no club is the user's
	pid, coachID := 1, 1
	for _, l := range Leagues {
		for i, def := range CountryClubDefs(l.Code) {
			c := &Club{ID: len(w.clubs) + 1, League: l.Code, Division: i/DivisionSize + 1, Name: def.Name, Short: def.Short,
				Reputation: def.Rep, Formation: def.Formation, Tactic: def.Tactic, FormWeeks: 6}
			c.Tactic.Normalize()
			squad := GenSquad(r, l.Nations, def.Base, def.Stars)
			for _, p := range squad {
				p.ID, pid = pid, pid+1
				cid := c.ID
				p.ClubID = &cid
				p.History = []int{cid}
				if r.Intn(10) < 3 {
					p.History = []int{1 + r.Intn(Divisions*DivisionSize*len(Leagues)), cid}
				}
				p.Tenure = 3 + r.Intn(40)
				// mid-season: tired legs and moods vary
				p.Fitness = 74 + r.Float64()*26
				p.Morale = clamp(65+r.NormFloat64()*12, 25, 100)
			}
			head := GenCoach(r, l.Nations, "head", 6+int(def.Base-55)/3)
			if def.Coach.Name != "" {
				head.Name, head.Nation, head.Skill = def.Coach.Name, def.Coach.Nation, def.Coach.Skill
				if st, ok := famousStyles[def.Coach.Name]; ok {
					head.Style = st
				}
			}
			staff := []*Coach{head}
			for _, role := range CoachRoles[1:] {
				skill := int(clamp(5+float64(def.Rep-70)/3+float64(r.Intn(4)), 3, 18))
				staff = append(staff, GenCoach(r, l.Nations, role, skill))
			}
			for _, co := range staff {
				co.ID, coachID = coachID, coachID+1
				cid := c.ID
				co.ClubID = &cid
				co.Perks = perksFor(co)
			}
			c.Lineup = BestLineup(squad, c.Formation)
			w.clubs = append(w.clubs, c)
			w.byID[c.ID] = c
			w.players[c.ID] = squad
			w.coaches[c.ID] = staff
		}
	}
	return w
}

// calPair: one fixture of the calibration run.
type calPair struct {
	home, away int
	comp       string
	day        int
}

// calPairs: every league fixture of every division, plus cup ties between the divisions of one country and
// continental ties between the top clubs of the four countries (the big gaps).
func calPairs(w *world, r *rand.Rand, cupTies, clTies int) []calPair {
	var out []calPair
	div := map[string][]*Club{}
	var keys []string
	for _, c := range w.clubs {
		k := fmt.Sprintf("%s-%d", c.League, c.Division)
		if div[k] == nil {
			keys = append(keys, k)
		}
		div[k] = append(div[k], c)
	}
	for _, k := range keys {
		for _, h := range div[k] {
			for _, a := range div[k] {
				if h != a {
					out = append(out, calPair{h.ID, a.ID, "league", 1 + r.Intn(len(Calendar))})
				}
			}
		}
	}
	for i := 0; i < cupTies; i++ {
		l := Leagues[r.Intn(len(Leagues))].Code
		var cs []*Club
		for _, c := range w.clubs {
			if c.League == l {
				cs = append(cs, c)
			}
		}
		if h, a := cs[r.Intn(len(cs))], cs[r.Intn(len(cs))]; h != a {
			out = append(out, calPair{h.ID, a.ID, "cup", 1 + r.Intn(len(Calendar))})
		}
	}
	var top []*Club
	for _, c := range w.clubs {
		if c.Division == 1 && (c.ID-1)%(Divisions*DivisionSize) < CLPerLeague {
			top = append(top, c)
		}
	}
	for i := 0; i < clTies; i++ {
		if h, a := top[r.Intn(len(top))], top[r.Intn(len(top))]; h != a {
			out = append(out, calPair{h.ID, a.ID, "cl", 1 + r.Intn(len(Calendar))})
		}
	}
	return out
}

func calFixture(id int, pr calPair) *Fixture {
	f := &Fixture{ID: id, Day: pr.day, Comp: pr.comp, HomeID: pr.home, AwayID: pr.away, Stage: "R"}
	if pr.comp == "cl" {
		f.Stage = "G"
	}
	return f
}

// calSheets: both sheets as the match is played and its odds are worked out (world.matchSheets).
func calSheets(w *world, f *Fixture) (TeamSheet, TeamSheet) {
	return w.matchSheets(context.Background(), nil, f)
}

// shownOdds: home win, draw and away win exactly as the match page shows them (MatchSetup.Odds).
func shownOdds(w *world, f *Fixture) [3]float64 {
	p := MatchOdds(calSheets(w, f)).Percent()
	return [3]float64{float64(p[0]) / 100, float64(p[1]) / 100, float64(p[2]) / 100}
}

// calRow: one bucket of the calibration table, from one side's point of view.
type calRow struct {
	n                         int
	shownW, shownD, shownL    float64
	actualW, actualD, actualL float64
}

func (r *calRow) add(shown [3]float64, res int) {
	r.n++
	r.shownW += shown[0]
	r.shownD += shown[1]
	r.shownL += shown[2]
	switch res {
	case 1:
		r.actualW++
	case 0:
		r.actualD++
	default:
		r.actualL++
	}
}

// gaps: how far the actual shares are from the shown ones, in points.
func (r calRow) gaps() (w, d, l float64) {
	n := float64(r.n)
	return 100 * (r.actualW - r.shownW) / n, 100 * (r.actualD - r.shownD) / n, 100 * (r.actualL - r.shownL) / n
}

type calReport struct {
	rows                [10]calRow // by shown win chance: 0–9 %, 10–19 %, …
	fav80, dog33        calRow     // shown 75–84 % and 28–37 %
	matches             int
	goals, nilNil       float64
	homeW, draws, awayW float64
	brier, brierOwn     float64              // shown odds against the results; each pair's own result shares against them
	gaps                map[string][]float64 // |shown − actual| home win share per pair, by competition
	noise               map[string]float64   // the mean of that gap from sampling alone (runs per pair), by competition
	ppg                 map[int][2]float64   // league points per club: from the results, from the shown odds
	games               map[int]int
}

// side adds one side's view of a result: shown = its own win/draw/loss chance, res = 1 win, 0 draw, −1 loss.
func (cr *calReport) side(shown [3]float64, res int) {
	cr.rows[min(9, int(shown[0]*10+1e-9))].add(shown, res)
	if shown[0] >= 0.75-1e-9 && shown[0] < 0.85-1e-9 {
		cr.fav80.add(shown, res)
	}
	if shown[0] >= 0.28-1e-9 && shown[0] < 0.38-1e-9 {
		cr.dog33.add(shown, res)
	}
}

// calibrate plays every pair runs times with Simulate and compares the results with the shown odds.
func calibrate(w *world, pairs []calPair, runs int, seed int64, shown func(*world, *Fixture) [3]float64) *calReport {
	r := rand.New(rand.NewSource(seed))
	cr := &calReport{gaps: map[string][]float64{}, noise: map[string]float64{}, ppg: map[int][2]float64{}, games: map[int]int{}}
	for i, pr := range pairs {
		f := calFixture(100000+i, pr)
		odds := shown(w, f)
		home, away := calSheets(w, f)
		var hw, dr, aw float64
		for k := 0; k < runs; k++ {
			res := Simulate(r, home, away)
			out := 0
			switch {
			case res.HomeGoals > res.AwayGoals:
				out, hw = 1, hw+1
			case res.HomeGoals < res.AwayGoals:
				out, aw = -1, aw+1
			default:
				dr++
			}
			cr.matches++
			cr.goals += float64(res.HomeGoals + res.AwayGoals)
			if res.HomeGoals+res.AwayGoals == 0 {
				cr.nilNil++
			}
			cr.side(odds, out)
			cr.side([3]float64{odds[2], odds[1], odds[0]}, -out)
			var o [3]float64
			o[1-out] = 1
			for j := range o {
				cr.brier += (odds[j] - o[j]) * (odds[j] - o[j])
			}
		}
		cr.homeW, cr.draws, cr.awayW = cr.homeW+hw, cr.draws+dr, cr.awayW+aw
		n := float64(runs)
		own := [3]float64{hw / n, dr / n, aw / n}
		for _, q := range own {
			cr.brierOwn += n * q * (1 - q) // the pair's own result shares as the forecast: the best any odds could do
		}
		cr.gaps[pr.comp] = append(cr.gaps[pr.comp], math.Abs(odds[0]-own[0]))
		cr.noise[pr.comp] += math.Sqrt(odds[0] * (1 - odds[0]) / n * 2 / math.Pi) // mean |N(0, se)|
		if pr.comp == "league" {
			h, a := cr.ppg[pr.home], cr.ppg[pr.away]
			h[0], h[1] = h[0]+3*own[0]+own[1], h[1]+3*odds[0]+odds[1]
			a[0], a[1] = a[0]+3*own[2]+own[1], a[1]+3*odds[2]+odds[1]
			cr.ppg[pr.home], cr.ppg[pr.away] = h, a
			cr.games[pr.home]++
			cr.games[pr.away]++
		}
	}
	return cr
}

func pct(x float64, n int) string {
	if n == 0 {
		return "    –"
	}
	return fmt.Sprintf("%5.1f", 100*x/float64(n))
}

func (cr *calReport) table() string {
	var b strings.Builder
	fmt.Fprintf(&b, "shown win %%   sides | shown  W     D     L   | actual W     D     L\n")
	line := func(label string, r calRow) {
		fmt.Fprintf(&b, "%-10s %8d | %s %s %s | %s %s %s\n", label, r.n,
			pct(r.shownW, r.n), pct(r.shownD, r.n), pct(r.shownL, r.n), pct(r.actualW, r.n), pct(r.actualD, r.n), pct(r.actualL, r.n))
	}
	for i, r := range cr.rows {
		if r.n > 0 {
			line(fmt.Sprintf("%d–%d", i*10, i*10+9), r)
		}
	}
	line("fav 75–84", cr.fav80)
	line("dog 28–37", cr.dog33)
	m := float64(cr.matches)
	fmt.Fprintf(&b, "matches %d · goals a match %.2f · home win / draw / away win %.1f / %.1f / %.1f %% · 0-0 %.1f %%\n", cr.matches,
		cr.goals/m, 100*cr.homeW/m, 100*cr.draws/m, 100*cr.awayW/m, 100*cr.nilNil/m)
	fmt.Fprintf(&b, "Brier score (3 results) of the shown odds %.4f; of each pair's own result shares %.4f\n", cr.brier/m, cr.brierOwn/m)
	for _, c := range []string{"league", "cup", "cl"} {
		g := append([]float64{}, cr.gaps[c]...)
		if len(g) == 0 {
			continue
		}
		sort.Float64s(g)
		s := 0.0
		for _, x := range g {
			s += x
		}
		fmt.Fprintf(&b, "%-6s %5d pairs: |shown − actual| home win, mean %.1f (sampling alone %.1f), 90th percentile %.1f, worst %.1f points\n",
			c, len(g), 100*s/float64(len(g)), 100*cr.noise[c]/float64(len(g)), 100*g[len(g)*9/10], 100*g[len(g)-1])
	}
	return b.String()
}

// seasons: each division's spread over a 38-game season, from the simulated results and from the shown odds:
// the strongest and the weakest club's points and the standard deviation of the points.
func (cr *calReport) seasons(w *world) string {
	type row struct {
		name     string
		sim, odd float64
	}
	divs := map[string][]row{}
	var keys []string
	for id, v := range cr.ppg {
		n := float64(cr.games[id])
		if n < 30 {
			continue
		}
		c := w.byID[id]
		k := fmt.Sprintf("%s-%d", c.League, c.Division)
		if divs[k] == nil {
			keys = append(keys, k)
		}
		divs[k] = append(divs[k], row{c.Name, v[0] / n * 38, v[1] / n * 38})
	}
	sort.Strings(keys)
	sd := func(xs []float64) float64 {
		m, v := 0.0, 0.0
		for _, x := range xs {
			m += x / float64(len(xs))
		}
		for _, x := range xs {
			v += (x - m) * (x - m) / float64(len(xs))
		}
		return math.Sqrt(v)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "division  best pts (sim / odds)               worst pts (sim / odds)  sd pts (sim / odds)\n")
	for _, k := range keys {
		rs := divs[k]
		sort.Slice(rs, func(i, j int) bool { return rs[i].sim > rs[j].sim })
		var s, o []float64
		for _, r := range rs {
			s, o = append(s, r.sim), append(o, r.odd)
		}
		fmt.Fprintf(&b, "%-8s  %5.1f / %5.1f %-24s  %5.1f / %5.1f           %5.1f / %5.1f\n", k, rs[0].sim, rs[0].odd, "("+rs[0].name+")",
			rs[len(rs)-1].sim, rs[len(rs)-1].odd, sd(s), sd(o))
	}
	return b.String()
}

// TestSimCalibration: the odds the match page shows come true in the simulated match, bucket by bucket, and the
// simulated football stays believable (goals, draws, home wins, how often a favourite slips).
func TestSimCalibration(t *testing.T) {
	w := calWorld(1)
	pairs := calPairs(w, rand.New(rand.NewSource(2)), 3000, 600)
	r := rand.New(rand.NewSource(3))
	r.Shuffle(len(pairs), func(i, j int) { pairs[i], pairs[j] = pairs[j], pairs[i] })
	cr := calibrate(w, pairs[:1800], 150, 4, shownOdds)
	t.Logf("the match page's odds (MatchSetup.Odds) against Simulate:\n%s", cr.table())
	for i, row := range cr.rows {
		if row.n < 20000 {
			continue
		}
		if gw, gd, gl := row.gaps(); math.Abs(gw) > 1.5 || math.Abs(gd) > 1.5 || math.Abs(gl) > 1.5 {
			t.Errorf("shown %d–%d%%: actual win/draw/loss off the shown odds by %.1f/%.1f/%.1f points", i*10, i*10+9, gw, gd, gl)
		}
	}
	if gw, _, _ := cr.dog33.gaps(); math.Abs(gw) > 1.5 {
		t.Errorf("a side shown at about 33%% won %.1f points off that", gw)
	}
	f := cr.fav80
	if f.n < 5000 {
		t.Fatalf("too few clear favourites to judge (%d)", f.n)
	}
	if gw, _, _ := f.gaps(); math.Abs(gw) > 1.5 {
		t.Errorf("a side shown at about 80%% won %.1f points off that", gw)
	}
	if l, d := 100*f.actualL/float64(f.n), 100*f.actualD/float64(f.n); l < 4 || l > 10 || d < 10 || d > 17 {
		t.Errorf("a clear favourite (about 80%%) lost %.1f%% and drew %.1f%%: want about 5–10%% and 10–17%%", l, d)
	}
	m := float64(cr.matches)
	if g := cr.goals / m; g < 2.5 || g > 3.0 {
		t.Errorf("%.2f goals a match, want 2.5–3", g)
	}
	if d := 100 * cr.draws / m; d < 22 || d > 28 {
		t.Errorf("%.1f%% draws, want 22–28%%", d)
	}
	if h := 100 * cr.homeW / m; h < 40 || h > 48 {
		t.Errorf("%.1f%% home wins, want 40–48%%", h)
	}
}

// TestMatchOddsMatchSimulate: for single fixtures (even sides, a top club at home to the weakest, a cup tie in
// the snow, a continental night) the exact odds agree with tens of thousands of simulated matches.
func TestMatchOddsMatchSimulate(t *testing.T) {
	w := calWorld(5)
	top, bottom := w.clubs[0], w.clubs[DivisionSize-1] // England's first division: the strongest club and the last
	d3 := w.clubs[3*DivisionSize-1]                    // the last club of England's third division
	snowID := 3
	for weatherFor(&Fixture{ID: snowID, Day: 17}) != "snow" {
		snowID += 1000
	}
	cases := []struct {
		name string
		f    *Fixture
	}{
		{"even league game", &Fixture{ID: 1, Day: 3, Comp: "league", Stage: "R", HomeID: w.clubs[12].ID, AwayID: w.clubs[13].ID}},
		{"top v bottom", &Fixture{ID: 2, Day: 5, Comp: "league", Stage: "R", HomeID: top.ID, AwayID: bottom.ID}},
		{"cup tie in the snow", &Fixture{ID: snowID, Day: 17, Comp: "cup", Stage: "R16", HomeID: d3.ID, AwayID: top.ID}},
		{"continental night", &Fixture{ID: 4, Day: 26, Comp: "cl", Stage: "QF", HomeID: w.clubs[1].ID, AwayID: w.clubs[Divisions*DivisionSize].ID}},
	}
	r := rand.New(rand.NewSource(6))
	const runs = 40000
	for _, c := range cases {
		home, away := calSheets(w, c.f)
		o := MatchOdds(home, away)
		var hw, dr, aw, gh, ga float64
		for k := 0; k < runs; k++ {
			res := Simulate(r, home, away)
			switch {
			case res.HomeGoals > res.AwayGoals:
				hw++
			case res.HomeGoals < res.AwayGoals:
				aw++
			default:
				dr++
			}
			gh += float64(res.HomeGoals)
			ga += float64(res.AwayGoals)
		}
		t.Logf("%-20s (%s) odds %.1f/%.1f/%.1f xG %.2f–%.2f · simulated %.1f/%.1f/%.1f goals %.2f–%.2f", c.name, home.Weather,
			100*o.Home, 100*o.Draw, 100*o.Away, o.HomeXG, o.AwayXG, 100*hw/runs, 100*dr/runs, 100*aw/runs, gh/runs, ga/runs)
		for _, x := range [][2]float64{{o.Home, hw / runs}, {o.Draw, dr / runs}, {o.Away, aw / runs}} {
			if math.Abs(x[0]-x[1]) > 0.012 { // about four standard errors
				t.Errorf("%s: odds %.3f, simulated %.3f", c.name, x[0], x[1])
			}
		}
		if math.Abs(o.HomeXG-gh/runs) > 0.04 || math.Abs(o.AwayXG-ga/runs) > 0.04 {
			t.Errorf("%s: expected goals %.2f–%.2f, simulated %.2f–%.2f", c.name, o.HomeXG, o.AwayXG, gh/runs, ga/runs)
		}
	}
}

// TestMatchOddsUserMatch: the user's match counts what the simulated match counts on the day: the captain, the
// press conference and the home crowd lift the user's chance, in the odds and in the simulation alike.
func TestMatchOddsUserMatch(t *testing.T) {
	w := calWorld(7)
	user, opp := w.clubs[30], w.clubs[31] // two English second-division clubs
	f := &Fixture{ID: 77, Day: 9, Comp: "league", Stage: "R", HomeID: user.ID, AwayID: opp.ID}
	plain := MatchOdds(calSheets(w, f))
	w.career.UserClubID = user.ID
	w.career.Events.Captain = user.Lineup[5]
	w.career.Events.Press = &PressConf{FixtureID: f.ID, Answer: "bold"}
	w.life = &ClubLife{Init: true, Fans: FanState{Mood: 95}}
	home, away := calSheets(w, f)
	lifted := MatchOdds(home, away)
	if home.Boost <= 0 || home.Chem.Team <= w.sheet(user.ID).Chem.Team {
		t.Fatalf("the press conference, the crowd and the captain should lift the user's sheet: boost %.2f, chemistry %d", home.Boost, home.Chem.Team)
	}
	if lifted.Home <= plain.Home+0.01 {
		t.Errorf("the user's win chance should rise with the captain, a bold press answer and a happy crowd: %.3f → %.3f", plain.Home, lifted.Home)
	}
	r := rand.New(rand.NewSource(8))
	const runs = 40000
	won := 0.0
	for k := 0; k < runs; k++ {
		if res := Simulate(r, home, away); res.HomeGoals > res.AwayGoals {
			won++
		}
	}
	if math.Abs(won/runs-lifted.Home) > 0.012 {
		t.Errorf("odds %.3f, simulated %.3f", lifted.Home, won/runs)
	}
	t.Logf("user at home: %.1f%% → %.1f%% with the captain, a bold press answer and a crowd at 95 (simulated %.1f%%)",
		100*plain.Home, 100*lifted.Home, 100*won/runs)
}

// The odds as whole percentages always add up to 100; the luck nodes integrate a standard normal.
func TestOddsPercent(t *testing.T) {
	for _, o := range []Odds{{Home: 0.335, Draw: 0.335, Away: 0.33}, {Home: 0.996, Draw: 0.003, Away: 0.001},
		{Home: 0.4449, Draw: 0.2649, Away: 0.2902}, {Home: 1}, {Home: -1e-17, Draw: 0.5, Away: 0.5}} {
		if p := o.Percent(); p[0]+p[1]+p[2] != 100 || p[0] < 0 || p[1] < 0 || p[2] < 0 {
			t.Errorf("%v → %v", o, p)
		}
	}
	var s, m2, e float64
	for i, z := range luckZ {
		s += luckW[i]
		m2 += luckW[i] * z * z
		e += luckW[i] * math.Exp(z*SimLuck)
	}
	if math.Abs(s-1) > 1e-9 || math.Abs(m2-1) > 1e-9 || math.Abs(e-math.Exp(SimLuck*SimLuck/2)) > 1e-9 {
		t.Errorf("luck nodes: sum %.12f, variance %.12f, lognormal mean %.12f", s, m2, e)
	}
}

// jsWinChance: the odds as the match page worked them out until now (frontend MatchCentre.tsx winChance on the
// setup's ratings): the Poisson odds of the old goal model (SimGap 50, midfield 0.25/30, shared goals 0.2),
// without the day's form, the weather or the occasion. Kept to measure what the page used to show.
func jsWinChance(h, a TeamRating) [3]float64 {
	mid := ((h.Midfield - a.Midfield) / 30) * 0.25
	lh := math.Min(3.6, 1.5*math.Exp((h.Attack-a.Defense)/50+mid))
	la := math.Min(3.6, 1.2*math.Exp((a.Attack-h.Defense)/50-mid))
	shared := math.Min(0.2, math.Min(lh, la)*0.5)
	H, D, _ := poissonResult(lh-shared, la-shared)
	h100, d100 := math.Round(H*100), math.Round(D*100)
	return [3]float64{h100 / 100, d100 / 100, math.Max(0, 100-h100-d100) / 100}
}

func jsShownOdds(w *world, f *Fixture) [3]float64 {
	return jsWinChance(w.side(f.HomeID, f).Rating, w.side(f.AwayID, f).Rating)
}

// TestSimCalibrationReport: the full table, every league fixture of the four countries plus 3,600 cup and
// continental ties, 300 runs each, for the match page's odds and for the formula the page used until now.
func TestSimCalibrationReport(t *testing.T) {
	if os.Getenv("PITCHSIDE_CALIBRATION") == "" {
		t.Skip("set PITCHSIDE_CALIBRATION=1 for the full calibration report")
	}
	w := calWorld(1)
	pairs := calPairs(w, rand.New(rand.NewSource(2)), 3000, 600)
	cr := calibrate(w, pairs, 300, 4, shownOdds)
	t.Logf("the match page's odds (MatchSetup.Odds) against Simulate:\n%s\n%s", cr.table(), cr.seasons(w))
	old := calibrate(w, pairs, 300, 4, jsShownOdds)
	t.Logf("the old page formula (MatchCentre.tsx winChance) against today's Simulate:\n%s", old.table())
}
