package game

import (
	"context"
	"math/rand"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- weekly money

func (w *world) weeklyMoney(ctx context.Context, q DBTX, rep *DayReport, uo *matchOutcome) error {
	c := w.career
	user := w.byID[c.UserClubID]
	rf := float64(user.Reputation) / 80
	lines := []MoneyLine{}
	add := func(kind string, amount int64) error {
		if amount == 0 {
			return nil
		}
		user.Budget += amount
		lines = append(lines, MoneyLine{Kind: kind, Amount: amount})
		return addFinance(ctx, q, c, kind, amount, "")
	}
	// An off-season friendly is a bonus game, not a week of the season: no wages, staff, upkeep,
	// loan instalment or weekly sponsor money that day, just what the match itself earns.
	friendly := uo != nil && uo.f != nil && uo.f.Comp == "friendly"
	if !friendly {
		var wages int64
		for _, p := range w.players[user.ID] {
			wages += p.Wage
		}
		if err := add("wages", -wages); err != nil {
			return err
		}
		var staff int64
		for _, co := range w.coaches[user.ID] {
			staff += co.Wage
		}
		if err := add("staff", -staff); err != nil {
			return err
		}
		if err := add("sponsor", c.Commercial.totalWeekly()); err != nil {
			return err
		}
		if err := add("upkeep", -FacilityUpkeep(user)); err != nil {
			return err
		}
		if c.Loan != nil {
			if err := add("loan_payment", -c.Loan.Weekly); err != nil {
				return err
			}
			c.Loan.WeeksLeft--
			if c.Loan.WeeksLeft <= 0 {
				c.Loan = nil
			}
		}
	}
	// upgrade points (TP) are earned on the pitch: 1 for every match played, 1 more for a win
	// (a shoot-out win counts). Nothing on a day without a match or for an abandoned one.
	tp := 0
	if uo != nil && !uo.res.Forfeit {
		f := uo.f
		gf, ga := *f.HomeGoals, *f.AwayGoals
		if uo.userSide == 1 {
			gf, ga = ga, gf
		}
		tp = TPPerMatch
		if gf > ga || (gf == ga && f.PensHome != nil && *f.PensHome == (uo.userSide == 0)) {
			tp += TPPerWin
		}
	}
	c.TP += tp
	rep.TP = tp
	if uo != nil {
		f := uo.f
		hg, ag := *f.HomeGoals, *f.AwayGoals
		gf, ga := hg, ag
		if uo.userSide == 1 {
			gf, ga = ag, hg
		}
		compMul := map[string]float64{"league": 1, "cup": 0.8, "cl": 2.2, "friendly": 0.5}[f.Comp]
		if f.Comp == "friendly" {
			opp := w.byID[f.AwayID]
			if uo.userSide == 1 {
				opp = w.byID[f.HomeID]
			}
			fee := int64(opp.Reputation) * 10_000
			if gf > ga {
				fee += 300_000
			}
			if err := add("friendly_fee", fee); err != nil {
				return err
			}
		}
		stadium := 1 + 0.18*float64(max(1, user.Stadium)-1)
		if uo.userSide == 0 {
			price := c.Ticket
			if price == "" {
				price = "normal"
			}
			// fanGate (club_fans.go): the fans' mood fills the stands, ×0.85 to ×1.12
			if err := add("tickets", int64(float64(user.Reputation)*10_000*compMul*stadium*ticketIncome[price]*w.fanGate())); err != nil {
				return err
			}
			for _, p := range w.players[user.ID] {
				p.Morale = clamp(p.Morale+ticketMorale[price], 20, 100)
			}
		}
		if f.Comp == "friendly" {
			compMul = 0
		}
		if err := add("tv", int64(220_000*rf*compMul)); err != nil {
			return err
		}
		if err := add("ads", int64(float64(user.Reputation)*2_200*compMul*(1+0.1*float64(max(1, user.Stadium)-1)))); err != nil {
			return err
		}
		var bonus int64
		for _, sp := range c.Commercial.Sponsors {
			if gf > ga {
				bonus += sp.WinBonus
			}
			bonus += int64(gf) * sp.GoalBonus
		}
		if err := add("sponsor_bonus", bonus); err != nil {
			return err
		}
		if hb := hotBonusFor(c, f, user.Reputation); hb != nil && hb.met(gf, ga) {
			if err := add("hot_bonus", hb.Amount); err != nil {
				return err
			}
		}
		if f.Comp != "friendly" {
			// fanMerch (club_fans.go): happy fans (and a summer tour abroad) sell shirts, ×0.9 to ×1.1
			if err := add("merch", roundK(float64(merchIncome(w.players[user.ID], &c.Commercial, user.Stadium))*w.fanMerch())); err != nil {
				return err
			}
		}
		_ = ga
	}
	// shareholders take their cut of today's revenue
	var revenue int64
	for _, l := range lines {
		if l.Amount > 0 && l.Kind != "loan" {
			revenue += l.Amount
		}
	}
	if err := add("dividend", -dividendCut(&c.Commercial, revenue)); err != nil {
		return err
	}
	rep.Money = append(rep.Money, lines...)
	return nil
}

// ---------------------------------------------------------------- sponsors

var sponsorBrands = []string{"Skyward Air", "Kopi Cola", "NovaTel", "Rapido Motors", "Zenith Bank", "Pixel Phones",
	"Aurora Energy", "Bolt Sportswear", "Orbit Games", "Lumen Insurance", "Tempo Watches", "Polar Water"}

// kitBrands: the kit maker slot goes to sportswear makers only.
var kitBrands = []string{"Bolt Sportswear", "Strida", "Veloce Sport", "Kickform", "Aeroline", "Fieldmark", "Pitchwear", "Vanta Athletics"}

// brandsFor: the companies that bid for a sponsor slot.
func brandsFor(slot string) []string {
	if slot == "kit" {
		return kitBrands
	}
	return sponsorBrands
}

func SponsorOffers(c *Career, rep int) []Sponsor {
	r := rand.New(rand.NewSource(int64(c.ID*1000 + c.Season)))
	brands := append([]string{}, sponsorBrands...)
	r.Shuffle(len(brands), func(i, j int) { brands[i], brands[j] = brands[j], brands[i] })
	rv := int64(rep)
	return []Sponsor{
		{Name: brands[0], Kind: "safe", Weekly: rv * 9_000, WinBonus: 100_000, GoalBonus: 20_000, Signing: rv * 40_000, SeasonsLeft: 2},
		{Name: brands[1], Kind: "balanced", Weekly: rv * 6_000, WinBonus: 350_000, GoalBonus: 60_000, Signing: rv * 25_000, SeasonsLeft: 2},
		{Name: brands[2], Kind: "performance", Weekly: rv * 3_000, WinBonus: 700_000, GoalBonus: 120_000, Signing: rv * 10_000, SeasonsLeft: 1},
	}
}

type FinanceEntry struct {
	Day    int    `json:"day"`
	Kind   string `json:"kind"`
	Amount int64  `json:"amount"`
}

type FinanceView struct {
	Budget  int64            `json:"budget"`
	Sponsor *Sponsor         `json:"sponsor"`
	Offers  []Sponsor        `json:"offers"`
	Totals  map[string]int64 `json:"totals"` // this season, by kind
	Entries []FinanceEntry   `json:"entries"`
	Wages   int64            `json:"wages"`
	Staff   int64            `json:"staff"`

	Facilities  []FacilityView `json:"facilities"`
	Upkeep      int64          `json:"upkeep"`
	Ticket      string         `json:"ticket"`
	Loan        *Loan          `json:"loan"`
	LoanAmounts []int64        `json:"loanAmounts"`
	LoanOptions []LoanOption   `json:"loanOptions"`
	Shares      *SharesView    `json:"shares"`
	LoanWeeks   int            `json:"loanWeeks"`
	TP          int            `json:"tp"`
	TPPrice     int64          `json:"tpPrice"`
	TPBuyLeft   int            `json:"tpBuyLeft"` // TP the club can still buy this season
	TPBuyMax    int            `json:"tpBuyMax"`
}

type FacilityView struct {
	Kind  string `json:"kind"`
	Level int    `json:"level"`
	Max   int    `json:"max"`
	Next  int64  `json:"next"`  // cost of the next level, 0 at max
	Wear  int    `json:"wear"`  // seasons left before it slips a level (0: not running)
	Renew int64  `json:"renew"` // renovation: keeps the level RenovateSeasons more seasons (0: not needed now)
}

func (s *Store) Finance(ctx context.Context, careerID int) (*FinanceView, error) {
	c, err := getCareer(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	club, err := getClub(ctx, s.DB, c.UserClubID)
	if err != nil {
		return nil, err
	}
	v := &FinanceView{Budget: club.Budget, Sponsor: c.Sponsor, Totals: map[string]int64{}, Entries: []FinanceEntry{},
		Upkeep: FacilityUpkeep(club), Ticket: c.Ticket, Loan: c.Loan, LoanAmounts: LoanAmounts, LoanOptions: LoanOptions(club.Reputation), LoanWeeks: LoanWeeks, TP: c.TP, TPPrice: TPPrice, TPBuyMax: TPBuyMax}
	if bought, err := tpBought(ctx, s.DB, c); err == nil {
		v.TPBuyLeft = max(0, TPBuyMax-bought)
	}
	for _, k := range []string{"stadium", "training", "academy", "medical"} {
		lvl := max(1, *facilityLevel(club, k))
		fv := FacilityView{Kind: k, Level: lvl, Max: MaxFacility, Wear: c.Commercial.Wear[k]}
		if lvl < MaxFacility {
			fv.Next = facilityCosts[k][lvl-1]
		}
		if lvl > 1 && fv.Wear < RenovateSeasons {
			fv.Renew = RenovateCost(k, lvl)
		}
		v.Facilities = append(v.Facilities, fv)
	}

	rows, err := s.DB.Query(ctx, `SELECT day, kind, amount FROM finances WHERE career_id=$1 AND season=$2 ORDER BY id DESC`, careerID, c.Season)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var e FinanceEntry
		if err := rows.Scan(&e.Day, &e.Kind, &e.Amount); err != nil {
			return nil, err
		}
		v.Totals[e.Kind] += e.Amount
		if len(v.Entries) < 120 {
			v.Entries = append(v.Entries, e)
		}
	}
	ps, err := queryPlayers(ctx, s.DB, `club_id=$1`, club.ID)
	if err != nil {
		return nil, err
	}
	cs, err := queryCoaches(ctx, s.DB, `club_id=$1`, club.ID)
	if err != nil {
		return nil, err
	}
	applyPay(c, ps, cs)
	for _, p := range ps {
		v.Wages += p.Wage
	}
	v.Shares = sharesView(&c.Commercial, club.Reputation, ps)
	for _, co := range cs {
		v.Staff += co.Wage
	}
	return v, rows.Err()
}

func (s *Store) ChooseSponsor(ctx context.Context, careerID, index int) error {
	_, err := s.Commercial(ctx, careerID, CommercialReq{Action: "sign", Slot: "shirt", Index: index})
	return err
}

// ---------------------------------------------------------------- quests

type questDef struct {
	Kind   string
	Target int
	Reward int64
}

var questPool = []questDef{
	{"win_streak", 3, 1_500_000}, {"goals_match", 4, 1_200_000}, {"clean_sheets", 3, 1_500_000},
	{"live_wins", 2, 2_000_000}, {"goals_total", 10, 1_500_000}, {"sign_young", 1, 800_000},
	{"beat_stronger", 1, 2_000_000}, {"hattrick", 1, 2_000_000}, {"win_away", 2, 1_200_000},
	{"high_rating", 1, 1_000_000}, {"win_cup_match", 2, 1_500_000},
}

type Quest struct {
	ID       int    `json:"id"`
	Kind     string `json:"kind"`
	Target   int    `json:"target"`
	Progress int    `json:"progress"`
	Reward   int64  `json:"reward"`
	Status   string `json:"status"` // active | done | claimed
}

func listQuests(ctx context.Context, q DBTX, careerID int, where string) ([]*Quest, error) {
	rows, err := q.Query(ctx, `SELECT id, kind, target, progress, reward, status FROM quests WHERE career_id=$1 `+where+` ORDER BY id`, careerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Quest{}
	for rows.Next() {
		x := &Quest{}
		if err := rows.Scan(&x.ID, &x.Kind, &x.Target, &x.Progress, &x.Reward, &x.Status); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

// ensureQuests keeps three open quests (active or ready to claim).
func ensureQuests(ctx context.Context, q DBTX, r *rand.Rand, c *Career, rep int) error {
	open, err := listQuests(ctx, q, c.ID, `AND status <> 'claimed'`)
	if err != nil {
		return err
	}
	have := map[string]bool{}
	for _, x := range open {
		have[x.Kind] = true
	}
	if rep == 0 {
		rep = 70
	}
	for len(open) < 3 {
		d := questPool[r.Intn(len(questPool))]
		if have[d.Kind] {
			continue
		}
		have[d.Kind] = true
		reward := int64(float64(d.Reward)*float64(rep)/70/10_000) * 10_000
		x := &Quest{Kind: d.Kind, Target: d.Target, Reward: reward, Status: "active"}
		if _, err := q.Exec(ctx, `INSERT INTO quests (career_id, kind, target, reward) VALUES ($1,$2,$3,$4)`, c.ID, x.Kind, x.Target, x.Reward); err != nil {
			return err
		}
		open = append(open, x)
	}
	return nil
}

func saveQuest(ctx context.Context, q DBTX, x *Quest) error {
	if x.Status == "active" && x.Progress >= x.Target {
		x.Status = "done"
	}
	_, err := q.Exec(ctx, `UPDATE quests SET progress=$2, status=$3 WHERE id=$1`, x.ID, x.Progress, x.Status)
	return err
}

func (w *world) progressQuests(ctx context.Context, q DBTX, uo *matchOutcome) ([]string, error) {
	c := w.career
	f := uo.f
	gf, ga := *f.HomeGoals, *f.AwayGoals
	if uo.userSide == 1 {
		gf, ga = ga, gf
	}
	win := gf > ga || (gf == ga && f.PensHome != nil && (*f.PensHome == (uo.userSide == 0)))
	if gf > ga {
		c.Streak++
	} else {
		c.Streak = 0
	}
	hat := false
	for id, n := range uo.goals {
		if p := w.playerByID(id); p != nil && p.ClubID != nil && *p.ClubID == c.UserClubID && n >= 3 {
			hat = true
		}
	}
	top := 0.0
	for _, p := range w.players[c.UserClubID] {
		if rt, ok := uo.ratings[p.ID]; ok && rt > top {
			top = rt
		}
	}
	qs, err := listQuests(ctx, q, c.ID, `AND status='active'`)
	if err != nil {
		return nil, err
	}
	var done []string
	for _, x := range qs {
		switch x.Kind {
		case "win_streak":
			x.Progress = c.Streak
		case "goals_match":
			if gf > x.Progress {
				x.Progress = gf
			}
		case "clean_sheets":
			if ga == 0 {
				x.Progress++
			}
		case "live_wins":
			if uo.live && gf > ga {
				x.Progress++
			}
		case "goals_total":
			x.Progress += gf
		case "beat_stronger":
			if gf > ga && uo.oppOvr > uo.ownOvr+1 {
				x.Progress = 1
			}
		case "hattrick":
			if hat {
				x.Progress = 1
			}
		case "win_away":
			if gf > ga && uo.userSide == 1 {
				x.Progress++
			}
		case "high_rating":
			if top >= 8.5 {
				x.Progress = 1
			}
		case "win_cup_match":
			if win && f.Comp != "league" {
				x.Progress++
			}
		}
		if x.Progress > x.Target {
			x.Progress = x.Target
		}
		wasActive := x.Status == "active"
		if err := saveQuest(ctx, q, x); err != nil {
			return nil, err
		}
		if wasActive && x.Status == "done" {
			done = append(done, x.Kind)
		}
	}
	return done, nil
}

func (s *Store) Quests(ctx context.Context, careerID int) ([]*Quest, error) {
	return listQuests(ctx, s.DB, careerID, `AND status <> 'claimed'`)
}

func (s *Store) ClaimQuest(ctx context.Context, careerID, questID int) (int64, error) {
	var reward int64
	err := s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		qs, err := listQuests(ctx, q, careerID, `AND status='done'`)
		if err != nil {
			return err
		}
		var x *Quest
		for _, it := range qs {
			if it.ID == questID {
				x = it
			}
		}
		if x == nil {
			return userErr("quest_not_ready", "This quest is not complete yet")
		}
		club, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		x.Status = "claimed"
		if err := saveQuest(ctx, q, x); err != nil {
			return err
		}
		reward = x.Reward
		club.Budget += reward
		if err := addFinance(ctx, q, c, "quest", reward, x.Kind); err != nil {
			return err
		}
		if err := saveClub(ctx, q, club); err != nil {
			return err
		}
		return ensureQuests(ctx, q, newRand(), c, club.Reputation)
	})
	return reward, err
}

// questSignedYoung is called after a successful signing.
func questSignedYoung(ctx context.Context, q DBTX, careerID int, age int) error {
	if age >= 21 {
		return nil
	}
	qs, err := listQuests(ctx, q, careerID, `AND status='active' AND kind='sign_young'`)
	if err != nil {
		return err
	}
	for _, x := range qs {
		x.Progress = x.Target
		if err := saveQuest(ctx, q, x); err != nil {
			return err
		}
	}
	return nil
}
