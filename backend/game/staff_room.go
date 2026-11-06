package game

import (
	"context"
	"math"
	"sort"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- the staff room (Staff page)
//
// GET  /api/careers/{id}/staff  → StaffRoomView: every role (from CoachRoles, so a new role simply
//      appears) with its coach and today's candidates, the decision cards, coach wage demands
//      (answered through contracts.go), the assistant's notes, young players to mentor, the log.
// POST /api/careers/{id}/staff  → StaffAction: decide · mentor · unmentor · hire · fire · bonus.
// CareerState.StaffView carries the open cards for badges and the inbox (staffBadge).

type MenteeView struct {
	PlayerID  int    `json:"playerId"`
	Name      string `json:"name"`
	Position  string `json:"position"`
	Role      string `json:"role"`
	Age       int    `json:"age"`
	Overall   int    `json:"overall"`
	Potential int    `json:"potential"`
	Boost     int    `json:"boost"`
	Fit       string `json:"fit"` // full | good | half
}

// StaffCard: one member of the user's staff.
type StaffCard struct {
	ID         int          `json:"id"`
	Name       string       `json:"name"`
	Nation     string       `json:"nation"`
	Role       string       `json:"role"`
	Style      string       `json:"style,omitempty"`
	Skill      int          `json:"skill"` // his real skill
	Mood       int          `json:"mood"`  // what morale adds to it today (+1, 0, −1)
	Ceil       int          `json:"ceil"`
	Perks      []string     `json:"perks"`
	Age        int          `json:"age"`
	Trait      string       `json:"trait"`
	Morale     int          `json:"morale"`
	XP         int          `json:"xp"`
	XPNeed     int          `json:"xpNeed"`
	Ends       int          `json:"ends"` // last season of his contract
	Wage       int64        `json:"wage"`
	Market     int64        `json:"market"`
	Seasons    int          `json:"seasons"`
	Since      int          `json:"since"` // season he joined
	Leaving    bool         `json:"leaving"`
	Retiring   bool         `json:"retiring"`
	LevelUp    bool         `json:"levelUp"`
	BonusIn    int          `json:"bonusIn"` // days until he can have another bonus
	BonusCost  int64        `json:"bonusCost"`
	PastPeak   bool         `json:"pastPeak"`   // at or past his ceiling: each point takes PastPeakCost times the experience
	Course     string       `json:"course"`     // advanced course: "open", "done" (this season) or "" (it would not help)
	CourseCost int64        `json:"courseCost"` // what it costs
	CourseCeil int          `json:"courseCeil"` // his ceiling after it
	Slots      int          `json:"slots"`      // mentoring places (0: his role does not mentor)
	Mentees    []MenteeView `json:"mentees"`
	Famous     bool         `json:"famous"`
	QuitRisk   bool         `json:"quitRisk"`
}

type CandidateView struct {
	ID     int      `json:"id"`
	Name   string   `json:"name"`
	Nation string   `json:"nation"`
	Role   string   `json:"role"`
	Style  string   `json:"style,omitempty"`
	Skill  int      `json:"skill"`
	Ceil   int      `json:"ceil"`
	Perks  []string `json:"perks"`
	Age    int      `json:"age"`
	Trait  string   `json:"trait"`
	Price  int64    `json:"price"`
	Wage   int64    `json:"wage"`
	Famous bool     `json:"famous"`
	Slots  int      `json:"slots"`
}

type RoleSlot struct {
	Role       string          `json:"role"`
	Group      string          `json:"group"` // coaching | medical
	Coach      *StaffCard      `json:"coach"`
	Candidates []CandidateView `json:"candidates"`
}

type YoungView struct {
	ID        int         `json:"id"`
	Name      string      `json:"name"`
	Position  string      `json:"position"`
	Role      string      `json:"role"`
	Age       int         `json:"age"`
	Overall   int         `json:"overall"`
	Potential int         `json:"potential"`
	Mentor    int         `json:"mentor"` // coach id, 0 = nobody
	Boosts    map[int]int `json:"boosts"` // coach → % extra growth he would bring
	Starter   bool        `json:"starter"`
}

type ReportLine struct {
	ID       int     `json:"id"`
	Name     string  `json:"name"`
	Position string  `json:"position"`
	V        float64 `json:"v"`
	N        int     `json:"n"`
	Age      int     `json:"age,omitempty"`
}

// StaffReport: the assistant's notes after the last matchday.
type StaffReport struct {
	Verdict  *StaffVerdict `json:"verdict"`
	Style    string        `json:"style,omitempty"`
	InForm   []ReportLine  `json:"inForm"`   // average rating of the last games (V), games counted (N)
	Rest     []ReportLine  `json:"rest"`     // fitness (V)
	Minutes  []ReportLine  `json:"minutes"`  // potential (V), games in a row without playing (N)
	Improved []ReportLine  `json:"improved"` // overall now (V), points gained (N)
	Since    int           `json:"since"`    // matchday the week started
}

type PromiseView struct {
	Kind   string `json:"kind"`
	Coach  string `json:"coach"`
	Player string `json:"player,omitempty"`
	Pos    string `json:"pos,omitempty"`
	Need   int    `json:"need,omitempty"`
	Got    int    `json:"got,omitempty"`
	Left   int    `json:"left"` // minutes: games left · signing: days left
}

type BoostView struct {
	Key    string `json:"key"`
	Pos    string `json:"pos,omitempty"`
	Player string `json:"player,omitempty"`
	V      int    `json:"v"`
	Left   int    `json:"left"`
}

type StaffRoomView struct {
	Season     int             `json:"season"`
	Day        int             `json:"day"`
	Tick       int             `json:"tick"`
	Offseason  bool            `json:"offseason"`
	Budget     int64           `json:"budget"`
	Wages      int64           `json:"wages"`
	Filled     int             `json:"filled"`
	Slots      []RoleSlot      `json:"slots"`
	Decisions  []StaffDecision `json:"decisions"`
	Raises     []Demand        `json:"raises"`
	Report     StaffReport     `json:"report"`
	Youngsters []YoungView     `json:"youngsters"`
	Promises   []PromiseView   `json:"promises"`
	Boosts     []BoostView     `json:"boosts"`
	Log        []StaffLog      `json:"log"`
	Ready      bool            `json:"ready"`
}

func (s *Store) StaffRoom(ctx context.Context, careerID int) (*StaffRoomView, error) {
	var v *StaffRoomView
	err := s.tx(ctx, func(q pgx.Tx) error {
		w, err := loadWorld(ctx, q, newRand(), careerID)
		if err != nil {
			return err
		}
		v, err = w.staffRoomView(ctx, q)
		return err
	})
	return v, err
}

func (w *world) staffRoomView(ctx context.Context, q DBTX) (*StaffRoomView, error) {
	c := w.career
	st := w.crew
	user := w.byID[c.UserClubID]
	v := &StaffRoomView{Season: c.Season, Day: c.Day, Tick: st.Tick, Offseason: c.Day > len(Calendar), Budget: user.Budget, Ready: st.ok}
	pool, err := queryCoaches(ctx, q, `career_id=$1 AND club_id IS NULL ORDER BY role, skill DESC`, c.ID)
	if err != nil {
		return nil, err
	}
	famous := map[string]bool{}
	for _, fc := range FreeCoaches {
		famous[fc.Name] = true
	}
	squad := w.userSquad()
	mentees := map[int][]*Player{}
	for _, p := range squad {
		if p.Mentor != nil {
			mentees[p.Mentor.CoachID] = append(mentees[p.Mentor.CoachID], p)
		}
	}
	roles := append([]string{}, CoachRoles...)
	for _, co := range w.coaches[user.ID] { // (a role the list does not know yet still shows)
		known := false
		for _, r := range roles {
			known = known || r == co.Role
		}
		if !known {
			roles = append(roles, co.Role)
		}
	}
	for _, role := range roles {
		slot := RoleSlot{Role: role, Group: "coaching", Candidates: []CandidateView{}}
		if staffMedical(role) {
			slot.Group = "medical"
		}
		if co := coachOfRole(w.coaches[user.ID], role); co != nil {
			slot.Coach = w.staffCard(co, mentees[co.ID], famous)
			v.Filled++
			v.Wages += co.Wage
		}
		for _, x := range pool {
			if x.Role == role {
				slot.Candidates = append(slot.Candidates, candidateView(x, famous[x.Name]))
			}
		}
		v.Slots = append(v.Slots, slot)
	}
	v.Decisions = st.viewDecisions()
	v.Raises = []Demand{}
	for _, d := range c.Contracts.Demands {
		if d.Kind == "coach" && coachByID(w.coaches[user.ID], d.ID) != nil {
			v.Raises = append(v.Raises, d)
		}
	}
	v.Report = w.staffReport()
	v.Youngsters = w.staffYoungsters(squad)
	v.Promises = []PromiseView{}
	for _, pr := range st.Promises {
		pv := PromiseView{Kind: pr.Kind, Coach: pr.Coach, Player: pr.Player, Pos: pr.Pos, Need: pr.Need, Got: pr.Got, Left: pr.Left}
		if pr.Kind == "signing" {
			pv.Left = max(0, pr.Until-st.Tick)
		}
		v.Promises = append(v.Promises, pv)
	}
	v.Boosts = []BoostView{}
	for _, b := range st.Boosts {
		if b.Until <= st.Tick {
			continue
		}
		bv := BoostView{Key: b.Key, Pos: b.Pos, V: int(math.Round(b.V * 100)), Left: b.Until - st.Tick}
		if b.PlayerID != 0 {
			if p := w.mine(b.PlayerID); p != nil {
				bv.Player = p.Name
			}
		}
		v.Boosts = append(v.Boosts, bv)
	}
	v.Log = st.Log
	if v.Log == nil {
		v.Log = []StaffLog{}
	}
	return v, nil
}

func fitName(f float64) string {
	switch {
	case f >= 1:
		return "full"
	case f >= 0.75:
		return "good"
	}
	return "half"
}

func (w *world) staffCard(co *Coach, ms []*Player, famous map[string]bool) *StaffCard {
	st := w.crew
	c := w.career
	l := st.life(co, c.now(), c.Day <= len(Calendar))
	base := st.baseSkill(co)
	card := &StaffCard{ID: co.ID, Name: co.Name, Nation: co.Nation, Role: co.Role, Skill: base, Mood: co.Skill - base, Ceil: max(l.Ceil, base),
		Perks: co.Perks, Age: l.Age, Trait: l.Trait, Morale: int(math.Round(l.Morale)), XP: l.XP, XPNeed: coachXPNeed(base, l.Ceil),
		Ends: contractEnds(c, l.Years), Wage: co.Wage, Market: int64(base) * 10_000, Seasons: l.Seasons, Since: l.Since / 100,
		Leaving: l.Leaving, Retiring: l.Retiring, LevelUp: l.LevelAt > 0 && st.Tick-l.LevelAt < 3, Slots: mentorSlots(base, l.Trait, co.Role),
		Famous: famous[co.Name], QuitRisk: l.Morale <= StaffQuit+7, Mentees: []MenteeView{},
		BonusIn: max(0, l.BonusUntil-st.Tick), BonusCost: roundK(float64(co.Wage) * StaffBonusWeeks),
		PastPeak: base >= l.Ceil && base < MaxCoachSkill, Course: courseState(base, l, c.Season), CourseCost: courseCost(co),
		CourseCeil: courseCeil(base, l)}
	if co.Role == "head" {
		card.Style = styleFor(co)
	}
	if card.Perks == nil {
		card.Perks = []string{}
	}
	for _, p := range ms {
		card.Mentees = append(card.Mentees, MenteeView{PlayerID: p.ID, Name: p.Name, Position: p.Position, Role: p.Role, Age: p.Age,
			Overall: p.Overall, Potential: p.Potential, Boost: p.Mentor.Boost, Fit: fitName(mentorFit(co.Role, p.Position))})
	}
	return card
}

func candidateView(x *Coach, famous bool) CandidateView {
	age := coachAge(x)
	cv := CandidateView{ID: x.ID, Name: x.Name, Nation: x.Nation, Role: x.Role, Skill: x.Skill, Ceil: coachCeil(x.Skill, x.ID, age),
		Perks: x.Perks, Age: age, Trait: coachTrait(x.ID), Price: x.Price, Wage: x.Wage, Famous: famous}
	if x.Role == "head" {
		cv.Style = styleFor(x)
	}
	cv.Slots = mentorSlots(x.Skill, cv.Trait, x.Role)
	if cv.Perks == nil {
		cv.Perks = []string{}
	}
	return cv
}

func (st *StaffState) viewDecisions() []StaffDecision {
	out := make([]StaffDecision, 0, len(st.Decisions))
	for _, d := range st.Decisions {
		d.Left = max(0, d.Until-st.Tick)
		out = append(out, d)
	}
	return out
}

func (w *world) staffReport() StaffReport {
	st := w.crew
	c := w.career
	user := w.byID[c.UserClubID]
	rp := StaffReport{Verdict: st.Last, InForm: []ReportLine{}, Rest: []ReportLine{}, Minutes: []ReportLine{}, Improved: []ReportLine{}, Since: st.WeekDay}
	if head := headCoachOf(w.coaches[user.ID]); head != nil {
		rp.Style = styleFor(head)
	}
	inXI := map[int]bool{}
	for _, id := range user.Lineup {
		inXI[id] = true
	}
	es := &c.Events
	for _, p := range w.userSquad() {
		line := ReportLine{ID: p.ID, Name: p.Name, Position: p.Position, Age: p.Age}
		if fs := st.Form[p.ID]; len(fs) >= 2 {
			n := min(3, len(fs))
			sum := 0.0
			for _, x := range fs[len(fs)-n:] {
				sum += x
			}
			if avg := sum / float64(n); avg >= 7 {
				l := line
				l.V, l.N = math.Round(avg*10)/10, n
				rp.InForm = append(rp.InForm, l)
			}
		}
		if p.Injury == 0 && p.Fitness < 80 && (inXI[p.ID] || p.Fitness < 70) {
			l := line
			l.V = math.Round(p.Fitness)
			rp.Rest = append(rp.Rest, l)
		}
		if !isLegend(p) && p.Age <= 21 && p.Potential-p.Overall >= 6 && p.Injury == 0 && !inXI[p.ID] && es.Bench[p.ID] >= 2 {
			l := line
			l.V, l.N = float64(p.Potential), es.Bench[p.ID]
			rp.Minutes = append(rp.Minutes, l)
		}
		if was, ok := st.WeekOvr[p.ID]; ok && p.Overall > was {
			l := line
			l.V, l.N = float64(p.Overall), p.Overall-was
			rp.Improved = append(rp.Improved, l)
		}
	}
	sort.Slice(rp.InForm, func(i, j int) bool { return rp.InForm[i].V > rp.InForm[j].V })
	sort.Slice(rp.Rest, func(i, j int) bool { return rp.Rest[i].V < rp.Rest[j].V })
	sort.Slice(rp.Minutes, func(i, j int) bool { return rp.Minutes[i].V > rp.Minutes[j].V })
	sort.Slice(rp.Improved, func(i, j int) bool {
		return rp.Improved[i].N > rp.Improved[j].N || (rp.Improved[i].N == rp.Improved[j].N && rp.Improved[i].V > rp.Improved[j].V)
	})
	trim := func(ls []ReportLine, n int) []ReportLine {
		if len(ls) > n {
			return ls[:n]
		}
		return ls
	}
	rp.InForm, rp.Rest, rp.Minutes, rp.Improved = trim(rp.InForm, 3), trim(rp.Rest, 4), trim(rp.Minutes, 3), trim(rp.Improved, 4)
	return rp
}

func (w *world) staffYoungsters(squad []*Player) []YoungView {
	st := w.crew
	user := w.byID[w.career.UserClubID]
	inXI := map[int]bool{}
	for _, id := range user.Lineup {
		inXI[id] = true
	}
	out := []YoungView{}
	for _, p := range squad {
		if !canMentee(p) || w.isLoanee(p.ID) {
			continue
		}
		y := YoungView{ID: p.ID, Name: p.Name, Position: p.Position, Role: p.Role, Age: p.Age, Overall: p.Overall, Potential: p.Potential,
			Boosts: map[int]int{}, Starter: inXI[p.ID]}
		if p.Mentor != nil {
			y.Mentor = p.Mentor.CoachID
		}
		for _, co := range w.coaches[user.ID] {
			if l := st.People[co.ID]; l != nil && staffCoaching(co.Role) {
				y.Boosts[co.ID] = int(math.Round(mentorBoost(co.Skill, l.Trait, co.Role, p) * 100))
			}
		}
		out = append(out, y)
	}
	sort.SliceStable(out, func(i, j int) bool {
		gi, gj := out[i].Potential-out[i].Overall, out[j].Potential-out[j].Overall
		return gi > gj || (gi == gj && out[i].Potential > out[j].Potential)
	})
	return out
}

// StaffBadge: the open cards, for the menu badge and the inbox (CareerState.StaffView).
type StaffBadge struct {
	Waiting   int             `json:"waiting"`
	Urgent    int             `json:"urgent"` // due today or tomorrow
	Decisions []StaffDecision `json:"decisions"`
}

func (w *world) staffBadge() *StaffBadge {
	st := w.crew
	if st == nil || w.career.Ended != "" {
		return nil
	}
	b := &StaffBadge{Decisions: st.viewDecisions()}
	b.Waiting = len(b.Decisions)
	for _, d := range b.Decisions {
		if d.Left <= 1 {
			b.Urgent++
		}
	}
	return b
}

// ---------------------------------------------------------------- actions

type StaffReq struct {
	Action   string `json:"action"` // decide | mentor | unmentor | hire | fire | bonus | course
	ID       int    `json:"id"`     // decide: the card
	Choice   string `json:"choice"`
	CoachID  int    `json:"coachId"`
	PlayerID int    `json:"playerId"`
	Years    int    `json:"years"` // hire: contract length (1–3 seasons)
}

func (s *Store) StaffAction(ctx context.Context, careerID int, req StaffReq) (*StaffResult, error) {
	var out *StaffResult
	err := s.tx(ctx, func(q pgx.Tx) error {
		// answers queue up behind a matchday (and a double click cannot answer the same card twice)
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		r := newRand()
		w, err := loadWorld(ctx, q, r, careerID)
		if err != nil {
			return err
		}
		c := w.career
		st := w.crew
		if !st.ok {
			return userErr("staff_unavailable", "The staff room is not ready yet")
		}
		sr := w.staffRun(ctx, q, r, nil)
		user := w.byID[c.UserClubID]
		uid := user.ID
		switch req.Action {
		case "decide":
			i := -1
			for k, d := range st.Decisions {
				if d.ID == req.ID {
					i = k
				}
			}
			if i < 0 {
				return userErr("no_decision", "This decision has gone")
			}
			d := st.Decisions[i]
			st.Decisions = append(st.Decisions[:i], st.Decisions[i+1:]...)
			res, err := sr.resolve(&d, req.Choice, false)
			if err != nil {
				return err
			}
			out = res
		case "mentor":
			co := coachByID(w.coaches[uid], req.CoachID)
			if co == nil || !staffCoaching(co.Role) {
				return userErr("not_coaching", "Only a coach can mentor")
			}
			p := w.mine(req.PlayerID)
			if p == nil || !canMentee(p) || w.isLoanee(p.ID) {
				return userErr("not_mentee", "He cannot be mentored")
			}
			l := st.People[co.ID]
			n := 0
			for pid, cid := range st.Mentees {
				if cid == co.ID && pid != p.ID {
					n++
				}
			}
			if n >= mentorSlots(st.baseSkill(co), l.Trait, co.Role) {
				return userErr("mentor_full", "He has no room for another mentee")
			}
			st.Mentees[p.ID] = co.ID
			out = &StaffResult{Outcome: "mentor", Name: p.Name, Other: co.Name, Amount: int64(math.Round(mentorBoost(co.Skill, l.Trait, co.Role, p) * 100))}
		case "unmentor":
			if _, ok := st.Mentees[req.PlayerID]; !ok {
				return userErr("not_mentee", "He has no mentor")
			}
			delete(st.Mentees, req.PlayerID)
			out = &StaffResult{Outcome: "unmentor"}
			if p := w.mine(req.PlayerID); p != nil {
				out.Name = p.Name
			}
		case "hire":
			cs, err := queryCoaches(ctx, q, `career_id=$1 AND id=$2`, c.ID, req.CoachID)
			if err != nil {
				return err
			}
			if len(cs) == 0 {
				return ErrNotFound
			}
			years := req.Years
			if years == 0 {
				years = 2
			}
			if err := sr.hire(cs[0], years); err != nil {
				return err
			}
			sr.say("staff_hired", cs[0].Name, 0)
			out = &StaffResult{Outcome: "hired", Name: cs[0].Name, Amount: -cs[0].Price}
		case "fire":
			co := coachByID(w.coaches[uid], req.CoachID)
			if co == nil {
				return userErr("coach_not_yours", "This coach is not at your club")
			}
			name := co.Name
			if err := sr.leave(co, 0, false); err != nil {
				return err
			}
			sr.say("staff_fired_gone", name, 0)
			out = &StaffResult{Outcome: "fired", Name: name}
		case "bonus":
			co := coachByID(w.coaches[uid], req.CoachID)
			if co == nil {
				return userErr("coach_not_yours", "This coach is not at your club")
			}
			l := st.People[co.ID]
			if st.Tick < l.BonusUntil {
				return userErr("bonus_wait", "He had a bonus recently")
			}
			cost := roundK(float64(co.Wage) * StaffBonusWeeks)
			if user.Budget < cost {
				return userErr("no_budget", "Not enough budget")
			}
			user.Budget -= cost
			if err := addFinance(ctx, q, c, "staff_bonus", -cost, co.Name); err != nil {
				return err
			}
			sr.moraleRaw(l, StaffBonusMorale)
			l.BonusUntil = st.Tick + StaffBonusWait
			out = &StaffResult{Outcome: "bonus", Name: co.Name, Amount: -cost}
		case "course":
			co := coachByID(w.coaches[uid], req.CoachID)
			if co == nil {
				return userErr("coach_not_yours", "This coach is not at your club")
			}
			l := st.People[co.ID]
			base := st.baseSkill(co)
			switch courseState(base, l, c.Season) {
			case "done":
				return userErr("course_done", "He has been on a course this season")
			case "":
				return userErr("course_not_now", "A course would not help him now")
			}
			cost := courseCost(co)
			if user.Budget < cost {
				return userErr("no_budget", "Not enough budget")
			}
			user.Budget -= cost
			if err := addFinance(ctx, q, c, "staff_course", -cost, co.Name); err != nil {
				return err
			}
			l.Ceil = courseCeil(base, l)
			l.Course = c.Season
			sr.moraleRaw(l, CourseMorale)
			sr.say("staff_course", co.Name, int64(l.Ceil))
			if err := sr.gainXP(co, l, 0); err != nil { // what he banked at his peak, now at the usual rate
				return err
			}
			out = &StaffResult{Outcome: "course", Name: co.Name, Amount: -cost, Ceil: l.Ceil}
		default:
			return userErr("bad_action", "Unknown action")
		}
		if err := sr.finish(); err != nil {
			return err
		}
		if err := saveClub(ctx, q, user); err != nil {
			return err
		}
		return saveCareer(ctx, q, c)
	})
	return out, err
}
