package game

import "math"

// ---------------------------------------------------------------- position training
//
// A player can train for a role that is not his own (Care.Learn), e.g. a winger learning to play up front. Every day
// of training brings him closer (LearnDaily), minutes played in that role bring him closer still (LearnMatch), and
// the further the role is from his line, the slower it goes (learnSpeed). Partly learned, the penalty for playing
// there shrinks with his progress; once learned (Care.Known, MaxKnown roles at most) he plays it like his own.

const (
	LearnDaily = 2.5 // progress (out of 100) for a day of training
	LearnMatch = 10  // more for a full match in that role (a share for fewer minutes)
	MaxKnown   = 3   // roles a player can know besides his own
)

// RoleLearn: the role a player is training for and how far he has come (0–100).
type RoleLearn struct {
	Role string  `json:"role"`
	Pct  float64 `json:"pct"`
}

// rolePlay: the role a player of yours had in today's match and his share of the 90 minutes.
type rolePlay struct {
	role  string
	share float64
}

// baseFit: fitFactor without anything learned.
func baseFit(p *Player, role string) float64 {
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

// learnFit: the fit a player has in a role he knows (1) or is learning (closer to 1 as he progresses).
func learnFit(p *Player, role string, f float64) float64 {
	if f >= 1 || p.Position == "GK" || RoleCat(role) == "GK" {
		return f
	}
	for _, k := range p.Known {
		if roleFits(k, role) { // a learned LB also plays LWB, a learned LW the left of a midfield four
			return 1
		}
	}
	if p.Learning != "" && roleFits(p.Learning, role) {
		return f + (1-f)*math.Min(100, p.LearnPct)/100
	}
	return f
}

// learnSpeed: a role in his own line is learned fastest, one a line away more slowly, one further away slower still.
func learnSpeed(p *Player, role string) float64 {
	switch d := catOrder[RoleCat(role)] - catOrder[p.Position]; {
	case d == 0:
		return 1
	case d == 1 || d == -1:
		return 0.6
	}
	return 0.4
}

// canLearn: why a player cannot start training for a role ("" = he can).
func canLearn(c *Career, p *Player, role string) string {
	switch {
	case !roleInPosition(role, RoleCat(role)) || role == "GK" || p.Position == "GK":
		return "learn_bad_role" // a keeper stays a keeper, an outfield player stays outfield
	case baseFit(p, role) >= 1:
		return "role_fits"
	}
	for _, k := range c.Care.Known[p.ID] {
		if k == role {
			return "role_known"
		}
	}
	if len(c.Care.Known[p.ID]) >= MaxKnown {
		return "learn_max"
	}
	return ""
}

// learnDay: one day of position training for a player of yours: a day's progress, more for minutes in that role
// today (uo: today's match, nil without one); none while he is injured. Once learned the role is his for good.
func (w *world) learnDay(p *Player, uo *matchOutcome) {
	c := w.career
	lr, ok := c.Care.Learn[p.ID]
	if !ok || (p.Injury > 0 && !p.Rushed) {
		return
	}
	gain := LearnDaily
	if uo != nil {
		if rp, ok := uo.roles[p.ID]; ok && roleFits(lr.Role, rp.role) {
			gain += LearnMatch * rp.share
		}
	}
	lr.Pct = math.Min(100, lr.Pct+gain*learnSpeed(p, lr.Role))
	if lr.Pct >= 100 {
		delete(c.Care.Learn, p.ID)
		if c.Care.Known == nil {
			c.Care.Known = map[int][]string{}
		}
		c.Care.Known[p.ID] = append(c.Care.Known[p.ID], lr.Role)
		p.Known, p.Learning, p.LearnPct = c.Care.Known[p.ID], "", 0
		w.logHappening(ComEvent{Key: "role_learned", Name: p.Name + " · " + lr.Role})
		return
	}
	c.Care.Learn[p.ID] = lr
	p.LearnPct = lr.Pct
}
