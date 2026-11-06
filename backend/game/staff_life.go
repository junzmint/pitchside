package game

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"strings"
	"sync/atomic"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- coaching staff life (staff work stream)
//
// Coaches are people. Everyone on the user's staff has an age, a contract (until the end of a given
// season), morale (how he gets on with you), experience that turns into skill (up to his ceiling;
// a second perk at 15), a personality, and one day he retires. Things to deal with arrive as
// decision cards on the Staff page (staff_decisions.go): contract talks, a club poaching him, a row
// between the head coach and an assistant, a training camp, a signing the head coach wants, a
// prospect who needs minutes, a famous coach out of work. Coaches mentor young players
// (Player.GrowBoost), and the assistant writes notes after every matchday (staff_room.go).
//
// The state lives in its own table, staff_life (one JSONB document per career, created by Migrate).
// AI clubs keep the simple model: their coaches never age, sulk or retire.
//
// Hook points, called from match.go:
//   loadStaff  — in loadWorld, after the squads and coaches are loaded (read only): Player.GrowBoost
//                and Player.Mentor for mentees and short boosts, and the mood bonus on the skill of
//                the user's coaches (a happy coach works as one point better, an unhappy one worse)
//   staffTick  — in advance, once per matchday: morale, experience, contracts, the season review,
//                decision cards and their defaults, the assistant's notes

const (
	StaffMoraleStart = 70.0 // the staff already at the club when the staff room opens
	StaffMoraleNew   = 75.0 // a new job: he arrives keen
	StaffMoraleRest  = 65.0 // morale drifts back towards this
	StaffMoraleDrift = 0.04
	StaffHappy       = 80.0 // at or above: works as +1 skill
	StaffUnhappy     = 30.0 // at or below: works as −1 skill
	StaffQuit        = 18.0 // at or below: he may walk out
	StaffMaxOpen     = 2    // random decision cards open at once (contract talks come on top)
	StaffLogSize     = 24
	MentorMaxAge     = 23   // mentees are this age or younger
	GrowBoostCap     = 0.45 // every growth boost together
	StaffBonusWeeks  = 3    // a bonus costs three weeks of his wage...
	StaffBonusMorale = 12   // ...and lifts his morale this much
	StaffBonusWait   = 10   // matchdays before the same coach can have another
	RetireAge        = 64   // from this age a coach may decide to retire
	StaffMaxYears    = 4    // the longest contract, in seasons
	CaretakerAfter   = 6    // matchdays a role can stay empty before the board appoints a stand-in
	MaxCoachSkill    = 20   // the top of the scale
	PastPeakCost     = 3    // at or past his ceiling a skill point takes three times the experience
	CourseWeeks      = 12   // an advanced course costs twelve weeks of his wage...
	CourseMorale     = 6    // ...lifts his morale a little (the experience he banked at his peak counts at once)...
	CourseYoungAge   = 50   // ...and lifts his ceiling by 2 below this age, by 1 from it; once a season
)

// Mentor: who mentors a young player and how much faster he grows (shown on the player).
type Mentor struct {
	CoachID int    `json:"coachId"`
	Coach   string `json:"coach"`
	Role    string `json:"role"`
	Boost   int    `json:"boost"` // % extra growth
}

// CoachLife: one coach of the user's staff as a person.
type CoachLife struct {
	Age        int     `json:"age"`
	Years      int     `json:"years"` // seasons left on his contract, the current one included
	Morale     float64 `json:"morale"`
	XP         int     `json:"xp"`      // experience towards his next skill point
	Ceil       int     `json:"ceil"`    // the best he can become
	Trait      string  `json:"trait"`   // loyal | ambitious | teacher | fiery | calm
	Since      int     `json:"since"`   // season*100+day he joined
	Joined     int     `json:"joined"`  // tick he joined (0: he was here when the staff room opened)
	Seasons    int     `json:"seasons"` // seasons completed at the club
	Wage       int64   `json:"wage"`    // agreed wage last seen (a pay rise lifts his morale)
	BonusUntil int     `json:"bonusUntil,omitempty"`
	LevelAt    int     `json:"levelAt,omitempty"` // tick of his last skill point (the card shines for a few days)
	Retiring   bool    `json:"retiring,omitempty"`
	Stayed     bool    `json:"stayed,omitempty"`  // talked out of retiring once already
	Leaving    bool    `json:"leaving,omitempty"` // contract not renewed: leaves at the end of the season
	Asked      int     `json:"asked,omitempty"`   // season his renewal talks opened
	RetireAsk  int     `json:"retireAsk,omitempty"`
	Course     int     `json:"course,omitempty"` // season of his last advanced course (one a season)
}

// StaffBoost: a short burst of faster growth (a training camp, a clinic, a vote of confidence).
type StaffBoost struct {
	Key      string  `json:"key"`
	Pos      string  `json:"pos,omitempty"` // positions it covers, e.g. "MF,FW"; "" = everyone
	PlayerID int     `json:"playerId,omitempty"`
	V        float64 `json:"v"`
	Until    int     `json:"until"` // tick
}

func (b StaffBoost) applies(p *Player, tick int) bool {
	if b.Until <= tick {
		return false
	}
	if b.PlayerID != 0 {
		return b.PlayerID == p.ID
	}
	return b.Pos == "" || strings.Contains(b.Pos, p.Position)
}

// StaffPromise: something you promised a coach. signing: a new player in a position within a few
// days; minutes: a prospect plays in Need of the next Left matches.
type StaffPromise struct {
	Kind     string `json:"kind"`
	CoachID  int    `json:"coachId"`
	Coach    string `json:"coach"`
	PlayerID int    `json:"playerId,omitempty"`
	Player   string `json:"player,omitempty"`
	Pos      string `json:"pos,omitempty"`
	MinOvr   int    `json:"minOvr,omitempty"`
	Squad    []int  `json:"squad,omitempty"`
	Need     int    `json:"need,omitempty"`
	Got      int    `json:"got,omitempty"`
	Left     int    `json:"left,omitempty"`
	Until    int    `json:"until"`
}

// StaffVerdict: the head coach's word on the last match.
type StaffVerdict struct {
	Key       string  `json:"key"`
	Tip       string  `json:"tip"`
	Season    int     `json:"season"`
	Day       int     `json:"day"`
	Comp      string  `json:"comp"`
	Opp       string  `json:"opp"`
	GF        int     `json:"gf"`
	GA        int     `json:"ga"`
	Coach     string  `json:"coach"`
	CoachID   int     `json:"coachId"`
	Best      string  `json:"best,omitempty"`
	BestScore float64 `json:"bestScore,omitempty"`
}

// StaffLog: one line of the staff room's own news.
type StaffLog struct {
	Season int    `json:"season"`
	Day    int    `json:"day"`
	Key    string `json:"key"`
	Name   string `json:"name,omitempty"`
	Amount int64  `json:"amount,omitempty"`
}

// StaffState: the coaching staff's life for one career.
type StaffState struct {
	Started   bool               `json:"started"`
	Tick      int                `json:"tick"` // matchdays since the staff room opened
	People    map[int]*CoachLife `json:"people"`
	Decisions []StaffDecision    `json:"decisions"`
	NextID    int                `json:"nextId"`
	Mentees   map[int]int        `json:"mentees"` // player → mentor (coach id)
	Boosts    []StaffBoost       `json:"boosts"`
	Promises  []StaffPromise     `json:"promises"`
	Form      map[int][]float64  `json:"form"` // player → his last match ratings, newest last
	Last      *StaffVerdict      `json:"last,omitempty"`
	WeekOvr   map[int]int        `json:"weekOvr"` // overall at the weekly snapshot
	WeekTick  int                `json:"weekTick"`
	WeekDay   int                `json:"weekDay"`
	Asks      map[int]int64      `json:"asks"`   // coach → raise he asked for (contracts.go demands)
	Vacant    map[string]int     `json:"vacant"` // role → tick it fell vacant (the board steps in after a while)
	Cool      map[string]int     `json:"cool"`   // card kind → no new card of that kind before this tick
	Log       []StaffLog         `json:"log"`

	ok   bool        // the table exists, so the state can be saved
	base map[int]int // coach → his real skill (before the mood bonus)
}

func (st *StaffState) init() {
	if st.People == nil {
		st.People = map[int]*CoachLife{}
	}
	if st.Mentees == nil {
		st.Mentees = map[int]int{}
	}
	if st.Form == nil {
		st.Form = map[int][]float64{}
	}
	if st.WeekOvr == nil {
		st.WeekOvr = map[int]int{}
	}
	if st.Asks == nil {
		st.Asks = map[int]int64{}
	}
	if st.Cool == nil {
		st.Cool = map[string]int{}
	}
	if st.Vacant == nil {
		st.Vacant = map[string]int{}
	}
	if st.Decisions == nil {
		st.Decisions = []StaffDecision{}
	}
	if st.base == nil {
		st.base = map[int]int{}
	}
}

var staffTable atomic.Bool

func loadStaffState(ctx context.Context, q DBTX, careerID int) (*StaffState, error) {
	st := &StaffState{}
	if !staffTable.Load() {
		// a binary started against a database Migrate has not reached yet: run without the staff room
		var ok bool
		if err := q.QueryRow(ctx, `SELECT to_regclass('staff_life') IS NOT NULL`).Scan(&ok); err != nil {
			return nil, err
		}
		if !ok {
			st.init()
			return st, nil
		}
		staffTable.Store(true)
	}
	var raw []byte
	err := q.QueryRow(ctx, `SELECT data FROM staff_life WHERE career_id=$1`, careerID).Scan(&raw)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, st)
	}
	st.ok = true
	st.init()
	return st, nil
}

func saveStaffState(ctx context.Context, q DBTX, careerID int, st *StaffState) error {
	if st == nil || !st.ok {
		return nil
	}
	_, err := q.Exec(ctx, `INSERT INTO staff_life (career_id, data) VALUES ($1, $2)
		ON CONFLICT (career_id) DO UPDATE SET data=EXCLUDED.data`, careerID, st)
	return err
}

// ---------------------------------------------------------------- who he is

// staffHash: a stable number from a coach id, so a candidate keeps his age and character.
func staffHash(id, salt int) int {
	x := uint64(id)*0x9E3779B97F4A7C15 + uint64(salt)*0xBF58476D1CE4E5B9
	x ^= x >> 30
	x *= 0xBF58476D1CE4E5B9
	x ^= x >> 27
	x *= 0x94D049BB133111EB
	x ^= x >> 31
	return int(x % 1_000_003)
}

// coachAge: how old a coach is when we first meet him.
func coachAge(c *Coach) int {
	if c.Role == "head" {
		return 38 + staffHash(c.ID, 1)%27 // 38..64
	}
	return 31 + staffHash(c.ID, 1)%30 // 31..60
}

// StaffTraits: the five personalities.
//
//	loyal      rarely tempted by other clubs, takes knocks calmly, modest wage demands
//	ambitious  learns 50% faster, tempting for other clubs, asks for more
//	teacher    mentors better (+5%) and always has room for two
//	fiery      starts more rows, morale swings 30% harder
//	calm       fewer rows, morale swings 20% softer
var StaffTraits = []string{"loyal", "ambitious", "teacher", "fiery", "calm"}

func coachTrait(id int) string {
	switch x := staffHash(id, 2) % 100; {
	case x < 25:
		return "loyal"
	case x < 50:
		return "ambitious"
	case x < 70:
		return "teacher"
	case x < 85:
		return "fiery"
	}
	return "calm"
}

// coachCeil: the best a coach can become. Young coaches have the most room to grow.
func coachCeil(skill, id, age int) int {
	h := staffHash(id, 3)
	up := h % 2
	switch {
	case age < 42:
		up = 3 + h%3
	case age < 52:
		up = 1 + h%3
	case age < 60:
		up = h % 3
	}
	return min(MaxCoachSkill, skill+up)
}

func newCoachLife(c *Coach, skill, now, tick, years int, morale float64) *CoachLife {
	age := coachAge(c)
	return &CoachLife{Age: age, Years: years, Morale: morale, Ceil: coachCeil(skill, c.ID, age), Trait: coachTrait(c.ID),
		Since: now, Joined: tick}
}

// life: the coach's life story, created on first sight (kept once the state is saved). Staff who
// were at the club when the staff room opened have one to three seasons left; anyone hired since
// (outside the staff room) signed for two.
func (st *StaffState) life(co *Coach, now int, inSeason bool) *CoachLife {
	if l, ok := st.People[co.ID]; ok {
		return l
	}
	skill := co.Skill
	if b, ok := st.base[co.ID]; ok {
		skill = b
	}
	years, morale := 2, StaffMoraleNew
	if inSeason {
		years++
	}
	if !st.Started {
		years, morale = 1+staffHash(co.ID, 4)%3, StaffMoraleStart
	}
	l := newCoachLife(co, skill, now, st.Tick, years, morale)
	st.People[co.ID] = l
	return l
}

func (st *StaffState) baseSkill(co *Coach) int {
	if b, ok := st.base[co.ID]; ok {
		return b
	}
	return co.Skill
}

// moodBonus: what morale does to the skill he works at.
func moodBonus(m float64) int {
	switch {
	case m >= StaffHappy:
		return 1
	case m <= StaffUnhappy:
		return -1
	}
	return 0
}

// traitSwing: how a personality colours a change of morale.
func traitSwing(trait string, v float64) float64 {
	switch trait {
	case "fiery":
		return v * 1.3
	case "calm":
		return v * 0.8
	case "loyal":
		if v < 0 {
			return v * 0.7
		}
	case "ambitious":
		if v < 0 {
			return v * 1.2
		}
	}
	return v
}

// moraleV: a morale change as it will land on this coach (shown on the decision cards).
func moraleV(l *CoachLife, v float64) float64 {
	if l == nil {
		return v
	}
	return math.Round(traitSwing(l.Trait, v))
}

// xpNeed: experience for the next skill point.
func xpNeed(skill int) int { return 40 + 6*skill }

// staffCoaching: the roles that run training and can mentor, argue or propose sessions.
func staffCoaching(role string) bool {
	switch role {
	case "head", "attack", "defense", "fitness", "goalkeeping":
		return true
	}
	return false
}

// staffMedical: the medical team (shown apart; the medical stream owns what they do).
func staffMedical(role string) bool { return role == "physio" || role == "doctor" }

func coachByID(cs []*Coach, id int) *Coach {
	for _, c := range cs {
		if c.ID == id {
			return c
		}
	}
	return nil
}

func coachOfRole(cs []*Coach, role string) *Coach {
	for _, c := range cs {
		if c.Role == role {
			return c
		}
	}
	return nil
}

// areaCoach: the specialist for a position (forwards and midfielders: the attacking coach).
func areaCoach(cs []*Coach, pos string) *Coach {
	return coachOfRole(cs, map[string]string{"GK": "goalkeeping", "DF": "defense", "MF": "attack", "FW": "attack"}[pos])
}

// ---------------------------------------------------------------- mentoring

// mentorFit: how well a coach's speciality suits a position. The head and fitness coaches help
// everyone a bit; a specialist helps his own players fully and the others half as much.
func mentorFit(role, pos string) float64 {
	switch role {
	case "head", "fitness":
		return 0.75
	case "attack":
		if pos == "FW" || pos == "MF" {
			return 1
		}
	case "defense":
		if pos == "DF" {
			return 1
		}
		if pos == "MF" {
			return 0.75
		}
	case "goalkeeping":
		if pos == "GK" {
			return 1
		}
	}
	return 0.5
}

// mentorBoost: extra growth for a mentee, 16–29% from a specialist (by skill; teachers +5%).
func mentorBoost(skill int, trait, role string, p *Player) float64 {
	b := 0.08 + 0.008*float64(skill)
	if trait == "teacher" {
		b += 0.05
	}
	return b * mentorFit(role, p.Position)
}

// mentorSlots: one mentee each, two for a teacher or a coach of skill 14 or better.
func mentorSlots(skill int, trait, role string) int {
	if !staffCoaching(role) {
		return 0
	}
	if skill >= 14 || trait == "teacher" {
		return 2
	}
	return 1
}

func canMentee(p *Player) bool { return !isLegend(p) && !p.Retired && p.Age <= MentorMaxAge }

// ---------------------------------------------------------------- the hooks

func (w *world) loadStaff(ctx context.Context, q DBTX) error {
	st, err := loadStaffState(ctx, q, w.career.ID)
	if err != nil {
		return err
	}
	w.crew = st
	c := w.career
	uid := c.UserClubID
	inSeason := c.Day <= len(Calendar)
	for _, co := range w.coaches[uid] {
		st.base[co.ID] = co.Skill
		l := st.life(co, c.now(), inSeason)
		co.Skill = max(1, min(20, co.Skill+moodBonus(l.Morale)))
	}
	for _, p := range w.players[uid] {
		if p.ClubID == nil || *p.ClubID != uid {
			continue
		}
		b := 0.0
		if cid, ok := st.Mentees[p.ID]; ok && canMentee(p) {
			if co := coachByID(w.coaches[uid], cid); co != nil && staffCoaching(co.Role) {
				mb := mentorBoost(co.Skill, st.People[co.ID].Trait, co.Role, p)
				b += mb
				p.Mentor = &Mentor{CoachID: co.ID, Coach: co.Name, Role: co.Role, Boost: int(math.Round(mb * 100))}
			}
		}
		for _, bo := range st.Boosts {
			if bo.applies(p, st.Tick) {
				b += bo.V
			}
		}
		p.GrowBoost = math.Min(GrowBoostCap, b)
	}
	return nil
}

// staffRun: one pass over the staff room (a matchday, or an answer from the Staff page).
type staffRun struct {
	w       *world
	st      *StaffState
	ctx     context.Context
	q       DBTX
	r       *rand.Rand
	rep     *DayReport // nil outside a matchday
	touched map[int]*Player
	clubs   map[int]*Club // other clubs whose budget changed
	matchXP int           // experience today's match brought
}

func (w *world) staffRun(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) *staffRun {
	return &staffRun{w: w, st: w.crew, ctx: ctx, q: q, r: r, rep: rep, touched: map[int]*Player{}, clubs: map[int]*Club{}}
}

func (sr *staffRun) touch(p *Player) { sr.touched[p.ID] = p }

// say: a line for the day report, the club log and the staff room's own log.
func (sr *staffRun) say(key, name string, amount int64) {
	ev := ComEvent{Key: key, Name: name, Amount: amount}
	if sr.rep != nil {
		sr.rep.Happenings = append(sr.rep.Happenings, ev)
	}
	sr.w.logHappening(ev)
	c := sr.w.career
	day := min(c.Day, len(Calendar))
	if sr.rep != nil {
		day = min(sr.rep.Day, len(Calendar))
	}
	sr.st.Log = append([]StaffLog{{Season: c.Season, Day: day, Key: key, Name: name, Amount: amount}}, sr.st.Log...)
	if len(sr.st.Log) > StaffLogSize {
		sr.st.Log = sr.st.Log[:StaffLogSize]
	}
}

func (sr *staffRun) moraleRaw(l *CoachLife, v float64) {
	if l != nil {
		l.Morale = clamp(l.Morale+v, 0, 100)
	}
}

func (sr *staffRun) moraleSwing(l *CoachLife, v float64) {
	if l != nil {
		l.Morale = clamp(l.Morale+traitSwing(l.Trait, v), 0, 100)
	}
}

// finish writes what the pass changed (the caller saves the user's club and the career).
func (sr *staffRun) finish() error {
	if len(sr.touched) > 0 {
		ps := make([]*Player, 0, len(sr.touched))
		for _, p := range sr.touched {
			ps = append(ps, p)
		}
		if err := savePlayers(sr.ctx, sr.q, ps); err != nil {
			return err
		}
	}
	for _, cl := range sr.clubs {
		if err := saveClub(sr.ctx, sr.q, cl); err != nil {
			return err
		}
	}
	return saveStaffState(sr.ctx, sr.q, sr.w.career.ID, sr.st)
}

func (w *world) staffTick(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport, uo *matchOutcome) error {
	c := w.career
	st := w.crew
	if st == nil || c.Ended != "" || rep == nil {
		return nil
	}
	sr := w.staffRun(ctx, q, r, rep)
	st.Tick++
	st.Started = true
	sr.reconcile()
	sr.pay()
	if uo != nil {
		sr.afterMatch(uo)
	}
	if err := sr.daily(); err != nil {
		return err
	}
	sr.trackPromises(uo)
	if err := sr.expire(); err != nil {
		return err
	}
	if rep.SeasonEnd != nil {
		if err := sr.seasonEnd(rep.SeasonEnd); err != nil {
			return err
		}
	} else if rep.Day <= len(Calendar) {
		if err := sr.caretakers(r); err != nil {
			return err
		}
		if err := sr.newDecisions(); err != nil {
			return err
		}
	}
	sr.weekly()
	return sr.finish()
}

// reconcile: newcomers get a life story, people who left are forgotten.
func (sr *staffRun) reconcile() {
	w, st := sr.w, sr.st
	c := w.career
	uid := c.UserClubID
	// a coach who walked out over a refused raise today (contracts.go) is gone already
	if sr.rep != nil {
		for _, n := range sr.rep.Refusals {
			if name, ok := strings.CutSuffix(n, ":left"); ok {
				for _, co := range w.coaches[uid] {
					if co.Name == name {
						sr.drop(co)
						break
					}
				}
			}
		}
	}
	here := map[int]*Coach{}
	for _, co := range w.coaches[uid] {
		here[co.ID] = co
		st.life(co, c.now(), c.Day <= len(Calendar))
	}
	for id := range st.People {
		if here[id] == nil {
			delete(st.People, id)
		}
	}
	squad := map[int]*Player{}
	for _, p := range w.userSquad() {
		squad[p.ID] = p
	}
	for pid, cid := range st.Mentees {
		p, co := squad[pid], here[cid]
		switch {
		case p == nil || co == nil || !staffCoaching(co.Role) || isLegend(p):
			delete(st.Mentees, pid)
		case p.Age > MentorMaxAge:
			delete(st.Mentees, pid)
			sr.say("staff_graduated", p.Name, 0)
		}
	}
	keepD := st.Decisions[:0]
	for _, d := range st.Decisions {
		if d.Kind != "famous" && (here[d.CoachID] == nil || (d.OtherID != 0 && here[d.OtherID] == nil)) {
			continue
		}
		if d.PlayerID != 0 && squad[d.PlayerID] == nil {
			continue
		}
		keepD = append(keepD, d)
	}
	st.Decisions = keepD
	keepP := st.Promises[:0]
	for _, pr := range st.Promises {
		if here[pr.CoachID] != nil && (pr.PlayerID == 0 || squad[pr.PlayerID] != nil) {
			keepP = append(keepP, pr)
		}
	}
	st.Promises = keepP
	keepB := st.Boosts[:0]
	for _, b := range st.Boosts {
		if b.Until > st.Tick && (b.PlayerID == 0 || squad[b.PlayerID] != nil) {
			keepB = append(keepB, b)
		}
	}
	st.Boosts = keepB
	for pid := range st.Form {
		if squad[pid] == nil {
			delete(st.Form, pid)
		}
	}
	for k, until := range st.Cool {
		if until <= st.Tick {
			delete(st.Cool, k)
		}
	}
}

// pay: a pay rise (a wage demand you accepted in the inbox) lifts his mood; a raise he asked for
// and did not get sours it.
func (sr *staffRun) pay() {
	w, st := sr.w, sr.st
	c := w.career
	asks := map[int]int64{}
	for _, d := range c.Contracts.Demands {
		if d.Kind == "coach" {
			asks[d.ID] = d.Ask
		}
	}
	for _, co := range w.coaches[c.UserClubID] {
		l := st.People[co.ID]
		if l == nil {
			continue
		}
		agreed := c.Contracts.Coaches[co.ID]
		if agreed == 0 {
			agreed = co.Wage
		}
		switch {
		case l.Wage == 0:
		case agreed > l.Wage:
			sr.moraleSwing(l, 10)
		case st.Asks[co.ID] > 0 && asks[co.ID] == 0:
			sr.moraleSwing(l, -12)
		}
		l.Wage = agreed
	}
	st.Asks = asks
}

// afterMatch: results move the staff's mood and experience; the assistant keeps the form book and
// the head coach has his say.
func (sr *staffRun) afterMatch(uo *matchOutcome) {
	w, st := sr.w, sr.st
	c := w.career
	f := uo.f
	if f == nil || f.HomeGoals == nil || f.AwayGoals == nil {
		return
	}
	gf, ga := *f.HomeGoals, *f.AwayGoals
	shots, poss := uo.res.ShotsHome, uo.res.PossHome
	opp := w.byID[f.AwayID]
	if uo.userSide == 1 {
		gf, ga = ga, gf
		shots, poss = uo.res.ShotsAway, 100-uo.res.PossHome
		opp = w.byID[f.HomeID]
	}
	win := f.WinnerID()
	won := gf > ga || (gf == ga && win == c.UserClubID)
	lost := gf < ga || (gf == ga && win != 0 && win != c.UserClubID)
	friendly := f.Comp == "friendly"
	if won {
		sr.matchXP = 1
	}
	if f.Comp == "cup" || f.Comp == "cl" {
		sr.matchXP++
	}
	if friendly {
		sr.matchXP /= 2
	} else {
		for _, co := range w.coaches[c.UserClubID] {
			l := st.People[co.ID]
			if l == nil {
				continue
			}
			up, down := 1.0, -1.0
			if co.Role == "head" {
				up, down = 2, -2.5
			}
			switch {
			case won:
				sr.moraleSwing(l, up)
			case lost:
				sr.moraleSwing(l, down)
			}
		}
	}
	v := &StaffVerdict{Season: c.Season, Day: sr.rep.Day, Comp: f.Comp, GF: gf, GA: ga, Key: verdictKey(gf, ga, won, lost, uo.ownOvr-uo.oppOvr, friendly),
		Tip: tipKey(gf, ga, shots, poss)}
	if opp != nil {
		v.Opp = opp.Name
	}
	if head := headCoachOf(w.coaches[c.UserClubID]); head != nil {
		v.Coach, v.CoachID = head.Name, head.ID
	}
	for _, p := range w.userSquad() {
		rt, ok := uo.ratings[p.ID]
		if !ok {
			continue
		}
		if rt > v.BestScore {
			v.Best, v.BestScore = p.Name, rt
		}
		if !friendly {
			fs := append(st.Form[p.ID], rt)
			if len(fs) > 5 {
				fs = fs[len(fs)-5:]
			}
			st.Form[p.ID] = fs
		}
	}
	st.Last = v
}

// verdictKey: the head coach's reading of a result. diff: our strength minus theirs.
func verdictKey(gf, ga int, won, lost bool, diff float64, friendly bool) string {
	switch {
	case friendly:
		return "friendly"
	case gf == ga && won:
		return "pens_win"
	case gf == ga && lost:
		return "pens_loss"
	case gf-ga >= 3:
		return "big_win"
	case gf > ga && diff < -1.5:
		return "upset_win"
	case gf > ga:
		return "win"
	case ga-gf >= 3:
		return "heavy_loss"
	case gf < ga && diff > 1.5:
		return "bad_loss"
	case gf < ga:
		return "loss"
	case diff < -1.5:
		return "good_draw"
	case diff > 1.5:
		return "poor_draw"
	}
	return "draw"
}

// tipKey: what to work on next.
func tipKey(gf, ga, shots, poss int) string {
	switch {
	case ga >= 2:
		return "defend"
	case shots < 8:
		return "shoot"
	case poss < 42:
		return "ball"
	case gf >= 3:
		return "keep"
	}
	return "fine"
}

// daily: morale drifts back to normal, experience builds up into skill, and a coach at the end of
// his tether may walk out.
func (sr *staffRun) daily() error {
	w, st := sr.w, sr.st
	c := w.career
	for _, co := range append([]*Coach{}, w.coaches[c.UserClubID]...) {
		l := st.People[co.ID]
		if l == nil {
			continue
		}
		l.Morale = clamp(l.Morale+(StaffMoraleRest-l.Morale)*StaffMoraleDrift, 0, 100)
		xp := 1 + sr.matchXP
		if l.Trait == "ambitious" {
			xp += xp / 2
		}
		if l.Age >= 62 {
			xp = max(1, xp/2)
		}
		if err := sr.gainXP(co, l, xp); err != nil {
			return err
		}
		if l.Morale <= StaffQuit && sr.rep != nil && sr.rep.Day <= len(Calendar) && sr.r.Float64() < 0.08 {
			name := co.Name
			if err := sr.leave(co, 0, false); err != nil {
				return err
			}
			sr.say("staff_quit_gone", name, 0)
		}
	}
	return nil
}

// gainXP: experience, and a skill point when the bar is full. His ceiling is a guide, not a wall: at or past
// it a point takes PastPeakCost times the experience (coachXPNeed) and his ceiling moves up with him. Only the
// top of the scale stops him.
func (sr *staffRun) gainXP(co *Coach, l *CoachLife, xp int) error {
	base := sr.st.baseSkill(co)
	if base >= MaxCoachSkill {
		l.XP = 0
		return nil
	}
	l.XP += xp
	if need := coachXPNeed(base, l.Ceil); l.XP >= need {
		l.XP -= need
		l.Ceil = max(l.Ceil, base+1)
		if base+1 >= MaxCoachSkill {
			l.XP = 0
		}
		return sr.levelUp(co, l, base+1)
	}
	return nil
}

// coachXPNeed: experience for his next skill point: xpNeed below his ceiling, PastPeakCost times it at or past it.
func coachXPNeed(skill, ceil int) int {
	if skill >= ceil {
		return xpNeed(skill) * PastPeakCost
	}
	return xpNeed(skill)
}

// courseState: whether he can go on an advanced course: "open" at his ceiling or one point below it (the course
// lifts it), "done" once he has been on one this season, "" when it would not help (his ceiling is the top of
// the scale already, or he still has room to grow on his own).
func courseState(base int, l *CoachLife, season int) string {
	switch {
	case max(l.Ceil, base) >= MaxCoachSkill || base < l.Ceil-1:
		return ""
	case l.Course == season:
		return "done"
	}
	return "open"
}

// courseGain: how far an advanced course lifts his ceiling (a younger coach takes in more).
func courseGain(age int) int {
	if age < CourseYoungAge {
		return 2
	}
	return 1
}

// courseCost: an advanced course, in weeks of his wage.
func courseCost(co *Coach) int64 { return roundK(float64(co.Wage) * CourseWeeks) }

// courseCeil: his ceiling after an advanced course.
func courseCeil(base int, l *CoachLife) int {
	return min(MaxCoachSkill, max(l.Ceil, base)+courseGain(l.Age))
}

func (sr *staffRun) levelUp(co *Coach, l *CoachLife, skill int) error {
	if _, err := sr.q.Exec(sr.ctx, `UPDATE coaches SET skill=$2 WHERE id=$1`, co.ID, skill); err != nil {
		return err
	}
	old := sr.st.baseSkill(co)
	sr.st.base[co.ID] = skill
	co.Skill += skill - old // what he works at follows
	l.LevelAt = sr.st.Tick
	sr.say("staff_levelup", co.Name, int64(skill))
	if old < 15 && skill >= 15 {
		co.Perks = perksFor(&Coach{ID: co.ID, Name: co.Name, Role: co.Role, Skill: skill})
		sr.say("staff_perk", co.Name, 0)
	}
	return nil
}

// trackPromises: a signing bought in time, a prospect given his games — or not.
func (sr *staffRun) trackPromises(uo *matchOutcome) {
	w, st := sr.w, sr.st
	uid := w.career.UserClubID
	compMatch := uo != nil && uo.f != nil && uo.f.Comp != "friendly"
	keep := st.Promises[:0]
	for _, pr := range st.Promises {
		l := st.People[pr.CoachID]
		if l == nil || coachByID(w.coaches[uid], pr.CoachID) == nil {
			continue
		}
		switch pr.Kind {
		case "signing":
			if sr.newSigning(pr) != nil {
				sr.moraleRaw(l, 10)
				sr.say("staff_promise_kept", pr.Coach, 0)
				continue
			}
			if st.Tick >= pr.Until {
				sr.moraleRaw(l, -10)
				sr.say("staff_promise_broken", pr.Coach, 0)
				continue
			}
		case "minutes":
			p := w.mine(pr.PlayerID)
			if p == nil {
				continue
			}
			if compMatch {
				pr.Left--
				if _, ok := uo.ratings[p.ID]; ok {
					pr.Got++
				}
			}
			switch {
			case pr.Got >= pr.Need:
				p.Morale = clamp(p.Morale+8, 20, 100)
				sr.touch(p)
				st.Boosts = append(st.Boosts, StaffBoost{Key: "minutes", PlayerID: p.ID, V: 0.15, Until: st.Tick + 8})
				sr.moraleRaw(l, 6)
				sr.say("staff_minutes_kept", p.Name, 0)
				continue
			case pr.Got+pr.Left < pr.Need || st.Tick >= pr.Until:
				p.Morale = clamp(p.Morale-8, 20, 100)
				sr.touch(p)
				sr.moraleRaw(l, -6)
				sr.say("staff_minutes_broken", p.Name, 0)
				continue
			}
		}
		keep = append(keep, pr)
	}
	st.Promises = keep
}

// newSigning: a player who has joined since the promise, in the position, good enough.
func (sr *staffRun) newSigning(pr StaffPromise) *Player {
	was := map[int]bool{}
	for _, id := range pr.Squad {
		was[id] = true
	}
	for _, p := range sr.w.userSquad() {
		if !was[p.ID] && p.Position == pr.Pos && p.Overall >= pr.MinOvr {
			return p
		}
	}
	return nil
}

// expire: an unanswered card settles itself with its default.
func (sr *staffRun) expire() error {
	st := sr.st
	var due []StaffDecision
	keep := st.Decisions[:0]
	for _, d := range st.Decisions {
		if st.Tick >= d.Until {
			due = append(due, d)
		} else {
			keep = append(keep, d)
		}
	}
	st.Decisions = keep
	return sr.settle(due)
}

func (sr *staffRun) settle(due []StaffDecision) error {
	for i := range due {
		if _, err := sr.resolve(&due[i], due[i].Default, true); err != nil {
			if _, ok := IsUserErr(err); ok {
				continue // (a default never costs money; anything odd is simply dropped)
			}
			return err
		}
	}
	return nil
}

// seasonEnd: the season review. Results lift or sour the staff, experience is handed out, everyone
// is a year older, contracts tick down, and the retiring say goodbye.
func (sr *staffRun) seasonEnd(se *SeasonEnd) error {
	w, st := sr.w, sr.st
	c := w.career
	user := w.byID[c.UserClubID]
	due := append([]StaffDecision{}, st.Decisions...)
	st.Decisions = st.Decisions[:0]
	if err := sr.settle(due); err != nil {
		return err
	}
	grade := seasonGrade(se, w.expectedRank(user.ID))
	xp := map[string]int{"great": 15, "good": 8, "ok": 3}[grade]
	mood := map[string]float64{"great": 10, "good": 4, "bad": -8}[grade]
	switch grade {
	case "great":
		sr.say("staff_season_great", "", 0)
	case "bad":
		sr.say("staff_season_loss", "", 0)
	}
	for _, co := range append([]*Coach{}, w.coaches[user.ID]...) {
		l := st.People[co.ID]
		if l == nil {
			continue
		}
		l.Seasons++
		sr.moraleSwing(l, mood)
		if err := sr.gainXP(co, l, xp); err != nil {
			return err
		}
		l.Age++
		name, seasons := co.Name, l.Seasons
		if l.Retiring {
			if err := sr.leave(co, 0, true); err != nil {
				return err
			}
			sr.say("staff_retired", name, int64(seasons))
			continue
		}
		l.Years--
		if l.Years <= 0 {
			if err := sr.leave(co, 0, false); err != nil {
				return err
			}
			sr.say("staff_contract_gone", name, 0)
		}
	}
	return nil
}

// seasonGrade: how the staff rate the season (expected: where the club should have finished).
func seasonGrade(se *SeasonEnd, expected int) string {
	switch {
	case se.Position == 1 || se.Cup == "W" || se.CL == "W" || se.Move == "up":
		return "great"
	case se.Move == "down" || se.Position > expected+5:
		return "bad"
	case se.Position <= expected:
		return "good"
	}
	return "ok"
}

// weekly: the snapshot the assistant measures improvement against.
func (sr *staffRun) weekly() {
	st := sr.st
	if st.WeekTick != 0 && st.Tick-st.WeekTick < 7 {
		return
	}
	st.WeekOvr = map[int]int{}
	for _, p := range sr.w.userSquad() {
		st.WeekOvr[p.ID] = p.Overall
	}
	st.WeekTick = st.Tick
	if sr.rep != nil {
		st.WeekDay = min(sr.rep.Day, len(Calendar))
	}
}

// ---------------------------------------------------------------- people come and go

// drop: forget a coach who is already gone (the database row was changed elsewhere).
func (sr *staffRun) drop(co *Coach) {
	w := sr.w
	uid := w.career.UserClubID
	if b, ok := sr.st.base[co.ID]; ok {
		co.Skill = b
	}
	kept := w.coaches[uid][:0]
	for _, x := range w.coaches[uid] {
		if x.ID != co.ID {
			kept = append(kept, x)
		}
	}
	w.coaches[uid] = kept
	sr.forget(co.ID)
	delete(w.career.Contracts.Coaches, co.ID)
}

// leave: a coach leaves the user's club — for another club (to > 0), into the pool of free coaches
// (to = 0), or out of the game (retire).
func (sr *staffRun) leave(co *Coach, to int, retire bool) error {
	w := sr.w
	uid := w.career.UserClubID
	ctx, q := sr.ctx, sr.q
	switch {
	case retire:
		if _, err := q.Exec(ctx, `DELETE FROM coaches WHERE id=$1 AND club_id=$2`, co.ID, uid); err != nil {
			return err
		}
	case to > 0:
		// the other club's man in that role makes way
		if _, err := q.Exec(ctx, `UPDATE coaches SET club_id=NULL WHERE club_id=$1 AND role=$2`, to, co.Role); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `UPDATE coaches SET club_id=$1 WHERE id=$2`, to, co.ID); err != nil {
			return err
		}
		kept := w.coaches[to][:0]
		for _, x := range w.coaches[to] {
			if x.Role != co.Role {
				kept = append(kept, x)
			}
		}
		w.coaches[to] = append(kept, co)
	default:
		if _, err := q.Exec(ctx, `UPDATE coaches SET club_id=NULL WHERE id=$1 AND club_id=$2`, co.ID, uid); err != nil {
			return err
		}
	}
	sr.drop(co)
	if to > 0 {
		dest := to
		co.ClubID = &dest
	} else {
		co.ClubID = nil
	}
	return nil
}

// forget: everything the staff room knew about a coach who has gone.
func (sr *staffRun) forget(coachID int) {
	st := sr.st
	delete(st.People, coachID)
	delete(st.Asks, coachID)
	for pid, cid := range st.Mentees {
		if cid == coachID {
			delete(st.Mentees, pid)
		}
	}
	keepD := st.Decisions[:0]
	for _, d := range st.Decisions {
		if d.Kind == "famous" {
			if d.OtherID == coachID {
				d.OtherID, d.Other = 0, "" // the post he would take is simply vacant now
			}
			if d.CoachID != coachID {
				keepD = append(keepD, d)
			}
			continue
		}
		if d.CoachID != coachID && d.OtherID != coachID {
			keepD = append(keepD, d)
		}
	}
	st.Decisions = keepD
	keepP := st.Promises[:0]
	for _, pr := range st.Promises {
		if pr.CoachID != coachID {
			keepP = append(keepP, pr)
		}
	}
	st.Promises = keepP
}

// hire: sign a coach from the pool on a contract of n seasons (after this one, when the season is
// running). The man he replaces goes back into the pool, as on the market page.
func (sr *staffRun) hire(co *Coach, years int) error {
	w, st := sr.w, sr.st
	c := w.career
	user := w.byID[c.UserClubID]
	if co.ClubID != nil {
		return userErr("coach_taken", "This coach already has a job")
	}
	if user.Budget < co.Price {
		return userErr("no_budget", "Not enough budget")
	}
	for _, old := range append([]*Coach{}, w.coaches[user.ID]...) {
		if old.Role == co.Role {
			if err := sr.leave(old, 0, false); err != nil {
				return err
			}
		}
	}
	if _, err := sr.q.Exec(sr.ctx, `UPDATE coaches SET club_id=$1 WHERE id=$2 AND club_id IS NULL`, user.ID, co.ID); err != nil {
		return err
	}
	user.Budget -= co.Price
	if err := addFinance(sr.ctx, sr.q, c, "staff_hire", -co.Price, co.Name); err != nil {
		return err
	}
	uid := user.ID
	co.ClubID = &uid
	w.coaches[uid] = append(w.coaches[uid], co)
	years = max(1, min(StaffMaxYears-1, years))
	if c.Day <= len(Calendar) {
		years++ // the rest of this season comes on top
	}
	st.base[co.ID] = co.Skill
	l := newCoachLife(co, co.Skill, c.now(), st.Tick, years, StaffMoraleNew)
	l.Wage = co.Wage
	st.People[co.ID] = l
	if c.Contracts.Coaches == nil {
		c.Contracts.Coaches = map[int]int64{}
	}
	c.Contracts.Coaches[co.ID] = co.Wage
	return nil
}

// caretakers: a role left empty for CaretakerAfter matchdays of the season gets a stand-in from the
// board: a modest coach (skill 4–6) on a contract to the end of the season, no fee. He can be
// replaced at any time, or kept with a new contract. (Careless managers are not left without staff.)
func (sr *staffRun) caretakers(r *rand.Rand) error {
	w, st := sr.w, sr.st
	c := w.career
	uid := c.UserClubID
	have := map[string]bool{}
	for _, co := range w.coaches[uid] {
		have[co.Role] = true
	}
	for _, role := range CoachRoles {
		if have[role] {
			delete(st.Vacant, role)
			continue
		}
		since, ok := st.Vacant[role]
		if !ok {
			st.Vacant[role] = st.Tick
			continue
		}
		if st.Tick-since < CaretakerAfter {
			continue
		}
		co := GenCoach(r, nationsOf(w.byID[uid].League), role, 4+r.Intn(3))
		co.ClubID = &uid
		if err := insertCoach(sr.ctx, sr.q, c.ID, co); err != nil {
			return err
		}
		if role == "head" {
			co.Style = styleFor(co)
		}
		w.coaches[uid] = append(w.coaches[uid], co)
		st.base[co.ID] = co.Skill
		l := newCoachLife(co, co.Skill, c.now(), st.Tick, 1, StaffMoraleStart)
		l.Wage = co.Wage
		st.People[co.ID] = l
		if c.Contracts.Coaches == nil {
			c.Contracts.Coaches = map[int]int64{}
		}
		c.Contracts.Coaches[co.ID] = co.Wage
		delete(st.Vacant, role)
		sr.say("staff_caretaker", co.Name, 0)
	}
	return nil
}

// contractEnds: the last season of a contract (Years counts the running season too).
func contractEnds(c *Career, years int) int {
	if c.Day > len(Calendar) {
		return c.Season + years // the off-season: the next season is the first of what is left
	}
	return c.Season + years - 1
}
