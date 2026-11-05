package game

import (
	"context"
	"math"
	"math/rand"
	"sort"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- the commercial side of the club

// Commercial: sponsors in several slots, mid-season offers, chance cards (like a board game),
// the board's season goal and the odd billionaire.
type Commercial struct {
	Sponsors map[string]*Sponsor `json:"sponsors"` // slot → sponsor
	Offers   []Offer             `json:"offers"`   // tempting offers that expire
	NextCard int                 `json:"nextCard"` // season*100+day of the next card draw
	Pending  *Card               `json:"pending"`  // a card waiting for your choice
	Log      []Card              `json:"log"`      // recent cards, newest first
	Board    *BoardGoal          `json:"board"`
	Takeover *Takeover           `json:"takeover"`
	OfferID  int                 `json:"offerId"`
	Wear     map[string]int      `json:"wear"` // facility → seasons left before it slips a level
	Shares   *Shares             `json:"shares"`
}

var FacilityKinds = []string{"stadium", "training", "academy", "medical"}

// facilityWear (at every season's end): a facility above level 1 slips one level when its clock runs out,
// RenovateSeasons seasons after it was built, upgraded or renovated (all three set the clock), and the level
// below it gets a full clock of its own.
func (w *world) facilityWear(r *rand.Rand, rep *DayReport) {
	cm := &w.career.Commercial
	if cm.Wear == nil {
		cm.Wear = map[string]int{}
	}
	user := w.byID[w.career.UserClubID]
	for _, k := range FacilityKinds {
		lvl := facilityLevel(user, k)
		if *lvl <= 1 {
			delete(cm.Wear, k)
			continue
		}
		if cm.Wear[k] <= 0 {
			cm.Wear[k] = RenovateSeasons // a facility from before the clock (a new career's own) starts one
			continue
		}
		cm.Wear[k]--
		if cm.Wear[k] <= 0 {
			*lvl--
			rep.Commercial = append(rep.Commercial, ComEvent{Key: "facility_worn", Name: k})
			if *lvl > 1 {
				cm.Wear[k] = RenovateSeasons
			} else {
				delete(cm.Wear, k)
			}
		}
	}
}

// Sponsor slots: how much each is worth compared with the shirt.
var SponsorSlots = []string{"shirt", "sleeve", "stadium", "kit", "partner"}
var slotFactor = map[string]float64{"shirt": 1, "sleeve": 0.3, "stadium": 0.5, "kit": 0.25, "partner": 0.15}
var slotSeasons = map[string]int{"shirt": 2, "sleeve": 1, "stadium": 3, "kit": 2, "partner": 1}

type Offer struct {
	ID      int     `json:"id"`
	Slot    string  `json:"slot"`
	Sponsor Sponsor `json:"sponsor"`
	Until   int     `json:"until"` // matchday
}

type Card struct {
	Key    string `json:"key"`
	Deck   string `json:"deck"`   // chance | chest
	Amount int64  `json:"amount"` // + income, − cost; for choice cards the stake
	Choice bool   `json:"choice"`
	Until  int    `json:"until,omitempty"`
	Result string `json:"result,omitempty"` // how it ended: paid | won | lost | skipped …
	Net    int64  `json:"net"`
	Season int    `json:"season"`
	Day    int    `json:"day"`
}

type BoardGoal struct {
	Season int    `json:"season"`
	Goal   string `json:"goal"` // title | top4 | top8 | mid | survive | promotion
	Reward int64  `json:"reward"`
	Fine   int64  `json:"fine"`
	Result string `json:"result,omitempty"` // met | missed
}

type Takeover struct {
	Investor string `json:"investor"`
	Amount   int64  `json:"amount"`
	Goal     string `json:"goal"`     // cl_qual | promotion
	Deadline int    `json:"deadline"` // season by which the goal must be met
	Status   string `json:"status"`   // offer | active | done | failed | declined
	Until    int    `json:"until"`    // matchday the offer lapses
}

// ComEvent is a line in the day report: a sponsor left, a bonus was paid, the board judged you…
type ComEvent struct {
	Key    string `json:"key"`
	Name   string `json:"name,omitempty"`
	Amount int64  `json:"amount,omitempty"`
	Age    int    `json:"age,omitempty"` // a player's age, when it matters (which version of a legend turned up)
}

var investors = []string{"Al-Nahyar Group", "Petrov Holdings", "Sun Pacific Capital", "Redbridge Partners", "Vanterra Ventures", "Okafor Industries"}

// migrateCommercial moves the old single sponsor into the shirt slot.
func migrateCommercial(c *Career) {
	if c.Commercial.Sponsors == nil {
		c.Commercial.Sponsors = map[string]*Sponsor{}
	}
	if c.Sponsor != nil {
		if c.Commercial.Sponsors["shirt"] == nil {
			sp := *c.Sponsor
			sp.Slot = "shirt"
			c.Commercial.Sponsors["shirt"] = &sp
		}
		c.Sponsor = nil
	}
}

func (cm *Commercial) totalWeekly() int64 {
	var t int64
	for _, s := range cm.Sponsors {
		t += s.Weekly
	}
	return t
}

// ---------------------------------------------------------------- sponsor offers

func sponsorFor(r *rand.Rand, brand, slot, kind string, rep int, expected int, division int) Sponsor {
	rv := float64(rep) * slotFactor[slot]
	base := map[string][4]float64{ // weekly, win bonus, goal bonus, signing (per reputation point)
		"safe":        {4_400, 50_000, 10_000, 20_000},
		"balanced":    {2_900, 175_000, 30_000, 12_000},
		"performance": {1_450, 350_000, 60_000, 5_000},
	}[kind]
	f := slotFactor[slot]
	sp := Sponsor{Name: brand, Slot: slot, Kind: kind, Weekly: roundK(rv * base[0]), WinBonus: roundK(base[1] * f), GoalBonus: roundK(base[2] * f),
		Signing: roundK(rv * base[3] * float64(slotSeasons[slot])), SeasonsLeft: slotSeasons[slot]}
	// objective and clause: the riskier the deal, the higher the bar
	sp.Target = targetFor(expected, division, kind)
	sp.TargetBonus = sp.Weekly * 10
	if kind != "safe" {
		sp.MinPos = min(DivisionSize, expected+map[string]int{"balanced": 7, "performance": 4}[kind])
	}
	sp.Exit = sp.Weekly * 8
	return sp
}

func roundK(v float64) int64 { return int64(v/10_000+0.5) * 10_000 }

// targetFor picks an objective that fits the club's expected finish.
func targetFor(expected, division int, kind string) string {
	shift := map[string]int{"safe": 3, "balanced": 0, "performance": -2}[kind]
	e := max(1, expected+shift)
	if division > 1 {
		if e <= 3 {
			return "promotion"
		}
		if e <= 8 {
			return "top8"
		}
		return "survive"
	}
	switch {
	case e <= 1:
		return "title"
	case e <= 4:
		return "top4"
	case e <= 8:
		return "top8"
	case e <= 13:
		return "mid"
	}
	return "survive"
}

// SlotOffers: the three standing offers for an empty slot this season (stable within a season).
func SlotOffers(c *Career, rep, expected, division int, slot string) []Sponsor {
	idx := 0
	for i, s := range SponsorSlots {
		if s == slot {
			idx = i
		}
	}
	r := rand.New(rand.NewSource(int64(c.ID*1000+c.Season)*31 + int64(idx)))
	used := map[string]bool{}
	for _, s := range c.Commercial.Sponsors {
		used[s.Name] = true
	}
	var brands []string
	for _, b := range brandsFor(slot) {
		if !used[b] {
			brands = append(brands, b)
		}
	}
	r.Shuffle(len(brands), func(i, j int) { brands[i], brands[j] = brands[j], brands[i] })
	out := []Sponsor{}
	for i, kind := range []string{"safe", "balanced", "performance"} {
		if i < len(brands) {
			out = append(out, sponsorFor(r, brands[i], slot, kind, rep, expected, division))
		}
	}
	return out
}

// expectedRank: where the club "should" finish, by reputation within its division.
func (w *world) expectedRank(clubID int) int {
	me := w.byID[clubID]
	n := 1
	for _, cl := range w.clubs {
		if cl.League == me.League && cl.Division == me.Division && cl.ID != me.ID && cl.Reputation > me.Reputation {
			n++
		}
	}
	return n
}

func (w *world) leaguePos(clubID int) int {
	me := w.byID[clubID]
	for i, row := range divisionTable(w.clubs, w.fixtures, me.League, me.Division) {
		if row.ClubID == clubID {
			return i + 1
		}
	}
	return 0
}

// ---------------------------------------------------------------- hot bonuses

type HotBonus struct {
	Kind   string `json:"kind"` // win | score3 | clean | win2
	Amount int64  `json:"amount"`
	Brand  string `json:"brand"`
}

// hotBonusFor: about two matches in five, one of your sponsors puts money on the result.
// Stable per fixture, so the match centre shows the same offer that gets paid.
func hotBonusFor(c *Career, f *Fixture, rep int) *HotBonus {
	if f == nil || f.Comp == "friendly" || len(c.Commercial.Sponsors) == 0 {
		return nil
	}
	r := rand.New(rand.NewSource(int64(f.ID)*7717 + int64(c.ID)))
	if r.Float64() > 0.4 {
		return nil
	}
	var names []string
	for _, s := range SponsorSlots {
		if sp := c.Commercial.Sponsors[s]; sp != nil {
			names = append(names, sp.Name)
		}
	}
	kinds := []string{"win", "score3", "clean", "win2"}
	k := kinds[r.Intn(len(kinds))]
	mul := map[string]float64{"win": 1, "score3": 0.9, "clean": 0.8, "win2": 1.3}[k] * map[string]float64{"league": 1, "cup": 1.3, "cl": 2}[f.Comp]
	return &HotBonus{Kind: k, Brand: names[r.Intn(len(names))], Amount: roundK(float64(rep) * 15_000 * mul)}
}

func (h *HotBonus) met(gf, ga int) bool {
	switch h.Kind {
	case "win":
		return gf > ga
	case "score3":
		return gf >= 3
	case "clean":
		return ga == 0
	case "win2":
		return gf-ga >= 2
	}
	return false
}

// ---------------------------------------------------------------- shirt sales

// merchIncome: stars sell shirts, icons most of all; a kit deal and a bigger stadium shop help.
func merchIncome(squad []*Player, cm *Commercial, stadium int) int64 {
	var v float64
	for _, p := range squad {
		a := math.Pow(math.Max(0, float64(p.Overall)-74), 1.5) * 1_100
		if isLegend(p) {
			a = a*2.5 + 25_000
		}
		v += a
	}
	if cm.Sponsors["kit"] != nil {
		v *= 1.2
	}
	v *= 1 + 0.1*float64(max(1, stadium)-1)
	return roundK(v)
}

// ---------------------------------------------------------------- chance cards

type cardDef struct {
	Key    string
	Deck   string
	Amount float64 // millions at reputation 80 (scaled by reputation)
	Choice bool
}

var cardDeck = []cardDef{
	{"shirt_sellout", "chance", 3, false}, {"asia_tour", "chance", 5, false}, {"tv_extra", "chance", 2, false},
	{"viral", "chance", 1.2, false}, {"legal_win", "chest", 1.5, false}, {"fan_donation", "chest", 1, false},
	{"lottery", "chest", 0.8, false},
	{"fireworks", "chest", -1, false}, {"pitch_repair", "chest", -2, false}, {"tax_audit", "chance", -1.5, false},
	{"discipline", "chance", -0.6, false}, {"flood", "chest", -1.2, false}, {"lawsuit", "chance", -2.5, false},
	{"fine_appeal", "chest", -1.5, true}, {"invest_promo", "chance", -2, true}, {"charity_match", "chest", -0.5, true},
}

func (w *world) drawCard(r *rand.Rand) *Card {
	c := w.career
	rep := float64(w.byID[c.UserClubID].Reputation)
	d := cardDeck[r.Intn(len(cardDeck))]
	amt := roundK(d.Amount * 1_000_000 * rep / 80)
	return &Card{Key: d.Key, Deck: d.Deck, Amount: amt, Choice: d.Choice, Season: c.Season, Day: c.Day}
}

func (cm *Commercial) logCard(cd Card) {
	cm.Log = append([]Card{cd}, cm.Log...)
	if len(cm.Log) > 12 {
		cm.Log = cm.Log[:12]
	}
}

// ---------------------------------------------------------------- the daily tick

// commercialTick runs after every matchday: card draws, offers, clause checks and the billionaire.
func (w *world) commercialTick(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	c := w.career
	cm := &c.Commercial
	user := w.byID[c.UserClubID]
	now := c.Season*100 + c.Day
	inSeason := c.Day <= len(Calendar)
	pay := func(kind string, amount int64, note string) error {
		if amount == 0 {
			return nil
		}
		user.Budget += amount
		return addFinance(ctx, q, c, kind, amount, note)
	}

	// the board sets a goal at the start of every season
	if cm.Board == nil || cm.Board.Season != c.Season {
		exp := w.expectedRank(user.ID)
		g := targetFor(exp, user.Division, "balanced")
		rv := int64(user.Reputation)
		cm.Board = &BoardGoal{Season: c.Season, Goal: g, Reward: rv * 120_000, Fine: rv * 100_000}
		rep.Commercial = append(rep.Commercial, ComEvent{Key: "board_set", Name: g})
	}

	// a pending choice card that ran out counts as the safe option
	if cm.Pending != nil && c.Day > cm.Pending.Until {
		cd := *cm.Pending
		cm.Pending = nil
		if err := w.resolveCard(ctx, q, r, &cd, "a"); err != nil {
			return err
		}
		rep.Commercial = append(rep.Commercial, ComEvent{Key: "card_auto", Name: cd.Key, Amount: cd.Net})
	}

	// chance cards: one every four to eight matchdays
	if inSeason && cm.Pending == nil {
		if cm.NextCard == 0 {
			cm.NextCard = now + 3 + r.Intn(4)
		}
		if now >= cm.NextCard {
			cm.NextCard = now + 4 + r.Intn(5)
			cd := w.drawCard(r)
			if cd.Choice {
				cd.Until = c.Day + 3
				cm.Pending = cd
			} else {
				cd.Net = cd.Amount
				cd.Result = "applied"
				if err := pay("card", cd.Amount, cd.Key); err != nil {
					return err
				}
				if cd.Key == "discipline" {
					for _, p := range w.players[user.ID] {
						if r.Intn(len(w.players[user.ID])) == 0 {
							p.Morale = clamp(p.Morale-10, 20, 100)
						}
					}
				}
				cm.logCard(*cd)
			}
			rep.Card = cd
		}
	}

	// expired offers go away; now and then a tempting new one arrives
	keep := cm.Offers[:0]
	for _, o := range cm.Offers {
		if o.Until >= c.Day && inSeason {
			keep = append(keep, o)
		}
	}
	cm.Offers = keep
	if inSeason && len(cm.Offers) == 0 && r.Float64() < 0.08 {
		slot := SponsorSlots[r.Intn(len(SponsorSlots))]
		exp := w.expectedRank(user.ID)
		cur := cm.Sponsors[slot]
		used := map[string]bool{}
		for _, s := range cm.Sponsors {
			used[s.Name] = true
		}
		var brand string
		pool := brandsFor(slot)
		for _, i := range r.Perm(len(pool)) {
			if !used[pool[i]] {
				brand = pool[i]
				break
			}
		}
		if brand != "" {
			sp := sponsorFor(r, brand, slot, []string{"safe", "balanced", "performance"}[r.Intn(3)], user.Reputation, exp, user.Division)
			boost := 1.3 + r.Float64()*0.5
			sp.Weekly, sp.Signing = roundK(float64(sp.Weekly)*boost), roundK(float64(sp.Signing)*boost)
			sp.TargetBonus = sp.Weekly * 10
			sp.Exit = sp.Weekly * 8
			if cur == nil || sp.Weekly > cur.Weekly {
				cm.OfferID++
				cm.Offers = append(cm.Offers, Offer{ID: cm.OfferID, Slot: slot, Sponsor: sp, Until: c.Day + 4})
				rep.Commercial = append(rep.Commercial, ComEvent{Key: "offer", Name: brand, Amount: sp.Weekly})
			}
		}
	}

	// performance clauses: three matchdays below the line and the sponsor walks
	if inSeason && Calendar[c.Day-2].Comp == "league" {
		pos := w.leaguePos(user.ID)
		for slot, sp := range cm.Sponsors {
			if sp.MinPos == 0 || c.Day < 12 {
				continue
			}
			if pos > sp.MinPos {
				sp.Strikes++
				if sp.Strikes == 2 {
					rep.Commercial = append(rep.Commercial, ComEvent{Key: "sponsor_warn", Name: sp.Name})
				}
				if sp.Strikes >= 3 {
					delete(cm.Sponsors, slot)
					rep.Commercial = append(rep.Commercial, ComEvent{Key: "sponsor_left", Name: sp.Name})
				}
			} else if sp.Strikes > 0 {
				sp.Strikes--
			}
		}
	}

	// a billionaire comes knocking (rarely)
	if cm.Takeover != nil && cm.Takeover.Status == "offer" && c.Day > cm.Takeover.Until {
		cm.Takeover.Status = "declined"
	}
	if inSeason && (cm.Takeover == nil || cm.Takeover.Status == "declined" || cm.Takeover.Status == "done" || cm.Takeover.Status == "failed") && r.Float64() < 0.003 {
		goal := "cl_qual"
		if user.Division > 1 {
			goal = "promotion"
		}
		cm.Takeover = &Takeover{Investor: investors[r.Intn(len(investors))], Amount: int64(50+r.Intn(151)) * M, Goal: goal,
			Deadline: c.Season + 1, Status: "offer", Until: c.Day + 5}
		rep.Commercial = append(rep.Commercial, ComEvent{Key: "takeover_offer", Name: cm.Takeover.Investor, Amount: cm.Takeover.Amount})
	}
	return nil
}

// commercialSeasonEnd: objectives are paid, the board gives its verdict, contracts run down.
func (w *world) commercialSeasonEnd(ctx context.Context, q DBTX, se *SeasonEnd, rep *DayReport) error {
	c := w.career
	cm := &c.Commercial
	user := w.byID[c.UserClubID]
	pay := func(kind string, amount int64, note string) error {
		if amount == 0 {
			return nil
		}
		user.Budget += amount
		rep.Money = append(rep.Money, MoneyLine{Kind: kind, Amount: amount})
		return addFinance(ctx, q, c, kind, amount, note)
	}
	for _, slot := range SponsorSlots {
		sp := cm.Sponsors[slot]
		if sp == nil {
			continue
		}
		if goalMet(sp.Target, se) {
			if err := pay("sponsor_target", sp.TargetBonus, sp.Name); err != nil {
				return err
			}
			rep.Commercial = append(rep.Commercial, ComEvent{Key: "target_met", Name: sp.Name, Amount: sp.TargetBonus})
		}
		sp.SeasonsLeft--
		if se.Move == "down" && sp.MinPos > 0 {
			sp.SeasonsLeft = 0 // relegation ends performance deals
		}
		if sp.SeasonsLeft <= 0 {
			delete(cm.Sponsors, slot)
			rep.Commercial = append(rep.Commercial, ComEvent{Key: "sponsor_ended", Name: sp.Name})
		}
		sp.Strikes = 0
	}
	if b := cm.Board; b != nil && b.Season == c.Season && b.Result == "" {
		if goalMet(b.Goal, se) {
			b.Result = "met"
			if err := pay("board_reward", b.Reward, b.Goal); err != nil {
				return err
			}
		} else {
			b.Result = "missed"
			if err := pay("board_fine", -b.Fine, b.Goal); err != nil {
				return err
			}
		}
		rep.Commercial = append(rep.Commercial, ComEvent{Key: "board_" + b.Result, Name: b.Goal, Amount: map[bool]int64{true: b.Reward, false: -b.Fine}[b.Result == "met"]})
	}
	if t := cm.Takeover; t != nil && t.Status == "active" {
		if goalMet(t.Goal, se) {
			t.Status = "done"
			rep.Commercial = append(rep.Commercial, ComEvent{Key: "takeover_done", Name: t.Investor})
		} else if c.Season >= t.Deadline {
			t.Status = "failed"
			if err := pay("takeover_exit", -t.Amount/2, t.Investor); err != nil {
				return err
			}
			rep.Commercial = append(rep.Commercial, ComEvent{Key: "takeover_failed", Name: t.Investor, Amount: -t.Amount / 2})
		}
	}
	cm.Offers = nil
	w.facilityWear(newRand(), rep)
	return nil
}

func goalMet(goal string, se *SeasonEnd) bool {
	switch goal {
	case "title":
		return se.Position == 1
	case "top4":
		return se.Position <= 4
	case "top8":
		return se.Position <= 8
	case "mid":
		return se.Position <= 13
	case "survive":
		return se.Move != "down"
	case "promotion":
		return se.Move == "up"
	case "cl_qual":
		return se.Qualified
	case "cup_sf":
		return se.Cup == "SF" || se.Cup == "F" || se.Cup == "W"
	}
	return false
}

// ---------------------------------------------------------------- choices

// resolveCard plays out a choice card: "a" is the safe option, "b" the gamble.
func (w *world) resolveCard(ctx context.Context, q DBTX, r *rand.Rand, cd *Card, choice string) error {
	c := w.career
	user := w.byID[c.UserClubID]
	net := int64(0)
	switch cd.Key {
	case "fine_appeal": // a: pay the fine · b: appeal, 50/50 cleared or doubled
		if choice == "b" {
			if r.Float64() < 0.5 {
				cd.Result = "won"
			} else {
				cd.Result, net = "lost", cd.Amount*2
			}
		} else {
			cd.Result, net = "paid", cd.Amount
		}
	case "invest_promo": // a: skip · b: invest, 60% returns 2.5×
		if choice == "b" {
			net = cd.Amount
			if r.Float64() < 0.6 {
				cd.Result, net = "won", net-cd.Amount*5/2
			} else {
				cd.Result = "lost"
			}
		} else {
			cd.Result = "skipped"
		}
	case "charity_match": // a: decline · b: play it, costs a little, lifts the squad and the crowd
		if choice == "b" {
			cd.Result, net = "played", cd.Amount
			for _, p := range w.players[user.ID] {
				p.Morale = clamp(p.Morale+6, 20, 100)
			}
			user.Reputation = min(99, user.Reputation+1)
		} else {
			cd.Result = "skipped"
		}
	}
	cd.Net = net
	if net != 0 {
		user.Budget += net
		if err := addFinance(ctx, q, c, "card", net, cd.Key); err != nil {
			return err
		}
	}
	c.Commercial.logCard(*cd)
	return nil
}

type CommercialReq struct {
	Action string `json:"action"` // sign | cancel | accept_offer | decline_offer | card | takeover
	Slot   string `json:"slot"`
	Index  int    `json:"index"`
	Offer  int    `json:"offer"`
	Choice string `json:"choice"` // card: a | b · takeover: accept | decline
	Amount int64  `json:"amount"` // buyback: your offer for a 10% block (0 asks for their price)
}

type CommercialResult struct {
	Card    *Card  `json:"card,omitempty"`
	Ask     int64  `json:"ask,omitempty"`
	Outcome string `json:"outcome,omitempty"`
}

// Commercial handles every decision on the commercial side.
func (s *Store) Commercial(ctx context.Context, careerID int, req CommercialReq) (*CommercialResult, error) {
	out := &CommercialResult{}
	err := s.tx(ctx, func(q pgx.Tx) error {
		r := newRand()
		w, err := loadWorld(ctx, q, r, careerID)
		if err != nil {
			return err
		}
		c := w.career
		cm := &c.Commercial
		user := w.byID[c.UserClubID]
		sign := func(slot string, sp Sponsor) error {
			sp.Slot = slot
			cm.Sponsors[slot] = &sp
			user.Budget += sp.Signing
			return addFinance(ctx, q, c, "signing_bonus", sp.Signing, sp.Name)
		}
		switch req.Action {
		case "sign":
			if slotFactor[req.Slot] == 0 {
				return userErr("bad_slot", "Unknown sponsor slot")
			}
			if cm.Sponsors[req.Slot] != nil {
				return userErr("has_sponsor", "This slot already has a sponsor")
			}
			offers := SlotOffers(c, user.Reputation, w.expectedRank(user.ID), user.Division, req.Slot)
			if req.Index < 0 || req.Index >= len(offers) {
				return userErr("bad_offer", "Unknown offer")
			}
			if err := sign(req.Slot, offers[req.Index]); err != nil {
				return err
			}
		case "cancel":
			sp := cm.Sponsors[req.Slot]
			if sp == nil {
				return userErr("no_sponsor", "There is no sponsor in this slot")
			}
			user.Budget -= sp.Exit
			if err := addFinance(ctx, q, c, "sponsor_exit", -sp.Exit, sp.Name); err != nil {
				return err
			}
			delete(cm.Sponsors, req.Slot)
		case "accept_offer", "decline_offer":
			idx := -1
			for i, o := range cm.Offers {
				if o.ID == req.Offer {
					idx = i
				}
			}
			if idx < 0 {
				return userErr("bad_offer", "This offer has gone")
			}
			o := cm.Offers[idx]
			cm.Offers = append(cm.Offers[:idx], cm.Offers[idx+1:]...)
			if req.Action == "accept_offer" {
				if cur := cm.Sponsors[o.Slot]; cur != nil {
					user.Budget -= cur.Exit
					if err := addFinance(ctx, q, c, "sponsor_exit", -cur.Exit, cur.Name); err != nil {
						return err
					}
				}
				if err := sign(o.Slot, o.Sponsor); err != nil {
					return err
				}
			}
		case "card":
			if cm.Pending == nil {
				return userErr("no_card", "No card is waiting")
			}
			cd := *cm.Pending
			cm.Pending = nil
			if err := w.resolveCard(ctx, q, r, &cd, req.Choice); err != nil {
				return err
			}
			out.Card = &cd
			if err := savePlayers(ctx, q, w.players[user.ID]); err != nil {
				return err
			}
		case "takeover":
			t := cm.Takeover
			if t == nil || t.Status != "offer" {
				return userErr("no_takeover", "There is no takeover offer")
			}
			if req.Choice == "accept" {
				t.Status = "active"
				user.Budget += t.Amount
				if err := addFinance(ctx, q, c, "takeover", t.Amount, t.Investor); err != nil {
					return err
				}
			} else {
				t.Status = "declined"
			}
		case "sell_shares", "buyback":
			if err := w.sharesAction(ctx, q, r, req, out); err != nil {
				return err
			}
		default:
			return userErr("bad_action", "Unknown action")
		}
		if err := saveClub(ctx, q, user); err != nil {
			return err
		}
		return saveCareer(ctx, q, c)
	})
	return out, err
}

// CommercialView: everything the finance page needs about sponsors and the rest.
type CommercialView struct {
	Slots    []SlotView `json:"slots"`
	Offers   []Offer    `json:"offers"`
	Pending  *Card      `json:"pending"`
	Log      []Card     `json:"log"`
	Board    *BoardGoal `json:"board"`
	Takeover *Takeover  `json:"takeover"`
	Merch    int64      `json:"merch"` // shirt sales per matchday at the moment
	Position int        `json:"position"`
	Expected int        `json:"expected"`
}

type SlotView struct {
	Slot    string    `json:"slot"`
	Sponsor *Sponsor  `json:"sponsor"`
	Offers  []Sponsor `json:"offers"`
}

func (w *world) commercialView() *CommercialView {
	c := w.career
	cm := &c.Commercial
	user := w.byID[c.UserClubID]
	exp := w.expectedRank(user.ID)
	v := &CommercialView{Offers: cm.Offers, Pending: cm.Pending, Log: cm.Log, Board: cm.Board, Takeover: cm.Takeover,
		Merch: merchIncome(w.players[user.ID], cm, user.Stadium), Position: w.leaguePos(user.ID), Expected: exp}
	for _, slot := range SponsorSlots {
		sv := SlotView{Slot: slot, Sponsor: cm.Sponsors[slot]}
		if sv.Sponsor == nil {
			sv.Offers = SlotOffers(c, user.Reputation, exp, user.Division, slot)
		}
		v.Slots = append(v.Slots, sv)
	}
	if v.Offers == nil {
		v.Offers = []Offer{}
	}
	if v.Log == nil {
		v.Log = []Card{}
	}
	sort.SliceStable(v.Offers, func(i, j int) bool { return v.Offers[i].Until < v.Offers[j].Until })
	return v
}

func (s *Store) CommercialInfo(ctx context.Context, careerID int) (*CommercialView, error) {
	var v *CommercialView
	err := s.tx(ctx, func(q pgx.Tx) error {
		w, err := loadWorld(ctx, q, newRand(), careerID)
		if err != nil {
			return err
		}
		v = w.commercialView()
		return nil
	})
	return v, err
}

// ---------------------------------------------------------------- club shares

// Shares: you can sell up to 49% of the club in 10% blocks. Shareholders take a cut of every
// matchday's revenue as a dividend; buying a block back is a negotiation.
type Shares struct {
	Sold   int   `json:"sold"`   // percent held by investors
	Raised int64 `json:"raised"` // money taken in so far
	Ask    int64 `json:"ask"`    // their price for the next 10% (0: not quoted yet this season)
	Tries  int   `json:"tries"`
	Season int   `json:"season"`
}

type SharesView struct {
	Sold      int     `json:"sold"`
	Raised    int64   `json:"raised"`
	Valuation int64   `json:"valuation"`
	SellPrice int64   `json:"sellPrice"` // what a 10% block fetches now
	Ask       int64   `json:"ask"`       // what they want for 10% back (after the first quote)
	Fair      int64   `json:"fair"`      // a 10% block at today's valuation
	Tries     int     `json:"tries"`
	Dividend  float64 `json:"dividend"` // share of matchday revenue paid out
}

const ShareBlock = 10
const MaxShares = 49
const DividendShare = 0.3 // investors receive 30% of revenue for every 100% they own

// clubValuation: reputation squared plus a quarter of the squad's market value.
func clubValuation(rep int, squad []*Player) int64 {
	v := float64(rep*rep) * 40_000
	for _, p := range squad {
		v += float64(p.Value) * 0.25
	}
	return roundK(v)
}

func sharesView(cm *Commercial, rep int, squad []*Player) *SharesView {
	sh := cm.Shares
	if sh == nil {
		sh = &Shares{}
	}
	val := clubValuation(rep, squad)
	fair := val * ShareBlock / 100
	return &SharesView{Sold: sh.Sold, Raised: sh.Raised, Valuation: val, SellPrice: fair * 9 / 10, Ask: sh.Ask, Fair: fair,
		Tries: sh.Tries, Dividend: float64(sh.Sold) / 100 * DividendShare}
}

// dividendCut: what shareholders take from today's revenue.
func dividendCut(cm *Commercial, revenue int64) int64 {
	if cm.Shares == nil || cm.Shares.Sold == 0 || revenue <= 0 {
		return 0
	}
	return roundK(float64(revenue) * float64(cm.Shares.Sold) / 100 * DividendShare)
}

func (w *world) sharesAction(ctx context.Context, q DBTX, r *rand.Rand, req CommercialReq, out *CommercialResult) error {
	c := w.career
	cm := &c.Commercial
	user := w.byID[c.UserClubID]
	if cm.Shares == nil {
		cm.Shares = &Shares{}
	}
	sh := cm.Shares
	if sh.Season != c.Season {
		sh.Season, sh.Ask, sh.Tries = c.Season, 0, 0
	}
	fair := clubValuation(user.Reputation, w.players[user.ID]) * ShareBlock / 100
	switch req.Action {
	case "sell_shares":
		if sh.Sold+ShareBlock > MaxShares {
			return userErr("shares_max", "You must keep a majority of the club")
		}
		price := fair * 9 / 10
		sh.Sold += ShareBlock
		sh.Raised += price
		user.Budget += price
		return addFinance(ctx, q, c, "shares_sold", price, "")
	case "buyback":
		if sh.Sold < ShareBlock {
			return userErr("no_shares", "Investors hold no shares")
		}
		if sh.Ask == 0 {
			sh.Ask = roundK(float64(fair) * (1.25 + r.Float64()*0.25)) // they want a premium
		}
		if req.Amount <= 0 { // just asking for a price
			out.Ask = sh.Ask
			return nil
		}
		if sh.Tries >= 3 && req.Amount < sh.Ask {
			return userErr("demand_final", "They will not negotiate any further this season")
		}
		if user.Budget < req.Amount {
			return userErr("no_budget", "Not enough budget")
		}
		accepted := req.Amount >= sh.Ask
		if !accepted {
			floor := float64(fair) * 0.95
			share := (float64(req.Amount) - floor) / (float64(sh.Ask) - floor)
			accepted = share > 0 && r.Float64() < 0.1+0.8*math.Pow(share, 1.5)
		}
		if !accepted {
			sh.Tries++
			sh.Ask = roundK(float64(sh.Ask) - (float64(sh.Ask)-float64(req.Amount))*0.15)
			out.Ask = sh.Ask
			out.Outcome = "countered"
			if sh.Tries >= 3 {
				out.Outcome = "final"
			}
			return nil
		}
		sh.Sold -= ShareBlock
		sh.Ask, sh.Tries = 0, 0
		user.Budget -= req.Amount
		out.Outcome = "bought"
		return addFinance(ctx, q, c, "shares_bought", -req.Amount, "")
	}
	return nil
}
