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

// The simulated match's goal model (see Simulate): even sides score about 1.5 at home and
// 1.2 away; every SimGap points between attack and defence multiply that by e.
const (
	SimHomeGoals = 1.5
	SimAwayGoals = 1.2
	SimGap       = 50.0
	SimMid       = 0.25
	SimMaxGoals  = 3.6
	SimForm      = 0.22
	SimShared    = 0.2 // goals both sides share (bivariate Poisson): real scores correlate, so draws are commoner
)

func Simulate(r *rand.Rand, home, away TeamSheet) SimResult {
	h, a := home.Rating(), away.Rating()
	midDiff := (h.Midfield - a.Midfield) / 30
	// Expected goals follow one side's attack against the other's defence, softened so that the
	// stronger side usually wins while draws and upsets stay common, plus a little form on the day.
	form := func() float64 { return math.Exp(r.NormFloat64() * SimForm) }
	lh := math.Min(SimMaxGoals, SimHomeGoals*math.Exp((h.Attack-a.Defense)/SimGap+midDiff*SimMid)*form())
	la := math.Min(SimMaxGoals, SimAwayGoals*math.Exp((a.Attack-h.Defense)/SimGap-midDiff*SimMid)*form())
	// weather: wet and frozen pitches mean fewer goals, heat slows the game a little
	wx := WeatherGoals[home.Weather]
	if wx == 0 {
		wx = 1
	}
	lh, la = lh*wx, la*wx
	// a shared part keeps each side's expected goals but makes level scores more likely
	sh := math.Min(SimShared, math.Min(lh, la)*0.5)
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
