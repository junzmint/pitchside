package game

import (
	"context"
	"math"
	"math/rand"
	"sort"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- hidden player traits

// Traits change how a player behaves in the live match and nudge simulated results.
// They stay hidden until revealed (5 games for your club, a good scout, or 1 TP).
var AllTraits = []string{
	"one_two", "playmaker", "long_shot", "poacher", "speedster", "flair", "hard_tackler",
	"aerial", "tireless", "reflexes", "leader", "big_game", "injury_prone", "hothead",
}

// assignTraits picks 0–2 traits that suit a player's attributes.
func assignTraits(r *rand.Rand, p *Player) []string {
	type cand struct {
		t string
		w float64
	}
	var cs []cand
	add := func(t string, ok bool, w float64) {
		if ok {
			cs = append(cs, cand{t, w})
		}
	}
	gk := p.Position == "GK"
	add("one_two", !gk && p.Passing >= 68 && p.Position != "DF", 1.2)
	add("playmaker", !gk && p.Passing >= 74, 1.4)
	add("long_shot", !gk && p.Shooting >= 70, 1.2)
	add("poacher", p.Position == "FW" && p.Shooting >= 68, 1.4)
	add("speedster", !gk && p.Pace >= 78, 1.3)
	add("flair", !gk && p.Dribbling >= 76, 1.2)
	add("hard_tackler", (p.Position == "DF" || p.Position == "MF") && p.Defending >= 70, 1.3)
	add("aerial", !gk && p.Physical >= 74, 1)
	add("tireless", p.Physical >= 70, 0.9)
	add("reflexes", gk && p.Goalkeeping >= 70, 2)
	add("leader", p.Age >= 27, 0.5)
	add("big_game", OverallAs(p, p.Position) >= 78, 0.6)
	add("injury_prone", true, 0.3)
	add("hothead", !gk, 0.25)
	n := 0
	switch x := r.Float64(); {
	case x < 0.15:
		n = 2
	case x < 0.55:
		n = 1
	}
	var out []string
	for len(out) < n && len(cs) > 0 {
		var tot float64
		for _, c := range cs {
			tot += c.w
		}
		x := r.Float64() * tot
		for i, c := range cs {
			x -= c.w
			if x <= 0 {
				out = append(out, c.t)
				cs = append(cs[:i], cs[i+1:]...)
				break
			}
		}
	}
	if out == nil {
		out = []string{}
	}
	return out
}

// traitsForStyle gives a star the traits his play-style implies.
var styleTraits = map[string][]string{
	"goat": {"flair", "playmaker", "big_game"}, "siu": {"long_shot", "big_game", "aerial"},
	"speed": {"speedster", "poacher"}, "finisher": {"poacher", "aerial"}, "playmaker": {"playmaker", "one_two"},
	"dribbler": {"flair", "speedster"}, "wall": {"hard_tackler", "leader"}, "engine": {"tireless", "hard_tackler"},
	"keeper": {"reflexes", "leader"},
}

func hasTrait(p *Player, t string) bool {
	for _, x := range p.Traits {
		if x == t {
			return true
		}
	}
	return false
}

// ensureTraits gives players created before traits existed a deterministic set.
func ensureTraits(p *Player) {
	if p.Traits == nil {
		p.Traits = assignTraits(rand.New(rand.NewSource(int64(p.ID)*7919+13)), p)
	}
}

// ---------------------------------------------------------------- coach philosophy

type CoachStyle struct {
	Formations []string
	Mentality  []string
	Pressing   []string
	Passing    []string
	Width      []string
	Traits     []string
}

var CoachStyles = map[string]CoachStyle{
	"tiki_taka":  {[]string{"4-3-3", "4-2-3-1"}, []string{"balanced", "attacking"}, []string{"high"}, []string{"short"}, []string{"normal", "wide"}, []string{"one_two", "playmaker", "flair"}},
	"gegenpress": {[]string{"4-2-3-1", "4-3-3"}, []string{"attacking"}, []string{"high"}, []string{"mixed", "direct"}, nil, []string{"tireless", "hard_tackler", "speedster"}},
	"counter":    {[]string{"4-4-2", "5-3-2", "4-2-3-1"}, []string{"defensive", "balanced"}, []string{"low", "mid"}, []string{"direct"}, nil, []string{"speedster", "poacher", "long_shot"}},
	"catenaccio": {[]string{"5-3-2", "3-5-2", "4-4-2"}, []string{"defensive"}, []string{"low", "mid"}, []string{"mixed", "short"}, []string{"narrow", "normal"}, []string{"hard_tackler", "aerial", "leader"}},
	"wing_play":  {[]string{"4-4-2", "3-5-2", "4-3-3"}, []string{"balanced", "attacking"}, []string{"mid"}, []string{"mixed", "direct"}, []string{"wide"}, []string{"speedster", "aerial", "poacher"}},
	"star_power": {nil, []string{"attacking", "balanced"}, nil, nil, nil, []string{"flair", "big_game", "long_shot"}},
}

var StyleNames = []string{"tiki_taka", "gegenpress", "counter", "catenaccio", "wing_play", "star_power"}

// famous coaches keep the style they're known for
var famousStyles = map[string]string{
	"Pep Guardiolo": "tiki_taka", "Arne Slott": "gegenpress", "Mikel Artetta": "tiki_taka", "Enzo Maresco": "tiki_taka",
	"Ruben Amorin": "counter", "Ange Postecoglu": "gegenpress", "Eddie Howo": "wing_play", "Unai Emeri": "counter",
	"Xabi Alonzo": "tiki_taka", "Hansi Flik": "gegenpress", "Diego Simeono": "catenaccio", "Ernesto Valverdi": "wing_play",
	"Simone Inzagy": "catenaccio", "Antonio Conté": "catenaccio", "Thiago Motá": "tiki_taka", "Massimiliano Allegry": "catenaccio",
	"Gian Piero Gasperinni": "gegenpress", "Claudio Ranieli": "counter", "Vincent Kompani": "gegenpress", "Erik ten Haag": "tiki_taka",
	"Niko Kovack": "counter", "Marco Rosé": "gegenpress", "Carlo Ancelotto": "star_power", "Jürgen Kloppe": "gegenpress",
	"José Mourinyo": "counter", "Zinedine Zidann": "star_power", "Luis Enrike": "tiki_taka", "Thomas Tuchell": "gegenpress",
}

func styleFor(c *Coach) string {
	if c.Style != "" {
		return c.Style
	}
	if s, ok := famousStyles[c.Name]; ok {
		return s
	}
	return StyleNames[(c.ID*31+len(c.Name))%len(StyleNames)]
}

type CoachFit struct {
	Score     int      `json:"score"` // 0..100
	Style     string   `json:"style"`
	Coach     string   `json:"coach"`
	Formation int      `json:"formation"` // 0..25
	Tactic    int      `json:"tactic"`    // 0..40
	Players   int      `json:"players"`   // 0..35
	Fits      int      `json:"fits"`      // starters whose traits suit the style
	Prefer    []string `json:"prefer"`    // formations the coach likes
	Misses    []string `json:"misses"`    // tactic settings that clash: mentality|pressing|passing|width
}

func in(xs []string, v string) bool {
	if len(xs) == 0 {
		return true
	}
	for _, x := range xs {
		if x == v {
			return true
		}
	}
	return false
}

// ComputeCoachFit: how well the head coach's philosophy matches formation, tactics and players.
func ComputeCoachFit(head *Coach, formation string, t Tactic, starters []*Player) CoachFit {
	if head == nil {
		return CoachFit{Score: 50}
	}
	style := styleFor(head)
	cs := CoachStyles[style]
	f := CoachFit{Style: style, Coach: head.Name, Prefer: cs.Formations}
	if in(cs.Formations, formation) {
		f.Formation = 25
	} else {
		f.Formation = 5
	}
	for _, x := range []struct {
		name string
		opts []string
		v    string
	}{{"mentality", cs.Mentality, t.Mentality}, {"pressing", cs.Pressing, t.Pressing}, {"passing", cs.Passing, t.Passing}, {"width", cs.Width, t.Width}} {
		if in(x.opts, x.v) {
			f.Tactic += 10
		} else {
			f.Misses = append(f.Misses, x.name)
		}
	}
	if style == "star_power" {
		var ovr []float64
		for _, p := range starters {
			if p != nil {
				ovr = append(ovr, float64(p.Overall))
			}
		}
		sort.Sort(sort.Reverse(sort.Float64Slice(ovr)))
		var top float64
		for i := 0; i < 3 && i < len(ovr); i++ {
			top += ovr[i] / 3
		}
		f.Players = int(clamp((top-70)*2.5, 0, 35))
	}
	for _, p := range starters {
		if p == nil {
			continue
		}
		for _, tr := range cs.Traits {
			if hasTrait(p, tr) {
				f.Fits++
				break
			}
		}
	}
	if style != "star_power" {
		f.Players = int(math.Min(35, float64(f.Fits)*7))
	}
	f.Score = f.Formation + f.Tactic + f.Players
	return f
}

// FitMultiplier: 50 is neutral, 100 lifts the team 4%, 0 costs 4%.
func FitMultiplier(score int) float64 { return 1 + float64(score-50)/50*0.04 }

// traitRating adds small team-rating bonuses from the starters' traits.
func traitRating(r *TeamRating, starters []*Player, bigGame bool) {
	for _, p := range starters {
		if p == nil {
			continue
		}
		for _, t := range p.Traits {
			switch t {
			case "poacher", "long_shot", "flair":
				r.Attack += 0.4
			case "playmaker", "one_two":
				r.Midfield += 0.4
			case "hard_tackler", "aerial":
				r.Defense += 0.35
			case "reflexes":
				r.Defense += 0.6
			case "big_game":
				if bigGame {
					r.Attack += 0.6
					r.Midfield += 0.3
				}
			}
		}
	}
}

// ---------------------------------------------------------------- visibility

const ScoutRevealSkill = 15

// visibleTraits decides whether the user can see a player's traits.
func visibleTraits(p *Player, userClubID, scoutSkill int) bool {
	if p.TraitsKnown || scoutSkill >= ScoutRevealSkill {
		return true
	}
	return p.ClubID != nil && *p.ClubID == userClubID && p.Tenure >= 5
}

// redact hides unrevealed traits before players are sent to the browser.
func redact(ps []*Player, userClubID, scoutSkill int) {
	for _, p := range ps {
		if !visibleTraits(p, userClubID, scoutSkill) {
			p.HiddenTraits = len(p.Traits)
			p.Traits = nil
			p.Dev = ""
		} else {
			p.Dev = devClass(p)
		}
	}
}

func userScoutSkill(ctx context.Context, q DBTX, userClubID int) int {
	cs, _ := queryCoaches(ctx, q, `club_id=$1 AND role='scout'`, userClubID)
	s := 0
	for _, c := range cs {
		v := c.Skill
		for _, p := range c.Perks {
			if p == "talent_eye" {
				v += 5 // sees through players much sooner
			}
		}
		s = max(s, v)
	}
	return s
}

// RevealTraits spends one upgrade point to scout a player's hidden traits.
func (s *Store) RevealTraits(ctx context.Context, careerID, playerID int) (*Player, error) {
	var out *Player
	err := s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		p, err := getPlayer(ctx, q, careerID, playerID)
		if err != nil {
			return err
		}
		if p.TraitsKnown {
			out = p
			return nil
		}
		if c.TP < 1 {
			return userErr("no_tp", "Not enough upgrade points")
		}
		c.TP--
		p.TraitsKnown = true
		if err := savePlayer(ctx, q, p); err != nil {
			return err
		}
		out = p
		return saveCareer(ctx, q, c)
	})
	return out, err
}
