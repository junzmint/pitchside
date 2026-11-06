package game

import (
	"context"
	"math"
	"math/rand"
	"sort"
	"time"
)

// ---------------------------------------------------------------- Deadline Day
//
// The last day of each transfer window (world_ai.go): matchday 29 for the winter window, and the
// first day of a season for the summer one. Clubs make late bids for your players (they land in
// the events stream's bid list: accept, reject or ask for more), one or two clubs in trouble sell
// a good player cheaply for today only, and the computer's clubs do last-minute deals.

type DeadlineState struct {
	Season   int        `json:"season"`
	Day      int        `json:"day"`
	Window   string     `json:"window"` // summer | winter
	Bargains []Bargain  `json:"bargains"`
	Bids     []int      `json:"bids"`  // ids of the last-minute bids (EventState.Bids)
	Deals    []NewsItem `json:"deals"` // the computer's last-minute transfers
}

// Bargain: a panic sale, today only.
type Bargain struct {
	PlayerID  int    `json:"playerId"`
	Name      string `json:"name"`
	Position  string `json:"position"`
	Role      string `json:"role"`
	Overall   int    `json:"overall"`
	Potential int    `json:"potential"`
	Age       int    `json:"age"`
	Nation    string `json:"nation"`
	ClubID    int    `json:"clubId"`
	Club      string `json:"club"`
	Short     string `json:"short"`
	Color     string `json:"color"`
	Color2    string `json:"color2"`
	Full      int64  `json:"full"`   // his usual price
	Price     int64  `json:"price"`  // today only
	Reason    string `json:"reason"` // debt | rebuild | wages
	Sold      bool   `json:"sold"`
	Signed    bool   `json:"signed,omitempty"` // the user bought him (Sold alone may mean he went elsewhere)
}

func (life *ClubLife) deadlineActive(c *Career) bool {
	d := life.Deadline
	return d != nil && d.Season == c.Season && d.Day == c.Day && c.Day <= len(Calendar)
}

// bargainHeld: a Deadline Day bargain stays at the club until the next transfer window (when this
// deadline's list is replaced): no releasing, selling or swapping a panic sale on for a quick profit.
func (life *ClubLife) bargainHeld(pid int) bool {
	if life == nil || life.Deadline == nil {
		return false
	}
	for _, b := range life.Deadline.Bargains {
		if b.PlayerID == pid && b.Signed {
			return true
		}
	}
	return false
}

// errBargainHeld: the answer when someone tries to move a held bargain on.
var errBargainHeld = userErr("bargain_held", "He signed as a Deadline Day bargain: he stays until the next transfer window")

// checkBargainHeld is bargainHeld for requests that don't load the world (release, deals).
func checkBargainHeld(ctx context.Context, q DBTX, careerID int, pids ...int) error {
	life, err := loadClubLife(ctx, q, careerID)
	if err != nil {
		return err
	}
	for _, id := range pids {
		if life.bargainHeld(id) {
			return errBargainHeld
		}
	}
	return nil
}

// deadlineTick: the winter window's last day opens; the day after, the window has shut.
func (w *world) deadlineTick(ctx context.Context, q DBTX, r *rand.Rand, life *ClubLife, rep *DayReport) error {
	c := w.career
	if d := life.Deadline; d != nil && d.Season == c.Season && d.Day == rep.Day {
		sold := 0
		for _, b := range d.Bargains {
			if b.Sold {
				sold++
			}
		}
		rep.Happenings = append(rep.Happenings, ComEvent{Key: "deadline_closed", Name: itoa(sold), Amount: int64(len(d.Deals))})
	}
	if c.Day != winterWindowTo || c.Day > len(Calendar) || life.deadlineActive(c) {
		return nil
	}
	news, err := w.openDeadline(ctx, q, r, life, "winter", w.players, rep)
	if err != nil {
		return err
	}
	for _, n := range news {
		if n.Big {
			rep.World = append(rep.World, n)
		}
	}
	return nil
}

// openDeadline sets up the day: late bids, panic sales and the computer's last-minute deals.
// squads must be current (StartNextSeason reads them fresh). rep is nil in the summer.
func (w *world) openDeadline(ctx context.Context, q DBTX, r *rand.Rand, life *ClubLife, window string, squads map[int][]*Player, rep *DayReport) ([]NewsItem, error) {
	c := w.career
	user := w.byID[c.UserClubID]
	mine := w.mineOnly(squads[user.ID])
	d := &DeadlineState{Season: c.Season, Day: c.Day, Window: window, Bargains: []Bargain{}, Bids: []int{}}
	d.Bids = w.deadlineBids(r, mine, squads)
	d.Bargains = w.panicSales(r, mine, squads)
	keep := map[int]bool{}
	for _, b := range d.Bargains {
		keep[b.PlayerID] = true // on sale to you today: nobody else gets him first
	}
	deals, err := w.deadlineDeals(ctx, q, r, squads, 2+r.Intn(3), keep)
	if err != nil {
		return nil, err
	}
	d.Deals = deals
	if d.Deals == nil {
		d.Deals = []NewsItem{}
	}
	life.Deadline = d
	ev := ComEvent{Key: "deadline_" + window, Name: itoa(len(d.Bargains)), Amount: int64(len(d.Bids))}
	if rep != nil {
		rep.Happenings = append(rep.Happenings, ev)
	}
	w.logHappening(ev)
	return deals, nil
}

// deadlineBids: one or two clubs make a late offer for your players (a little above value).
func (w *world) deadlineBids(r *rand.Rand, mine []*Player, squads map[int][]*Player) []int {
	c := w.career
	es := &c.Events
	es.init()
	user := w.byID[c.UserClubID]
	n := 1 + r.Intn(2)
	switch {
	case len(mine) <= MinSquad:
		return []int{}
	case len(mine) <= MinSquad+3:
		n = 1
	}
	borrowed := map[int]bool{}
	for _, l := range es.LoansIn {
		borrowed[l.PlayerID] = true
	}
	// clubs don't come for a player you have only just signed
	recent := func(p *Player) bool {
		j, ok := w.life.Joined[p.ID]
		return ok && c.now()-j < 100 // within the last season
	}
	var cands []*Player
	for _, p := range mine {
		if !borrowed[p.ID] && !es.bidFor(p.ID) && p.Overall >= 55 && p.Tag != "custom" && !recent(p) {
			cands = append(cands, p)
		}
	}
	ids := []int{}
	for len(ids) < n && len(cands) > 0 {
		var tot float64
		for _, p := range cands {
			tot += math.Sqrt(float64(p.Value))
		}
		x, k := r.Float64()*tot, len(cands)-1
		for i, p := range cands {
			if x -= math.Sqrt(float64(p.Value)); x <= 0 {
				k = i
				break
			}
		}
		p := cands[k]
		cands = append(cands[:k], cands[k+1:]...)
		fee := roundK(float64(resalePrice(c, p)) * (1.0 + r.Float64()*0.35) * (1 + managerPerks(es.Level).BidBonus))
		var clubs []*Club
		for _, cl := range w.clubs {
			if !cl.IsUser && cl.Division > 0 && isCompLeague(cl.League) && len(squads[cl.ID]) < AIMaxSquad && cl.Budget >= fee &&
				cl.Reputation >= user.Reputation-15 {
				clubs = append(clubs, cl)
			}
		}
		if len(clubs) == 0 {
			continue
		}
		cl := clubs[r.Intn(len(clubs))]
		b := Bid{ID: es.nextID(), PlayerID: p.ID, Name: p.Name, Role: p.Role, Overall: p.Overall, Value: p.Value, ClubID: cl.ID,
			Club: cl.Name, Fee: fee, Until: c.Day, Listed: es.Listed[p.ID] > c.now()}
		es.Bids = append(es.Bids, b)
		ids = append(ids, b.ID)
	}
	return ids
}

// panicSales: one or two good players from clubs in a hurry, at 50–70% of their usual price.
func (w *world) panicSales(r *rand.Rand, mine []*Player, squads map[int][]*Player) []Bargain {
	c := w.career
	user := w.byID[c.UserClubID]
	var ovr []int
	for _, id := range BestLineup(mine, user.Formation) {
		for _, p := range mine {
			if p.ID == id {
				ovr = append(ovr, p.Overall)
			}
		}
	}
	xi := topOverall(ovr, 11)
	if xi == 0 {
		xi = 60
	}
	skip := onLoan(c)
	type cand struct {
		p     *Player
		cl    *Club
		price int64
		full  int64
		score float64
	}
	var cands []cand
	for _, cl := range w.clubs {
		if cl.IsUser || cl.Division == 0 || !isCompLeague(cl.League) || len(squads[cl.ID]) <= AIMinSquad+1 {
			continue
		}
		for _, p := range squads[cl.ID] {
			if p.ClubID == nil || *p.ClubID != cl.ID || p.Age > 31 || p.Age < 18 || isLegend(p) || p.Injury > 0 || skip[p.ID] {
				continue
			}
			ov := float64(p.Overall)
			if ov < xi-3 || ov > xi+5 {
				continue
			}
			full := askingPrice(p, c.Season)
			if full < p.Value {
				full = p.Value
			}
			price := roundK(float64(full) * (0.5 + r.Float64()*0.2))
			score := ov - xi + r.Float64()*5
			if cl.Budget < 5*M {
				score += 3 // a club short of money is the one that sells in a panic
			}
			cands = append(cands, cand{p, cl, price, full, score})
		}
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].score > cands[j].score })
	n := 1
	if r.Float64() < 0.6 {
		n = 2
	}
	var out []Bargain
	used := map[int]bool{}
	take := func(x cand) {
		reason := []string{"rebuild", "wages", "rebuild"}[r.Intn(3)]
		if x.cl.Budget < 3*M {
			reason = "debt"
		}
		out = append(out, Bargain{PlayerID: x.p.ID, Name: x.p.Name, Position: x.p.Position, Role: x.p.Role, Overall: x.p.Overall,
			Potential: x.p.Potential, Age: x.p.Age, Nation: x.p.Nation, ClubID: x.cl.ID, Club: x.cl.Name, Short: x.cl.Short,
			Color: x.cl.Color, Color2: x.cl.Color2, Full: x.full, Price: x.price, Reason: reason})
		used[x.cl.ID] = true
	}
	// affordable first; a club short of money still sees one bargain to sell for
	for _, x := range cands {
		if len(out) < n && !used[x.cl.ID] && x.price <= max(user.Budget, 0) {
			take(x)
		}
	}
	if len(out) == 0 {
		sort.SliceStable(cands, func(i, j int) bool { return cands[i].price < cands[j].price })
		for _, x := range cands[:min(len(cands), 30)] {
			if !used[x.cl.ID] {
				take(x)
				break
			}
		}
	}
	if out == nil {
		out = []Bargain{}
	}
	return out
}

// deadlineDeals: the computer's clubs do a few last-minute deals, paying over the odds.
func (w *world) deadlineDeals(ctx context.Context, q DBTX, r *rand.Rand, squads map[int][]*Player, n int, keep map[int]bool) ([]NewsItem, error) {
	c := w.career
	user := w.byID[c.UserClubID]
	skip := onLoan(c)
	var buyers []*Club
	for _, cl := range w.clubs {
		if !cl.IsUser && cl.Division > 0 && isCompLeague(cl.League) && cl.Budget > 4*M {
			buyers = append(buyers, cl)
		}
	}
	if len(buyers) == 0 {
		return nil, nil
	}
	var out []NewsItem
	moved := map[int]bool{}
	for tries := 0; len(out) < n && tries < n*10; tries++ {
		buyer := buyers[r.Intn(len(buyers))]
		if tries%2 == 0 && buyer.League != user.League { // the deals people talk about: the user's league
			for _, b := range buyers {
				if b.League == user.League && r.Intn(3) == 0 {
					buyer = b
					break
				}
			}
		}
		if len(squads[buyer.ID]) >= AIMaxSquad {
			continue
		}
		var ovr []int
		for _, p := range squads[buyer.ID] {
			ovr = append(ovr, p.Overall)
		}
		floor := topOverall(ovr, 11)
		pos := []string{"GK", "DF", "DF", "MF", "MF", "FW", "FW"}[r.Intn(7)]
		var best *Player
		var from *Club
		var fee int64
		for _, cl := range w.clubs {
			if cl.ID == buyer.ID || cl.IsUser || cl.Division == 0 || !isCompLeague(cl.League) || len(squads[cl.ID]) <= AIMinSquad+1 ||
				cl.Reputation > buyer.Reputation+6 {
				continue
			}
			for _, p := range squads[cl.ID] {
				if p.Position != pos || p.Age > 31 || isLegend(p) || p.Injury > 0 || skip[p.ID] || moved[p.ID] || keep[p.ID] ||
					p.ClubID == nil || *p.ClubID != cl.ID || float64(p.Overall) < floor-1 || float64(p.Overall) > floor+10 {
					continue
				}
				f := roundK(float64(askingPrice(p, c.Season)) * (1.15 + r.Float64()*0.35)) // deadline premium
				if f <= 0 || f > buyer.Budget*7/10 {
					continue
				}
				if best == nil || p.Overall > best.Overall || (p.Overall == best.Overall && r.Intn(2) == 0) {
					best, from, fee = p, cl, f
				}
			}
		}
		if best == nil {
			continue
		}
		moveTo(best, &buyer.ID, pickShirt(squads[buyer.ID], w.retiredOf(ctx, q, buyer.ID), best))
		keep := squads[from.ID][:0]
		for _, x := range squads[from.ID] {
			if x.ID != best.ID {
				keep = append(keep, x)
			}
		}
		squads[from.ID] = keep
		squads[buyer.ID] = append(squads[buyer.ID], best)
		moved[best.ID] = true
		from.Budget += fee
		buyer.Budget -= fee
		if err := savePlayers(ctx, q, []*Player{best}); err != nil {
			return out, err
		}
		if err := saveClub(ctx, q, from); err != nil {
			return out, err
		}
		if err := saveClub(ctx, q, buyer); err != nil {
			return out, err
		}
		ovr2 := int(math.Round(OverallAs(best, best.Position)))
		item := NewsItem{Season: c.Season, Day: c.Day, Kind: "transfer", Player: best.Name, PlayerID: best.ID, Ovr: ovr2, Age: best.Age,
			From: from.Name, FromID: from.ID, To: buyer.Name, ToID: buyer.ID, Fee: fee, At: time.Now(),
			Big: fee >= 20*M || ovr2 >= 82 || from.League == user.League || buyer.League == user.League}
		if err := insertNews(ctx, q, c.ID, &item); err != nil {
			return out, err
		}
		out = append(out, item)
	}
	return out, nil
}

// buyBargain: a panic sale goes through at the price on the tag.
func (w *world) buyBargain(ctx context.Context, q DBTX, life *ClubLife, pid int) (*Player, int64, error) {
	c := w.career
	user := w.byID[c.UserClubID]
	if !life.deadlineActive(c) {
		return nil, 0, userErr("deadline_over", "The transfer window has closed")
	}
	var b *Bargain
	for i := range life.Deadline.Bargains {
		if x := &life.Deadline.Bargains[i]; x.PlayerID == pid && !x.Sold {
			b = x
		}
	}
	if b == nil {
		return nil, 0, userErr("bargain_gone", "This bargain has gone")
	}
	from := w.byID[b.ClubID]
	var p *Player
	for _, x := range w.players[b.ClubID] {
		if x.ID == pid && x.ClubID != nil && *x.ClubID == b.ClubID {
			p = x
		}
	}
	if p == nil || from == nil {
		b.Sold = true
		return nil, 0, userErr("bargain_gone", "This bargain has gone")
	}
	squad := w.userSquad()
	if len(squad) >= MaxSquad {
		return nil, 0, userErr("squad_full", "Your squad is full")
	}
	if user.Budget < b.Price {
		return nil, 0, userErr("no_budget", "Not enough budget")
	}
	user.Budget -= b.Price
	from.Budget += b.Price
	from.Deals++
	moveTo(p, &user.ID, pickShirt(squad, life.retiredSet(), p))
	keep := w.players[from.ID][:0]
	for _, x := range w.players[from.ID] {
		if x.ID != p.ID {
			keep = append(keep, x)
		}
	}
	w.players[from.ID] = keep
	w.players[user.ID] = append(w.players[user.ID], p)
	b.Sold, b.Signed = true, true
	if err := savePlayers(ctx, q, []*Player{p}); err != nil {
		return nil, 0, err
	}
	if err := saveClub(ctx, q, from); err != nil {
		return nil, 0, err
	}
	if err := addFinance(ctx, q, c, "transfer_in", -b.Price, p.Name); err != nil {
		return nil, 0, err
	}
	noteSigning(c, p, b.Price) // resale.go
	if err := questSignedYoung(ctx, q, c.ID, p.Age); err != nil {
		return nil, 0, err
	}
	applyPay(c, w.players[user.ID], w.coaches[user.ID])
	w.logHappening(ComEvent{Key: "bargain_signed", Name: p.Name + " (" + from.Name + ")", Amount: b.Price})
	// legend_versions.go: the club owns a legend version of him: he merges into it (the card reveal shows the legend)
	if m, err := w.arrivalMerge(ctx, q, nil, p); err != nil {
		return nil, 0, err
	} else if m != nil {
		p = m.Legend
	}
	return p, b.Price, nil
}

// ---------------------------------------------------------------- view

type DeadlineView struct {
	Window    string     `json:"window"`
	Day       int        `json:"day"`
	Active    bool       `json:"active"`
	Bargains  []Bargain  `json:"bargains"`
	Bids      []Bid      `json:"bids"` // the last-minute bids still open
	Deals     []NewsItem `json:"deals"`
	SquadFull bool       `json:"squadFull"`
	Next      int        `json:"next"` // the next deadline day (0: none this season)
}

func deadlineView(c *Career, user *Club, squad []*Player, life *ClubLife) *DeadlineView {
	next := 0
	if c.Day < winterWindowTo {
		next = winterWindowTo
	}
	if !life.deadlineActive(c) {
		if next == 0 {
			return nil
		}
		return &DeadlineView{Next: next, Bargains: []Bargain{}, Bids: []Bid{}, Deals: []NewsItem{}}
	}
	d := life.Deadline
	v := &DeadlineView{Window: d.Window, Day: d.Day, Active: true, Bargains: d.Bargains, Bids: []Bid{}, Deals: d.Deals,
		SquadFull: len(squad) >= MaxSquad, Next: next}
	ids := map[int]bool{}
	for _, id := range d.Bids {
		ids[id] = true
	}
	for _, b := range c.Events.Bids {
		if ids[b.ID] {
			v.Bids = append(v.Bids, b)
		}
	}
	if v.Bargains == nil {
		v.Bargains = []Bargain{}
	}
	if v.Deals == nil {
		v.Deals = []NewsItem{}
	}
	return v
}
