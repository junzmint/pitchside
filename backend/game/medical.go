package game

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"sort"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- medical department (medical work stream)
//
// Every injury has a kind (injury_kinds.go). The medical file (table medical, one JSONB per career)
// keeps, for every player in the four leagues, his active injury, body wear, match sharpness and
// fragile spell after an injury; for the user's club also the case history, the decisions waiting
// for the manager (medical_cards.go), the weekly reports and the season's numbers.
//
// Hooks (match.go): loadMedical in loadWorld (fills Player.Rust and Player.InjKind), matchInjury,
// trainingKnock and healDay (injury.go) during the matchday, medicalTick at the end of advance.
// ageAndRetire carries long injuries over the summer (summerInjury).
//
// The computer's clubs get the same injuries, treatment and lasting effects, with the usual
// treatment chosen for them; only the user's club gets decisions, wrong diagnoses and warnings.

// MedState: the medical file of one career.
type MedState struct {
	Season  int             `json:"season"` // the season the file was last brought up to date for
	Tick    int             `json:"tick"`   // matchdays the department has seen (decisions count down in these)
	NextID  int             `json:"nextId"`
	P       map[int]*MedRec `json:"p"`                 // every player in the four leagues with something on his file
	Cases   []*MedCase      `json:"cases,omitempty"`   // the user's club, newest first
	Cards   []*MedCard      `json:"cards,omitempty"`   // decisions waiting for the manager
	Reports []*MedReport    `json:"reports,omitempty"` // the weekly medical report, newest first
	Stats   MedSeason       `json:"stats"`
	Prev    *MedSeason      `json:"prev,omitempty"`
	News    []MedNews       `json:"news,omitempty"` // serious injuries around the leagues this season, newest first

	loaded  bool
	fresh   map[int]freshInj // injuries suffered today (matchInjury, trainingKnock), settled in medicalTick
	notes   []medNote        // what happened to players during the day (healDay)
	lines   []MedLine        // this matchday's report
	touched map[int]*Player  // players whose attributes or lay-off the department changed (saved again)
	created int              // decisions opened this matchday
}

// MedRec: one player's medical file.
type MedRec struct {
	Kind   string  `json:"k,omitempty"`  // active injury (the true kind), or rest | ease | rehab | flu
	Diag   string  `json:"d,omitempty"`  // the club doctor's diagnosis when it is wrong (the user's club)
	Hide   int     `json:"h,omitempty"`  // weeks hidden behind that wrong diagnosis
	Total  int     `json:"t,omitempty"`  // weeks out in all (for the progress bar)
	Treat  string  `json:"tr,omitempty"` // rest | surgery | injection | specialist ("" = not chosen)
	Dmg    float64 `json:"dm,omitempty"` // lasting-damage multiplier of the active injury (treatment, setbacks)
	Since  int     `json:"s,omitempty"`  // season*100+matchday the injury began
	Src    string  `json:"src,omitempty"`
	Case   int     `json:"c,omitempty"` // the user's case
	Wear   float64 `json:"w,omitempty"` // body wear: every injury adds some, the body sheds it slowly
	WearLv int     `json:"wl,omitempty"`
	Alert  bool    `json:"al,omitempty"` // the wear warning has been given
	Rust   float64 `json:"r,omitempty"`  // match sharpness lost after a lay-off
	Frag   int     `json:"f,omitempty"`  // matchdays of raised re-injury risk left
	FragK  string  `json:"fk,omitempty"`
	Knock  int     `json:"kn,omitempty"` // playing through a hidden knock: matches left
	Seen   bool    `json:"ks,omitempty"` // ...and the doctor knows about it
	Conc   int     `json:"cc,omitempty"` // concussions
	N      int     `json:"n,omitempty"`  // injuries on his file
	Last   string  `json:"lk,omitempty"` // his last serious injury...
	LastS  int     `json:"ls,omitempty"` // ...and its season
	Warned int     `json:"wt,omitempty"` // tick of the doctor's last warning about him
}

// MedCase: one injury at the user's club, from diagnosis to return.
type MedCase struct {
	ID       int        `json:"id"`
	PlayerID int        `json:"playerId"`
	Name     string     `json:"name"`
	Kind     string     `json:"kind"`           // what the club knows
	Diag     string     `json:"diag,omitempty"` // the first, wrong diagnosis
	Source   string     `json:"source"`         // match | training | intl | other
	Season   int        `json:"season"`
	Day      int        `json:"day"`
	Weeks    int        `json:"weeks"`
	Treat    string     `json:"treat,omitempty"`
	Setbacks int        `json:"setbacks,omitempty"`
	Done     bool       `json:"done"`
	Back     int        `json:"back,omitempty"` // matchday he was fit again
	Loss     []LossNote `json:"loss,omitempty"`
	Cost     int64      `json:"cost,omitempty"`
	Notes    []string   `json:"notes,omitempty"` // complication | misdiag | scan | hid_knock | rushed | recurrence | aggravated | eased
}

// LossNote: points lost for good (attr "potential" is his ceiling).
type LossNote struct {
	Attr string `json:"attr"`
	N    int    `json:"n"`
}

// MedLine: one line of the weekly report.
type MedLine struct {
	Key      string     `json:"key"` // new | back | setback | misdiag | lasting | worn | prone | treat | auto | complication | scan_ok | scan_found | knock | flu | flu_spread | rest | ease | rehab | inject
	PlayerID int        `json:"playerId,omitempty"`
	Name     string     `json:"name,omitempty"`
	Kind     string     `json:"kind,omitempty"`
	Was      string     `json:"was,omitempty"` // misdiag: the first diagnosis
	Treat    string     `json:"treat,omitempty"`
	N        int        `json:"n,omitempty"`
	Loss     []LossNote `json:"loss,omitempty"`
	Cost     int64      `json:"cost,omitempty"`
}

type MedReport struct {
	Tick   int       `json:"tick"`
	Season int       `json:"season"`
	Day    int       `json:"day"` // the matchday just played
	Out    int       `json:"out"` // players out after it
	Lines  []MedLine `json:"lines"`
}

// MedSeason: this season's numbers (the user's club, and every club for comparison).
type MedSeason struct {
	Season     int    `json:"season"`
	Injuries   int    `json:"injuries"` // the user's club
	Serious    int    `json:"serious"`
	Weeks      int    `json:"weeks"` // player-matchdays missed
	Lasting    int    `json:"lasting"`
	Spent      int64  `json:"spent"`
	Saved      int    `json:"saved"`  // rested on the doctor's advice
	DivInj     int    `json:"divInj"` // the other clubs of the user's division
	DivClubs   int    `json:"divClubs"`
	AllInj     int    `json:"allInj"` // every club in the four leagues
	Clubs      int    `json:"clubs"`
	Tiers      [5]int `json:"tiers"`
	AllLasting int    `json:"allLasting"`
	AllWorn    int    `json:"allWorn"`
	Setbacks   int    `json:"setbacks"`
}

// MedNews: a serious injury elsewhere.
type MedNews struct {
	Season   int    `json:"season"`
	Day      int    `json:"day"`
	PlayerID int    `json:"playerId"`
	Name     string `json:"name"`
	ClubID   int    `json:"clubId"`
	Club     string `json:"club"`
	Kind     string `json:"kind"`
	Weeks    int    `json:"weeks"`
	Overall  int    `json:"overall"`
	Mine     bool   `json:"mine"` // the user's division
}

type medNote struct {
	club int
	line MedLine
}

type freshInj struct {
	Kind   string
	Club   int
	Source string // match | training | intl | other
	Rushed bool
	Knock  bool // he was hiding a knock
}

func newMedState() *MedState {
	md := &MedState{P: map[int]*MedRec{}}
	md.init()
	return md
}

func (md *MedState) init() {
	if md.P == nil {
		md.P = map[int]*MedRec{}
	}
	md.fresh = map[int]freshInj{}
	md.touched = map[int]*Player{}
}

func (md *MedState) rec(id int) *MedRec {
	r := md.P[id]
	if r == nil {
		r = &MedRec{}
		md.P[id] = r
	}
	return r
}

func (md *MedState) nextID() int {
	md.NextID++
	return md.NextID
}

func (md *MedState) caseByID(id int) *MedCase {
	if id == 0 {
		return nil
	}
	for _, c := range md.Cases {
		if c.ID == id {
			return c
		}
	}
	return nil
}

// note: something that happened to a player during the day (only the user's club makes the report).
func (md *MedState) note(clubID int, l MedLine) {
	md.notes = append(md.notes, medNote{club: clubID, line: l})
}

// shown: what the club believes the injury is.
func (rec *MedRec) shown() string {
	if rec.Diag != "" {
		return rec.Diag
	}
	return rec.Kind
}

func isRealInjury(kind string) bool {
	if kind == "" {
		return false
	}
	k, ok := injuryByKey[kind]
	return ok && k.Tier > 0
}

func (rec *MedRec) empty() bool {
	return rec.Kind == "" && rec.Wear < 0.05 && rec.WearLv == 0 && rec.Rust <= 0 && rec.Frag == 0 && rec.Knock == 0 && rec.Conc == 0 && rec.Last == ""
}

// fitWeek: a week of training for a fit player: sharpness comes back, the fragile spell runs down,
// the body sheds wear.
func (rec *MedRec) fitWeek(fitCoach int) {
	if rec.Rust > 0 {
		rec.Rust = math.Max(0, rec.Rust-(RustTrain+0.0004*float64(min(20, fitCoach))))
	}
	if rec.Frag > 0 {
		rec.Frag--
		if rec.Frag == 0 {
			rec.FragK = ""
		}
	}
	rec.shedWear()
}

func (rec *MedRec) shedWear() {
	if rec.Wear > 0 {
		rec.Wear = math.Max(0, rec.Wear-WearHeal)
	}
	for rec.WearLv > 0 && rec.Wear < wearLevels[rec.WearLv-1]-2 {
		rec.WearLv--
	}
	if rec.Alert && rec.Wear < 5 {
		rec.Alert = false
	}
}

// ---------------------------------------------------------------- storage

func loadMedState(ctx context.Context, q DBTX, careerID int) (*MedState, error) {
	md := &MedState{}
	var raw []byte
	err := q.QueryRow(ctx, `SELECT data FROM medical WHERE career_id=$1`, careerID).Scan(&raw)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if len(raw) > 0 {
		if json.Unmarshal(raw, md) != nil {
			md = &MedState{}
		}
	}
	md.init()
	md.loaded = true
	return md, nil
}

func saveMedState(ctx context.Context, q DBTX, careerID int, md *MedState) error {
	r3 := func(v float64) float64 { return math.Round(v*1000) / 1000 }
	for _, rec := range md.P { // (keeps the stored file small: no 3.9399999999999995)
		rec.Wear, rec.Rust, rec.Dmg = r3(rec.Wear), r3(rec.Rust), r3(rec.Dmg)
	}
	_, err := q.Exec(ctx, `INSERT INTO medical (career_id, data, updated_at) VALUES ($1, $2, now())
		ON CONFLICT (career_id) DO UPDATE SET data=$2, updated_at=now()`, careerID, md)
	return err
}

// medState: the medical file of this request (loadWorld loads it; a bare world gets an empty one
// that is never saved).
func (w *world) medState() *MedState {
	if w.med == nil {
		w.med = newMedState()
	}
	return w.med
}

// rollover: a new season. The summer break heals: wear eases, sharpness half comes back, fragile
// spells and hidden knocks are over; last season's numbers are kept for comparison.
func (md *MedState) rollover(season int) {
	if md.Season == season {
		return
	}
	if md.Season != 0 {
		prev := md.Stats
		md.Prev = &prev
		for _, rec := range md.P {
			rec.Wear *= SummerWear
			if rec.Rust *= 0.5; rec.Rust < 0.01 {
				rec.Rust = 0
			}
			rec.Frag, rec.FragK, rec.Knock, rec.Seen = 0, "", 0, false
			if rec.Last != "" && rec.LastS < season-3 {
				rec.Last, rec.LastS = "", 0
			}
			rec.shedWear()
		}
		md.News = nil
		keep := []*MedCard{}
		for _, cd := range md.Cards {
			if cd.Kind == "treat" {
				keep = append(keep, cd)
			}
		}
		md.Cards = keep
	}
	md.Stats = MedSeason{Season: season}
	md.Season = season
}

// loadMedical (loadWorld): the medical file, and on every player his match sharpness and the
// kind of his injury (what the club's doctor believes, for the user's players).
func (w *world) loadMedical(ctx context.Context, q DBTX) error {
	md, err := loadMedState(ctx, q, w.career.ID)
	if err != nil {
		return err
	}
	w.med = md
	md.rollover(w.career.Season)
	user := w.career.UserClubID
	for cid, ps := range w.players {
		for _, p := range ps {
			rec := md.P[p.ID]
			if rec == nil {
				continue
			}
			p.Rust = rec.Rust
			if p.Injury > 0 && rec.Kind != "" {
				p.InjKind = rec.Kind
				if cid == user {
					p.InjKind = rec.shown()
				}
			}
		}
	}
	return nil
}

// ---------------------------------------------------------------- staff

// doctorSkill: the club doctor's skill. The computer's clubs without one lean on their physio.
func (w *world) doctorSkill(clubID int) int {
	if s := coachSkill(w.coaches[clubID], "doctor"); s > 0 {
		return s
	}
	if clubID != w.career.UserClubID {
		return coachSkill(w.coaches[clubID], "physio")
	}
	return 0
}

// misdiagChance: how often the club's doctor takes a serious injury for a lighter one. A scanner
// (medical centre level 3) catches most mistakes, the level-5 imaging suite nearly all.
func misdiagChance(doc, lvl int, ps Perks) float64 {
	if ps["diagnostician"] {
		return 0
	}
	m := 0.32 * (1 - 0.85*float64(min(20, doc))/20)
	switch {
	case lvl >= 5:
		m *= 0.15
	case lvl >= 3:
		m *= 0.35
	}
	return m
}

// spotChance: does the doctor notice a player hiding a knock?
func spotChance(doc, lvl int, ps Perks) float64 {
	if ps["diagnostician"] {
		return 1
	}
	s := 0.25 + 0.035*float64(min(20, doc))
	if lvl >= 3 {
		s += 0.2
	}
	return math.Min(0.95, s)
}

// ---------------------------------------------------------------- the matchday

// medicalTick (end of advance): today's injuries get their diagnosis, treatment and case; players
// who are fit again come back (rusty, fragile for a while, maybe never quite the same); the
// manager's decisions run down; the doctor reports.
func (w *world) medicalTick(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport, uo *matchOutcome, injuredToday map[int]bool) error {
	md := w.med
	if md == nil || !md.loaded {
		return nil
	}
	c := w.career
	md.Tick++
	md.lines = nil
	md.created = 0
	user := w.byID[c.UserClubID]
	all := w.compPlayers()
	ids := make([]int, 0, len(all))
	for id := range all {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	clubs, div := 0, 0
	for _, cl := range w.clubs {
		if cl.Division > 0 && isCompLeague(cl.League) {
			clubs++
			if user != nil && cl.League == user.League && cl.Division == user.Division {
				div++
			}
		}
	}
	md.Stats.Clubs, md.Stats.DivClubs = clubs, max(0, div-1)

	// 1. what happened to the user's players during the day (setbacks, a wrong diagnosis found out)
	for _, mn := range md.notes {
		if mn.club != c.UserClubID {
			continue
		}
		n := mn.line
		md.lines = append(md.lines, n)
		if cs := w.caseOf(n.PlayerID); cs != nil {
			switch n.Key {
			case "setback":
				cs.Setbacks++
			case "misdiag":
				cs.Diag, cs.Kind = n.Was, n.Kind
				cs.Notes = append(cs.Notes, "misdiag")
				if rec := md.P[n.PlayerID]; rec != nil {
					cs.Weeks = rec.Total
				}
			}
		}
		switch n.Key {
		case "setback":
			w.happen(rep, "med_injury_setback", n.Name, int64(n.N))
		case "misdiag":
			w.happen(rep, "med_injury_misdiag", n.Name, int64(n.N))
			if p := all[n.PlayerID]; p != nil {
				w.noteInjury(rep, p, n.Kind, true)
				if k := injuryKind(n.Kind); k.Tier >= 3 {
					if rec := md.P[p.ID]; rec != nil && rec.Treat == "" {
						w.addCard(w.treatCard(p, rec, k))
					}
				}
			}
		}
	}
	md.notes = nil

	// 2. today's injuries
	fresh := make([]int, 0, len(md.fresh))
	for id := range md.fresh {
		fresh = append(fresh, id)
	}
	sort.Ints(fresh)
	for _, id := range fresh {
		p := all[id]
		if p == nil || p.Injury <= 0 { // shrugged off (a pre-season camp)
			continue
		}
		w.openInjury(r, p, md.fresh[id], rep)
	}
	md.fresh = map[int]freshInj{}

	// 3. injuries from elsewhere (international duty…), and players who are fit again
	for _, id := range ids {
		p := all[id]
		rec := md.P[id]
		switch {
		case p.Injury > 0 && (rec == nil || rec.Kind == ""):
			src := "other"
			if rep != nil {
				for _, h := range rep.Happenings {
					if h.Key == "intl_injury" && h.Name == p.Name {
						src = "intl"
					}
				}
			}
			w.openInjury(r, p, freshInj{Kind: w.lightKind(r, p), Club: *p.ClubID, Source: src}, rep)
		case p.Injury <= 0 && rec != nil && rec.Kind != "":
			w.closeInjury(r, p, rec, rep)
		}
	}
	// the files of players who left the four leagues (or have nothing left on them) are closed,
	// and so are the club's open cases of players who have left it
	for id, rec := range md.P {
		if all[id] == nil || rec.empty() {
			delete(md.P, id)
		}
	}
	mine := map[int]bool{}
	for _, p := range w.userSquad() {
		mine[p.ID] = true
	}
	for _, cs := range md.Cases {
		if !cs.Done && !mine[cs.PlayerID] {
			cs.Done = true
		}
	}

	// 4. the manager's decisions
	if user != nil && c.Ended == "" {
		if err := w.settleCards(ctx, q, r, rep); err != nil {
			return err
		}
		w.newCards(r, rep, uo)
		if md.created > 0 {
			w.happen(rep, "med_wait_cards", "", int64(len(md.Cards)))
		}
	}

	// 5. the weekly report
	out := 0
	for _, p := range w.userSquad() {
		if p.Injury > 0 {
			out++
		}
	}
	if rep != nil && rep.Day <= len(Calendar) {
		md.Stats.Weeks += out
	}
	day := c.Day
	if rep != nil {
		day = rep.Day
	}
	lines := md.lines
	if lines == nil {
		lines = []MedLine{}
	}
	md.Reports = append([]*MedReport{{Tick: md.Tick, Season: c.Season, Day: day, Out: out, Lines: lines}}, md.Reports...)
	if len(md.Reports) > 8 {
		md.Reports = md.Reports[:8]
	}
	md.lines = nil

	// 6. write back: the players the department changed (attributes, lay-offs) and the file
	if len(md.touched) > 0 {
		ps := make([]*Player, 0, len(md.touched))
		for _, p := range md.touched {
			p.Fill()
			ps = append(ps, p)
		}
		if err := savePlayers(ctx, q, ps); err != nil {
			return err
		}
		md.touched = map[int]*Player{}
	}
	return saveMedState(ctx, q, c.ID, md) // (the club, with any medical bills, is saved at the end of advance)
}

// compPlayers: every player at a club in the four leagues, by id.
func (w *world) compPlayers() map[int]*Player {
	all := map[int]*Player{}
	for cid, ps := range w.players {
		cl := w.byID[cid]
		if cl == nil || cl.Division == 0 || !isCompLeague(cl.League) {
			continue
		}
		for _, p := range ps {
			if p.ClubID != nil && *p.ClubID == cid {
				all[p.ID] = p
			}
		}
	}
	return all
}

func (w *world) caseOf(playerID int) *MedCase {
	if rec := w.med.P[playerID]; rec != nil {
		return w.med.caseByID(rec.Case)
	}
	return nil
}

// lightKind: the kind given to an injury that came from elsewhere (international duty).
func (w *world) lightKind(r *rand.Rand, p *Player) string {
	for range 6 {
		if k := pickKind(r, p, nil, false); k.Tier <= 2 && k.Max <= max(2, p.Injury+1) {
			return k.Key
		}
	}
	return "knock"
}

// medDay: the matchday being reported.
func (w *world) medDay(rep *DayReport) int {
	if rep != nil {
		return rep.Day
	}
	return min(w.career.Day, len(Calendar)+1)
}

// openInjury: a new injury goes on the player's file.
func (w *world) openInjury(r *rand.Rand, p *Player, fi freshInj, rep *DayReport) {
	md := w.med
	c := w.career
	if p.ClubID == nil {
		return
	}
	club := w.byID[*p.ClubID]
	if club == nil {
		return
	}
	user := w.byID[c.UserClubID]
	isUser := club.ID == c.UserClubID
	k := injuryKind(fi.Kind)
	rec := md.rec(p.ID)
	if rec.Kind != "" && isUser { // broke down while still recovering (rushed back): that case ends here
		if cs := md.caseByID(rec.Case); cs != nil && !cs.Done {
			cs.Done = true
			cs.Notes = append(cs.Notes, "aggravated")
		}
	}
	recurrence := rec.Frag > 0 && rec.FragK == k.Key
	rec.Kind, rec.Diag, rec.Hide, rec.Treat, rec.Src = k.Key, "", 0, "", fi.Source
	rec.Total, rec.Since, rec.Dmg, rec.Case = p.Injury, c.Season*100+w.medDay(rep), 1, 0
	if fi.Rushed {
		rec.Dmg *= 1.3
	}
	if fi.Knock {
		rec.Dmg *= 1.2
	}
	if recurrence {
		rec.Dmg *= 1.3
	}
	rec.Frag, rec.FragK, rec.Knock, rec.Seen = 0, "", 0, false
	if k.Tier == 0 {
		return
	}
	rec.N++
	if k.Key == "concussion" {
		rec.Conc++
	}
	if k.Tier >= 3 {
		rec.Last, rec.LastS = k.Key, c.Season
	}
	st := &md.Stats
	st.AllInj++
	st.Tiers[k.Tier]++
	if !isUser && user != nil && club.League == user.League && club.Division == user.Division {
		st.DivInj++
	}
	wear := k.Wear
	if recurrence {
		wear *= 1.5
	}
	w.addWear(r, p, rec, wear, rep)
	if isUser {
		w.userInjury(r, p, rec, k, fi, recurrence, rep)
		return
	}
	// the computer's clubs: the treatment their doctors usually choose
	if k.Tier >= 3 {
		if t := aiTreatment(club, k); t != "rest" {
			w.applyTreatment(r, p, rec, t, club.ID)
		} else {
			rec.Treat = "rest"
		}
	}
	mine := user != nil && club.League == user.League && club.Division == user.Division
	if k.Tier >= 4 || (k.Tier >= 3 && mine && p.Overall >= 70 && p.Injury >= 5) {
		md.News = append([]MedNews{{Season: c.Season, Day: w.medDay(rep), PlayerID: p.ID, Name: p.Name, ClubID: club.ID, Club: club.Name,
			Kind: k.Key, Weeks: p.Injury, Overall: p.Overall, Mine: mine}}, md.News...)
		if len(md.News) > 24 {
			md.News = md.News[:24]
		}
		if k.Tier >= 4 && mine {
			w.happen(rep, "med_injury_rival_"+k.Key, p.Name+" ("+club.Name+")", 0)
		}
	}
}

// aiTreatment: what a computer club's doctors do with a serious injury.
func aiTreatment(cl *Club, k *InjuryKind) string {
	switch {
	case k.Tier >= 4 && cl.Reputation >= 85:
		return "specialist"
	case k.Tier >= 4:
		return "surgery"
	case k.Tier >= 3 && cl.Reputation >= 70:
		return "surgery"
	}
	return "rest"
}

// userInjury: one of the user's players: the doctor's diagnosis, the case, the day report, and a
// decision for a serious injury (or a doubtful diagnosis).
func (w *world) userInjury(r *rand.Rand, p *Player, rec *MedRec, k *InjuryKind, fi freshInj, recurrence bool, rep *DayReport) {
	md := w.med
	c := w.career
	user := w.byID[c.UserClubID]
	ps := w.perks(user.ID)
	doc := w.doctorSkill(user.ID)
	physio := coachSkill(w.coaches[user.ID], "physio")
	uncertain := false
	if k.Mis != "" && fi.Source != "intl" {
		if r.Float64() < misdiagChance(doc, user.Medical, ps) {
			mk := injuryKind(k.Mis)
			if dw := rollWeeks(r, mk, physio, user.Medical); dw < p.Injury {
				rec.Diag, rec.Hide = mk.Key, p.Injury-dw
				p.Injury, rec.Total = dw, dw
				md.touched[p.ID] = p
			}
		}
		sure := 0.45 + 0.03*float64(min(20, doc))
		if user.Medical >= 3 {
			sure += 0.25
		}
		if rec.Diag != "" {
			sure -= 0.35
		}
		uncertain = !ps["diagnostician"] && r.Float64() > sure
	}
	shown := rec.shown()
	cs := &MedCase{ID: md.nextID(), PlayerID: p.ID, Name: p.Name, Kind: shown, Source: fi.Source, Season: c.Season, Day: w.medDay(rep), Weeks: p.Injury}
	if fi.Knock {
		cs.Notes = append(cs.Notes, "hid_knock")
	}
	if fi.Rushed {
		cs.Notes = append(cs.Notes, "rushed")
	}
	if recurrence {
		cs.Notes = append(cs.Notes, "recurrence")
	}
	md.Cases = append([]*MedCase{cs}, md.Cases...)
	if len(md.Cases) > 80 {
		md.Cases = md.Cases[:80]
	}
	rec.Case = cs.ID
	sk := injuryKind(shown)
	md.Stats.Injuries++
	if sk.Tier >= 3 {
		md.Stats.Serious++
	}
	w.noteInjury(rep, p, shown, false)
	md.lines = append(md.lines, MedLine{Key: "new", PlayerID: p.ID, Name: p.Name, Kind: shown, N: p.Injury})
	switch {
	case sk.Tier >= 3:
		w.addCard(w.treatCard(p, rec, sk))
	case uncertain:
		w.addCard(w.diagCard(p, rec, sk))
	}
}

// noteInjury: the injury's kind and tier next to the name in the day report.
func (w *world) noteInjury(rep *DayReport, p *Player, kind string, again bool) {
	if rep == nil {
		return
	}
	k := injuryKind(kind)
	if !again {
		for i := range rep.Injuries {
			in := &rep.Injuries[i]
			if in.Name == p.Name && in.Kind == "" || in.PlayerID == p.ID {
				in.PlayerID, in.Kind, in.Tier, in.Weeks = p.ID, k.Key, k.Tier, p.Injury
				return
			}
		}
	}
	rep.Injuries = append(rep.Injuries, InjuryNote{PlayerID: p.ID, Name: p.Name, Weeks: p.Injury, Kind: k.Key, Tier: k.Tier})
}

// addWear: every injury wears the body; past each level pace and physical slip for good, and from
// the second level he becomes injury-prone. (Legends are spared.)
func (w *world) addWear(r *rand.Rand, p *Player, rec *MedRec, amount float64, rep *DayReport) {
	md := w.med
	rec.Wear += amount
	lvl := 0
	for i, t := range wearLevels {
		if rec.Wear >= t {
			lvl = i + 1
		}
	}
	isUser := p.ClubID != nil && *p.ClubID == w.career.UserClubID
	for rec.WearLv < lvl {
		rec.WearLv++
		if isLegend(p) {
			continue
		}
		var loss []LossNote
		hit := func(a string, lo, hi int) {
			n := lo + r.Intn(hi-lo+1)
			if n <= 0 {
				return
			}
			v := p.Attr(a)
			if *v-float64(n) < 20 {
				n = max(0, int(*v)-20)
			}
			if n <= 0 {
				return
			}
			*v -= float64(n)
			loss = append(loss, LossNote{a, n})
		}
		switch rec.WearLv {
		case 1:
			hit("pace", 1, 1)
			hit("physical", 1, 1)
		case 2:
			hit("pace", 1, 2)
			hit("physical", 1, 2)
		default:
			hit("pace", 2, 2)
			hit("physical", 2, 2)
		}
		if rec.WearLv >= 3 {
			ovr := int(math.Round(OverallAs(p, p.Position)))
			if np := max(ovr, p.Potential-2); np < p.Potential {
				loss = append(loss, LossNote{"potential", p.Potential - np})
				p.Potential = np
			}
		}
		prone := false
		if rec.WearLv >= 2 && !hasTrait(p, "injury_prone") {
			p.Traits = append(p.Traits, "injury_prone")
			prone = true
		}
		p.Fill()
		md.touched[p.ID] = p
		md.Stats.AllWorn++
		if isUser {
			pts := 0
			for _, l := range loss {
				pts += l.N
			}
			md.lines = append(md.lines, MedLine{Key: "worn", PlayerID: p.ID, Name: p.Name, N: rec.WearLv, Loss: loss})
			w.happen(rep, "med_injury_worn", p.Name, int64(pts))
			if prone {
				md.lines = append(md.lines, MedLine{Key: "prone", PlayerID: p.ID, Name: p.Name})
				w.happen(rep, "med_injury_prone", p.Name, 0)
			}
		}
	}
}

// applyTreatment: a treatment for the player's injury (the user's choice, or a computer club's).
// Surgery can go wrong; an injection wears the body more.
func (w *world) applyTreatment(r *rand.Rand, p *Player, rec *MedRec, treat string, clubID int) (complication bool) {
	t := treatmentOf(treat)
	k := injuryKind(rec.Kind)
	lvl := 1
	if cl := w.byID[clubID]; cl != nil {
		lvl = cl.Medical
	}
	doc := w.doctorSkill(clubID)
	ps := w.perks(clubID)
	before := p.Injury
	p.Injury = max(1, int(math.Round(float64(p.Injury)*t.Weeks)))
	rec.Total += p.Injury - before
	rec.Treat = treat
	rec.Dmg = math.Max(rec.Dmg, 1) * treatmentDmg(treat, doc, lvl, ps)
	if t.Wear > 1 {
		w.addWear(r, p, rec, k.Wear*(t.Wear-1), nil)
	}
	if treat == "surgery" && r.Float64() < complicationChance(doc, lvl, ps) {
		add := max(1, int(math.Ceil(float64(p.Injury)*0.25)))
		p.Injury += add
		rec.Total += add
		rec.Dmg *= 1.4
		complication = true
	}
	w.med.touched[p.ID] = p
	return complication
}

// closeInjury: the player is fit again. He comes back short of match sharpness, fragile for a
// while, and after a bad injury maybe never quite the same.
func (w *world) closeInjury(r *rand.Rand, p *Player, rec *MedRec, rep *DayReport) {
	md := w.med
	c := w.career
	k := injuryKind(rec.Kind)
	clubID := *p.ClubID
	isUser := clubID == c.UserClubID
	if k.Tier == 0 || k.Key == "flu" { // a rest, a week of easing in, a rehab block, the flu: nothing lingers
		rec.Kind, rec.Treat, rec.Total, rec.Since, rec.Src, rec.Case, rec.Dmg = "", "", 0, 0, "", 0, 0
		return
	}
	cl := w.byID[clubID]
	weeks := rec.Total
	physio := coachSkill(w.coaches[clubID], "physio")
	rust := rustAfter(weeks)
	if cl != nil && cl.Medical >= 4 {
		rust *= 0.75 // the rehab pool keeps him ticking over
	}
	rec.Rust = math.Max(rec.Rust, rust)
	p.Rust = rec.Rust
	if k.Frag > 0 {
		rec.Frag, rec.FragK = max(1, k.Frag-physio/5), k.Key
	}
	loss := w.lastingDamage(r, p, rec, k, physio)
	if len(loss) > 0 {
		md.Stats.AllLasting++
		md.touched[p.ID] = p
	}
	caseID := rec.Case
	rec.Kind, rec.Diag, rec.Hide, rec.Treat, rec.Dmg, rec.Total, rec.Since, rec.Src, rec.Case = "", "", 0, "", 0, 0, 0, "", 0
	if !isUser {
		return
	}
	if cs := md.caseByID(caseID); cs != nil {
		cs.Done, cs.Back, cs.Weeks, cs.Loss = true, c.Season*100+w.medDay(rep), weeks, loss
		cs.Kind = k.Key
	}
	if len(loss) > 0 {
		pts := 0
		for _, l := range loss {
			pts += l.N
		}
		md.Stats.Lasting++
		md.lines = append(md.lines, MedLine{Key: "lasting", PlayerID: p.ID, Name: p.Name, Kind: k.Key, Loss: loss})
		w.happen(rep, "med_injury_lasting", p.Name, int64(pts))
	}
	md.lines = append(md.lines, MedLine{Key: "back", PlayerID: p.ID, Name: p.Name, Kind: k.Key, N: weeks})
	if weeks >= 4 {
		w.happen(rep, "med_back", p.Name, int64(weeks))
		p.Morale = clamp(p.Morale+4, 20, 100) // glad to be back
		md.touched[p.ID] = p
		if c.Day <= len(Calendar) && c.Ended == "" {
			w.addCard(w.returnCard(p, rec, k.Key, weeks))
		}
	}
}

// lastingDamage: the roll for lasting damage when he is back. The kind sets the odds and what it
// costs; treatment, setbacks, the physio and his age move them.
func (w *world) lastingDamage(r *rand.Rand, p *Player, rec *MedRec, k *InjuryKind, physio int) []LossNote {
	ch := damageChance(p, rec, k, physio)
	if ch <= 0 || r.Float64() >= ch {
		return nil
	}
	var out []LossNote
	for _, l := range k.Loss {
		n := l.Lo
		if l.Hi > l.Lo {
			n += r.Intn(l.Hi - l.Lo + 1)
		}
		v := p.Attr(l.Attr)
		if v == nil {
			continue
		}
		if *v-float64(n) < 20 {
			n = max(0, int(*v)-20)
		}
		if n <= 0 {
			continue
		}
		*v -= float64(n)
		out = append(out, LossNote{l.Attr, n})
	}
	if k.Pot[1] > 0 {
		n := k.Pot[0] + r.Intn(k.Pot[1]-k.Pot[0]+1)
		ovr := int(math.Round(OverallAs(p, p.Position)))
		if np := max(ovr, p.Potential-n); np < p.Potential {
			out = append(out, LossNote{"potential", p.Potential - np})
			p.Potential = np
		}
	}
	p.Fill()
	return out
}

// damageChance: the odds of lasting damage from this injury as things stand.
func damageChance(p *Player, rec *MedRec, k *InjuryKind, physio int) float64 {
	if isLegend(p) || k.Dmg <= 0 || (k.GKLoss && p.Position != "GK") {
		return 0
	}
	dm := 1.0
	if rec != nil && rec.Dmg > 0 {
		dm = rec.Dmg
	}
	return math.Min(0.95, k.Dmg*dm*(1-0.015*float64(min(20, physio)))*ageDmg(p.Age))
}
