package game

import (
	"encoding/json"
	"errors"
	"math"
)

// ErrUser marks errors caused by a bad request. Code is translated by the frontend.
type ErrUser struct {
	Code string
	Msg  string
}

func (e ErrUser) Error() string { return e.Msg }

func userErr(code, msg string) error { return ErrUser{Code: code, Msg: msg} }

func IsUserErr(err error) (ErrUser, bool) {
	var u ErrUser
	ok := errors.As(err, &u)
	return u, ok
}

var ErrNotFound = errors.New("not found")

type Player struct {
	ID           int      `json:"id"`
	ClubID       *int     `json:"clubId"`
	TemplateID   *int     `json:"templateId"`
	Name         string   `json:"name"`
	Nation       string   `json:"nation"`
	Age          int      `json:"age"`
	Position     string   `json:"position"` // GK, DF, MF, FW
	Pace         float64  `json:"pace"`
	Shooting     float64  `json:"shooting"`
	Passing      float64  `json:"passing"`
	Dribbling    float64  `json:"dribbling"`
	Defending    float64  `json:"defending"`
	Physical     float64  `json:"physical"`
	Goalkeeping  float64  `json:"goalkeeping"`
	Potential    int      `json:"potential"`
	Fitness      float64  `json:"fitness"`
	Morale       float64  `json:"morale"`
	Focus        string   `json:"focus"`
	Injury       int      `json:"injury"` // weeks out
	Unrest       int      `json:"unrest"` // >0: asked to leave over unpaid wages (matchdays since)
	Traits       []string `json:"traits"`
	TraitsKnown  bool     `json:"traitsKnown"`
	HiddenTraits int      `json:"hiddenTraits"` // count of traits not yet revealed
	Tenure       int      `json:"tenure"`       // matches played for the club
	History      []int    `json:"history"`      // club ids, current and former
	Shirt        int      `json:"shirt"`
	Retired      bool     `json:"retired"`
	Tag          string   `json:"tag"`                  // legend | custom | ""
	Version      string   `json:"version"`              // legend card label, e.g. "Real Madrix '14"
	Load         string   `json:"load"`                 // user's per-player training load (from Career.Care, not stored on the player)
	Rushed       bool     `json:"rushed"`               // cleared to play in his last week out (from Career.Care)
	Rust         float64  `json:"rust,omitempty"`       // 0..0.3: lost match sharpness after an injury (medical.go, not stored on the player)
	InjKind      string   `json:"injKind,omitempty"`    // the kind of his injury (medical.go, not stored on the player)
	GrowBoost    float64  `json:"-"`                    // extra growth share, e.g. from a mentor (staff_life.go, not stored on the player)
	Mentor       *Mentor  `json:"mentor,omitempty"`     // the coach mentoring him (staff_life.go, not stored on the player)
	ResaleCap    int64    `json:"resaleCap,omitempty"`  // recent signing: the most other clubs pay for him (resale.go)
	ResaleLeft   int      `json:"resaleLeft,omitempty"` // matchdays until they pay his full value again
	BrokeLimit   bool     `json:"brokeLimit,omitempty"` // he broke his limit with TP this season (from Career.Care)
	Apps         int      `json:"apps"`                 // appearances for the user's club this season (career view only)

	Role     string `json:"role"` // natural position: GK, CB, LB, RB, DM, CM, AM, LM, RM, LW, RW, ST
	Overall  int    `json:"overall"`
	Value    int64  `json:"value"`
	Wage     int64  `json:"wage"`
	Market   int64  `json:"market"`   // what his wage would be on the market today (user's players)
	Contract int    `json:"contract"` // seasons left on his contract (user's players); -1 = permanent (icons)
	Dev      string `json:"dev"`      // development class, only when his traits are visible
	Price    int64  `json:"price"`    // asking price on the market (free agents, scouting)
}

func (p *Player) Fill() {
	p.Role = NaturalRole(p)
	p.Overall = int(math.Round(OverallAs(p, p.Position)))
	p.Value = ValueOf(p)
	p.Wage = WageOf(p.Value)
	if isLegend(p) {
		p.Value = int64(float64(p.Value)*IconPriceFactor/10_000) * 10_000 // icons cost half as much again; wages stay normal
	}
}

func (p *Player) Attr(name string) *float64 {
	switch name {
	case "pace":
		return &p.Pace
	case "shooting":
		return &p.Shooting
	case "passing":
		return &p.Passing
	case "dribbling":
		return &p.Dribbling
	case "defending":
		return &p.Defending
	case "physical":
		return &p.Physical
	case "goalkeeping":
		return &p.Goalkeeping
	}
	return nil
}

var AttrNames = []string{"pace", "shooting", "passing", "dribbling", "defending", "physical", "goalkeeping"}

func isAttr(a string) bool {
	for _, x := range AttrNames {
		if x == a {
			return true
		}
	}
	return false
}

type Tactic struct {
	Mentality string `json:"mentality"`
	Pressing  string `json:"pressing"`
	Passing   string `json:"passing"`
	Width     string `json:"width"`
}

func DefaultTactic() Tactic {
	return Tactic{Mentality: "balanced", Pressing: "mid", Passing: "mixed", Width: "normal"}
}

func (t *Tactic) Normalize() {
	pk := func(v *string, ok []string, def string) {
		for _, o := range ok {
			if *v == o {
				return
			}
		}
		*v = def
	}
	pk(&t.Mentality, []string{"defensive", "balanced", "attacking"}, "balanced")
	pk(&t.Pressing, []string{"low", "mid", "high"}, "mid")
	pk(&t.Passing, []string{"short", "mixed", "direct"}, "mixed")
	pk(&t.Width, []string{"narrow", "normal", "wide"}, "normal")
}

type Club struct {
	ID         int    `json:"id"`
	CareerID   int    `json:"careerId"`
	League     string `json:"league"`
	Name       string `json:"name"`
	Short      string `json:"short"`
	Color      string `json:"color"`
	Color2     string `json:"color2"`
	IsUser     bool   `json:"isUser"`
	Budget     int64  `json:"budget"`
	Reputation int    `json:"reputation"`
	Formation  string `json:"formation"`
	Tactic     Tactic `json:"tactic"`
	Lineup     []int  `json:"lineup"`
	FormWeeks  int    `json:"formWeeks"`
	Division   int    `json:"division"` // 1..3 for competition clubs, 0 for world clubs
	Stadium    int    `json:"stadium"`  // facility levels 1..5
	TrainLvl   int    `json:"trainLvl"`
	Academy    int    `json:"academy"`
	Deals      int    `json:"deals"` // completed deals with the user's club (relationship)
	Medical    int    `json:"medical"`
	Kits       *Kits  `json:"kits,omitempty"` // kits.go: filled for the views and the live match, not stored on the club
}

type Coach struct {
	ID     int      `json:"id"`
	ClubID *int     `json:"clubId"`
	Name   string   `json:"name"`
	Nation string   `json:"nation"`
	Role   string   `json:"role"` // head | attack | defense | fitness | goalkeeping | physio | scout | doctor
	Style  string   `json:"style"`
	Skill  int      `json:"skill"`
	Price  int64    `json:"price"`
	Wage   int64    `json:"wage"`
	Market int64    `json:"market"`
	Perks  []string `json:"perks"` // special skills, see perks.go
}

func (c *Coach) Fill() {
	c.Price = int64(c.Skill*c.Skill) * 60_000
	c.Wage = int64(c.Skill) * 10_000
}

var CoachRoles = []string{"head", "attack", "defense", "fitness", "goalkeeping", "physio", "scout", "doctor"}

type Fixture struct {
	ID        int             `json:"id"`
	Season    int             `json:"season"`
	Day       int             `json:"day"`
	Comp      string          `json:"comp"`
	League    string          `json:"league"`
	Stage     string          `json:"stage"`
	HomeID    int             `json:"homeId"`
	AwayID    int             `json:"awayId"`
	HomeGoals *int            `json:"homeGoals"`
	AwayGoals *int            `json:"awayGoals"`
	PensHome  *bool           `json:"pensHome"`
	ExtraTime bool            `json:"extraTime"`
	PensH     *int            `json:"pensH"` // shoot-out score when there was one
	PensA     *int            `json:"pensA"`
	Played    bool            `json:"played"`
	Report    json.RawMessage `json:"report,omitempty"`
}

// WinnerID of a played fixture (knockouts settle draws on penalties).
func (f *Fixture) WinnerID() int {
	if f.HomeGoals == nil || f.AwayGoals == nil {
		return 0
	}
	h, a := *f.HomeGoals, *f.AwayGoals
	if h > a || (h == a && f.PensHome != nil && *f.PensHome) {
		return f.HomeID
	}
	if a > h || (h == a && f.PensHome != nil && !*f.PensHome) {
		return f.AwayID
	}
	return 0
}

type Training struct {
	Intensity string `json:"intensity"`
}

type Sponsor struct {
	Name        string `json:"name"`
	Kind        string `json:"kind"` // safe | balanced | performance
	Weekly      int64  `json:"weekly"`
	WinBonus    int64  `json:"winBonus"`
	GoalBonus   int64  `json:"goalBonus"`
	Signing     int64  `json:"signing"`
	SeasonsLeft int    `json:"seasonsLeft"`
	Slot        string `json:"slot"`   // shirt | sleeve | stadium | kit | partner
	Target      string `json:"target"` // season objective, paid at the end
	TargetBonus int64  `json:"targetBonus"`
	MinPos      int    `json:"minPos"`  // clause: stay at or above this league position (0 = none)
	Exit        int64  `json:"exit"`    // what it costs you to end the deal early
	Strikes     int    `json:"strikes"` // matchdays below the clause line
}

type Loan struct {
	Amount    int64 `json:"amount"`
	Weekly    int64 `json:"weekly"`
	WeeksLeft int   `json:"weeksLeft"`
}

type Career struct {
	TP         int          `json:"tp"`     // upgrade points
	Ticket     string       `json:"ticket"` // low | normal | high
	Loan       *Loan        `json:"loan"`
	ID         int          `json:"id"`
	UserID     int          `json:"userId"`
	UserClubID int          `json:"userClubId"`
	League     string       `json:"league"`
	Season     int          `json:"season"`
	Day        int          `json:"day"`
	Training   Training     `json:"training"`
	Sponsor    *Sponsor     `json:"sponsor"`
	Streak     int          `json:"streak"`
	Care       Care         `json:"care"`
	Contracts  Contracts    `json:"contracts"`
	IconPick   *IconPick    `json:"iconPick"`
	Commercial Commercial   `json:"commercial"`
	Events     EventState   `json:"events"`  // events.go: press, squad life, derbies, loans, bids…
	Explore    ExploreState `json:"explore"` // explore.go: scouting missions, achievements, job offers…
	Ended      string       `json:"ended"`   // "" while active; "collapse" when the squad fell apart
}

type TableRow struct {
	ClubID int    `json:"clubId"`
	Name   string `json:"name"`
	Short  string `json:"short"`
	Color  string `json:"color"`
	P      int    `json:"p"`
	W      int    `json:"w"`
	D      int    `json:"d"`
	L      int    `json:"l"`
	GF     int    `json:"gf"`
	GA     int    `json:"ga"`
	Pts    int    `json:"pts"`
	IsUser bool   `json:"isUser"`
}

// CalDay is one slot of the season calendar: only one competition plays per day.
type CalDay struct {
	Comp  string `json:"comp"`  // league | cup | cl
	Stage string `json:"stage"` // R | G | QF | SF | F
	Round int    `json:"round"`
}

// Calendar: 38 league rounds with the cups slotted in between — 54 matchdays, one competition per day.
var Calendar = buildCalendar()

func buildCalendar() []CalDay {
	after := map[int][]CalDay{
		2: {{"cl", "G", 1}}, 4: {{"cup", "R1", 0}}, 5: {{"cl", "G", 2}}, 7: {{"cl", "G", 3}}, 9: {{"cup", "R32", 0}},
		11: {{"cl", "G", 4}}, 13: {{"cl", "G", 5}}, 15: {{"cl", "G", 6}}, 17: {{"cup", "R16", 0}}, 20: {{"cl", "R16", 0}},
		23: {{"cup", "QF", 0}}, 26: {{"cl", "QF", 0}}, 29: {{"cup", "SF", 0}}, 32: {{"cl", "SF", 0}}, 35: {{"cup", "F", 0}},
		38: {{"cl", "F", 0}},
	}
	var out []CalDay
	for r := 1; r <= 2*(DivisionSize-1); r++ {
		out = append(out, CalDay{"league", "R", r})
		out = append(out, after[r]...)
	}
	return out
}

// knockout stage order for each cup
var cupStages = []string{"R1", "R32", "R16", "QF", "SF", "F"}
var clStages = []string{"R16", "QF", "SF", "F"}

func prevStage(stages []string, s string) string {
	for i, x := range stages {
		if x == s && i > 0 {
			return stages[i-1]
		}
	}
	return ""
}

func dayOf(comp, stage string, round int) int {
	for i, d := range Calendar {
		if d.Comp == comp && d.Stage == stage && d.Round == round {
			return i + 1
		}
	}
	return 0
}
