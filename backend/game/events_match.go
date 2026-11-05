package game

import (
	"math"
	"math/rand"
	"sort"
	"strings"
)

// ---------------------------------------------------------------- weather

// WeatherGoals scales the expected goals of a simulated match; HeatDrain the fitness a match costs.
var WeatherGoals = map[string]float64{"clear": 1, "rain": 0.9, "snow": 0.84, "heat": 0.96}

const HeatDrain = 1.2

// weatherFor: stable per fixture, seasonal by matchday (autumn showers, winter snow, summer heat).
func weatherFor(f *Fixture) string {
	if f == nil {
		return "clear"
	}
	r := rand.New(rand.NewSource(int64(f.ID)*48271 + int64(f.Day)*131 + 7))
	x := r.Float64()
	switch d := f.Day; {
	case d <= 10: // late summer, early autumn
		return pickWeather(x, 0.6, 0.32, 0, 0.08)
	case d <= 32: // winter
		return pickWeather(x, 0.38, 0.36, 0.26, 0)
	case d <= 45: // spring
		return pickWeather(x, 0.58, 0.36, 0.02, 0.04)
	case d <= len(Calendar): // early summer run-in
		return pickWeather(x, 0.55, 0.15, 0, 0.3)
	}
	return pickWeather(x, 0.5, 0.1, 0, 0.4) // summer friendlies
}

func pickWeather(x, clear, rain, snow, heat float64) string {
	switch {
	case x < clear:
		return "clear"
	case x < clear+rain:
		return "rain"
	case x < clear+rain+snow:
		return "snow"
	}
	_ = heat
	return "heat"
}

// ---------------------------------------------------------------- rivals and derbies

const (
	DerbyGate  = 0.6 // extra gate on derby day, as a share of a normal home gate
	DerbySwing = 5.0 // extra morale won or lost in a derby
)

// words that say nothing about where a club comes from
var cityStop = map[string]bool{"fc": true, "cf": true, "real": true, "atlético": true, "atletico": true, "athletic": true,
	"sc": true, "ssc": true, "ac": true, "as": true, "sporting": true, "the": true, "club": true}

// classic rivalries between clubs from different cities
var classicPairs = [][2]string{{"tyne", "sunderland"}, {"nottingham", "derby"}, {"sevila", "betis"}, {"bilbo", "sociedá"},
	{"bristol", "cardiff"}, {"cardiff", "swansea"}, {"neapolis", "roma"}, {"dortmund", "bavaria"}, {"torino", "milano"}}

func cityWords(name string) []string {
	var out []string
	ws := strings.Fields(strings.ToLower(name))
	for i := 0; i < len(ws); i++ {
		w := ws[i]
		if cityStop[w] {
			continue
		}
		if (w == "north" || w == "south" || w == "east" || w == "west") && i+1 < len(ws) {
			w += " " + ws[i+1]
			i++
		}
		w = strings.TrimSuffix(w, "side") // Merseyside, Tyneside
		out = append(out, w)
	}
	return out
}

// sameCity: the first place word of one name appears in the other (Roma Lupi / Aquile Roma,
// Mersey Red / Merseyside Blues, North London Gunners / North London Lilywhites, Real / Atlético Madrix).
func sameCity(a, b string) bool {
	wa, wb := cityWords(a), cityWords(b)
	if len(wa) == 0 || len(wb) == 0 {
		return false
	}
	has := func(ws []string, x string) bool {
		for _, w := range ws {
			if w == x {
				return true
			}
		}
		return false
	}
	return has(wb, wa[0]) || has(wa, wb[0])
}

func classicRivals(a, b string) bool {
	wa, wb := cityWords(a), cityWords(b)
	if len(wa) == 0 || len(wb) == 0 {
		return false
	}
	for _, p := range classicPairs {
		if (wa[0] == p[0] && wb[0] == p[1]) || (wa[0] == p[1] && wb[0] == p[0]) {
			return true
		}
	}
	return false
}

// pickRival: a same-city club first (same division preferred), then a classic rivalry, then the
// club closest in reputation in the same division.
func (w *world) pickRival(me *Club) (int, bool) {
	var city, classic, div []*Club
	for _, cl := range w.clubs {
		if cl.ID == me.ID || cl.League != me.League || cl.Division == 0 {
			continue
		}
		switch {
		case sameCity(me.Name, cl.Name):
			city = append(city, cl)
		case classicRivals(me.Name, cl.Name):
			classic = append(classic, cl)
		}
		if cl.Division == me.Division {
			div = append(div, cl)
		}
	}
	best := func(cs []*Club) *Club {
		sort.Slice(cs, func(i, j int) bool {
			di, dj := cs[i].Division != me.Division, cs[j].Division != me.Division
			if di != dj {
				return !di
			}
			ri, rj := absInt(cs[i].Reputation-me.Reputation), absInt(cs[j].Reputation-me.Reputation)
			if ri != rj {
				return ri < rj
			}
			return cs[i].ID < cs[j].ID
		})
		return cs[0]
	}
	if len(city) > 0 {
		return best(city).ID, true
	}
	if len(classic) > 0 {
		return best(classic).ID, true
	}
	if len(div) > 0 {
		return best(div).ID, false
	}
	return 0, false
}

func absInt(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// ensureRival keeps the rival fixed; a rival picked only by reputation is re-picked once a season if
// the two clubs no longer share a division.
func (w *world) ensureRival() {
	c := w.career
	es := &c.Events
	me := w.byID[c.UserClubID]
	if me == nil {
		return
	}
	cur := w.byID[es.Rival]
	if cur != nil && (es.RivalCity || es.RivalSeason == c.Season || cur.Division == me.Division) {
		es.RivalSeason = c.Season
		return
	}
	es.Rival, es.RivalCity = w.pickRival(me)
	es.RivalSeason = c.Season
}

func (w *world) rivalID() int {
	if w.byID[w.career.Events.Rival] == nil {
		w.ensureRival()
	}
	return w.career.Events.Rival
}

func (w *world) isDerby(f *Fixture) bool {
	if f == nil {
		return false
	}
	u, rv := w.career.UserClubID, w.rivalID()
	return rv != 0 && ((f.HomeID == u && f.AwayID == rv) || (f.AwayID == u && f.HomeID == rv))
}

// ---------------------------------------------------------------- match modifiers

// matchMods sets the fixture's weather on both sheets and, for the user's match, the derby
// atmosphere, the captain's influence and the effect of the press conference.
func (w *world) matchMods(f *Fixture, home, away *TeamSheet) {
	wx := weatherFor(f)
	home.Weather, away.Weather = wx, wx
	c := w.career
	if f.HomeID != c.UserClubID && f.AwayID != c.UserClubID {
		return
	}
	us, them := home, away
	if f.AwayID == c.UserClubID {
		us, them = away, home
	}
	if w.isDerby(f) {
		home.BigGame, away.BigGame = true, true
	}
	es := &c.Events
	if es.Captain != 0 {
		for _, p := range us.Starters {
			if p != nil && p.ID == es.Captain {
				bump := CaptainChem
				if hasTrait(p, "leader") {
					bump += CaptainLeaderChem
				}
				us.Chem.Team = min(100, us.Chem.Team+bump)
			}
		}
	}
	w.pressAuto(f) // the assistant answers if you asked him to
	if pc := es.Press; pc != nil && pc.FixtureID == f.ID {
		switch pc.Answer {
		case "bold":
			us.Boost += PressBoldBoost
		case "deflect":
			them.Boost -= PressMindGames
		}
	}
}

// ---------------------------------------------------------------- captain

const (
	CaptainChem       = 2 // team chemistry when the captain starts
	CaptainLeaderChem = 3 // more if he is a natural leader
)

// ---------------------------------------------------------------- press conferences

const (
	PressBoldBoost = 1.0 // rating lines when the manager promises a win
	PressMindGames = 0.7 // taken off the opponent when the pressure is put on them
)

// PressConf: the manager's answer before a notable match.
type PressConf struct {
	FixtureID int    `json:"fixtureId"`
	Answer    string `json:"answer"` // bold | calm | deflect
	Opponent  string `json:"opponent"`
	Result    string `json:"result,omitempty"` // win | draw | loss once played
	Season    int    `json:"season"`
	Day       int    `json:"day"`
	Auto      bool   `json:"auto,omitempty"` // the assistant answered
}

var PressAnswers = []string{"bold", "calm", "deflect"}

// pressNotable: cup and continental ties, derbies and about one league game in five.
func (w *world) pressNotable(f *Fixture) bool {
	if f == nil || f.Comp == "friendly" {
		return false
	}
	if f.Comp == "cup" || f.Comp == "cl" || w.isDerby(f) {
		return true
	}
	r := rand.New(rand.NewSource(int64(f.ID)*15485863 + 3))
	return r.Float64() < 0.2
}

// pressAuto: when the assistant answers the press, today's conference is answered his way.
func (w *world) pressAuto(f *Fixture) {
	c := w.career
	es := &c.Events
	if es.PressAuto == "" || f == nil || (f.HomeID != c.UserClubID && f.AwayID != c.UserClubID) || !w.pressNotable(f) ||
		(es.Press != nil && es.Press.FixtureID == f.ID) {
		return
	}
	opp := w.byID[f.AwayID]
	if f.AwayID == c.UserClubID {
		opp = w.byID[f.HomeID]
	}
	if opp == nil {
		return
	}
	es.Press = &PressConf{FixtureID: f.ID, Answer: es.PressAuto, Opponent: opp.Name, Season: c.Season, Day: c.Day, Auto: true}
}

// settlePress: what the answer meant once the result is in.
func (w *world) settlePress(f *Fixture, opp *Club, won, lost bool, rep *DayReport) {
	c := w.career
	es := &c.Events
	pc := es.Press
	if pc == nil || pc.FixtureID != f.ID {
		return
	}
	es.Press = nil
	user := w.byID[c.UserClubID]
	res := "draw"
	if won {
		res = "win"
	} else if lost {
		res = "loss"
	}
	pc.Result = res
	key := "press_" + pc.Answer + "_" + res
	switch pc.Answer {
	case "bold": // "we'll win this": big reward, bigger risk
		switch res {
		case "win":
			w.squadMorale(5)
			user.Reputation = min(99, user.Reputation+1)
			w.addXP(6, rep)
		case "draw":
			w.squadMorale(-3)
		case "loss":
			w.squadMorale(-6)
			if user.Reputation > 35 && rand.Float64() < 0.5 {
				user.Reputation--
			}
		}
	case "calm": // respect the opponent: nothing to lose
		switch res {
		case "win":
			w.squadMorale(3)
		case "draw":
			w.squadMorale(1)
		case "loss":
			w.squadMorale(2) // cushions the defeat
		}
	case "deflect": // the pressure is on them
		switch res {
		case "win":
			w.squadMorale(2)
			w.addXP(3, rep)
		case "loss":
			w.squadMorale(-3)
		}
	}
	w.happen(rep, key, opp.Name, 0)
	es.PressLog = append([]PressConf{*pc}, es.PressLog...)
	if len(es.PressLog) > 10 {
		es.PressLog = es.PressLog[:10]
	}
}

// ---------------------------------------------------------------- manager level

const MaxManagerLevel = 30

// xpForLevel: total experience needed to reach a level (level 2 at 100, 3 at 250, 4 at 450 …).
func xpForLevel(l int) int {
	if l <= 1 {
		return 0
	}
	n := l - 1
	return 100*n + 25*n*(n-1)
}

// ManagerPerks: small, growing advantages from the manager's reputation.
type ManagerPerks struct {
	BidBonus     float64 `json:"bidBonus"`     // clubs bid more for your players
	CounterBonus float64 `json:"counterBonus"` // counter-offers succeed more often
	LoanDiscount float64 `json:"loanDiscount"` // cheaper loan fees
	YouthBonus   int     `json:"youthBonus"`   // potential added to academy prospects
}

func managerPerks(level int) ManagerPerks {
	l := float64(max(0, level-1))
	return ManagerPerks{BidBonus: math.Min(0.15, l*0.01), CounterBonus: math.Min(0.2, l*0.015),
		LoanDiscount: math.Min(0.3, l*0.02), YouthBonus: min(6, (level-1)/2)}
}

func (w *world) addXP(n int, rep *DayReport) {
	if n <= 0 {
		return
	}
	c := w.career
	es := &c.Events
	es.init()
	es.XP += n
	for es.Level < MaxManagerLevel && es.XP >= xpForLevel(es.Level+1) {
		es.Level++
		tp := 3 + es.Level
		c.TP += tp
		w.happen(rep, "level_up", "", int64(es.Level))
		if rep != nil {
			rep.TP += tp
		}
	}
}
