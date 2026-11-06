package game

import (
	"context"
	"math"
	"math/rand"
	"sort"
)

// ---------------------------------------------------------------- things to deal with (medical work stream)
//
// Decision cards in the medical room. Each has a default for when the manager leaves it: a
// treatment card waits two matchdays, then the doctor's advice stands (never the expensive trip
// abroad); a doubtful diagnosis or a worn body waits two; the rest are about the next match only
// and lapse once it is played (their default is simply what already happens).
//
//   treat  — a serious injury: rest and rehab, surgery, a painkilling injection (or, for a
//            career-threatening one, surgery at home or a specialist abroad)
//   diag   — the doctor is not sure of his diagnosis: pay for a scan elsewhere, or trust him
//   return — back after a long lay-off: one more week of easing in, or straight into the team
//   warn   — the doctor fears for a tired, worn or fragile player: rest him for the next match?
//   knock  — a player hiding a knock to keep his place: sit him out, or let him play
//   flu    — a player has the flu: send him home, or let him train (it may spread)
//   wear   — a body worn by injuries: a two-week rehabilitation block, or carry on

type MedCard struct {
	ID       int      `json:"id"`
	Kind     string   `json:"kind"`
	PlayerID int      `json:"playerId"`
	Name     string   `json:"name"`
	Injury   string   `json:"injury,omitempty"`
	Weeks    int      `json:"weeks,omitempty"`
	Risk     float64  `json:"risk,omitempty"` // warn / knock: injury risk in the next match
	Base     float64  `json:"base,omitempty"` // ...and a fresh player's
	Wear     float64  `json:"wear,omitempty"`
	Rust     float64  `json:"rust,omitempty"`
	Frag     int      `json:"frag,omitempty"`
	Why      []string `json:"why,omitempty"` // warn: tired | worn | fragile | prone | knock
	Options  []MedOpt `json:"options"`
	Default  string   `json:"default"`
	Due      int      `json:"due"` // the matchday tick at which it closes
	Case     int      `json:"case,omitempty"`
}

type MedOpt struct {
	Key   string  `json:"key"`
	Weeks int     `json:"weeks,omitempty"` // weeks out with this choice
	Cost  int64   `json:"cost,omitempty"`
	Risk  float64 `json:"risk,omitempty"` // setback / injury / spread chance
	Dmg   float64 `json:"dmg,omitempty"`  // chance of lasting damage
	Comp  float64 `json:"comp,omitempty"` // surgery: chance of a complication
	Rec   bool    `json:"rec,omitempty"`  // the doctor's advice
}

const (
	HideChance  = 0.004 // per player and match: he keeps quiet about a knock
	FluChance   = 0.012 // per matchday: the flu gets into the dressing room
	FluSpread   = 0.25  // ...and each of four teammates catches it if the patient keeps training
	WearAlertAt = 7.0   // body wear at which the doctor suggests a rehabilitation block
	ScanCost    = 120_000
	RehabCost   = 200_000
	InjectCost  = 30_000
)

func (cd *MedCard) opt(key string) *MedOpt {
	for i := range cd.Options {
		if cd.Options[i].Key == key {
			return &cd.Options[i]
		}
	}
	return nil
}

func (cd *MedCard) advise(key string) {
	for i := range cd.Options {
		cd.Options[i].Rec = cd.Options[i].Key == key
	}
}

// addCard opens a decision (one of a kind per player).
func (w *world) addCard(cd *MedCard) {
	if cd == nil {
		return
	}
	md := w.med
	for _, x := range md.Cards {
		if x.Kind == cd.Kind && x.PlayerID == cd.PlayerID {
			return
		}
	}
	cd.ID = md.nextID()
	md.Cards = append(md.Cards, cd)
	md.created++
}

// treatCost: what a treatment costs (scaled by the player's value; a better centre operates in-house for less).
func treatCost(p *Player, k *InjuryKind, treat string, lvl int) int64 {
	v := float64(p.Value)
	c := 0.0
	switch treat {
	case "surgery":
		if k.Tier >= 4 {
			c = clamp(v*0.03, 300_000, 3_000_000)
		} else {
			c = clamp(v*0.02, 150_000, 1_500_000)
		}
		c *= 1.1 - 0.05*float64(max(1, lvl)-1)
	case "specialist":
		c = clamp(v*0.06, 1_000_000, 6_000_000)
	case "elite": // the world's best surgical team flies in: no discount for a good centre
		if k.Tier >= 4 {
			c = clamp(v*0.12, 3_000_000, 25_000_000)
		} else {
			c = clamp(v*0.08, 1_500_000, 12_000_000)
		}
	case "injection":
		c = InjectCost
	}
	return int64(c/10_000) * 10_000
}

// treatCard: how to treat a serious injury, with what each choice means.
func (w *world) treatCard(p *Player, rec *MedRec, k *InjuryKind) *MedCard {
	user := w.byID[w.career.UserClubID]
	doc, ps, lvl := w.doctorSkill(user.ID), w.perks(user.ID), user.Medical
	physio := coachSkill(w.coaches[user.ID], "physio")
	opts := []string{"rest", "surgery", "injection", "elite"}
	if k.Tier >= 4 {
		opts = []string{"surgery", "specialist", "elite"}
	}
	cd := &MedCard{Kind: "treat", PlayerID: p.ID, Name: p.Name, Injury: k.Key, Weeks: p.Injury, Case: rec.Case, Due: w.med.Tick + 2}
	for _, o := range opts {
		t := treatmentOf(o)
		weeks := max(1, int(math.Round(float64(p.Injury)*t.Weeks)))
		tr := *rec
		tr.Treat = o
		tr.Dmg = math.Max(1, rec.Dmg) * treatmentDmg(o, doc, lvl, ps)
		opt := MedOpt{Key: o, Weeks: weeks, Cost: treatCost(p, k, o, lvl), Dmg: damageChance(p, &tr, k, physio)}
		per := k.Setback * t.Setback * (1 - 0.03*float64(min(20, physio))) * rehabPool(lvl)
		opt.Risk = 1 - math.Pow(1-per, float64(max(0, weeks-1)))
		if o == "surgery" {
			opt.Comp = complicationChance(doc, lvl, ps)
		}
		cd.Options = append(cd.Options, opt)
	}
	// the doctor's advice: an operation when the club can easily afford it; for a valuable player
	// with a career-threatening injury, the specialist
	advice := "rest"
	if k.Tier >= 4 {
		advice = "surgery"
		if sp := cd.opt("specialist"); sp != nil && p.Value >= 15_000_000 && user.Budget >= 3*sp.Cost {
			advice = "specialist"
		}
	} else if su := cd.opt("surgery"); su != nil && user.Budget >= 4*su.Cost && k.Dmg >= 0.2 {
		advice = "surgery"
	}
	cd.Default = advice
	if advice == "specialist" {
		cd.Default = "surgery" // left alone, the club never spends that much
	}
	// for an icon, or a valuable player facing most of a season out, the doctor would fly in the
	// world's best surgeons when the club can easily afford it (left alone, it never does)
	if el := cd.opt("elite"); el != nil && user.Budget >= 3*el.Cost && (isLegend(p) || (k.Tier >= 4 && p.Value >= 30_000_000)) {
		advice = "elite"
	}
	cd.advise(advice)
	return cd
}

func (w *world) diagCard(p *Player, rec *MedRec, k *InjuryKind) *MedCard {
	cd := &MedCard{Kind: "diag", PlayerID: p.ID, Name: p.Name, Injury: k.Key, Weeks: p.Injury, Case: rec.Case, Due: w.med.Tick + 2, Default: "trust",
		Options: []MedOpt{{Key: "scan", Cost: ScanCost}, {Key: "trust"}}}
	cd.advise("scan")
	return cd
}

func (w *world) returnCard(p *Player, rec *MedRec, kind string, weeks int) *MedCard {
	cd := &MedCard{Kind: "return", PlayerID: p.ID, Name: p.Name, Injury: kind, Weeks: weeks, Rust: rec.Rust, Frag: rec.Frag, Due: w.med.Tick + 1, Default: "straight",
		Options: []MedOpt{{Key: "ease", Weeks: 1}, {Key: "straight"}}}
	if weeks >= 8 {
		cd.advise("ease")
	} else {
		cd.advise("straight")
	}
	return cd
}

func (w *world) warnCard(p *Player, rec *MedRec, risk, base float64) *MedCard {
	cd := &MedCard{Kind: "warn", PlayerID: p.ID, Name: p.Name, Risk: risk, Base: base, Due: w.med.Tick + 1, Default: "play",
		Options: []MedOpt{{Key: "sit", Weeks: 1}, {Key: "play", Risk: risk}}}
	if p.Fitness < 68 {
		cd.Why = append(cd.Why, "tired")
	}
	if rec != nil {
		cd.Wear, cd.Rust, cd.Frag = rec.Wear, rec.Rust, rec.Frag
		if rec.Wear >= 3 {
			cd.Why = append(cd.Why, "worn")
		}
		if rec.Frag > 0 {
			cd.Why = append(cd.Why, "fragile")
		}
		if rec.Knock > 0 && rec.Seen {
			cd.Why = append(cd.Why, "knock")
		}
	}
	if w.knownProne(p, rec) {
		cd.Why = append(cd.Why, "prone")
	}
	cd.advise("sit")
	return cd
}

func (w *world) knockCard(p *Player, risk float64) *MedCard {
	cd := &MedCard{Kind: "knock", PlayerID: p.ID, Name: p.Name, Risk: risk, Due: w.med.Tick + 1, Default: "play",
		Options: []MedOpt{{Key: "sit", Weeks: 1}, {Key: "play", Risk: risk}}}
	cd.advise("sit")
	return cd
}

func (w *world) fluCard(p *Player) *MedCard {
	cd := &MedCard{Kind: "flu", PlayerID: p.ID, Name: p.Name, Injury: "flu", Due: w.med.Tick + 1, Default: "home",
		Options: []MedOpt{{Key: "home", Weeks: 1}, {Key: "train", Risk: 1 - math.Pow(1-FluSpread, 4)}}}
	cd.advise("home")
	return cd
}

func (w *world) wearCard(p *Player, rec *MedRec) *MedCard {
	cd := &MedCard{Kind: "wear", PlayerID: p.ID, Name: p.Name, Wear: rec.Wear, Due: w.med.Tick + 2, Default: "carry",
		Options: []MedOpt{{Key: "rehab", Weeks: 2, Cost: RehabCost}, {Key: "carry", Risk: WearRisk * rec.Wear}}}
	cd.advise("rehab")
	return cd
}

// riskNext: the doctor's estimate of a player's injury risk over a full match in the next fixture.
func (w *world) riskNext(p *Player, f *Fixture) float64 {
	cl := w.byID[w.career.UserClubID]
	risk := 0.01 + math.Max(0, 68-p.Fitness)*0.003
	if cl.Tactic.Pressing == "high" {
		risk += 0.005
	}
	if f != nil && w.congested(cl.ID, f) {
		risk += MidweekInjury
	}
	risk *= w.knownBodyRisk(p, w.med.P[p.ID])
	if p.Rushed {
		risk += RushInjury
	}
	return risk * staffRisk(coachSkill(w.coaches[cl.ID], "physio"), coachSkill(w.coaches[cl.ID], "fitness"), cl.Medical, w.perks(cl.ID)) * InjuryRate
}

// warnRatio: the doctor speaks up when a player's risk is this many times a fresh player's (a
// better doctor sees trouble coming sooner; without one the physio only flags the worst cases).
func warnRatio(doc int, ps Perks) float64 {
	if doc <= 0 {
		return 3.4
	}
	r := 3.2 - 0.04*float64(min(20, doc))
	if ps["diagnostician"] {
		r -= 0.2
	}
	return r
}

// riskFresh: the same for a fresh, sound player (the yardstick for the warnings).
func (w *world) riskFresh(f *Fixture) float64 {
	return w.riskNext(&Player{Fitness: 100}, f)
}

// ---------------------------------------------------------------- opening and settling cards

// cardLive: is the card still about something real?
func (w *world) cardLive(cd *MedCard, p *Player) bool {
	rec := w.med.P[p.ID]
	switch cd.Kind {
	case "treat":
		return rec != nil && p.Injury > 0 && rec.Kind == cd.Injury && rec.Treat == "" && rec.Case == cd.Case
	case "diag": // (gone once the wrong diagnosis has come to light by itself)
		return rec != nil && p.Injury > 0 && rec.Case == cd.Case && rec.Kind != "" && (rec.Hide > 0 || rec.Kind == cd.Injury)
	case "flu":
		return rec != nil && rec.Kind == "flu" && p.Injury > 0
	case "knock":
		return p.Injury == 0 && rec != nil && rec.Knock > 0
	}
	return p.Injury == 0
}

// settleCards: decisions whose time is up. A treatment gets the doctor's advice; the others lapse.
func (w *world) settleCards(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	md := w.med
	var keep, due []*MedCard
	for _, cd := range md.Cards {
		p := w.mine(cd.PlayerID)
		if p == nil || !w.cardLive(cd, p) {
			continue
		}
		if md.Tick >= cd.Due {
			if cd.Kind == "treat" {
				due = append(due, cd)
			}
			continue
		}
		keep = append(keep, cd)
	}
	md.Cards = keep
	for _, cd := range due {
		if _, err := w.resolveMedCard(ctx, q, r, cd, cd.Default, true); err != nil {
			if _, ok := IsUserErr(err); !ok {
				return err
			}
		}
	}
	return nil
}

// newCards: what the doctor brings to the manager after the matchday (during the season).
func (w *world) newCards(r *rand.Rand, rep *DayReport, uo *matchOutcome) {
	c := w.career
	if c.Day > len(Calendar) {
		return // the off-season: no match to worry about
	}
	md := w.med
	user := w.byID[c.UserClubID]
	ps := w.perks(user.ID)
	doc := w.doctorSkill(user.ID)
	squad := w.userSquad()
	sort.Slice(squad, func(i, j int) bool { return squad[i].ID < squad[j].ID })
	// a player keeps quiet about a knock to keep his place
	if uo != nil && uo.f != nil && uo.f.Comp != "friendly" {
		for _, p := range squad {
			if _, played := uo.ratings[p.ID]; !played || p.Injury > 0 {
				continue
			}
			if rec := md.P[p.ID]; rec != nil && rec.Knock > 0 {
				continue
			}
			if r.Float64() >= HideChance {
				continue
			}
			rec := md.rec(p.ID)
			rec.Knock = 2
			if r.Float64() < spotChance(doc, user.Medical, ps) {
				rec.Seen = true
				w.addCard(w.knockCard(p, w.riskNext(p, w.userFixture())))
				md.lines = append(md.lines, MedLine{Key: "knock", PlayerID: p.ID, Name: p.Name})
			}
			// otherwise nobody knows: he plays on at a higher risk
		}
	}
	// the flu
	if r.Float64() < FluChance {
		var cands []*Player
		for _, p := range squad {
			if p.Injury == 0 {
				cands = append(cands, p)
			}
		}
		if len(cands) > 0 {
			p := cands[r.Intn(len(cands))]
			w.catchFlu(p, rep)
			w.addCard(w.fluCard(p))
			md.lines = append(md.lines, MedLine{Key: "flu", PlayerID: p.ID, Name: p.Name})
		}
	}
	// a body worn by injuries needs a break
	for _, p := range squad {
		rec := md.P[p.ID]
		if rec == nil || p.Injury > 0 || rec.Alert || rec.Wear < WearAlertAt {
			continue
		}
		rec.Alert = true
		w.addCard(w.wearCard(p, rec))
	}
	// the doctor's warnings before the next match
	f := w.userFixture()
	if f == nil {
		return
	}
	ratio := warnRatio(doc, ps)
	most := 1
	if doc >= 14 {
		most = 2
	}
	base := w.riskFresh(f)
	byOvr := append([]*Player{}, squad...)
	sort.SliceStable(byOvr, func(i, j int) bool { return byOvr[i].Overall > byOvr[j].Overall })
	type cand struct {
		p    *Player
		risk float64
	}
	var cs []cand
	for i, p := range byOvr {
		if i >= 16 {
			break // the doctor watches the players who will play
		}
		if p.Injury > 0 && !p.Rushed {
			continue
		}
		if rec := md.P[p.ID]; rec != nil && rec.Warned > 0 && md.Tick-rec.Warned < 6 {
			continue
		}
		if risk := w.riskNext(p, f); risk >= 0.012 && risk >= base*ratio {
			cs = append(cs, cand{p, risk})
		}
	}
	sort.SliceStable(cs, func(i, j int) bool { return cs[i].risk > cs[j].risk })
	for i := 0; i < len(cs) && i < most; i++ {
		rec := md.rec(cs[i].p.ID)
		rec.Warned = md.Tick
		w.addCard(w.warnCard(cs[i].p, rec, cs[i].risk, base))
	}
}

// catchFlu: the player goes home for a week.
func (w *world) catchFlu(p *Player, rep *DayReport) {
	md := w.med
	rec := md.rec(p.ID)
	rec.Kind, rec.Diag, rec.Hide, rec.Treat, rec.Src = "flu", "", 0, "", "flu"
	rec.Total, rec.Since, rec.Case, rec.Dmg = 1, w.career.Season*100+w.medDay(rep), 0, 0
	p.Injury = 1
	p.InjKind = "flu"
	md.touched[p.ID] = p
}

// medLog: a line for the report (between matchdays it goes into the latest one).
func (w *world) medLog(l MedLine, inTick bool) {
	md := w.med
	if inTick {
		md.lines = append(md.lines, l)
		return
	}
	if len(md.Reports) == 0 {
		md.Reports = []*MedReport{{Tick: md.Tick, Season: w.career.Season, Day: min(w.career.Day, len(Calendar)+1), Lines: []MedLine{}}}
	}
	md.Reports[0].Lines = append(md.Reports[0].Lines, l)
}

// resolveMedCard: the manager's answer (or, when auto, the default once time is up).
func (w *world) resolveMedCard(ctx context.Context, q DBTX, r *rand.Rand, cd *MedCard, choice string, auto bool) (*MedLine, error) {
	md := w.med
	c := w.career
	user := w.byID[c.UserClubID]
	p := w.mine(cd.PlayerID)
	if p == nil {
		return nil, userErr("not_yours", "This player is not at your club")
	}
	opt := cd.opt(choice)
	if opt == nil {
		return nil, userErr("bad_choice", "Unknown choice")
	}
	if !w.cardLive(cd, p) {
		w.dropCard(cd.ID)
		return nil, userErr("card_gone", "This decision is no longer needed")
	}
	rec := md.rec(p.ID)
	cs := md.caseByID(rec.Case)
	if cd.Kind == "treat" && auto && opt.Cost > user.Budget {
		// no money for the operation: he rests
		choice = "rest"
		opt = &MedOpt{Key: "rest"}
	}
	pay := func(cost int64) error {
		if cost <= 0 {
			return nil
		}
		if user.Budget < cost {
			return userErr("no_budget", "Not enough budget")
		}
		user.Budget -= cost
		md.Stats.Spent += cost
		if cs != nil {
			cs.Cost += cost
		}
		return addFinance(ctx, q, c, "medical", -cost, p.Name)
	}
	line := MedLine{PlayerID: p.ID, Name: p.Name, Kind: rec.shown(), Treat: choice, Cost: opt.Cost}
	var extra []MedLine
	switch cd.Kind {
	case "treat":
		if err := pay(opt.Cost); err != nil {
			return nil, err
		}
		comp := w.applyTreatment(r, p, rec, choice, user.ID)
		line.Key, line.N = "treat", p.Injury
		if auto {
			line.Key = "auto"
		}
		if cs != nil {
			cs.Treat, cs.Weeks = choice, rec.Total
		}
		if comp {
			if cs != nil {
				cs.Notes = append(cs.Notes, "complication")
			}
			extra = append(extra, MedLine{Key: "complication", PlayerID: p.ID, Name: p.Name, Kind: rec.Kind, N: p.Injury})
		}
	case "diag":
		line.Key = "trust"
		if choice == "scan" {
			if err := pay(ScanCost); err != nil {
				return nil, err
			}
			line.Key = "scan_ok"
			if rec.Hide > 0 {
				was, add := rec.Diag, rec.Hide
				p.Injury += add
				rec.Total += add
				rec.Hide, rec.Diag = 0, ""
				p.InjKind = rec.Kind
				line.Key, line.Kind, line.Was, line.N = "scan_found", rec.Kind, was, add
				if cs != nil {
					cs.Diag, cs.Kind, cs.Weeks = was, rec.Kind, rec.Total
					cs.Notes = append(cs.Notes, "scan")
				}
				if k := injuryKind(rec.Kind); k.Tier >= 3 {
					w.addCard(w.treatCard(p, rec, k))
				}
			}
		}
	case "return":
		line.Key = "straight"
		if choice == "ease" {
			p.Injury = 1
			rec.Kind, rec.Total, rec.Since = "ease", 1, c.Season*100+w.medDay(nil)
			p.InjKind = "ease"
			rec.Rust *= 0.5
			p.Rust = rec.Rust
			if rec.Frag > 0 {
				rec.Frag = (rec.Frag + 1) / 2
			}
			line.Key = "ease"
			for _, x := range md.Cases {
				if x.PlayerID == p.ID {
					x.Notes = append(x.Notes, "eased")
					break
				}
			}
		}
	case "warn", "knock":
		line.Key = "play"
		if choice == "sit" {
			p.Injury = 1
			rec.Kind, rec.Total, rec.Since, rec.Knock, rec.Seen = "rest", 1, c.Season*100+w.medDay(nil), 0, false
			p.InjKind = "rest"
			md.Stats.Saved++
			line.Key = "rest"
		} else if cd.Kind == "knock" {
			p.Morale = clamp(p.Morale+3, 20, 100) // grateful to keep his place
		}
	case "flu":
		line.Key = "flu_home"
		if choice == "train" {
			p.Injury, p.InjKind = 0, ""
			rec.Kind, rec.Total = "", 0
			p.Fitness = math.Max(25, p.Fitness-15)
			line.Key = "flu_train"
			mates := []*Player{}
			for _, o := range w.userSquad() {
				if o.ID != p.ID && o.Injury == 0 {
					mates = append(mates, o)
				}
			}
			r.Shuffle(len(mates), func(i, j int) { mates[i], mates[j] = mates[j], mates[i] })
			for i := 0; i < len(mates) && i < 4; i++ {
				if r.Float64() < FluSpread {
					w.catchFlu(mates[i], nil)
					extra = append(extra, MedLine{Key: "flu_spread", PlayerID: mates[i].ID, Name: mates[i].Name})
				}
			}
		}
	case "wear":
		line.Key = "carry"
		if choice == "rehab" {
			if err := pay(RehabCost); err != nil {
				return nil, err
			}
			p.Injury = 2
			rec.Kind, rec.Total, rec.Since = "rehab", 2, c.Season*100+w.medDay(nil)
			p.InjKind = "rehab"
			rec.Wear *= 0.5
			rec.shedWear()
			line.Key = "rehab"
		}
	}
	md.touched[p.ID] = p
	w.dropCard(cd.ID)
	inTick := auto
	w.medLog(line, inTick)
	for _, l := range extra {
		w.medLog(l, inTick)
	}
	return &line, nil
}

func (w *world) dropCard(id int) {
	md := w.med
	keep := md.Cards[:0]
	for _, x := range md.Cards {
		if x.ID != id {
			keep = append(keep, x)
		}
	}
	md.Cards = keep
}
