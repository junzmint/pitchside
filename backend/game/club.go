package game

import (
	"context"
	"math"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- facilities

const MaxFacility = 5

// cost to reach level 2..5
var facilityCosts = map[string][]int64{
	"stadium":  {12 * M, 22 * M, 36 * M, 55 * M},
	"training": {8 * M, 15 * M, 25 * M, 40 * M},
	"academy":  {6 * M, 12 * M, 20 * M, 32 * M},
	"medical":  {7 * M, 14 * M, 24 * M, 38 * M},
}

func facilityLevel(c *Club, kind string) *int {
	switch kind {
	case "stadium":
		return &c.Stadium
	case "training":
		return &c.TrainLvl
	case "academy":
		return &c.Academy
	case "medical":
		return &c.Medical
	}
	return nil
}

// FacilityUpkeep: weekly cost of running the club's facilities.
func FacilityUpkeep(c *Club) int64 {
	return int64(c.Stadium+c.TrainLvl+c.Academy+max(1, c.Medical)-4) * 40_000
}

func (s *Store) UpgradeFacility(ctx context.Context, careerID int, kind string) error {
	return s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		club, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		lvl := facilityLevel(club, kind)
		if lvl == nil {
			return userErr("bad_facility", "Unknown facility")
		}
		if *lvl < 1 {
			*lvl = 1
		}
		if *lvl >= MaxFacility {
			return userErr("facility_max", "Already at the highest level")
		}
		cost := facilityCosts[kind][*lvl-1]
		if club.Budget < cost {
			return userErr("no_budget", "Not enough budget")
		}
		club.Budget -= cost
		*lvl++
		if c.Commercial.Wear == nil {
			c.Commercial.Wear = map[string]int{}
		}
		c.Commercial.Wear[kind] = 1 + newRand().Intn(3) // brand new: lasts one to three seasons
		if err := addFinance(ctx, q, c, "facility", -cost, kind); err != nil {
			return err
		}
		if err := saveCareer(ctx, q, c); err != nil {
			return err
		}
		return saveClub(ctx, q, club)
	})
}

// ---------------------------------------------------------------- tickets & loans

var ticketIncome = map[string]float64{"low": 0.8, "normal": 1, "high": 1.25}
var ticketMorale = map[string]float64{"low": 2, "normal": 0, "high": -2}

func (s *Store) SetTicket(ctx context.Context, careerID int, price string) error {
	if _, ok := ticketIncome[price]; !ok {
		return userErr("bad_ticket", "Unknown ticket price")
	}
	return s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		c.Ticket = price
		return saveCareer(ctx, q, c)
	})
}

const LoanWeeks = 20
const LoanInterest = 0.08

// LoanOption: bigger loans run longer and cost more interest. A bank lends up to 3M per reputation point.
type LoanOption struct {
	Amount int64   `json:"amount"`
	Weeks  int     `json:"weeks"`
	Rate   float64 `json:"rate"`
	Weekly int64   `json:"weekly"`
	Total  int64   `json:"total"`
}

var loanTable = []LoanOption{
	{Amount: 10 * M, Weeks: 20, Rate: 0.08}, {Amount: 25 * M, Weeks: 30, Rate: 0.08}, {Amount: 50 * M, Weeks: 40, Rate: 0.09},
	{Amount: 100 * M, Weeks: 54, Rate: 0.10}, {Amount: 150 * M, Weeks: 80, Rate: 0.12}, {Amount: 200 * M, Weeks: 108, Rate: 0.14},
}

var LoanAmounts = []int64{10 * M, 25 * M, 50 * M, 100 * M, 150 * M, 200 * M}

func LoanOptions(reputation int) []LoanOption {
	var out []LoanOption
	for _, o := range loanTable {
		if o.Amount > int64(reputation)*3*M {
			continue
		}
		o.Total = int64(float64(o.Amount) * (1 + o.Rate))
		o.Weekly = o.Total / int64(o.Weeks) / 1000 * 1000
		out = append(out, o)
	}
	return out
}

func (s *Store) TakeLoan(ctx context.Context, careerID int, amount int64) error {
	return s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		if c.Loan != nil {
			return userErr("has_loan", "Repay your current loan first")
		}
		club, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		var opt *LoanOption
		for _, o := range LoanOptions(club.Reputation) {
			if o.Amount == amount {
				o := o
				opt = &o
			}
		}
		if opt == nil {
			return userErr("bad_loan", "The bank won't lend that much")
		}
		c.Loan = &Loan{Amount: amount, Weekly: opt.Weekly, WeeksLeft: opt.Weeks}
		club.Budget += amount
		if err := addFinance(ctx, q, c, "loan", amount, ""); err != nil {
			return err
		}
		if err := saveClub(ctx, q, club); err != nil {
			return err
		}
		return saveCareer(ctx, q, c)
	})
}

func (s *Store) RepayLoan(ctx context.Context, careerID int) error {
	return s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		if c.Loan == nil {
			return userErr("no_loan", "You have no loan")
		}
		club, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		rest := c.Loan.Weekly * int64(c.Loan.WeeksLeft)
		if club.Budget < rest {
			return userErr("no_budget", "Not enough budget")
		}
		club.Budget -= rest
		c.Loan = nil
		if err := addFinance(ctx, q, c, "loan_repay", -rest, ""); err != nil {
			return err
		}
		if err := saveClub(ctx, q, club); err != nil {
			return err
		}
		return saveCareer(ctx, q, c)
	})
}

// ---------------------------------------------------------------- upgrade points

// TP: earned in matches (TPPerMatch, TPPerWin more for a win), from achievements and manager
// levels, or bought: TPPrice each, at most TPBuyMax a season.
const (
	TPPerMatch = 1
	TPPerWin   = 1
	TPPrice    = 500_000
	TPBuyMax   = 30
)

// tpBought: TP the club has bought this season.
func tpBought(ctx context.Context, q DBTX, c *Career) (int, error) {
	var spent int64
	err := q.QueryRow(ctx, `SELECT COALESCE(-SUM(amount), 0) FROM finances WHERE career_id=$1 AND season=$2 AND kind='tp_buy'`, c.ID, c.Season).Scan(&spent)
	return int((spent + TPPrice/2) / TPPrice), err
}

func (s *Store) BuyTP(ctx context.Context, careerID, n int) error {
	if n < 1 || n > TPBuyMax {
		return userErr("bad_amount", "Buy between 1 and 30 points")
	}
	return s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		bought, err := tpBought(ctx, q, c)
		if err != nil {
			return err
		}
		if bought+n > TPBuyMax {
			return userErr("tp_limit", "You can buy at most 30 TP a season")
		}
		club, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		cost := int64(n) * TPPrice
		if club.Budget < cost {
			return userErr("no_budget", "Not enough budget")
		}
		club.Budget -= cost
		c.TP += n
		if err := addFinance(ctx, q, c, "tp_buy", -cost, ""); err != nil {
			return err
		}
		if err := saveClub(ctx, q, club); err != nil {
			return err
		}
		return saveCareer(ctx, q, c)
	})
}

// AttrUpgradeCost: higher attributes cost more points.
func AttrUpgradeCost(v float64) int { return 1 + int(math.Max(0, math.Floor((v-50)/10))) }

// BreakGap: a player can break his limit once his overall is within this many points of his
// potential, at most once a season.
const BreakGap = 2

// PotentialUpgradeCost: lifting the ceiling gets dearer near the top.
func PotentialUpgradeCost(pot int) int { return 5 + int(math.Max(0, float64(pot-80)/3)) }

type UpgradeResult struct {
	Player *Player `json:"player"`
	TP     int     `json:"tp"`
}

func (s *Store) UpgradePlayer(ctx context.Context, careerID, playerID int, what string) (*UpgradeResult, error) {
	var out *UpgradeResult
	err := s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		p, err := getPlayer(ctx, q, careerID, playerID)
		if err != nil {
			return err
		}
		if p.ClubID == nil || *p.ClubID != c.UserClubID {
			return userErr("not_yours", "This player is not at your club")
		}
		var cost int
		if what == "potential" {
			// legend_versions.go breakCheck: a legend card breaks his limit at any level (still once a season)
			switch breakCheck(c, p) {
			case "too_old":
				return userErr("too_old", "Only players aged 30 or under can break their limit")
			case "max_potential":
				return userErr("max_potential", "Potential is already at the maximum")
			case "break_done":
				return userErr("break_done", "He already broke his limit this season")
			case "not_at_limit":
				return userErr("not_at_limit", "Only a player at his limit can break it")
			}
			cost = PotentialUpgradeCost(p.Potential) * legendCost(p)
			if c.TP < cost {
				return userErr("no_tp", "Not enough upgrade points")
			}
			p.Potential++
			if c.Care.Breaks == nil {
				c.Care.Breaks = map[int]int{}
			}
			c.Care.Breaks[p.ID] = c.Season
		} else {
			v := p.Attr(what)
			if v == nil {
				return userErr("bad_focus", "Unknown attribute")
			}
			if *v >= attrCap(p) {
				return userErr("attr_max", "This attribute is maxed out")
			}
			cost = AttrUpgradeCost(*v) * legendCost(p)
			if c.TP < cost {
				return userErr("no_tp", "Not enough upgrade points")
			}
			*v = math.Min(attrCap(p), math.Floor(*v)+1)
			if OverallAs(p, p.Position) > float64(p.Potential)+0.5 {
				return userErr("at_potential", "He has reached his potential: break the limit first")
			}
		}
		c.TP -= cost
		p.Fill()
		if err := savePlayer(ctx, q, p); err != nil {
			return err
		}
		out = &UpgradeResult{Player: p, TP: c.TP}
		return saveCareer(ctx, q, c)
	})
	return out, err
}
