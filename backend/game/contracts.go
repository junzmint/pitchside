package game

import (
	"context"
	"math"
	"math/rand"
	"sort"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- ageing

// AgeNote: how much a user's player lost to age over the summer.
type AgeNote struct {
	Name   string `json:"name"`
	Age    int    `json:"age"`
	Before int    `json:"before"`
	After  int    `json:"after"`
}

// ageDecline runs once a season after birthdays. Nothing happens before 31; from 32 pace and
// physical start to go, from 34 the rest follows. A good training centre and fitness coach slow it.
func ageDecline(r *rand.Rand, p *Player, trainLvl, fitnessCoach int, vetCare bool) {
	a := p.Age
	if a <= 31 {
		return
	}
	// season loss for pace/physical (others lose about half, from 34)
	var phys float64
	switch {
	case a <= 33:
		phys = 1.5 + float64(a-32)*1.0 // 32: 1.5 · 33: 2.5
	case a <= 35:
		phys = 3.5 + float64(a-34)*1.0 // 34: 3.5 · 35: 4.5
	default:
		phys = 5.5 + float64(a-36)*1.0
	}
	slow := 1 - 0.06*float64(max(1, trainLvl)-1) - 0.015*float64(fitnessCoach)
	if vetCare {
		slow *= 0.7 // a veteran-care specialist keeps old legs going
	}
	slow = math.Max(0.4, slow)
	loss := func(base float64) float64 { return base * slow * (0.6 + r.Float64()*0.8) }
	p.Pace = math.Max(20, p.Pace-loss(phys*1.1))
	p.Physical = math.Max(20, p.Physical-loss(phys))
	if a >= 34 {
		other := phys * 0.45
		p.Dribbling = math.Max(20, p.Dribbling-loss(other))
		p.Shooting = math.Max(20, p.Shooting-loss(other*0.8))
		p.Defending = math.Max(20, p.Defending-loss(other*0.7))
		p.Passing = math.Max(20, p.Passing-loss(other*0.4)) // vision lasts longest
		if p.Position == "GK" {
			p.Goalkeeping = math.Max(20, p.Goalkeeping-loss(other*0.8))
		}
	}
	// the ceiling comes down with the player
	if ovr := int(math.Round(OverallAs(p, p.Position))); p.Potential > ovr {
		p.Potential = max(ovr, p.Potential-int(math.Ceil(phys)))
	}
}

// Legend cards and custom players are timeless: no birthdays, no decline, no retirement, but they improve slowly.
const LegendGrowth = 0.35

func isLegend(p *Player) bool { return p.Tag == "legend" || p.Tag == "custom" }

// wantsOutAllowed: whether he can ever ask to leave or push for a move. Icons never do: they ask for a raise
// now and then like anyone, but never for games, a transfer or a walk-out (playing-time talks, a refused
// raise, a broken promise, unpaid wages).
func wantsOutAllowed(p *Player) bool { return !isLegend(p) }

// legendCost: upgrade points cost double for a legend.
func legendCost(p *Player) int {
	if isLegend(p) {
		return 2
	}
	return 1
}

func staminaAge(p *Player) float64 {
	if isLegend(p) {
		return 1
	}
	return ageStamina(p.Age)
}

// ageStamina: older legs tire faster in a match and recover slower between games.
func ageStamina(age int) float64 {
	if age <= 30 {
		return 1
	}
	return 1 + 0.03*float64(age-30)
}

// ---------------------------------------------------------------- contracts and wage demands

// Contracts: agreed weekly wages for the user's players and staff (no end date; letting
// someone go costs nothing), plus open wage demands.
type Contracts struct {
	Players map[int]int64   `json:"players"`
	Coaches map[int]int64   `json:"coaches"`
	Demands []Demand        `json:"demands"`
	Quiet   map[string]int  `json:"quiet"` // "player:12" → no new demand before this point (season*100+day)
	Plan    DemandPlan      `json:"plan"`
	Years   map[int]int     `json:"years"`            // player → seasons left on his contract (icons: none, they are permanent)
	Signed  map[int]Signing `json:"signed,omitempty"` // resale.go: the user's recent signings and what they cost
	Version int             `json:"version"`          // 3: contracts re-signed after the wage scale changed
}

// DemandPlan: how many ordinary players will ask for a raise this season.
type DemandPlan struct {
	Season int `json:"season"`
	Target int `json:"target"`
	Made   int `json:"made"`
	Senior int `json:"senior"` // well-paid players who asked this season (at most SeniorPerSeason)
}

const SeniorPerSeason = 2

const DemandCooldown = 10 // matchdays after a demand is settled before the same person asks again

func (c *Career) now() int { return c.Season*100 + c.Day }

func (c *Career) settled(d Demand) {
	if c.Contracts.Quiet == nil {
		c.Contracts.Quiet = map[string]int{}
	}
	wait := DemandCooldown
	if d.Easy {
		wait = 100 + len(Calendar)/2 // well-paid players wait about one and a half seasons
	}
	c.Contracts.Quiet[d.Kind+":"+strconv.Itoa(d.ID)] = c.now() + wait
}

func (c *Career) quiet(kind string, id int) bool {
	return c.Contracts.Quiet[kind+":"+strconv.Itoa(id)] > c.now()
}

type Demand struct {
	Kind    string `json:"kind"` // player | coach
	ID      int    `json:"id"`
	Name    string `json:"name"`
	Role    string `json:"role"`
	Current int64  `json:"current"`
	Ask     int64  `json:"ask"`
	Until   int    `json:"until"`   // matchday by which he wants an answer
	Tries   int    `json:"tries"`   // offers turned down so far
	Reason  string `json:"reason"`  // improved | star | senior | coach
	Easy    bool   `json:"easy"`    // a well-paid player after a small raise: easier to agree with
	Renewal bool   `json:"renewal"` // a contract running out: sign again or he leaves for free
}

const DemandTries = 2

func roundWage(v float64) int64 { return int64(v/1000+0.5) * 1000 }

// applyPay sets wages from the agreed contracts; anyone without one is signed at the market rate.
// Market keeps what he would be worth today.
func applyPay(c *Career, squad []*Player, coaches []*Coach) {
	if c.Contracts.Version < 3 {
		// the wage scale changed: everyone is re-signed at today's rate, open demands start over
		c.Contracts.Players = map[int]int64{}
		c.Contracts.Coaches = map[int]int64{}
		c.Contracts.Demands = nil
		c.Contracts.Version = 3
	}
	if c.Contracts.Players == nil {
		c.Contracts.Players = map[int]int64{}
	}
	if c.Contracts.Coaches == nil {
		c.Contracts.Coaches = map[int]int64{}
	}
	if c.Contracts.Years == nil {
		c.Contracts.Years = map[int]int{}
	}
	for _, p := range squad {
		if p.ClubID == nil || *p.ClubID != c.UserClubID {
			continue
		}
		p.Market = p.Wage
		applyResale(c, p)
		if w, ok := c.Contracts.Players[p.ID]; ok {
			p.Wage = w
		} else {
			c.Contracts.Players[p.ID] = p.Wage
		}
		// modern players sign for two to four seasons; icons are with you for good
		if isLegend(p) {
			delete(c.Contracts.Years, p.ID)
			p.Contract = -1
		} else {
			if _, ok := c.Contracts.Years[p.ID]; !ok {
				c.Contracts.Years[p.ID] = 2 + p.ID%3
			}
			p.Contract = c.Contracts.Years[p.ID]
		}
	}
	for _, co := range coaches {
		if co.ClubID == nil || *co.ClubID != c.UserClubID {
			continue
		}
		co.Market = co.Wage
		if w, ok := c.Contracts.Coaches[co.ID]; ok {
			co.Wage = w
		} else {
			c.Contracts.Coaches[co.ID] = co.Wage
		}
	}
}

// pruneContracts forgets people who have left.
func pruneContracts(c *Career, squad []*Player, coaches []*Coach) {
	have := map[int]bool{}
	for _, p := range squad {
		if p.ClubID != nil && *p.ClubID == c.UserClubID {
			have[p.ID] = true
		}
	}
	for id := range c.Contracts.Players {
		if !have[id] {
			delete(c.Contracts.Players, id)
		}
	}
	for id := range c.Contracts.Years {
		if !have[id] {
			delete(c.Contracts.Years, id)
		}
	}
	for id := range c.Contracts.Signed {
		if !have[id] {
			delete(c.Contracts.Signed, id)
		}
	}
	haveC := map[int]bool{}
	for _, co := range coaches {
		if co.ClubID != nil && *co.ClubID == c.UserClubID {
			haveC[co.ID] = true
		}
	}
	for id := range c.Contracts.Coaches {
		if !haveC[id] {
			delete(c.Contracts.Coaches, id)
		}
	}
	keep := c.Contracts.Demands[:0]
	for _, d := range c.Contracts.Demands {
		if (d.Kind == "player" && have[d.ID]) || (d.Kind == "coach" && haveC[d.ID]) {
			keep = append(keep, d)
		}
	}
	c.Contracts.Demands = keep
}

func (c *Career) demandFor(kind string, id int) int {
	for i, d := range c.Contracts.Demands {
		if d.Kind == kind && d.ID == id {
			return i
		}
	}
	return -1
}

// newDemands: players who have outgrown their wage, stars who know their worth, and staff
// at a club that is doing well ask for a raise. At most two are open at a time.
func (w *world) newDemands(r *rand.Rand, rep *DayReport) {
	c := w.career
	if len(c.Contracts.Demands) >= 2 || c.Day > len(Calendar) {
		return
	}
	user := w.byID[c.UserClubID]
	var mine []*Player
	for _, p := range w.players[user.ID] {
		if p.ClubID != nil && *p.ClubID == user.ID && p.Wage > 0 {
			mine = append(mine, p)
		}
	}
	if len(mine) == 0 {
		return
	}
	add := func(d Demand) {
		d.Until = c.Day + 4
		c.Contracts.Demands = append(c.Contracts.Demands, d)
		rep.Demands = append(rep.Demands, d.Name)
	}
	open := func(kind string, id int) bool { return c.demandFor(kind, id) >= 0 || c.quiet(kind, id) }

	if c.Contracts.Plan.Season != c.Season {
		c.Contracts.Plan = DemandPlan{Season: c.Season, Target: 1 + r.Intn(4)}
	}
	plan := &c.Contracts.Plan

	// the best paid fifth of the squad (and legends / custom players) are already on good money:
	// each asks for a small raise about once every one or two seasons, and is easy to talk round
	ws := make([]int64, len(mine))
	for i, p := range mine {
		ws[i] = p.Wage
	}
	sort.Slice(ws, func(a, b int) bool { return ws[a] > ws[b] })
	cut := ws[min(len(ws)-1, max(2, len(ws)/5))]
	high := func(p *Player) bool { return p.Wage >= cut || isLegend(p) }
	for _, p := range mine {
		if len(c.Contracts.Demands) >= 2 {
			return
		}
		// (a veteran already paid well above what he is worth today doesn't ask)
		overpaid := !isLegend(p) && float64(p.Market) < float64(p.Wage)*0.8
		if plan.Senior < SeniorPerSeason && high(p) && !overpaid && p.Unrest == 0 && !open("player", p.ID) && r.Float64() < 1.0/(2*float64(len(Calendar))) {
			plan.Senior++
			add(Demand{Kind: "player", ID: p.ID, Name: p.Name, Role: p.Role, Current: p.Wage,
				Ask: roundWage(float64(p.Wage) * (1.04 + r.Float64()*0.06)), Reason: "senior", Easy: true})
		}
	}

	// everyone else: one to four requests across the whole squad per season, spread over the calendar
	left := plan.Target - plan.Made
	days := len(Calendar) - c.Day + 1
	if left <= 0 || len(c.Contracts.Demands) >= 2 || r.Float64() >= float64(left)/float64(max(1, days)) {
		return
	}
	var cands []*Player
	var weights []float64
	for _, p := range mine {
		if high(p) || p.Unrest > 0 || open("player", p.ID) || p.Age > 33 || float64(p.Market) < float64(p.Wage)*0.95 {
			continue // (players already paid what they are worth have nothing to ask for)
		}
		wt := 1.0
		if float64(p.Market) >= float64(p.Wage)*1.15 {
			wt = 4 // he has outgrown his wage
		}
		cands = append(cands, p)
		weights = append(weights, wt)
	}
	// staff can be the one asking, now and then, when the team is doing well
	if (c.Streak >= 3 || user.Reputation >= 80) && r.Float64() < 0.2 {
		for _, co := range w.coaches[user.ID] {
			if co.Skill >= 10 && !open("coach", co.ID) {
				add(Demand{Kind: "coach", ID: co.ID, Name: co.Name, Role: co.Role, Current: co.Wage, Ask: roundWage(float64(co.Wage) * (1.1 + r.Float64()*0.1)), Reason: "coach"})
				plan.Made++
				return
			}
		}
	}
	if len(cands) == 0 {
		return
	}
	var tot float64
	for _, x := range weights {
		tot += x
	}
	x := r.Float64() * tot
	for i, p := range cands {
		if x -= weights[i]; x > 0 {
			continue
		}
		d := Demand{Kind: "player", ID: p.ID, Name: p.Name, Role: p.Role, Current: p.Wage}
		if float64(p.Market) >= float64(p.Wage)*1.15 {
			d.Reason = "improved"
			// a big jump comes in steps: one raise is at most +60% (he may ask again later)
			d.Ask = roundWage(math.Min(math.Max(float64(p.Market)*1.03, float64(p.Wage)*1.1), float64(p.Wage)*1.6+10_000))
		} else {
			d.Reason = "star"
			d.Ask = roundWage(float64(p.Wage) * (1.08 + r.Float64()*0.12))
		}
		add(d)
		plan.Made++
		return
	}
}

// expireDemands: an unanswered demand counts as a refusal.
func (w *world) expireDemands(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	c := w.career
	keep := []Demand{}
	for _, d := range c.Contracts.Demands {
		if c.Day < d.Until {
			keep = append(keep, d)
			continue
		}
		c.settled(d)
		if d.Renewal {
			rep.Refusals = append(rep.Refusals, d.Name+":leaving")
			continue
		}
		note, err := w.refuse(ctx, q, r, d)
		if err != nil {
			return err
		}
		if note != "" {
			rep.Refusals = append(rep.Refusals, note)
		}
	}
	c.Contracts.Demands = keep
	return nil
}

// refuse: a player sulks (and may push for a move), a coach may walk away. Returns a short note.
func (w *world) refuse(ctx context.Context, q DBTX, r *rand.Rand, d Demand) (string, error) {
	c := w.career
	user := w.byID[c.UserClubID]
	if d.Kind == "coach" {
		if r.Float64() < 0.5 {
			if _, err := q.Exec(ctx, `UPDATE coaches SET club_id=NULL WHERE id=$1 AND club_id=$2`, d.ID, user.ID); err != nil {
				return "", err
			}
			delete(c.Contracts.Coaches, d.ID)
			return d.Name + ":left", nil
		}
		return d.Name + ":stays", nil
	}
	var p *Player
	for _, x := range w.players[user.ID] {
		if x.ID == d.ID {
			p = x
		}
	}
	if p == nil {
		return "", nil
	}
	p.Morale = math.Max(0, p.Morale-25)
	if wantsOutAllowed(p) && r.Float64() < 0.3 {
		// he forces a move: the club gets 60% of his value (never an icon: he only sulks)
		var dest []*Club
		for _, cl := range w.clubs {
			if !cl.IsUser && cl.Division > 0 && len(w.players[cl.ID]) < AIMaxSquad && cl.Budget > p.Value {
				dest = append(dest, cl)
			}
		}
		if len(dest) > 0 {
			to := dest[r.Intn(len(dest))]
			fee := int64(float64(p.Value)*0.6/10_000) * 10_000
			user.Budget += fee
			to.Budget -= fee
			moveTo(p, &to.ID, w.shirtFor(ctx, q, to.ID, p))
			w.players[to.ID] = append(w.players[to.ID], p)
			delete(c.Contracts.Players, p.ID)
			if err := addFinance(ctx, q, c, "forced_sale", fee, p.Name); err != nil {
				return "", err
			}
			if err := savePlayers(ctx, q, []*Player{p}); err != nil {
				return "", err
			}
			return p.Name + ":sold:" + to.Name, nil
		}
	}
	if err := savePlayers(ctx, q, []*Player{p}); err != nil {
		return "", err
	}
	return p.Name + ":sulks", nil
}

type DemandReq struct {
	Kind   string `json:"kind"`
	ID     int    `json:"id"`
	Action string `json:"action"` // accept | offer | refuse
	Amount int64  `json:"amount"`
	Years  int    `json:"years"` // renewals: length of the new contract (1–5 seasons)
}

type DemandResult struct {
	Accepted bool    `json:"accepted"`
	Outcome  string  `json:"outcome"` // signed | countered | final | refused note
	Demand   *Demand `json:"demand,omitempty"`
}

// AnswerDemand: pay what he asks, try a lower figure, or say no.
func (s *Store) AnswerDemand(ctx context.Context, careerID int, req DemandReq) (*DemandResult, error) {
	var out *DemandResult
	err := s.tx(ctx, func(q pgx.Tx) error {
		// answers queue up (a double click must not roll the same offer twice, nor undo a matchday)
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		r := newRand()
		w, err := loadWorld(ctx, q, r, careerID)
		if err != nil {
			return err
		}
		c := w.career
		i := c.demandFor(req.Kind, req.ID)
		if i < 0 {
			return userErr("no_demand", "There is no open wage demand")
		}
		d := c.Contracts.Demands[i]
		drop := func() {
			c.settled(d)
			c.Contracts.Demands = append(c.Contracts.Demands[:i], c.Contracts.Demands[i+1:]...)
		}
		sign := func(wage int64) {
			if d.Kind == "player" {
				c.Contracts.Players[d.ID] = wage
				if d.Renewal {
					n := max(1, min(5, req.Years))
					if req.Years == 0 {
						n = 3
					}
					// the new deal runs n seasons after this one: Years counts the current season too
					// (expireContracts takes one off when the next season starts), so a one-season
					// renewal in his last year must not see him leave at the season change
					c.Contracts.Years[d.ID] = n + 1
				}
			} else {
				c.Contracts.Coaches[d.ID] = wage
			}
			drop()
			out = &DemandResult{Accepted: true, Outcome: "signed"}
		}
		switch req.Action {
		case "accept":
			sign(d.Ask)
			if d.Kind == "player" {
				for _, p := range w.players[c.UserClubID] {
					if p.ID == d.ID {
						p.Morale = math.Min(100, p.Morale+5)
						if err := savePlayers(ctx, q, []*Player{p}); err != nil {
							return err
						}
					}
				}
			}
		case "offer":
			if d.Tries >= DemandTries {
				return userErr("demand_final", "He will not negotiate any further")
			}
			if req.Amount >= d.Ask {
				sign(d.Ask)
				break
			}
			floor := offerFloor(d)
			if req.Amount <= floor {
				return userErr("bad_offer", "Offer more than his current wage")
			}
			share := float64(req.Amount-floor) / float64(d.Ask-floor)
			chance := 0.1 + 0.85*math.Pow(share, 1.4) - 0.1*float64(d.Tries)
			if w.perks(c.UserClubID)["negotiator"] {
				chance += 0.08
			}
			if d.Easy {
				chance = 0.4 + 0.6*math.Pow(share, 1.1) - 0.05*float64(d.Tries)
			}
			if r.Float64() < chance {
				sign(req.Amount)
				break
			}
			// turned down: he comes down a little, and patience runs out
			d.Tries++
			d.Ask = roundWage(float64(d.Ask) - float64(d.Ask-req.Amount)*0.25)
			c.Contracts.Demands[i] = d
			out = &DemandResult{Outcome: "countered", Demand: &d}
			if d.Tries >= DemandTries {
				out.Outcome = "final"
			}
		case "refuse":
			if d.Renewal { // no hard feelings: he simply leaves when the contract runs out
				drop()
				out = &DemandResult{Outcome: d.Name + ":leaving"}
				break
			}
			drop()
			note, err := w.refuse(ctx, q, r, d)
			if err != nil {
				return err
			}
			out = &DemandResult{Outcome: note}
		default:
			return userErr("bad_action", "Unknown answer")
		}
		if err := saveClub(ctx, q, w.byID[c.UserClubID]); err != nil {
			return err
		}
		return saveCareer(ctx, q, c)
	})
	return out, err
}

// offerFloor: the lowest offer worth making. Usually his current wage; a veteran who already
// accepts a pay cut can be pushed further, down to 70% of what he asks.
func offerFloor(d Demand) int64 {
	if d.Ask < d.Current {
		return roundWage(float64(d.Ask) * 0.7)
	}
	return d.Current
}

// sortDemands keeps the most urgent first.
func sortDemands(ds []Demand) {
	sort.SliceStable(ds, func(i, j int) bool { return ds[i].Until < ds[j].Until })
}

// ---------------------------------------------------------------- contract renewals

// renewalDemands: from the middle of the season, players in the last year of their contract ask
// for a new one (they want at least the market rate). The answer is due by the end of the season.
func (w *world) renewalDemands(rep *DayReport) {
	c := w.career
	if c.Day < 28 || c.Day > len(Calendar) {
		return
	}
	for _, p := range w.players[c.UserClubID] {
		if p.ClubID == nil || *p.ClubID != c.UserClubID || isLegend(p) || c.Contracts.Years[p.ID] != 1 {
			continue
		}
		if c.demandFor("player", p.ID) >= 0 || c.Contracts.Quiet["renew:"+strconv.Itoa(p.ID)] == c.Season {
			continue
		}
		w.openRenewal(p)
		rep.Demands = append(rep.Demands, p.Name)
		return // one a day is plenty
	}
}

func (w *world) openRenewal(p *Player) {
	c := w.career
	if c.Contracts.Quiet == nil {
		c.Contracts.Quiet = map[string]int{}
	}
	c.Contracts.Quiet["renew:"+strconv.Itoa(p.ID)] = c.Season
	// a new deal follows what he is worth today: a player past his best takes a cut (never more
	// than a fifth), a rising one asks for the market rate, at most double his old wage in one go
	ask := float64(p.Market) * 1.05
	if p.Market < p.Wage {
		ask = math.Max(float64(p.Market)*1.1, float64(p.Wage)*0.8)
	}
	ask = math.Min(ask, float64(p.Wage)*2+20_000)
	c.Contracts.Demands = append(c.Contracts.Demands, Demand{Kind: "player", ID: p.ID, Name: p.Name, Role: p.Role,
		Current: p.Wage, Ask: roundWage(ask), Until: len(Calendar), Reason: "renewal", Renewal: true})
}

// SquadFloor: when contracts run out at the season change, the academy promotes youngsters until
// the squad has at least this many players. Ignoring renewals costs you players, but it never
// leaves a club unable to field a team.
const SquadFloor = 16

func (w *world) academyTopUp(ctx context.Context, q DBTX, r *rand.Rand) ([]string, error) {
	c := w.career
	user := w.byID[c.UserClubID]
	if user == nil {
		return nil, nil
	}
	squad, err := queryPlayers(ctx, q, `career_id=$1 AND club_id=$2 AND NOT retired`, c.ID, user.ID)
	if err != nil || len(squad) >= SquadFloor {
		return nil, err
	}
	have := map[string]int{}
	for _, p := range squad {
		have[p.Position]++
	}
	// two keepers, five defenders, five midfielders and three forwards first
	need := func() string {
		for _, x := range []struct {
			pos string
			min int
		}{{"GK", 2}, {"DF", 5}, {"MF", 5}, {"FW", 3}} {
			if have[x.pos] < x.min {
				return x.pos
			}
		}
		return []string{"DF", "MF", "MF", "FW"}[r.Intn(4)]
	}
	base := divisionLevel(user.League, user.Division)
	lvl := max(1, user.Academy)
	var names []string
	for len(squad)+len(names) < SquadFloor {
		pos := need()
		have[pos]++
		p := GenPlayer(r, nationsOf(user.League), pos, base-6+r.Float64()*4, 17, 19)
		p.Potential = int(math.Min(95, float64(p.Potential)+float64(4+lvl*2)))
		_, shirt, err := nextShirt(ctx, q, user.ID, p)
		if err != nil {
			return nil, err
		}
		moveTo(p, &user.ID, shirt)
		p.Fill()
		if err := insertPlayer(ctx, q, c.ID, p); err != nil {
			return nil, err
		}
		w.players[user.ID] = append(w.players[user.ID], p)
		names = append(names, p.Name)
	}
	return names, nil
}

// RenewEarly opens contract talks with a player before he asks.
func (s *Store) RenewEarly(ctx context.Context, careerID, playerID int) error {
	return s.tx(ctx, func(q pgx.Tx) error {
		w, err := loadWorld(ctx, q, newRand(), careerID)
		if err != nil {
			return err
		}
		c := w.career
		var p *Player
		for _, x := range w.players[c.UserClubID] {
			if x.ID == playerID {
				p = x
			}
		}
		if p == nil {
			return userErr("not_yours", "This player is not at your club")
		}
		if isLegend(p) {
			return userErr("permanent", "Icons are signed for good")
		}
		if c.demandFor("player", p.ID) >= 0 {
			return userErr("demand_open", "Talks with him are already open")
		}
		w.openRenewal(p)
		c.Contracts.Demands[len(c.Contracts.Demands)-1].Until = max(c.Day+4, len(Calendar))
		return saveCareer(ctx, q, c)
	})
}

// expireContracts runs at the start of a new season: a year comes off every contract and those
// that ran out leave for nothing, to a club that wants them.
func (w *world) expireContracts(ctx context.Context, q DBTX, r *rand.Rand) ([]string, error) {
	c := w.career
	var gone []string
	// fresh rows: ageing and retirement have just been written
	squad, err := queryPlayers(ctx, q, `career_id=$1 AND club_id=$2 AND NOT retired`, c.ID, c.UserClubID)
	if err != nil {
		return nil, err
	}
	for _, p := range squad {
		if isLegend(p) {
			continue
		}
		y, ok := c.Contracts.Years[p.ID]
		if !ok {
			continue
		}
		y--
		if y > 0 {
			c.Contracts.Years[p.ID] = y
			continue
		}
		var dest []*Club
		for _, cl := range w.clubs {
			if !cl.IsUser && cl.Division > 0 && len(w.players[cl.ID]) < AIMaxSquad {
				dest = append(dest, cl)
			}
		}
		if len(dest) == 0 {
			c.Contracts.Years[p.ID] = 1
			continue
		}
		to := dest[r.Intn(len(dest))]
		moveTo(p, &to.ID, w.shirtFor(ctx, q, to.ID, p))
		delete(c.Contracts.Years, p.ID)
		delete(c.Contracts.Players, p.ID)
		gone = append(gone, p.Name+" → "+to.Name)
		if err := savePlayers(ctx, q, []*Player{p}); err != nil {
			return nil, err
		}
	}
	return gone, nil
}
