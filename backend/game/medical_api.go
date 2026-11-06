package game

import (
	"context"
	"math"
	"sort"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- the medical room (medical work stream)
//
// GET /api/careers/{id}/medical → MedicalView; POST with MedReq answers a decision card, gives a
// painkilling injection or calls in elite surgery for a player already out. The career state carries
// a small badge (CareerState.medicalView).

type MedicalView struct {
	Season    int          `json:"season"`
	Day       int          `json:"day"`
	Tick      int          `json:"tick"`
	Offseason bool         `json:"offseason"`
	Budget    int64        `json:"budget"`
	Next      *FixtureView `json:"next"` // the next match (the warnings are about it)
	Injured   []MedInjured `json:"injured"`
	Cards     []*MedCard   `json:"cards"`
	Squad     []MedRisk    `json:"squad"`
	Team      MedTeam      `json:"team"`
	Reports   []*MedReport `json:"reports"`
	Stats     MedSeason    `json:"stats"`
	Prev      *MedSeason   `json:"prev"`
	Cases     []*MedCase   `json:"cases"`
	News      []MedNews    `json:"news"`
	Kinds     []MedKind    `json:"kinds"`
	Waiting   int          `json:"waiting"`
}

// MedInjured: a player in the treatment room.
type MedInjured struct {
	PlayerID int     `json:"playerId"`
	Name     string  `json:"name"`
	Position string  `json:"position"`
	Role     string  `json:"role"`
	Overall  int     `json:"overall"`
	Age      int     `json:"age"`
	Shirt    int     `json:"shirt"`
	Kind     string  `json:"kind"`
	Tier     int     `json:"tier"`
	Part     string  `json:"part"`
	Weeks    int     `json:"weeks"` // weeks left
	Total    int     `json:"total"`
	Treat    string  `json:"treat"`
	Source   string  `json:"source"`
	Since    int     `json:"since"`   // matchday it happened
	Setback  float64 `json:"setback"` // chance of a setback in rehab (each week)
	Dmg      float64 `json:"dmg"`     // chance of lasting damage when he is back
	Rushed   bool    `json:"rushed"`
	Pending  bool    `json:"pending"` // a decision about him is waiting
	Inject   *MedOpt `json:"inject,omitempty"`
	Elite    *MedOpt `json:"elite,omitempty"` // elite surgery is still possible: its cost and the weeks left after it
	Case     int     `json:"case,omitempty"`
}

// MedRisk: a fit player on the doctor's board.
type MedRisk struct {
	PlayerID int     `json:"playerId"`
	Name     string  `json:"name"`
	Position string  `json:"position"`
	Role     string  `json:"role"`
	Overall  int     `json:"overall"`
	Age      int     `json:"age"`
	Shirt    int     `json:"shirt"`
	Fitness  float64 `json:"fitness"`
	Risk     float64 `json:"risk"` // chance of an injury in a full match now
	Base     float64 `json:"base"` // ...for a fresh, sound player
	Wear     float64 `json:"wear"`
	WearLv   int     `json:"wearLv"`
	Frag     int     `json:"frag"`
	FragK    string  `json:"fragK,omitempty"`
	Rust     float64 `json:"rust"`
	Prone    bool    `json:"prone"`
	Injuries int     `json:"injuries"`
	Conc     int     `json:"conc,omitempty"`
	Last     string  `json:"last,omitempty"`
	LastS    int     `json:"lastS,omitempty"`
	Starter  bool    `json:"starter"`
}

// MedTeam: the medical staff and the medical centre, with what they do in numbers.
type MedTeam struct {
	Doctor  *Coach   `json:"doctor"`
	Physio  *Coach   `json:"physio"`
	Fitness *Coach   `json:"fitness"`
	Centre  int      `json:"centre"`
	NextLvl int64    `json:"nextLvl"` // cost of the next medical-centre level (0 at the top)
	Prevent float64  `json:"prevent"` // injury risk the staff and the centre take off (0..1)
	Rehab   float64  `json:"rehab"`   // lay-offs shortened by the physio (0..1)
	Misdiag float64  `json:"misdiag"` // chance a serious injury is taken for a lighter one
	Spot    float64  `json:"spot"`    // chance a hidden knock is spotted
	Comp    float64  `json:"comp"`    // chance an operation goes wrong
	Surgery float64  `json:"surgery"` // lasting damage after an operation, compared with resting
	Setback float64  `json:"setback"` // setbacks in rehab, compared with no physio and a basic centre
	Rust    float64  `json:"rust"`    // sharpness lost after a lay-off, compared with a basic centre
	Ratio   float64  `json:"ratio"`   // the doctor warns when a player's risk is this many times a fresh player's
	Perks   []string `json:"perks"`   // the medical staff's specialities
}

// MedKind: one entry of the injury handbook.
type MedKind struct {
	Key  string     `json:"key"`
	Part string     `json:"part"`
	Tier int        `json:"tier"`
	Min  int        `json:"min"`
	Max  int        `json:"max"`
	Frag int        `json:"frag"`
	Dmg  float64    `json:"dmg"`
	Loss []AttrLoss `json:"loss,omitempty"`
	Pot  [2]int     `json:"pot"`
	GK   bool       `json:"gk,omitempty"`
	Mis  string     `json:"mis,omitempty"`
	Seen int        `json:"seen"` // times it has happened at the user's club (cases kept)
}

type MedReq struct {
	Action   string `json:"action"` // card | inject | elite
	ID       int    `json:"id"`     // card id
	Choice   string `json:"choice"`
	PlayerID int    `json:"playerId"`
}

type MedResult struct {
	View *MedicalView `json:"view"`
	Line *MedLine     `json:"line,omitempty"` // what happened
}

// medicalBadge is sent with the career state (CareerState.medicalView).
func (w *world) medicalBadge() any {
	md := w.med
	if md == nil {
		return nil
	}
	out := 0
	for _, p := range w.userSquad() {
		if p.Injury > 0 {
			out++
		}
	}
	return map[string]int{"waiting": len(w.liveCards()), "injured": out, "tick": md.Tick}
}

// liveCards: the decisions still open.
func (w *world) liveCards() []*MedCard {
	out := []*MedCard{}
	for _, cd := range w.med.Cards {
		if p := w.mine(cd.PlayerID); p != nil && w.cardLive(cd, p) && w.med.Tick < cd.Due {
			out = append(out, cd)
		}
	}
	return out
}

func (s *Store) Medical(ctx context.Context, careerID int) (*MedicalView, error) {
	var v *MedicalView
	err := s.tx(ctx, func(q pgx.Tx) error {
		w, err := loadWorld(ctx, q, newRand(), careerID)
		if err != nil {
			return err
		}
		v = w.medicalView()
		return nil
	})
	return v, err
}

func (s *Store) MedicalAction(ctx context.Context, careerID int, req MedReq) (*MedResult, error) {
	var out *MedResult
	err := s.tx(ctx, func(q pgx.Tx) error {
		// queue behind a matchday being played
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		r := newRand()
		w, err := loadWorld(ctx, q, r, careerID)
		if err != nil {
			return err
		}
		md := w.med
		var line *MedLine
		switch req.Action {
		case "card":
			var cd *MedCard
			for _, x := range w.liveCards() {
				if x.ID == req.ID {
					cd = x
				}
			}
			if cd == nil {
				return userErr("card_gone", "This decision is no longer needed")
			}
			if line, err = w.resolveMedCard(ctx, q, r, cd, req.Choice, false); err != nil {
				return err
			}
		case "inject":
			if line, err = w.inject(ctx, q, req.PlayerID); err != nil {
				return err
			}
		case "elite":
			if line, err = w.elite(ctx, q, req.PlayerID); err != nil {
				return err
			}
		default:
			return userErr("bad_action", "Unknown action")
		}
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
		if err := saveClub(ctx, q, w.byID[w.career.UserClubID]); err != nil {
			return err
		}
		if err := saveMedState(ctx, q, w.career.ID, md); err != nil {
			return err
		}
		out = &MedResult{View: w.medicalView(), Line: line}
		return nil
	})
	return out, err
}

// injectable: a medium injury can be played through with painkillers (sooner back, riskier).
func (w *world) injectable(p *Player, rec *MedRec) bool {
	if rec == nil || p.Injury < 2 || rec.Treat != "" || !isRealInjury(rec.Kind) {
		return false
	}
	return injuryKind(rec.shown()).Tier == 2
}

func (w *world) inject(ctx context.Context, q DBTX, playerID int) (*MedLine, error) {
	p := w.mine(playerID)
	if p == nil {
		return nil, userErr("not_yours", "This player is not at your club")
	}
	md := w.med
	rec := md.P[p.ID]
	if !w.injectable(p, rec) {
		return nil, userErr("no_injection", "An injection is not possible for this injury")
	}
	c := w.career
	user := w.byID[c.UserClubID]
	if user.Budget < InjectCost {
		return nil, userErr("no_budget", "Not enough budget")
	}
	user.Budget -= InjectCost
	md.Stats.Spent += InjectCost
	if err := addFinance(ctx, q, c, "medical", -InjectCost, p.Name); err != nil {
		return nil, err
	}
	rr := newRand()
	w.applyTreatment(rr, p, rec, "injection", user.ID)
	if cs := md.caseByID(rec.Case); cs != nil {
		cs.Treat, cs.Weeks = "injection", rec.Total
		cs.Cost += InjectCost
	}
	line := MedLine{Key: "inject", PlayerID: p.ID, Name: p.Name, Kind: rec.shown(), N: p.Injury, Cost: InjectCost}
	w.medLog(line, false)
	return &line, nil
}

// eliteable: elite surgery can still be called in for a serious or career-threatening injury the
// club knows about, with a few weeks to go, whatever treatment he had first.
func (w *world) eliteable(p *Player, rec *MedRec) bool {
	if rec == nil || p.Injury < EliteMinWeeks || rec.Treat == "elite" || !isRealInjury(rec.Kind) {
		return false
	}
	return injuryKind(rec.shown()).Tier >= 3
}

// eliteOpt: what elite surgery would cost him now and how many weeks he would still be out.
func (w *world) eliteOpt(p *Player, rec *MedRec) *MedOpt {
	user := w.byID[w.career.UserClubID]
	k := injuryKind(rec.shown())
	return &MedOpt{Key: "elite", Cost: treatCost(p, k, "elite", user.Medical), Weeks: max(1, int(math.Round(float64(p.Injury)*treatmentOf("elite").Weeks)))}
}

// elite: the world's best surgical team operates on a player who is already out (the first treatment
// is replaced; the weeks still to go shrink to about a third and nothing lasting is left).
func (w *world) elite(ctx context.Context, q DBTX, playerID int) (*MedLine, error) {
	p := w.mine(playerID)
	if p == nil {
		return nil, userErr("not_yours", "This player is not at your club")
	}
	md := w.med
	rec := md.P[p.ID]
	if !w.eliteable(p, rec) {
		return nil, userErr("no_elite", "Elite surgery is not possible for this injury")
	}
	c := w.career
	user := w.byID[c.UserClubID]
	cost := w.eliteOpt(p, rec).Cost
	if user.Budget < cost {
		return nil, userErr("no_budget", "Not enough budget")
	}
	user.Budget -= cost
	md.Stats.Spent += cost
	if err := addFinance(ctx, q, c, "medical", -cost, p.Name); err != nil {
		return nil, err
	}
	w.applyTreatment(newRand(), p, rec, "elite", user.ID)
	if cs := md.caseByID(rec.Case); cs != nil {
		cs.Treat, cs.Weeks = "elite", rec.Total
		cs.Cost += cost
	}
	line := MedLine{Key: "treat", PlayerID: p.ID, Name: p.Name, Kind: rec.shown(), Treat: "elite", N: p.Injury, Cost: cost}
	w.medLog(line, false)
	return &line, nil
}

// medicalView: everything the medical room shows.
func (w *world) medicalView() *MedicalView {
	md := w.med
	c := w.career
	user := w.byID[c.UserClubID]
	v := &MedicalView{Season: c.Season, Day: min(c.Day, len(Calendar)+1), Tick: md.Tick, Offseason: c.Day > len(Calendar), Budget: user.Budget,
		Injured: []MedInjured{}, Squad: []MedRisk{}, Reports: md.Reports, Stats: md.Stats, Prev: md.Prev, News: md.News, Cases: []*MedCase{}}
	if v.Reports == nil {
		v.Reports = []*MedReport{}
	}
	if v.News == nil {
		v.News = []MedNews{}
	}
	f := w.userFixture()
	if f != nil {
		fv := viewFixture(f, w.byID)
		v.Next = &fv
	}
	v.Cards = w.liveCards()
	v.Waiting = len(v.Cards)
	pending := map[int]bool{}
	for _, cd := range v.Cards {
		pending[cd.PlayerID] = true
	}
	physio := coachSkill(w.coaches[user.ID], "physio")
	lineup := map[int]bool{}
	for _, id := range user.Lineup {
		lineup[id] = true
	}
	base := w.riskFresh(f)
	squad := w.userSquad()
	sort.SliceStable(squad, func(i, j int) bool { return squad[i].Shirt < squad[j].Shirt })
	inSquad := map[int]bool{}
	for _, p := range squad {
		inSquad[p.ID] = true
		rec := md.P[p.ID]
		if p.Injury > 0 {
			mi := MedInjured{PlayerID: p.ID, Name: p.Name, Position: p.Position, Role: p.Role, Overall: p.Overall, Age: p.Age, Shirt: p.Shirt,
				Weeks: p.Injury, Total: p.Injury, Rushed: p.Rushed, Pending: pending[p.ID]}
			if rec != nil && rec.Kind != "" {
				k := injuryKind(rec.shown())
				mi.Kind, mi.Tier, mi.Part, mi.Treat, mi.Source, mi.Case = k.Key, k.Tier, k.Part, rec.Treat, rec.Src, rec.Case
				mi.Total = max(p.Injury, rec.Total)
				mi.Since = rec.Since % 100
				if k.Tier > 0 && k.Setback > 0 && p.Injury > 1 {
					mi.Setback = k.Setback * treatmentOf(rec.Treat).Setback * (1 - 0.03*float64(min(20, physio))) * rehabPool(user.Medical)
				}
				// the odds as the club sees them (a hidden injury looks like the lighter one)
				view := *rec
				mi.Dmg = damageChance(p, &view, k, physio)
				if w.injectable(p, rec) {
					t := treatmentOf("injection")
					mi.Inject = &MedOpt{Key: "injection", Cost: InjectCost, Weeks: max(1, int(math.Round(float64(p.Injury)*t.Weeks))),
						Risk: math.Min(1, mi.Setback*t.Setback), Dmg: math.Min(0.95, mi.Dmg*t.Dmg)}
				}
				if w.eliteable(p, rec) {
					mi.Elite = w.eliteOpt(p, rec)
				}
			}
			v.Injured = append(v.Injured, mi)
			continue
		}
		mr := MedRisk{PlayerID: p.ID, Name: p.Name, Position: p.Position, Role: p.Role, Overall: p.Overall, Age: p.Age, Shirt: p.Shirt,
			Fitness: math.Round(p.Fitness), Risk: w.riskNext(p, f), Base: base, Prone: w.knownProne(p, rec), Starter: lineup[p.ID]}
		if rec != nil {
			mr.Wear, mr.WearLv, mr.Frag, mr.FragK, mr.Rust = math.Round(rec.Wear*10)/10, rec.WearLv, rec.Frag, rec.FragK, rec.Rust
			mr.Injuries, mr.Conc, mr.Last, mr.LastS = rec.N, rec.Conc, rec.Last, rec.LastS
		}
		v.Squad = append(v.Squad, mr)
	}
	sort.SliceStable(v.Injured, func(i, j int) bool { return v.Injured[i].Weeks > v.Injured[j].Weeks })
	// the case files of the current squad first, then the club's older cases
	for _, cs := range md.Cases {
		if inSquad[cs.PlayerID] {
			v.Cases = append(v.Cases, cs)
		}
	}
	for _, cs := range md.Cases {
		if !inSquad[cs.PlayerID] && len(v.Cases) < 60 {
			v.Cases = append(v.Cases, cs)
		}
	}
	v.Team = w.medTeam()
	seen := map[string]int{}
	for _, cs := range md.Cases {
		seen[cs.Kind]++
	}
	for _, k := range Injuries {
		if k.Tier == 0 || k.Key == "flu" {
			continue
		}
		v.Kinds = append(v.Kinds, MedKind{Key: k.Key, Part: k.Part, Tier: k.Tier, Min: k.Min, Max: k.Max, Frag: k.Frag, Dmg: k.Dmg,
			Loss: k.Loss, Pot: k.Pot, GK: k.GKLoss, Mis: k.Mis, Seen: seen[k.Key]})
	}
	return v
}

// medTeam: the medical staff and what they are worth.
func (w *world) medTeam() MedTeam {
	user := w.byID[w.career.UserClubID]
	cs := w.coaches[user.ID]
	pick := func(role string) *Coach {
		for _, c := range cs {
			if c.Role == role {
				return c
			}
		}
		return nil
	}
	ps := w.perks(user.ID)
	doc := w.doctorSkill(user.ID)
	physio := coachSkill(cs, "physio")
	fit := coachSkill(cs, "fitness")
	lvl := max(1, user.Medical)
	t := MedTeam{Doctor: pick("doctor"), Physio: pick("physio"), Fitness: pick("fitness"), Centre: lvl,
		Prevent: 1 - staffRisk(physio, fit, lvl, ps),
		Rehab:   0.012 * float64(min(20, physio)),
		Misdiag: misdiagChance(doc, lvl, ps),
		Spot:    spotChance(doc, lvl, ps),
		Comp:    complicationChance(doc, lvl, ps),
		Surgery: treatmentDmg("surgery", doc, lvl, ps),
		Setback: (1 - 0.03*float64(min(20, physio))) * rehabPool(lvl),
		Rust:    1,
		Ratio:   warnRatio(doc, ps),
		Perks:   []string{},
	}
	if lvl >= 4 {
		t.Rust = 0.75
	}
	if lvl < MaxFacility {
		t.NextLvl = facilityCosts["medical"][lvl-1]
	}
	for _, k := range []string{"diagnostician", "surgeon", "quick_heal", "injury_prevention", "recovery", "veteran_care"} {
		if ps[k] {
			t.Perks = append(t.Perks, k)
		}
	}
	return t
}
