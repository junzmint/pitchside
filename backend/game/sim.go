package game

import (
	"math"
	"math/rand"
)

type TeamSheet struct {
	Club      *Club
	Starters  []*Player
	Roles     []string
	HeadCoach int
	Chem      Chemistry
	Fit       CoachFit
	BigGame   bool
	Perks     Perks
	Bench     []*Player
	Subs      []Sub
	Rotated   []SwapNote
	Weather   string  // events.go: clear | rain | snow | heat
	Boost     float64 // events.go: press conference / mind games, added to every rating line
}

func (t TeamSheet) Rating() TeamRating {
	r := RateTeam(t.Starters, t.Roles, t.Club.Tactic, t.HeadCoach, t.Chem.Team)
	traitRating(&r, t.Starters, t.BigGame)
	applyPerkRating(&r, t.Perks, t.BigGame)
	m := FitMultiplier(t.Fit.Score)
	r.Attack, r.Midfield, r.Defense, r.Overall = r.Attack*m, r.Midfield*m, r.Defense*m, r.Overall*m
	if t.Boost != 0 {
		r.Attack, r.Midfield, r.Defense, r.Overall = r.Attack+t.Boost, r.Midfield+t.Boost, r.Defense+t.Boost, r.Overall+t.Boost
	}
	return r
}

type SimResult struct {
	HomeGoals int   `json:"homeGoals"`
	AwayGoals int   `json:"awayGoals"`
	Scorers   []int `json:"scorers"` // player ids, in order
	Assists   []int `json:"assists"` // parallel to Scorers; 0 = no assist
	PossHome  int   `json:"possHome"`
	ShotsHome int   `json:"shotsHome"`
	ShotsAway int   `json:"shotsAway"`
	ExtraTime bool  `json:"extraTime"` // a knockout tie went to extra time (goals above include it)
	Shootout  bool  `json:"shootout"`  // and then to penalties
	PensH     int   `json:"pensH"`
	PensA     int   `json:"pensA"`
	// Ratings: a live match's own player ratings (match.go fills them from the client)
	Ratings map[int]float64 `json:"-"`
	Forfeit bool            `json:"-"` // abandoned: nobody learns anything from it
	// XG: a live match: the goals (home, away) the quick simulation expected for it. The live engine's longer
	// matches bring more goals, so the Golden Glove counts these instead (player_stats.conceded_sim).
	XG *[2]float64 `json:"-"`
}

func poisson(r *rand.Rand, lambda float64) int {
	l, k, p := math.Exp(-lambda), 0, 1.0
	for {
		p *= r.Float64()
		if p <= l {
			return k
		}
		k++
	}
}

func weightedPick(r *rand.Rand, t TeamSheet, weight func(role string, p *Player) float64, exclude int) int {
	var total float64
	w := make([]float64, len(t.Starters))
	for i, p := range t.Starters {
		if p == nil || p.ID == exclude {
			continue
		}
		w[i] = weight(t.Roles[i], p)
		total += w[i]
	}
	if total == 0 {
		return 0
	}
	x := r.Float64() * total
	for i, v := range w {
		x -= v
		if x <= 0 && t.Starters[i] != nil && v > 0 {
			return t.Starters[i].ID
		}
	}
	return 0
}

func scorerWeight(role string, p *Player) float64 {
	f := map[string]float64{"GK": 0.01, "DF": 0.25, "MF": 0.8, "FW": 2.2}[RoleCat(role)]
	return f * math.Pow(p.Shooting/50, 2)
}

func assistWeight(role string, p *Player) float64 {
	f := map[string]float64{"GK": 0.05, "DF": 0.5, "MF": 1.6, "FW": 1.1}[RoleCat(role)]
	return f * math.Pow(p.Passing/50, 2)
}

// ---------------------------------------------------------------- the goal model
//
// One model plays the simulated match (Simulate) and gives the pre-match odds (MatchOdds), so the chance
// the match page shows is the chance the simulation plays out (sim_calibration_test.go measures it).
//
// A side's expected goals follow its attack line against the other side's defence line, and the midfield
// battle (TeamSheet.Rating: the starters' effective ratings by line, i.e. attributes, position fit, fitness,
// morale and match sharpness, times chemistry and the head coach's fit, plus his skill, the tactics, traits,
// staff perks and the day's boosts such as the press conference and the home crowd). Even sides expect
// SimHomeGoals at home and SimAwayGoals away. Every SimGap points of attack over defence multiply a side's
// expected goals by e (10 points ≈ +25%), and a point of midfield edge counts SimMid of that, for one side
// and against the other. Rain, snow and heat take goals away (WeatherGoals).
//
// What is left to chance: the goals themselves (Poisson), a little luck on the day (SimLuck: each side's
// expected goals vary by about ±12%, a deflection, a red card, an off day), and a few goals both sides share
// (SimShared, a bivariate Poisson: real scores correlate, so level scores are a little commoner). With these
// values the four leagues average about 2.75 goals a match with a quarter of the games drawn; a side given 80%
// wins about 80%, draws about 14% and loses about 6–7%, much as bookmakers' odds have it in real football; and
// a top-flight season spreads like a real one (the champions on about 90–95 points, the bottom club 20–30).
const (
	SimHomeGoals = 1.5
	SimAwayGoals = 1.2
	SimGap       = 44.0
	SimMid       = 0.42
	SimMaxGoals  = 3.6
	SimLuck      = 0.12
	SimShared    = 0.1
)

// goalRates: both sides' expected goals before the day's luck and the weather.
func goalRates(h, a TeamRating) (lh, la float64) {
	mid := (h.Midfield - a.Midfield) * SimMid / SimGap
	lh = SimHomeGoals * math.Exp((h.Attack-a.Defense)/SimGap+mid)
	la = SimAwayGoals * math.Exp((a.Attack-h.Defense)/SimGap-mid)
	return lh, la
}

func weatherGoals(wx string) float64 {
	if f := WeatherGoals[wx]; f > 0 {
		return f
	}
	return 1
}

// onTheDay: a side's expected goals with the day's luck (z, a standard normal draw), capped, in the weather.
func onTheDay(l, z, wx float64) float64 { return math.Min(SimMaxGoals, l*math.Exp(z*SimLuck)) * wx }

// sharedGoals: the expected goals both sides share (they add to both scores, so they change no result).
func sharedGoals(lh, la float64) float64 { return math.Min(SimShared, math.Min(lh, la)*0.5) }

func Simulate(r *rand.Rand, home, away TeamSheet) SimResult {
	h, a := home.Rating(), away.Rating()
	midDiff := (h.Midfield - a.Midfield) / 30
	lh0, la0 := goalRates(h, a)
	wx := weatherGoals(home.Weather)
	lh, la := onTheDay(lh0, r.NormFloat64(), wx), onTheDay(la0, r.NormFloat64(), wx)
	sh := sharedGoals(lh, la)
	z := poisson(r, sh)
	res := SimResult{HomeGoals: poisson(r, lh-sh) + z, AwayGoals: poisson(r, la-sh) + z}
	add := func(t TeamSheet) {
		s := weightedPick(r, t, scorerWeight, -1)
		as := 0
		if r.Float64() < 0.72 {
			as = weightedPick(r, t, assistWeight, s)
		}
		res.Scorers = append(res.Scorers, s)
		res.Assists = append(res.Assists, as)
	}
	for i := 0; i < res.HomeGoals; i++ {
		add(home)
	}
	for i := 0; i < res.AwayGoals; i++ {
		add(away)
	}
	res.PossHome = int(clamp(50+midDiff*25+r.NormFloat64()*4, 25, 75))
	res.ShotsHome = res.HomeGoals + poisson(r, lh*4)
	res.ShotsAway = res.AwayGoals + poisson(r, la*4)
	return res
}

// ---------------------------------------------------------------- pre-match odds

// Odds: the chance of each result over 90 minutes (they add up to 1) and the goals each side can expect.
type Odds struct {
	Home, Draw, Away float64
	HomeXG, AwayXG   float64
}

// The day's luck in MatchOdds: 9-point Gauss–Hermite nodes for a standard normal (z) and their weights.
var luckZ, luckW = func() ([]float64, []float64) {
	x := []float64{-3.190993201781528, -2.266580584531843, -1.468553289216668, -0.7235510187528376, 0,
		0.7235510187528376, 1.468553289216668, 2.266580584531843, 3.190993201781528}
	w := []float64{3.960697726326438e-05, 0.004943624275536947, 0.08847452739437657, 0.4326515590025558, 0.7202352156060510,
		0.4326515590025558, 0.08847452739437657, 0.004943624275536947, 3.960697726326438e-05}
	z, p := make([]float64, len(x)), make([]float64, len(x))
	for i := range x {
		z[i], p[i] = x[i]*math.Sqrt2, w[i]/math.Sqrt(math.Pi)
	}
	return z, p
}()

// poissonResult: the chance that a Poisson(lh) score beats, equals or loses to an independent Poisson(la) score.
func poissonResult(lh, la float64) (h, d, a float64) {
	const n = 26 // expected goals stay under SimMaxGoals: more than 25 goals never happens
	var ph, pa [n]float64
	ph[0], pa[0] = math.Exp(-lh), math.Exp(-la)
	for k := 1; k < n; k++ {
		ph[k], pa[k] = ph[k-1]*lh/float64(k), pa[k-1]*la/float64(k)
	}
	below := 0.0 // P(home score < k)
	for k := 0; k < n; k++ {
		d += ph[k] * pa[k]
		a += below * pa[k]
		below += ph[k]
	}
	return math.Max(0, 1-d-a), d, a
}

// MatchOdds: the chance of each result in 90 minutes as Simulate plays it, worked out exactly: the same expected
// goals, weather, cap and shared goals, the day's luck integrated over (Gauss–Hermite), then the Poisson scores.
// Pass the sheets prepared the way the match is played (world.matchSheets for the user's match).
func MatchOdds(home, away TeamSheet) Odds {
	lh0, la0 := goalRates(home.Rating(), away.Rating())
	wx := weatherGoals(home.Weather)
	var o Odds
	for i, zh := range luckZ {
		lh := onTheDay(lh0, zh, wx)
		for j, za := range luckZ {
			w := luckW[i] * luckW[j]
			la := onTheDay(la0, za, wx)
			sh := sharedGoals(lh, la)
			h, d, a := poissonResult(lh-sh, la-sh)
			o.Home, o.Draw, o.Away = o.Home+w*h, o.Draw+w*d, o.Away+w*a
			o.HomeXG, o.AwayXG = o.HomeXG+w*lh, o.AwayXG+w*la
		}
	}
	if s := o.Home + o.Draw + o.Away; s > 0 {
		o.Home, o.Draw, o.Away = o.Home/s, o.Draw/s, o.Away/s
	}
	return o
}

// Percent: the odds in whole percentages that add up to 100 (largest remainder), as the match page shows them.
func (o Odds) Percent() [3]int {
	ps := [3]float64{o.Home * 100, o.Draw * 100, o.Away * 100}
	var out [3]int
	left := 100
	for i, p := range ps {
		ps[i] = math.Max(0, p)
		out[i] = int(math.Floor(ps[i]))
		left -= out[i]
	}
	for ; left > 0; left-- {
		best, bestR := 0, -1.0
		for i, p := range ps {
			if r := p - float64(out[i]); r > bestR {
				best, bestR = i, r
			}
		}
		out[best]++
		ps[best] = float64(out[best]) // that remainder is used up
	}
	return out
}

// OddsView: the pre-match odds as the match page gets them (MatchSetup.Odds).
type OddsView struct {
	Home   int     `json:"home"` // % home win in 90 minutes
	Draw   int     `json:"draw"`
	Away   int     `json:"away"`
	HomeXG float64 `json:"homeXg"` // expected goals
	AwayXG float64 `json:"awayXg"`
}

// View: the odds for the match page, in whole percentages, with the expected goals to two decimals.
func (o Odds) View() *OddsView {
	p := o.Percent()
	return &OddsView{Home: p[0], Draw: p[1], Away: p[2], HomeXG: math.Round(o.HomeXG*100) / 100, AwayXG: math.Round(o.AwayXG*100) / 100}
}

// Penalties decide drawn knockout ties; better keepers tilt the odds.
func Penalties(r *rand.Rand, home, away TeamSheet) bool {
	gk := func(t TeamSheet) float64 {
		for i, p := range t.Starters {
			if p != nil && t.Roles[i] == "GK" {
				return p.Goalkeeping
			}
		}
		return 50
	}
	return r.Float64() < clamp(0.5+(gk(home)-gk(away))/200, 0.25, 0.75)
}
