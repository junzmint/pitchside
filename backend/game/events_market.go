package game

import (
	"context"
	"math"
	"math/rand"
	"sort"
	"strconv"
)

// ---------------------------------------------------------------- bids from AI clubs

const (
	BidDays      = 3     // matchdays a bid stays open
	BidChance    = 0.025 // per matchday, for an unsolicited bid (about one or two a season)
	CounterRaise = 1.2   // a counter-offer asks for 20% more
	CounterOdds  = 0.45  // base chance the club accepts the counter
	LoanWindow   = 45    // loans can be arranged up to this matchday
	MaxLoansOut  = 5
	MaxLoansIn   = 4
	LoanInShare  = 0.12 // loan fee for borrowing a player, as a share of his value
	LoanOutShare = 0.03 // what a club pays you for borrowing yours
)

type Bid struct {
	ID       int    `json:"id"`
	PlayerID int    `json:"playerId"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Overall  int    `json:"overall"`
	Value    int64  `json:"value"`
	ClubID   int    `json:"clubId"`
	Club     string `json:"club"`
	Fee      int64  `json:"fee"`
	Until    int    `json:"until"`
	Listed   bool   `json:"listed"` // he asked to leave / was put up for sale
}

func (es *EventState) bidFor(pid int) bool {
	for _, b := range es.Bids {
		if b.PlayerID == pid {
			return true
		}
	}
	return false
}

func (w *world) bidsTick(r *rand.Rand, rep *DayReport) {
	c := w.career
	es := &c.Events
	keep := es.Bids[:0]
	for _, b := range es.Bids {
		if c.Day <= b.Until {
			keep = append(keep, b)
		} else {
			w.happen(rep, "bid_expired", b.Name+" ("+b.Club+")", 0)
		}
	}
	es.Bids = keep
	if len(es.Bids) >= 2 || c.Day > len(Calendar) {
		return
	}
	squad := w.userSquad()
	if len(squad) <= MinSquad {
		return
	}
	// a listed player draws interest quickly; otherwise clubs come knocking now and then
	var target *Player
	for _, p := range squad {
		if es.Listed[p.ID] > c.now() && !es.bidFor(p.ID) && !w.life.bargainHeld(p.ID) && r.Float64() < 0.6 {
			target = p
			break
		}
	}
	listed := target != nil
	if target == nil {
		if r.Float64() > BidChance {
			return
		}
		var tot float64
		var cands []*Player
		for _, p := range squad {
			// (club_deadline.go: nobody bids for a Deadline Day bargain before the next window)
			if !w.isLoanee(p.ID) && !es.bidFor(p.ID) && p.Overall >= 55 && p.Tag != "custom" && !w.life.bargainHeld(p.ID) {
				cands = append(cands, p)
				tot += math.Sqrt(float64(p.Value))
			}
		}
		x := r.Float64() * tot
		for _, p := range cands {
			if x -= math.Sqrt(float64(p.Value)); x <= 0 {
				target = p
				break
			}
		}
	}
	if target == nil {
		return
	}
	user := w.byID[c.UserClubID]
	mul := (0.85 + r.Float64()*0.45) * (1 + managerPerks(es.Level).BidBonus)
	if listed {
		mul *= 0.9 // everyone knows he is for sale
	}
	fee := roundK(float64(resalePrice(c, target)) * mul) // resale.go: no instant profit on a recent signing
	var clubs []*Club
	for _, cl := range w.clubs {
		if !cl.IsUser && cl.Division > 0 && isCompLeague(cl.League) && len(w.players[cl.ID]) < AIMaxSquad && cl.Budget >= fee &&
			cl.Reputation >= user.Reputation-15 {
			clubs = append(clubs, cl)
		}
	}
	if len(clubs) == 0 {
		return
	}
	cl := clubs[r.Intn(len(clubs))]
	es.Bids = append(es.Bids, Bid{ID: es.nextID(), PlayerID: target.ID, Name: target.Name, Role: target.Role, Overall: target.Overall,
		Value: target.Value, ClubID: cl.ID, Club: cl.Name, Fee: fee, Until: c.Day + BidDays, Listed: listed})
	w.happen(rep, "bid_new", target.Name+" ("+cl.Name+")", fee)
}

// sellTo moves one of the user's players to an AI club for a fee.
func (w *world) sellTo(ctx context.Context, q DBTX, p *Player, to *Club, fee int64, kind string) error {
	c := w.career
	user := w.byID[c.UserClubID]
	if len(w.userSquad()) <= MinSquad {
		return userErr("squad_min", "You need at least 14 players")
	}
	if w.clubLife(ctx, q).bargainHeld(p.ID) { // club_deadline.go: no flipping a Deadline Day bargain
		return errBargainHeld
	}
	user.Budget += fee
	to.Budget -= fee
	moveTo(p, &to.ID, w.shirtFor(ctx, q, to.ID, p))
	w.players[to.ID] = append(w.players[to.ID], p)
	delete(c.Contracts.Players, p.ID)
	delete(c.Contracts.Years, p.ID)
	if err := savePlayers(ctx, q, []*Player{p}); err != nil {
		return err
	}
	if err := saveClub(ctx, q, to); err != nil {
		return err
	}
	w.tidyEvents()
	return addFinance(ctx, q, c, kind, fee, p.Name)
}

// answerBid: accept, reject or ask for 20% more (they may walk away).
func (w *world) answerBid(ctx context.Context, q DBTX, r *rand.Rand, id int, choice string) (string, int64, error) {
	c := w.career
	es := &c.Events
	idx := -1
	for i, b := range es.Bids {
		if b.ID == id {
			idx = i
		}
	}
	if idx < 0 {
		return "", 0, userErr("no_bid", "This bid has gone")
	}
	b := es.Bids[idx]
	es.Bids = append(es.Bids[:idx], es.Bids[idx+1:]...)
	p := w.mine(b.PlayerID)
	to := w.byID[b.ClubID]
	if p == nil || to == nil {
		return "", 0, userErr("no_bid", "This bid has gone")
	}
	switch choice {
	case "accept":
		if err := w.sellTo(ctx, q, p, to, b.Fee, "transfer_out"); err != nil {
			return "", 0, err
		}
		w.logHappening(ComEvent{Key: "bid_sold", Name: p.Name + " (" + to.Name + ")", Amount: b.Fee})
		return "sold", b.Fee, nil
	case "reject":
		if b.Listed {
			p.Morale = clamp(p.Morale-4, 20, 100)
		} else {
			p.Morale = clamp(p.Morale+2, 20, 100) // he feels wanted
		}
		return "rejected", 0, nil
	case "counter":
		fee := roundK(float64(b.Fee) * CounterRaise)
		odds := CounterOdds + managerPerks(es.Level).CounterBonus
		if b.Listed {
			odds -= 0.1
		}
		if to.Budget >= fee && r.Float64() < odds {
			if err := w.sellTo(ctx, q, p, to, fee, "transfer_out"); err != nil {
				return "", 0, err
			}
			w.logHappening(ComEvent{Key: "bid_sold", Name: p.Name + " (" + to.Name + ")", Amount: fee})
			return "sold", fee, nil
		}
		w.logHappening(ComEvent{Key: "bid_walked", Name: p.Name + " (" + to.Name + ")"})
		return "walked", 0, nil
	}
	return "", 0, userErr("bad_choice", "Unknown answer")
}

// ---------------------------------------------------------------- loans

// LoanDeal: a player out on loan (or borrowed); he goes back when the season ends.
type LoanDeal struct {
	ID       int    `json:"id"`
	PlayerID int    `json:"playerId"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Overall  int    `json:"overall"`
	ClubID   int    `json:"clubId"` // the other club (borrower for loans out, owner for loans in)
	Club     string `json:"club"`
	Season   int    `json:"season"`
	Fee      int64  `json:"fee"`
	Wage     int64  `json:"wage"`   // loans out: his contract, restored on return
	Years    int    `json:"years"`  // loans out: seasons left, restored on return
	Tenure   int    `json:"tenure"` // matches for the club before he left
	Shirt    int    `json:"shirt,omitempty"` // his number at home, given back on return if it is still free
	AppsAt   int    `json:"appsAt"` // loans out: season appearances when he left
	Apps     int    `json:"apps"`   // loans out: appearances for the borrower (refreshed in the view)
}

func (w *world) seasonApps(ctx context.Context, q DBTX, pid int) int {
	var n int
	_ = q.QueryRow(ctx, `SELECT COALESCE(sum(apps),0) FROM player_stats WHERE career_id=$1 AND player_id=$2 AND season=$3`,
		w.career.ID, pid, w.career.Season).Scan(&n)
	return n
}

// avgXI: the average overall of a club's first eleven.
func (w *world) avgXI(cl *Club) float64 {
	ids := map[int]bool{}
	for _, id := range cl.Lineup {
		ids[id] = true
	}
	var s float64
	n := 0
	for _, p := range w.players[cl.ID] {
		if ids[p.ID] {
			s += float64(p.Overall)
			n++
		}
	}
	if n == 0 {
		return 60
	}
	return s / float64(n)
}

// loanOut sends one of your players to a club in your country where he should play.
func (w *world) loanOut(ctx context.Context, q DBTX, r *rand.Rand, pid int) (*LoanDeal, error) {
	c := w.career
	es := &c.Events
	user := w.byID[c.UserClubID]
	if c.Day > LoanWindow {
		return nil, userErr("loan_closed", "The loan window is closed until next season")
	}
	if len(es.LoansOut) >= MaxLoansOut {
		return nil, userErr("loan_limit", "Too many players out on loan")
	}
	p := w.mine(pid)
	if p == nil {
		return nil, userErr("not_yours", "This player is not at your club")
	}
	if isLegend(p) {
		return nil, userErr("loan_icon", "Icons are not loaned out")
	}
	if w.isLoanee(p.ID) {
		return nil, userErr("loan_loanee", "He is on loan here himself")
	}
	if len(w.userSquad()) <= MinSquad {
		return nil, userErr("squad_min", "You need at least 14 players")
	}
	type cand struct {
		cl *Club
		s  float64
	}
	var cs []cand
	for _, cl := range w.clubs {
		if cl.IsUser || cl.Division == 0 || cl.League != user.League || len(w.players[cl.ID]) >= AIMaxSquad {
			continue
		}
		diff := float64(p.Overall) - w.avgXI(cl)
		cs = append(cs, cand{cl, -math.Abs(diff-3) + r.Float64()*2})
	}
	if len(cs) == 0 {
		return nil, userErr("loan_nobody", "No club wants him on loan")
	}
	sort.Slice(cs, func(i, j int) bool { return cs[i].s > cs[j].s })
	to := cs[0].cl
	d := LoanDeal{ID: es.nextID(), PlayerID: p.ID, Name: p.Name, Role: p.Role, Overall: p.Overall, ClubID: to.ID, Club: to.Name,
		Season: c.Season, Fee: roundK(float64(p.Value) * LoanOutShare), Wage: c.Contracts.Players[p.ID], Years: c.Contracts.Years[p.ID],
		Tenure: p.Tenure, AppsAt: w.seasonApps(ctx, q, p.ID), Shirt: p.Shirt}
	if d.Wage == 0 {
		d.Wage = p.Wage
	}
	user.Budget += d.Fee
	to.Budget -= d.Fee
	moveTo(p, &to.ID, w.shirtFor(ctx, q, to.ID, p))
	p.Morale = clamp(p.Morale+3, 20, 100)
	w.players[to.ID] = append(w.players[to.ID], p)
	delete(c.Contracts.Players, p.ID)
	delete(c.Contracts.Years, p.ID)
	es.LoansOut = append(es.LoansOut, d)
	w.tidyEvents()
	if err := savePlayers(ctx, q, []*Player{p}); err != nil {
		return nil, err
	}
	if err := saveClub(ctx, q, to); err != nil {
		return nil, err
	}
	if err := addFinance(ctx, q, c, "loan_fee_out", d.Fee, p.Name); err != nil {
		return nil, err
	}
	w.logHappening(ComEvent{Key: "loan_out", Name: p.Name + " (" + to.Name + ")", Amount: d.Fee})
	return &d, nil
}

// LoanCand: a player another club will lend you.
type LoanCand struct {
	Player *Player `json:"player"`
	Club   string  `json:"club"`
	ClubID int     `json:"clubId"`
	League string  `json:"league"`
	Fee    int64   `json:"fee"`
}

func loanInFee(p *Player, level int) int64 {
	return roundK(float64(p.Value) * LoanInShare * (1 - managerPerks(level).LoanDiscount))
}

// loanable: squad players (not in the first eleven) at competition clubs that can spare them.
func (w *world) loanable() []LoanCand {
	c := w.career
	user := w.byID[c.UserClubID]
	var mine []int
	for _, p := range w.userSquad() {
		mine = append(mine, p.Overall)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(mine)))
	floor := 55
	if len(mine) > 14 {
		floor = mine[14] // better than your 15th man, or there's no point
	}
	var out []LoanCand
	for _, cl := range w.clubs {
		if cl.IsUser || cl.Division == 0 || !isCompLeague(cl.League) || len(w.players[cl.ID]) <= AIMinSquad+1 {
			continue
		}
		xi := map[int]bool{}
		for _, id := range cl.Lineup {
			xi[id] = true
		}
		// big clubs don't lend their stars to much smaller ones
		if cl.Reputation > user.Reputation+20 {
			continue
		}
		for _, p := range w.players[cl.ID] {
			if xi[p.ID] || isLegend(p) || p.Injury > 0 || p.Overall < floor {
				continue
			}
			out = append(out, LoanCand{Player: p, Club: cl.Name, ClubID: cl.ID, League: cl.League, Fee: loanInFee(p, c.Events.Level)})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Player.Overall > out[j].Player.Overall })
	if len(out) > 40 {
		out = out[:40]
	}
	return out
}

func (w *world) loanIn(ctx context.Context, q DBTX, pid int) (*LoanDeal, error) {
	c := w.career
	es := &c.Events
	user := w.byID[c.UserClubID]
	if c.Day > LoanWindow {
		return nil, userErr("loan_closed", "The loan window is closed until next season")
	}
	if len(es.LoansIn) >= MaxLoansIn {
		return nil, userErr("loan_limit", "You already have enough loan players")
	}
	if len(w.userSquad()) >= MaxSquad {
		return nil, userErr("squad_full", "Your squad is full")
	}
	var cand *LoanCand
	for _, lc := range w.loanable() {
		if lc.Player.ID == pid {
			lc := lc
			cand = &lc
		}
	}
	if cand == nil {
		return nil, userErr("loan_unavailable", "His club will not lend him")
	}
	if user.Budget < cand.Fee {
		return nil, userErr("no_budget", "Not enough budget")
	}
	p := cand.Player
	from := w.byID[cand.ClubID]
	d := LoanDeal{ID: es.nextID(), PlayerID: p.ID, Name: p.Name, Role: p.Role, Overall: p.Overall, ClubID: from.ID, Club: from.Name,
		Season: c.Season, Fee: cand.Fee, Tenure: p.Tenure, Shirt: p.Shirt}
	user.Budget -= d.Fee
	from.Budget += d.Fee
	shirt := w.shirtFor(ctx, q, user.ID, p)
	// out of the lender's squad, into yours
	keep := w.players[from.ID][:0]
	for _, x := range w.players[from.ID] {
		if x.ID != p.ID {
			keep = append(keep, x)
		}
	}
	w.players[from.ID] = keep
	moveTo(p, &user.ID, shirt)
	w.players[user.ID] = append(w.players[user.ID], p)
	// he signs a loan contract at his market wage and won't ask for raises or renewals while here
	if c.Contracts.Quiet == nil {
		c.Contracts.Quiet = map[string]int{}
	}
	c.Contracts.Quiet["player:"+strconv.Itoa(p.ID)] = (c.Season+1)*100 + 1
	applyPay(c, w.players[user.ID], w.coaches[user.ID])
	if c.Contracts.Years[p.ID] < 2 {
		c.Contracts.Years[p.ID] = 2
	}
	es.LoansIn = append(es.LoansIn, d)
	if err := savePlayers(ctx, q, []*Player{p}); err != nil {
		return nil, err
	}
	if err := saveClub(ctx, q, from); err != nil {
		return nil, err
	}
	if err := addFinance(ctx, q, c, "loan_fee_in", -d.Fee, p.Name); err != nil {
		return nil, err
	}
	w.logHappening(ComEvent{Key: "loan_in", Name: p.Name + " (" + from.Name + ")", Amount: d.Fee})
	return &d, nil
}

// checkLoansIn: a borrowed player who left your club early (sold or released) must be paid for.
func (w *world) checkLoansIn(ctx context.Context, q DBTX, rep *DayReport) error {
	c := w.career
	es := &c.Events
	user := w.byID[c.UserClubID]
	keep := es.LoansIn[:0]
	for _, d := range es.LoansIn {
		if w.mine(d.PlayerID) != nil {
			keep = append(keep, d)
			continue
		}
		p, err := getPlayer(ctx, q, c.ID, d.PlayerID)
		if err != nil {
			continue
		}
		owner := w.byID[d.ClubID]
		charge := roundK(float64(p.Value) * QuickSellShare)
		user.Budget -= charge
		if owner != nil {
			owner.Budget += charge
			if p.ClubID == nil && !p.Retired { // released to the market: he goes home
				moveTo(p, &owner.ID, w.homeShirt(ctx, q, owner.ID, p, d.Shirt))
				if err := savePlayers(ctx, q, []*Player{p}); err != nil {
					return err
				}
				w.players[owner.ID] = append(w.players[owner.ID], p)
			}
		}
		if err := addFinance(ctx, q, c, "loan_breach", -charge, p.Name); err != nil {
			return err
		}
		w.happen(rep, "loan_breach", p.Name, -charge)
	}
	es.LoansIn = keep
	return nil
}

// returnLoans: at the end of the season everyone goes back where he belongs.
func (w *world) returnLoans(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	c := w.career
	es := &c.Events
	user := w.byID[c.UserClubID]
	var touched []*Player
	for _, d := range es.LoansOut {
		p := w.playerByID(d.PlayerID)
		if p == nil || p.ClubID == nil || *p.ClubID != d.ClubID {
			continue // he moved on (or you bought him back)
		}
		apps := w.seasonApps(ctx, q, p.ID) - d.AppsAt
		keep := w.players[d.ClubID][:0]
		for _, x := range w.players[d.ClubID] {
			if x.ID != p.ID {
				keep = append(keep, x)
			}
		}
		w.players[d.ClubID] = keep
		moveTo(p, &user.ID, w.homeShirt(ctx, q, user.ID, p, d.Shirt))
		p.Tenure = d.Tenure
		w.players[user.ID] = append(w.players[user.ID], p)
		c.Contracts.Players[p.ID] = d.Wage
		if d.Years > 0 {
			c.Contracts.Years[p.ID] = d.Years
		}
		// regular football brings him on
		if apps >= 10 {
			f := ageFactor(p.Age) * math.Min(1.5, float64(apps)/20)
			for _, a := range keyAttrs(p.Position) {
				v := p.Attr(a)
				*v = math.Min(attrCap(p), *v+f*(0.8+r.Float64()*0.8))
			}
			p.Morale = clamp(p.Morale+5, 20, 100)
			before := p.Overall
			p.Fill()
			w.happen(rep, "loan_back_dev", p.Name, int64(p.Overall-before))
		} else {
			p.Fill()
			w.happen(rep, "loan_back", p.Name, int64(apps))
		}
		touched = append(touched, p)
	}
	es.LoansOut = nil
	for _, d := range es.LoansIn {
		p := w.mine(d.PlayerID)
		if p == nil {
			continue
		}
		home := w.byID[d.ClubID]
		if home == nil {
			continue
		}
		keep := w.players[user.ID][:0]
		for _, x := range w.players[user.ID] {
			if x.ID != p.ID {
				keep = append(keep, x)
			}
		}
		w.players[user.ID] = keep
		moveTo(p, &home.ID, w.homeShirt(ctx, q, home.ID, p, d.Shirt))
		p.Tenure = d.Tenure
		w.players[home.ID] = append(w.players[home.ID], p)
		delete(c.Contracts.Players, p.ID)
		delete(c.Contracts.Years, p.ID)
		delete(c.Contracts.Quiet, "player:"+strconv.Itoa(p.ID))
		w.happen(rep, "loan_home", p.Name+" ("+home.Name+")", 0)
		touched = append(touched, p)
	}
	es.LoansIn = nil
	// legend_versions.go: a player back from loan who meets a legend version of himself merges into it
	for _, p := range touched {
		if p.ClubID != nil && *p.ClubID == user.ID {
			if _, err := w.arrivalMerge(ctx, q, rep, p); err != nil {
				return err
			}
		}
	}
	w.tidyEvents()
	return savePlayers(ctx, q, touched)
}
