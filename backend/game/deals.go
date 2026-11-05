package game

import (
	"context"
	"math"

	"github.com/jackc/pgx/v5"
)

// Deals with computer-run clubs succeed by chance. The player sees the odds before committing and
// can raise them: pay more (or ask less), hire an agent, target a club that needs the position,
// or build a bigger reputation.

type DealReq struct {
	Type     string `json:"type"`     // buy | sell | swap
	PlayerID int    `json:"playerId"` // buy/swap: their player · sell: your player
	ClubID   int    `json:"clubId"`   // sell: buying club
	GiveID   int    `json:"giveId"`   // swap: your player
	Price    int64  `json:"price"`    // buy/sell: fee · swap: cash you add (negative = they add)
	Agent    bool   `json:"agent"`
	Promise  bool   `json:"promise"` // promise a starting place (buy/swap)
	SellOn   bool   `json:"sellOn"`  // offer the selling club a sell-on clause (buy/swap)
	Scout    bool   `json:"scout"`   // send a scout first: costs 1 upgrade point
	Give2ID  int    `json:"give2Id"` // swap: a second player of yours
}

type DealQuote struct {
	Chance  float64  `json:"chance"`
	Fee     int64    `json:"fee"`
	Value   int64    `json:"value"`
	Factors []string `json:"factors"` // reason codes for the UI
	Blocked string   `json:"blocked,omitempty"`
	Ask     int64    `json:"ask"` // what the selling club values him at this season
}

type DealResult struct {
	DealQuote
	Accepted bool `json:"accepted"`
}

var typicalDepth = map[string]int{"GK": 3, "DF": 8, "MF": 8, "FW": 6}

type dealCtx struct {
	c          *Career
	user       *Club
	other      *Club
	p          *Player // their player (buy/swap) or yours (sell)
	give       *Player // swap
	give2      *Player // swap, optional
	theirs     []*Player
	mine       []*Player
	scoutSkill int
	perks      Perks
}

func (s *Store) loadDeal(ctx context.Context, q DBTX, careerID int, req DealReq) (*dealCtx, error) {
	d := &dealCtx{}
	var err error
	if d.c, err = getCareer(ctx, q, careerID); err != nil {
		return nil, err
	}
	if d.user, err = getClub(ctx, q, d.c.UserClubID); err != nil {
		return nil, err
	}
	if d.p, err = getPlayer(ctx, q, careerID, req.PlayerID); err != nil {
		return nil, err
	}
	if d.p.ClubID == nil {
		return nil, userErr("not_at_club", "This player has no club")
	}
	otherID := *d.p.ClubID
	if req.Type == "sell" {
		if *d.p.ClubID != d.user.ID {
			return nil, userErr("not_yours", "This player is not at your club")
		}
		otherID = req.ClubID
	} else if *d.p.ClubID == d.user.ID {
		return nil, userErr("already_yours", "This player is already at your club")
	}
	if d.other, err = getClub(ctx, q, otherID); err != nil || d.other.CareerID != careerID || d.other.IsUser {
		return nil, userErr("bad_club", "Pick another club")
	}
	if req.Type == "swap" {
		if d.give, err = getPlayer(ctx, q, careerID, req.GiveID); err != nil || d.give.ClubID == nil || *d.give.ClubID != d.user.ID {
			return nil, userErr("not_yours", "This player is not at your club")
		}
		if req.Give2ID != 0 && req.Give2ID != req.GiveID {
			if d.give2, err = getPlayer(ctx, q, careerID, req.Give2ID); err != nil || d.give2.ClubID == nil || *d.give2.ClubID != d.user.ID {
				return nil, userErr("not_yours", "This player is not at your club")
			}
		}
	}
	if d.theirs, err = queryPlayers(ctx, q, `club_id=$1`, d.other.ID); err != nil {
		return nil, err
	}
	if d.mine, err = queryPlayers(ctx, q, `club_id=$1`, d.user.ID); err != nil {
		return nil, err
	}
	d.scoutSkill = userScoutSkill(ctx, q, d.user.ID)
	if cs, err := queryCoaches(ctx, q, `club_id=$1`, d.user.ID); err == nil {
		d.perks = perksOf(cs)
	}
	return d, nil
}

func countPos(ps []*Player, pos string) (n int, best int) {
	for _, p := range ps {
		if p.Position == pos {
			n++
			if p.Overall > best {
				best = p.Overall
			}
		}
	}
	return
}

func (d *dealCtx) quote(req DealReq) DealQuote {
	qt := DealQuote{Factors: []string{}}
	add := func(code string, delta float64) {
		qt.Chance += delta
		qt.Factors = append(qt.Factors, code)
	}
	needs := func(club []*Player, p *Player) bool {
		n, best := countPos(club, p.Position)
		return n < typicalDepth[p.Position] || p.Overall >= best-1
	}
	isStarter := func() bool {
		for _, id := range BestLineup(d.theirs, d.other.Formation) {
			if id == d.p.ID {
				return true
			}
		}
		return false
	}
	var avg float64
	for _, p := range d.theirs {
		avg += float64(p.Overall)
	}
	avg /= math.Max(1, float64(len(d.theirs)))

	switch req.Type {
	case "buy":
		qt.Value = req.Price
		qt.Ask = askingPrice(d.p, d.c.Season)
		ratio := float64(req.Price) / float64(qt.Ask)
		qt.Chance = 0.45 + (ratio-1)*1.8
		if ratio >= 1.15 {
			qt.Factors = append(qt.Factors, "generous")
		} else if ratio < 0.95 {
			qt.Factors = append(qt.Factors, "lowball")
		}
		if isStarter() {
			add("key_player", -0.2)
		}
		if float64(d.p.Overall) >= avg+6 {
			add("star", -0.15)
		}
		if n, _ := countPos(d.theirs, d.p.Position); n > typicalDepth[d.p.Position] {
			add("surplus", 0.1)
		}
		if len(d.theirs) <= AIMinSquad {
			add("thin_squad", -0.25)
		}
		if len(d.mine) >= MaxSquad {
			qt.Blocked = "squad_full"
		}
	case "sell":
		qt.Value = req.Price
		ref := resalePrice(d.c, d.p) // resale.go: a recent signing goes for at most what you paid
		ratio := float64(req.Price) / float64(max(1, ref))
		qt.Chance = 0.55 - (ratio-1)*1.6
		if resaleLeft(d.c, d.p) > 0 {
			qt.Factors = append(qt.Factors, "recent_signing")
		}
		if ratio > 1.1 {
			qt.Factors = append(qt.Factors, "pricey")
		} else if ratio < 0.95 {
			qt.Factors = append(qt.Factors, "bargain")
		}
		if needs(d.theirs, d.p) {
			add("need", 0.2)
		}
		if d.p.Age >= 31 {
			add("age", -0.1)
		}
		if d.p.Injury > 0 {
			add("injured", -0.25)
		}
		if d.other.Budget < req.Price {
			qt.Blocked = "their_budget"
		}
		if len(d.mine) <= MinSquad {
			qt.Blocked = "squad_min"
		}
	case "swap":
		qt.Value = d.p.Value
		qt.Ask = askingPrice(d.p, d.c.Season)
		in := float64(resalePrice(d.c, d.give)) + float64(req.Price)
		if d.give2 != nil {
			in += float64(resalePrice(d.c, d.give2)) * 0.9
			qt.Factors = append(qt.Factors, "two_players")
		}
		if needs(d.theirs, d.give) || (d.give2 != nil && needs(d.theirs, d.give2)) {
			in *= 1.15
			qt.Factors = append(qt.Factors, "need")
		}
		ratio := in / float64(qt.Ask)
		qt.Chance = 0.45 + (ratio-1)*1.8
		if ratio >= 1.15 {
			qt.Factors = append(qt.Factors, "generous")
		} else if ratio < 0.95 {
			qt.Factors = append(qt.Factors, "lowball")
		}
		if isStarter() {
			add("key_player", -0.15)
		}
		if float64(d.p.Overall) >= avg+6 {
			add("star", -0.1)
		}
		if req.Price < 0 && d.other.Budget < -req.Price {
			qt.Blocked = "their_budget"
		}
	default:
		qt.Blocked = "bad_deal"
	}
	if d.user.Reputation-d.other.Reputation >= 5 && req.Type != "sell" {
		add("prestige", 0.1)
	}
	if d.other.Reputation-d.user.Reputation >= 8 && req.Type != "sell" {
		add("small_club", -0.08)
	}
	if req.Type != "sell" {
		if req.Promise {
			add("promise", 0.10)
		}
		if req.SellOn {
			add("sell_on", 0.07)
		}
	}
	if req.Scout {
		add("scout", 0.06)
		if d.c.TP < 1 {
			qt.Blocked = "no_tp"
		}
	}
	// every completed deal with this club makes the next one easier
	if rel := math.Min(0.16, float64(d.other.Deals)*0.04); rel > 0 {
		add("relationship", rel)
	}
	if sk := d.scoutSkill; sk > 0 && req.Type != "sell" {
		add("scout_staff", float64(sk)*0.005)
	}
	if d.perks["negotiator"] {
		add("negotiator", 0.05)
	}
	if req.Agent {
		add("agent", 0.15)
		qt.Fee = int64(math.Max(100_000, float64(qt.Value)*0.04)/10_000) * 10_000
	}
	cash := int64(0)
	switch req.Type {
	case "buy":
		cash = req.Price
	case "swap":
		if req.Price > 0 {
			cash = req.Price
		}
	}
	// only money the club has to pay up front needs covering; a sale (even with an agent, whose fee
	// comes off the proceeds) or a cash-free swap must stay possible for a club in debt
	need := cash
	if req.Type != "sell" {
		need += qt.Fee
	}
	if need > 0 && d.user.Budget < need {
		qt.Blocked = "no_budget"
	}
	if req.Price < 0 && req.Type != "swap" {
		qt.Blocked = "bad_price"
	}
	qt.Chance = math.Round(clamp(qt.Chance, 0.02, 0.95)*100) / 100
	return qt
}

func (s *Store) QuoteDeal(ctx context.Context, careerID int, req DealReq) (*DealQuote, error) {
	d, err := s.loadDeal(ctx, s.DB, careerID, req)
	if err != nil {
		return nil, err
	}
	qt := d.quote(req)
	var tried bool
	_ = s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM deal_attempts WHERE career_id=$1 AND player_id=$2 AND season=$3 AND day=$4)`,
		careerID, req.PlayerID, d.c.Season, d.c.Day).Scan(&tried)
	if tried {
		qt.Blocked = "tried_this_week"
	}
	return &qt, nil
}

func (s *Store) MakeDeal(ctx context.Context, careerID int, req DealReq) (*DealResult, error) {
	var out *DealResult
	err := s.tx(ctx, func(q pgx.Tx) error {
		d, err := s.loadDeal(ctx, q, careerID, req)
		if err != nil {
			return err
		}
		qt := d.quote(req)
		tag, err := q.Exec(ctx, `INSERT INTO deal_attempts (career_id, player_id, season, day) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
			careerID, req.PlayerID, d.c.Season, d.c.Day)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return userErr("tried_this_week", "You already tried for this player this week")
		}
		if qt.Blocked != "" {
			return userErr(qt.Blocked, "This deal is not possible")
		}
		// club_deadline.go: a Deadline Day bargain can't be sold or swapped on straight away for a profit
		switch req.Type {
		case "sell":
			err = checkBargainHeld(ctx, q, careerID, d.p.ID)
		case "swap":
			ids := []int{d.give.ID}
			if d.give2 != nil {
				ids = append(ids, d.give2.ID)
			}
			err = checkBargainHeld(ctx, q, careerID, ids...)
		}
		if err != nil {
			return err
		}
		out = &DealResult{DealQuote: qt}
		if req.Scout {
			d.c.TP--
			if err := saveCareer(ctx, q, d.c); err != nil {
				return err
			}
		}
		if qt.Fee > 0 {
			d.user.Budget -= qt.Fee
			if err := addFinance(ctx, q, d.c, "agent_fee", -qt.Fee, d.p.Name); err != nil {
				return err
			}
		}
		out.Accepted = newRand().Float64() < qt.Chance
		if out.Accepted {
			_, myShirt, err := nextShirt(ctx, q, d.user.ID)
			if err != nil {
				return err
			}
			_, theirShirt, err := nextShirt(ctx, q, d.other.ID)
			if err != nil {
				return err
			}
			switch req.Type {
			case "buy":
				d.user.Budget -= req.Price
				d.other.Budget += req.Price
				moveTo(d.p, &d.user.ID, myShirt)
				if req.Promise {
					d.p.Morale = clamp(d.p.Morale+10, 20, 100)
				}
				if err := addFinance(ctx, q, d.c, "transfer_in", -req.Price, d.p.Name); err != nil {
					return err
				}
				noteSigning(d.c, d.p, req.Price)
				if err := questSignedYoung(ctx, q, careerID, d.p.Age); err != nil {
					return err
				}
			case "sell":
				d.user.Budget += req.Price
				d.other.Budget -= req.Price
				moveTo(d.p, &d.other.ID, theirShirt)
				if err := addFinance(ctx, q, d.c, "transfer_out", req.Price, d.p.Name); err != nil {
					return err
				}
			case "swap":
				fee := resalePrice(d.c, d.give) + req.Price
				if d.give2 != nil {
					fee += resalePrice(d.c, d.give2)
				}
				noteSigning(d.c, d.p, fee)
				d.user.Budget -= req.Price
				d.other.Budget += req.Price
				moveTo(d.p, &d.user.ID, myShirt)
				moveTo(d.give, &d.other.ID, theirShirt)
				if err := savePlayer(ctx, q, d.give); err != nil {
					return err
				}
				if d.give2 != nil {
					moveTo(d.give2, &d.other.ID, theirShirt+1)
					if err := savePlayer(ctx, q, d.give2); err != nil {
						return err
					}
				}
				if req.Price != 0 {
					if err := addFinance(ctx, q, d.c, "swap_cash", -req.Price, d.p.Name); err != nil {
						return err
					}
				}
				if err := questSignedYoung(ctx, q, careerID, d.p.Age); err != nil {
					return err
				}
			}
			if err := savePlayer(ctx, q, d.p); err != nil {
				return err
			}
			d.other.Deals++
			if err := saveClub(ctx, q, d.other); err != nil {
				return err
			}
			if req.Type != "sell" {
				if err := saveCareer(ctx, q, d.c); err != nil {
					return err
				}
			}
		}
		return saveClub(ctx, q, d.user)
	})
	return out, err
}
