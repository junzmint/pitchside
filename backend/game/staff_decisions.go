package game

import (
	"math"
	"sort"
	"strconv"
	"time"
)

// ---------------------------------------------------------------- staff decision cards
//
// Things the staff bring to you. Each card lists its choices with their effects (StaffFx), so the
// Staff page can show exactly what a choice does, and the same list is applied when you pick it.
// A card you leave unanswered settles itself with its default after a few days (the head coach or
// the board decides), and every open card closes with its default when the season ends.
//
//	renew     his contract ends this season: sign him for 1–3 more, or let him go (default: 2 more)
//	retire    an old coach wants to stop at the end of the season: thank him, or pay him to stay a year
//	poach     another club wants him: take the fee, counter with a raise (a gamble), or refuse
//	clash     the head coach and an assistant disagree (training load, a youngster, the tactics)
//	camp      a coach proposes a camp or a clinic: money for a short boost
//	signing   the head coach wants a player in his weakest position: promise one (12 days), or not
//	prospect  a coach wants minutes for a prospect: promise him 2 of the next 4 games, or not
//	famous    a big-name coach is out of work and interested: hire him now, or he signs elsewhere

// StaffFx: one effect of a choice.
//
//	morale (coach ID, V) · pmorale (player ID, V) · squad (V: every player's morale) · fitness (V: every fit player)
//	growth (V %, Days; Pos or player ID, else everyone) · money (V, Str: finance kind) · wage (coach ID, V per week)
//	years (coach ID, V seasons after this one) · addyear (coach ID, V) · letgo · retire · stay (coach ID)
//	leave (coach ID, To club, Str club name) · tactic (Str mentality) · promise (V morale at stake, Days)
//	hire (coach ID, V price) · replace (Name: the coach who makes way)
type StaffFx struct {
	K    string  `json:"k"`
	ID   int     `json:"id,omitempty"`
	Name string  `json:"name,omitempty"`
	V    float64 `json:"v,omitempty"`
	Pos  string  `json:"pos,omitempty"`
	Days int     `json:"days,omitempty"`
	To   int     `json:"to,omitempty"`
	Str  string  `json:"str,omitempty"`
}

// StaffChoice: one answer. With a Chance (%), Fx happens on success and Fail otherwise.
type StaffChoice struct {
	Key    string    `json:"key"`
	Fx     []StaffFx `json:"fx"`
	Chance int       `json:"chance,omitempty"`
	Fail   []StaffFx `json:"fail,omitempty"`
}

type StaffClubTag struct {
	ID     int    `json:"id"`
	Name   string `json:"name"`
	Short  string `json:"short"`
	Color  string `json:"color"`
	Color2 string `json:"color2"`
	Rep    int    `json:"rep"`
}

func clubTag(cl *Club) *StaffClubTag {
	return &StaffClubTag{ID: cl.ID, Name: cl.Name, Short: cl.Short, Color: cl.Color, Color2: cl.Color2, Rep: cl.Reputation}
}

// StaffDecision: a card waiting on the Staff page.
type StaffDecision struct {
	ID        int            `json:"id"`
	Kind      string         `json:"kind"`
	Topic     string         `json:"topic,omitempty"`
	CoachID   int            `json:"coachId"`
	Coach     string         `json:"coach"`
	Role      string         `json:"role"`
	OtherID   int            `json:"otherId,omitempty"`
	Other     string         `json:"other,omitempty"`
	OtherRole string         `json:"otherRole,omitempty"`
	PlayerID  int            `json:"playerId,omitempty"`
	Player    string         `json:"player,omitempty"`
	Club      *StaffClubTag  `json:"club,omitempty"`
	Amount    int64          `json:"amount,omitempty"` // renew: the wage he asks · poach: the fee · camp: the cost · famous: his price
	Wage      int64          `json:"wage,omitempty"`   // his wage now
	Value     string         `json:"value,omitempty"`  // clash tactics: the mentality wanted · signing: the position · famous: his style
	Nums      map[string]int `json:"nums,omitempty"`   // numbers for the card text (age, potential, goals…)
	Choices   []StaffChoice  `json:"choices"`
	Default   string         `json:"default"`
	Until     int            `json:"until"` // tick
	Left      int            `json:"left"`  // days left (filled in for the page)
}

// StaffResult: what an answer led to (for the toast).
type StaffResult struct {
	Outcome string `json:"outcome"`
	Name    string `json:"name,omitempty"`
	Other   string `json:"other,omitempty"`
	Amount  int64  `json:"amount,omitempty"`
	Chance  int    `json:"chance,omitempty"`
	Success *bool  `json:"success,omitempty"` // a gamble: did it work
}

func (st *StaffState) open(d *StaffDecision) {
	st.NextID++
	d.ID = st.NextID
	st.Decisions = append(st.Decisions, *d)
}

// openRandom: cards that are not contract business.
func (st *StaffState) openRandom() int {
	n := 0
	for _, d := range st.Decisions {
		if d.Kind != "renew" && d.Kind != "retire" {
			n++
		}
	}
	return n
}

func (st *StaffState) hasCard(kind string, coachID int) bool {
	for _, d := range st.Decisions {
		if d.Kind == kind && d.CoachID == coachID {
			return true
		}
	}
	return false
}

func (st *StaffState) busyPlayer(pid int) bool {
	for _, d := range st.Decisions {
		if d.PlayerID == pid {
			return true
		}
	}
	for _, pr := range st.Promises {
		if pr.PlayerID == pid {
			return true
		}
	}
	return false
}

// how long until the same kind of card can come again (matchdays)
var staffCooldown = map[string]int{"poach": 15, "clash": 10, "camp": 12, "signing": 20, "prospect": 10, "famous": 54}

// newDecisions: contract talks first, then now and then one new card (about seven a season).
func (sr *staffRun) newDecisions() error {
	st := sr.st
	day := sr.rep.Day
	if d := sr.renewalCard(day); d != nil {
		st.open(d)
	}
	if d := sr.retireCard(day); d != nil {
		st.open(d)
	}
	if st.openRandom() >= StaffMaxOpen || st.Tick < st.Cool["any"] || day < 3 || day > len(Calendar)-2 {
		return nil
	}
	type gen struct {
		kind   string
		chance float64
		make   func() (*StaffDecision, error)
	}
	gens := []gen{
		{"poach", 1.0 / 45, sr.poachCard},
		{"clash", 1.0 / 22, sr.clashCard},
		{"camp", 1.0 / 28, sr.campCard},
		{"signing", 1.0 / 50, sr.signingCard},
		{"prospect", 1.0 / 26, sr.prospectCard},
		{"famous", 1.0 / 35, sr.famousCard},
	}
	sr.r.Shuffle(len(gens), func(i, j int) { gens[i], gens[j] = gens[j], gens[i] })
	for _, g := range gens {
		if st.Tick < st.Cool[g.kind] || sr.r.Float64() >= g.chance*sr.kindWeight(g.kind) {
			continue
		}
		d, err := g.make()
		if err != nil {
			return err
		}
		if d == nil {
			continue
		}
		st.open(d)
		st.Cool["any"] = st.Tick + 3
		st.Cool[g.kind] = st.Tick + staffCooldown[g.kind]
		return nil
	}
	return nil
}

// kindWeight: fiery coaches start more rows; ambition, low morale and a winning side draw suitors.
func (sr *staffRun) kindWeight(kind string) float64 {
	w, st := sr.w, sr.st
	uid := w.career.UserClubID
	m := 1.0
	for _, co := range w.coaches[uid] {
		l := st.People[co.ID]
		if l == nil || staffMedical(co.Role) {
			continue
		}
		switch kind {
		case "clash":
			if l.Trait == "fiery" {
				m += 0.5
			} else if l.Trait == "calm" {
				m -= 0.2
			}
		case "poach":
			if l.Trait == "ambitious" {
				m += 0.25
			}
			if l.Morale < 45 {
				m += 0.25
			}
		}
	}
	if kind == "poach" {
		if pos := w.leaguePos(uid); pos > 0 && pos <= 4 {
			m += 0.5
		}
	}
	return math.Max(0.3, m)
}

func (sr *staffRun) wageOf(co *Coach) int64 {
	if l := sr.st.People[co.ID]; l != nil && l.Wage > 0 {
		return l.Wage
	}
	return co.Wage
}

// ---------------------------------------------------------------- contract business

// renewalAsk: what he wants for a new contract — at least today's market rate for his skill and
// never less than he earns now. Ambition and a poor mood push it up; loyalty and a good mood take
// a little off the rise.
func renewalAsk(cur int64, base int, l *CoachLife) int64 {
	ask := math.Max(float64(cur), float64(base)*10_000)
	switch l.Trait {
	case "loyal":
		ask *= 0.97
	case "ambitious":
		ask *= 1.1
	}
	switch {
	case l.Morale < 40:
		ask *= 1.08
	case l.Morale >= StaffHappy:
		ask *= 0.97
	}
	return max(1000, roundWage(math.Max(ask, float64(cur)))) // (a new deal never pays less than the old one)
}

// renewalCard: from matchday 30, a coach in the last season of his contract asks for a new one.
func (sr *staffRun) renewalCard(day int) *StaffDecision {
	w, st := sr.w, sr.st
	c := w.career
	if day < 30 || day >= len(Calendar) {
		return nil
	}
	for _, co := range w.coaches[c.UserClubID] {
		l := st.People[co.ID]
		if l == nil || l.Years != 1 || l.Leaving || l.Retiring || l.Asked == c.Season || st.hasCard("renew", co.ID) {
			continue
		}
		l.Asked = c.Season
		cur := sr.wageOf(co)
		ask := renewalAsk(cur, st.baseSkill(co), l)
		d := &StaffDecision{Kind: "renew", CoachID: co.ID, Coach: co.Name, Role: co.Role, Amount: ask, Wage: cur,
			Until: st.Tick + max(1, min(8, len(Calendar)-day)), Default: "renew2"}
		for _, n := range []int{1, 2, 3} {
			fx := []StaffFx{{K: "years", ID: co.ID, V: float64(n)}, {K: "morale", ID: co.ID, Name: co.Name, V: moraleV(l, 4)}}
			if ask != cur {
				fx = append([]StaffFx{{K: "wage", ID: co.ID, V: float64(ask)}}, fx...)
			}
			d.Choices = append(d.Choices, StaffChoice{Key: "renew" + strconv.Itoa(n), Fx: fx})
		}
		d.Choices = append(d.Choices, StaffChoice{Key: "letgo", Fx: []StaffFx{{K: "letgo", ID: co.ID, Name: co.Name}}})
		return d
	}
	return nil
}

// retireCard: once a season (somewhere between matchdays 26 and 45) a coach of 64 or more may
// decide it is time; the older he is, the likelier.
func (sr *staffRun) retireCard(day int) *StaffDecision {
	w, st := sr.w, sr.st
	c := w.career
	for _, co := range w.coaches[c.UserClubID] {
		l := st.People[co.ID]
		// (never in the season he joined: nobody signs on only to stop at once)
		if l == nil || l.Age < RetireAge || l.Retiring || l.Seasons == 0 || l.RetireAsk == c.Season || day != 26+staffHash(co.ID, 5)%20 {
			continue
		}
		l.RetireAsk = c.Season
		if !l.Stayed && sr.r.Float64() >= 0.25+0.2*float64(l.Age-RetireAge) {
			continue
		}
		d := &StaffDecision{Kind: "retire", CoachID: co.ID, Coach: co.Name, Role: co.Role, Nums: map[string]int{"age": l.Age, "seasons": l.Seasons},
			Until: st.Tick + 5, Default: "farewell"}
		d.Choices = []StaffChoice{{Key: "farewell", Fx: []StaffFx{{K: "retire", ID: co.ID, Name: co.Name}}}}
		if !l.Stayed {
			cost := roundK(float64(sr.wageOf(co)) * 8)
			d.Amount = cost
			d.Choices = append(d.Choices, StaffChoice{Key: "persuade", Fx: []StaffFx{{K: "money", V: -float64(cost), Str: "staff_bonus"},
				{K: "stay", ID: co.ID, Name: co.Name}, {K: "morale", ID: co.ID, Name: co.Name, V: moraleV(l, 6)}}})
		}
		return d
	}
	return nil
}

// ---------------------------------------------------------------- the other cards

// poachFee: what a club pays to take a coach out of his contract (more years left, more money;
// never more than he would cost to hire).
func poachFee(skill, years int) int64 {
	return roundK(float64(skill*skill*60_000) * math.Min(1, 0.5+0.2*float64(max(1, years))))
}

func (sr *staffRun) poachCard() (*StaffDecision, error) {
	w, st := sr.w, sr.st
	c := w.career
	user := w.byID[c.UserClubID]
	type cand struct {
		co *Coach
		l  *CoachLife
		wt float64
	}
	var cs []cand
	tot := 0.0
	for _, co := range w.coaches[user.ID] {
		l := st.People[co.ID]
		base := st.baseSkill(co)
		if l == nil || staffMedical(co.Role) || base < 10 || l.Retiring || l.Leaving || st.Tick-l.Joined < 8 || st.hasCard("poach", co.ID) {
			continue
		}
		wt := float64(base) / 10
		switch l.Trait {
		case "ambitious":
			wt *= 2
		case "loyal":
			wt *= 0.4
		}
		if l.Morale < 50 {
			wt *= 1.5
		}
		cs = append(cs, cand{co, l, wt})
		tot += wt
	}
	if len(cs) == 0 {
		return nil, nil
	}
	x := sr.r.Float64() * tot
	pick := cs[len(cs)-1]
	for _, cd := range cs {
		if x -= cd.wt; x <= 0 {
			pick = cd
			break
		}
	}
	co, l := pick.co, pick.l
	base := st.baseSkill(co)
	fee := poachFee(base, l.Years)
	var suitors []*Club
	for _, cl := range w.clubs {
		if cl.IsUser || cl.Division == 0 || cl.Reputation < user.Reputation-4 || cl.Budget < fee*2 {
			continue
		}
		if coachSkill(w.coaches[cl.ID], co.Role) >= base {
			continue
		}
		suitors = append(suitors, cl)
	}
	if len(suitors) == 0 {
		return nil, nil
	}
	sort.Slice(suitors, func(i, j int) bool { return suitors[i].Reputation > suitors[j].Reputation })
	to := suitors[sr.r.Intn(min(5, len(suitors)))]
	stay := 55 + int(l.Morale-60)
	switch l.Trait {
	case "loyal":
		stay += 15
	case "ambitious":
		stay -= 15
	}
	stay = max(15, min(90, stay))
	wage := sr.wageOf(co)
	raise := roundWage(float64(wage) * 1.25)
	gone := []StaffFx{{K: "money", V: float64(fee), Str: "staff_sold"}, {K: "leave", ID: co.ID, Name: co.Name, To: to.ID, Str: to.Name}}
	d := &StaffDecision{Kind: "poach", CoachID: co.ID, Coach: co.Name, Role: co.Role, Club: clubTag(to), Amount: fee, Wage: wage,
		Until: st.Tick + 4, Default: "refuse"}
	d.Choices = []StaffChoice{
		{Key: "release", Fx: gone},
		{Key: "counter", Chance: stay, Fx: []StaffFx{{K: "wage", ID: co.ID, V: float64(raise)}, {K: "addyear", ID: co.ID, V: 1},
			{K: "morale", ID: co.ID, Name: co.Name, V: moraleV(l, 6)}}, Fail: gone},
		{Key: "refuse", Fx: []StaffFx{{K: "morale", ID: co.ID, Name: co.Name, V: moraleV(l, -12)}}},
	}
	return d, nil
}

// clashCard: the head coach and an assistant disagree. Siding with one pleases him and stings the other.
func (sr *staffRun) clashCard() (*StaffDecision, error) {
	w := sr.w
	head := headCoachOf(w.coaches[w.career.UserClubID])
	if head == nil {
		return nil, nil
	}
	topics := []string{"intensity", "youngster", "tactics"}
	sr.r.Shuffle(len(topics), func(i, j int) { topics[i], topics[j] = topics[j], topics[i] })
	for _, tp := range topics {
		if sr.st.Tick < sr.st.Cool["clash:"+tp] {
			continue // (the same row does not come straight back)
		}
		if d := sr.clashOn(tp, head); d != nil {
			sr.st.Cool["clash:"+tp] = sr.st.Tick + 25
			return d, nil
		}
	}
	return nil, nil
}

func (sr *staffRun) clashOn(topic string, head *Coach) *StaffDecision {
	w, st := sr.w, sr.st
	c := w.career
	user := w.byID[c.UserClubID]
	card := func(as *Coach) *StaffDecision {
		return &StaffDecision{Kind: "clash", Topic: topic, CoachID: as.ID, Coach: as.Name, Role: as.Role, OtherID: head.ID, Other: head.Name,
			OtherRole: "head", Until: st.Tick + 4, Default: "head"}
	}
	mo := func(co *Coach, v float64) StaffFx {
		return StaffFx{K: "morale", ID: co.ID, Name: co.Name, V: moraleV(st.People[co.ID], v)}
	}
	switch topic {
	case "intensity":
		fit := coachOfRole(w.coaches[user.ID], "fitness")
		if fit == nil {
			return nil
		}
		d := card(fit)
		d.Choices = []StaffChoice{
			{Key: "assistant", Fx: []StaffFx{{K: "fitness", V: 10}, mo(fit, 8), mo(head, -8)}},
			{Key: "head", Fx: []StaffFx{{K: "growth", V: 12, Days: 6}, {K: "fitness", V: -6}, mo(head, 8), mo(fit, -8)}},
		}
		return d
	case "youngster":
		p := sr.prospect(6, 2)
		if p == nil {
			return nil
		}
		as := areaCoach(w.coaches[user.ID], p.Position)
		if as == nil {
			return nil
		}
		d := card(as)
		d.PlayerID, d.Player = p.ID, p.Name
		d.Nums = map[string]int{"age": p.Age, "ovr": p.Overall, "pot": p.Potential}
		st.Cool[playerCool(p.ID)] = st.Tick + 20
		d.Choices = []StaffChoice{
			{Key: "assistant", Fx: []StaffFx{{K: "growth", ID: p.ID, Name: p.Name, V: 15, Days: 10}, {K: "pmorale", ID: p.ID, Name: p.Name, V: 8}, mo(as, 8), mo(head, -6)}},
			{Key: "head", Fx: []StaffFx{mo(head, 6), mo(as, -8), {K: "pmorale", ID: p.ID, Name: p.Name, V: -5}}},
		}
		return d
	case "tactics":
		gf, ga, n := sr.recentGoals(5)
		if n < 4 {
			return nil
		}
		steps := []string{"defensive", "balanced", "attacking"}
		at := map[string]int{"defensive": 0, "balanced": 1, "attacking": 2}[user.Tactic.Mentality]
		var as *Coach
		want, num := "", 0
		switch {
		case gf <= 4 && at < 2:
			as, want, num = coachOfRole(w.coaches[user.ID], "attack"), steps[at+1], gf
		case ga >= 9 && at > 0:
			as, want, num = coachOfRole(w.coaches[user.ID], "defense"), steps[at-1], ga
		}
		if as == nil {
			return nil
		}
		d := card(as)
		d.Value = want
		d.Nums = map[string]int{"n": num, "games": n}
		d.Choices = []StaffChoice{
			{Key: "assistant", Fx: []StaffFx{{K: "tactic", Str: want}, mo(as, 8), mo(head, -8)}},
			{Key: "head", Fx: []StaffFx{mo(head, 6), mo(as, -8)}},
		}
		return d
	}
	return nil
}

// recentGoals: goals for and against in the user's last n competitive games this season.
func (sr *staffRun) recentGoals(n int) (gf, ga, played int) {
	w := sr.w
	uid := w.career.UserClubID
	var fs []*Fixture
	for _, f := range w.fixtures {
		if f.Played && f.Comp != "friendly" && (f.HomeID == uid || f.AwayID == uid) && f.HomeGoals != nil && f.AwayGoals != nil {
			fs = append(fs, f)
		}
	}
	sort.Slice(fs, func(i, j int) bool { return fs[i].Day > fs[j].Day })
	for i := 0; i < len(fs) && i < n; i++ {
		h, a := *fs[i].HomeGoals, *fs[i].AwayGoals
		if fs[i].AwayID == uid {
			h, a = a, h
		}
		gf, ga, played = gf+h, ga+a, played+1
	}
	return gf, ga, played
}

// playerCool: the cooldown key that keeps the same youngster from being the subject of card after card.
func playerCool(id int) string { return "p:" + strconv.Itoa(id) }

// prospect: a young player with room to grow who is not getting games.
func (sr *staffRun) prospect(gap, benched int) *Player {
	w := sr.w
	c := w.career
	es := &c.Events
	user := w.byID[c.UserClubID]
	inXI := map[int]bool{}
	for _, id := range user.Lineup {
		inXI[id] = true
	}
	var best *Player
	bestV := 0.0
	for _, p := range w.userSquad() {
		if isLegend(p) || p.Age > 21 || p.Injury > 0 || inXI[p.ID] || w.isLoanee(p.ID) || es.Bench[p.ID] < benched {
			continue
		}
		g := float64(p.Potential - p.Overall)
		if g < float64(gap) || es.talkFor(p.ID) >= 0 || sr.st.busyPlayer(p.ID) || sr.st.Tick < sr.st.Cool[playerCool(p.ID)] {
			continue
		}
		promised := false
		for _, pr := range es.Promises {
			promised = promised || pr.PlayerID == p.ID
		}
		if promised {
			continue
		}
		if v := g + float64(es.Bench[p.ID]) + float64(p.Potential)/10; v > bestV {
			best, bestV = p, v
		}
	}
	return best
}

// campCost: a few days away costs a little more than a week of the staff's wages.
func (sr *staffRun) campCost(f float64) int64 {
	var wages int64
	for _, co := range sr.w.coaches[sr.w.career.UserClubID] {
		wages += sr.wageOf(co)
	}
	return roundK(math.Max(200_000, float64(wages)*1.2) * f)
}

func (sr *staffRun) campCard() (*StaffDecision, error) {
	w, st := sr.w, sr.st
	user := w.byID[w.career.UserClubID]
	var cs []*Coach
	for _, co := range w.coaches[user.ID] {
		if staffCoaching(co.Role) && !st.hasCard("camp", co.ID) {
			cs = append(cs, co)
		}
	}
	if len(cs) == 0 {
		return nil, nil
	}
	co := cs[sr.r.Intn(len(cs))]
	l := st.People[co.ID]
	var topic string
	var cost int64
	var fx []StaffFx
	switch co.Role {
	case "head":
		topic, cost = "camp", sr.campCost(1)
		fx = []StaffFx{{K: "growth", V: 12, Days: 8}, {K: "fitness", V: -6}, {K: "squad", V: 4}}
	case "fitness":
		topic, cost = "retreat", sr.campCost(0.6)
		fx = []StaffFx{{K: "fitness", V: 12}, {K: "squad", V: 3}}
	case "attack":
		topic, cost = "finishing", sr.campCost(0.8)
		fx = []StaffFx{{K: "growth", V: 25, Days: 8, Pos: "MF,FW"}}
	case "defense":
		topic, cost = "defending", sr.campCost(0.7)
		fx = []StaffFx{{K: "growth", V: 25, Days: 8, Pos: "DF"}}
	default:
		topic, cost = "keepers", sr.campCost(0.4)
		fx = []StaffFx{{K: "growth", V: 35, Days: 8, Pos: "GK"}}
	}
	if user.Budget < cost*2 {
		return nil, nil
	}
	book := append([]StaffFx{{K: "money", V: -float64(cost), Str: "staff_camp"}}, fx...)
	book = append(book, StaffFx{K: "morale", ID: co.ID, Name: co.Name, V: moraleV(l, 4)})
	d := &StaffDecision{Kind: "camp", Topic: topic, CoachID: co.ID, Coach: co.Name, Role: co.Role, Amount: cost, Until: st.Tick + 4, Default: "skip"}
	d.Choices = []StaffChoice{
		{Key: "book", Fx: book},
		{Key: "skip", Fx: []StaffFx{{K: "morale", ID: co.ID, Name: co.Name, V: moraleV(l, -3)}}},
	}
	return d, nil
}

// signingCard: the head coach wants a player for his weakest position.
func (sr *staffRun) signingCard() (*StaffDecision, error) {
	w, st := sr.w, sr.st
	user := w.byID[w.career.UserClubID]
	head := headCoachOf(w.coaches[user.ID])
	if head == nil || st.hasCard("signing", head.ID) {
		return nil, nil
	}
	for _, pr := range st.Promises {
		if pr.Kind == "signing" {
			return nil, nil
		}
	}
	squad := w.userSquad()
	byPos := map[string][]int{}
	var all []int
	for _, p := range squad {
		byPos[p.Position] = append(byPos[p.Position], p.Overall)
		all = append(all, p.Overall)
	}
	team := topOverall(all, 11)
	need := map[string]int{"GK": 1, "DF": 4, "MF": 3, "FW": 2}
	pos, worst, gap := "", 0.0, 2.5
	for _, k := range []string{"GK", "DF", "MF", "FW"} {
		ovr := append([]int{}, byPos[k]...)
		for len(ovr) < need[k] {
			ovr = append(ovr, 45) // an empty place counts as a poor player
		}
		avg := topOverall(ovr, need[k])
		if team-avg > gap {
			pos, worst, gap = k, avg, team-avg
		}
	}
	if pos == "" {
		return nil, nil
	}
	hl := st.People[head.ID]
	d := &StaffDecision{Kind: "signing", CoachID: head.ID, Coach: head.Name, Role: "head", Value: pos,
		Nums: map[string]int{"avg": int(math.Round(worst)), "team": int(math.Round(team)), "days": 12}, Until: st.Tick + 4, Default: "refuse"}
	d.Choices = []StaffChoice{
		{Key: "promise", Fx: []StaffFx{{K: "promise", V: 10, Days: 12, Pos: pos}, {K: "morale", ID: head.ID, Name: head.Name, V: moraleV(hl, 4)}}},
		{Key: "refuse", Fx: []StaffFx{{K: "morale", ID: head.ID, Name: head.Name, V: moraleV(hl, -5)}}},
	}
	return d, nil
}

// prospectCard: a coach asks you to give a benched prospect some games (players grow by playing).
func (sr *staffRun) prospectCard() (*StaffDecision, error) {
	w, st := sr.w, sr.st
	user := w.byID[w.career.UserClubID]
	p := sr.prospect(8, 3)
	if p == nil {
		return nil, nil
	}
	co := areaCoach(w.coaches[user.ID], p.Position)
	if co == nil {
		co = headCoachOf(w.coaches[user.ID])
	}
	if co == nil {
		return nil, nil
	}
	l := st.People[co.ID]
	st.Cool[playerCool(p.ID)] = st.Tick + 20
	d := &StaffDecision{Kind: "prospect", CoachID: co.ID, Coach: co.Name, Role: co.Role, PlayerID: p.ID, Player: p.Name,
		Nums:  map[string]int{"age": p.Age, "ovr": p.Overall, "pot": p.Potential, "bench": w.career.Events.Bench[p.ID], "need": 2, "of": 4},
		Until: st.Tick + 4, Default: "later"}
	d.Choices = []StaffChoice{
		{Key: "promise", Fx: []StaffFx{{K: "promise", ID: p.ID, Name: p.Name, V: 8, Days: 4}, {K: "morale", ID: co.ID, Name: co.Name, V: moraleV(l, 3)}}},
		{Key: "later", Fx: []StaffFx{{K: "morale", ID: co.ID, Name: co.Name, V: moraleV(l, -3)}}},
	}
	return d, nil
}

// famousCard: a big name between jobs (one of the famous free coaches) fancies your club.
func (sr *staffRun) famousCard() (*StaffDecision, error) {
	w, st := sr.w, sr.st
	c := w.career
	user := w.byID[c.UserClubID]
	if user.Reputation < 55 {
		return nil, nil
	}
	head := headCoachOf(w.coaches[user.ID])
	headSkill := 0
	if head != nil {
		headSkill = st.baseSkill(head)
	}
	names := make([]string, 0, len(FreeCoaches))
	for _, fc := range FreeCoaches {
		names = append(names, fc.Name)
	}
	free, err := queryCoaches(sr.ctx, sr.q, `career_id=$1 AND club_id IS NULL AND role='head' AND name = ANY($2) ORDER BY skill DESC`, c.ID, names)
	if err != nil {
		return nil, err
	}
	var fc *Coach
	for _, x := range free {
		if x.Skill >= headSkill+2 && x.Price <= user.Budget {
			fc = x
			break
		}
	}
	if fc == nil {
		return nil, nil
	}
	d := &StaffDecision{Kind: "famous", CoachID: fc.ID, Coach: fc.Name, Role: "head", Amount: fc.Price, Wage: fc.Wage, Value: styleFor(fc),
		Nums: map[string]int{"skill": fc.Skill}, Until: st.Tick + 4, Default: "pass"}
	hire := []StaffFx{{K: "hire", ID: fc.ID, Name: fc.Name, V: float64(fc.Price)}}
	if head != nil {
		d.OtherID, d.Other, d.OtherRole = head.ID, head.Name, "head"
		hire = append(hire, StaffFx{K: "replace", ID: head.ID, Name: head.Name})
	}
	d.Choices = []StaffChoice{{Key: "hire", Fx: hire}, {Key: "pass", Fx: []StaffFx{}}}
	return d, nil
}

// ---------------------------------------------------------------- answers

// resolve: carry out a choice (auto: the card ran out of time and settles with its default).
func (sr *staffRun) resolve(d *StaffDecision, key string, auto bool) (*StaffResult, error) {
	var ch *StaffChoice
	for i := range d.Choices {
		if d.Choices[i].Key == key {
			ch = &d.Choices[i]
		}
	}
	if ch == nil {
		return nil, userErr("bad_choice", "Unknown choice")
	}
	fx, ok := ch.Fx, true
	res := &StaffResult{Outcome: d.Kind + "_" + key, Name: d.Coach, Other: d.Other}
	if d.Kind == "clash" && key == "head" {
		res.Name, res.Other = d.Other, d.Coach
	}
	if ch.Chance > 0 {
		ok = sr.r.Intn(100) < ch.Chance
		res.Chance, res.Success = ch.Chance, &ok
		if !ok {
			fx = ch.Fail
		}
	}
	if err := sr.apply(d, fx, res); err != nil {
		return nil, err
	}
	if d.Kind == "famous" && key == "pass" {
		if err := sr.famousElsewhere(d); err != nil {
			return nil, err
		}
	}
	if !auto && d.Kind == "renew" && key != "letgo" {
		sr.say("staff_renewed", d.Coach, 0)
	}
	if auto {
		switch {
		case d.Kind == "renew":
			sr.say("staff_board_renew", d.Coach, 0)
		case d.Kind == "clash":
			sr.say("staff_timeout_clash", d.Other, 0)
		case d.Kind != "famous":
			sr.say("staff_timeout_"+d.Kind, d.Coach, 0)
		}
	}
	return res, nil
}

func (sr *staffRun) apply(d *StaffDecision, fx []StaffFx, res *StaffResult) error {
	w, st := sr.w, sr.st
	c := w.career
	user := w.byID[c.UserClubID]
	// money first: a choice you cannot afford changes nothing
	for _, x := range fx {
		if x.K == "money" && x.V < 0 && user.Budget < int64(-x.V) {
			return userErr("no_budget", "Not enough budget")
		}
		if x.K == "hire" && user.Budget < int64(x.V) {
			return userErr("no_budget", "Not enough budget")
		}
	}
	for _, x := range fx {
		l := st.People[x.ID]
		switch x.K {
		case "morale":
			sr.moraleRaw(l, x.V)
		case "pmorale":
			if p := w.mine(x.ID); p != nil {
				p.Morale = clamp(p.Morale+x.V, 20, 100)
				sr.touch(p)
			}
		case "squad":
			for _, p := range w.userSquad() {
				p.Morale = clamp(p.Morale+x.V, 20, 100)
				sr.touch(p)
			}
		case "fitness":
			for _, p := range w.userSquad() {
				if p.Injury == 0 {
					p.Fitness = clamp(p.Fitness+x.V, 25, 100)
					sr.touch(p)
				}
			}
		case "growth":
			key := d.Kind
			if d.Topic != "" {
				key += ":" + d.Topic
			}
			st.Boosts = append(st.Boosts, StaffBoost{Key: key, Pos: x.Pos, PlayerID: x.ID, V: x.V / 100, Until: st.Tick + x.Days})
		case "money":
			amt := int64(x.V)
			user.Budget += amt
			res.Amount += amt
			if err := addFinance(sr.ctx, sr.q, c, x.Str, amt, d.Coach); err != nil {
				return err
			}
		case "wage":
			wage := int64(x.V)
			if c.Contracts.Coaches == nil {
				c.Contracts.Coaches = map[int]int64{}
			}
			c.Contracts.Coaches[x.ID] = wage
			if l != nil {
				l.Wage = wage
			}
			if co := coachByID(w.coaches[user.ID], x.ID); co != nil {
				co.Wage = wage
			}
		case "years":
			if l != nil {
				l.Years, l.Leaving = 1+int(x.V), false
			}
		case "addyear":
			if l != nil {
				l.Years = min(StaffMaxYears, l.Years+int(x.V))
			}
		case "letgo":
			if l != nil {
				l.Leaving = true
			}
		case "retire":
			if l != nil {
				l.Retiring = true
				sr.dropCard("renew", x.ID)
			}
		case "stay":
			if l != nil {
				l.Retiring, l.Stayed = false, true
				l.Years = max(l.Years, 2)
			}
		case "leave":
			co := coachByID(w.coaches[user.ID], x.ID)
			if co == nil {
				continue
			}
			if x.To > 0 {
				if cl := w.byID[x.To]; cl != nil {
					cl.Budget -= d.Amount
					sr.clubs[cl.ID] = cl
				}
			}
			if err := sr.leave(co, x.To, false); err != nil {
				return err
			}
			sr.say("staff_poached_gone", co.Name+" → "+x.Str, d.Amount)
		case "tactic":
			user.Tactic.Mentality = x.Str
			user.Tactic.Normalize()
		case "promise":
			st.Promises = append(st.Promises, sr.promiseFrom(d, x))
		case "hire":
			if err := sr.hireByID(x.ID, 2); err != nil {
				return err
			}
			res.Amount -= int64(x.V)
			sr.say("staff_hired", x.Name, 0)
		}
	}
	return nil
}

func (sr *staffRun) dropCard(kind string, coachID int) {
	st := sr.st
	keep := st.Decisions[:0]
	for _, d := range st.Decisions {
		if d.Kind != kind || d.CoachID != coachID {
			keep = append(keep, d)
		}
	}
	st.Decisions = keep
}

func (sr *staffRun) promiseFrom(d *StaffDecision, x StaffFx) StaffPromise {
	st := sr.st
	if d.Kind == "signing" {
		var ids []int
		for _, p := range sr.w.userSquad() {
			ids = append(ids, p.ID)
		}
		return StaffPromise{Kind: "signing", CoachID: d.CoachID, Coach: d.Coach, Pos: x.Pos, MinOvr: d.Nums["avg"], Squad: ids, Until: st.Tick + x.Days}
	}
	return StaffPromise{Kind: "minutes", CoachID: d.CoachID, Coach: d.Coach, PlayerID: d.PlayerID, Player: d.Player,
		Need: d.Nums["need"], Left: d.Nums["of"], Until: st.Tick + 14}
}

func (sr *staffRun) hireByID(id, years int) error {
	cs, err := queryCoaches(sr.ctx, sr.q, `career_id=$1 AND id=$2`, sr.w.career.ID, id)
	if err != nil {
		return err
	}
	if len(cs) == 0 {
		return userErr("coach_taken", "This coach already has a job")
	}
	return sr.hire(cs[0], years)
}

// famousElsewhere: the big name you passed on takes a job at a top club, whose coach makes way.
func (sr *staffRun) famousElsewhere(d *StaffDecision) error {
	w := sr.w
	c := w.career
	user := w.byID[c.UserClubID]
	cs, err := queryCoaches(sr.ctx, sr.q, `career_id=$1 AND id=$2 AND club_id IS NULL`, c.ID, d.CoachID)
	if err != nil || len(cs) == 0 {
		return err
	}
	fc := cs[0]
	var cands []*Club
	for _, cl := range w.clubs {
		if !cl.IsUser && cl.Division == 1 && cl.Reputation >= 70 && coachSkill(w.coaches[cl.ID], "head") < fc.Skill {
			cands = append(cands, cl)
		}
	}
	if len(cands) == 0 {
		return nil
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].Reputation > cands[j].Reputation })
	to := cands[sr.r.Intn(min(6, len(cands)))]
	old := headCoachOf(w.coaches[to.ID])
	if _, err := sr.q.Exec(sr.ctx, `UPDATE coaches SET club_id=NULL WHERE club_id=$1 AND role='head'`, to.ID); err != nil {
		return err
	}
	if _, err := sr.q.Exec(sr.ctx, `UPDATE coaches SET club_id=$1 WHERE id=$2`, to.ID, fc.ID); err != nil {
		return err
	}
	kept := w.coaches[to.ID][:0]
	for _, x := range w.coaches[to.ID] {
		if x.Role != "head" {
			kept = append(kept, x)
		}
	}
	dest := to.ID
	fc.ClubID = &dest
	w.coaches[to.ID] = append(kept, fc)
	day := min(c.Day, len(Calendar))
	if sr.rep != nil {
		day = min(sr.rep.Day, len(Calendar))
	}
	n := NewsItem{Season: c.Season, Day: day, Kind: "sacked", To: fc.Name, From: to.Name, FromID: to.ID, At: time.Now(), Big: to.League == user.League}
	if old != nil {
		n.Coach = old.Name
	}
	if err := insertNews(sr.ctx, sr.q, c.ID, &n); err != nil {
		return err
	}
	if sr.rep != nil && n.Big {
		sr.rep.World = append(sr.rep.World, n)
	}
	sr.say("staff_famous_gone", fc.Name+" → "+to.Name, 0)
	return nil
}
