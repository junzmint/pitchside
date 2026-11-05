package game

import (
	"context"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- view

type RivalView struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Short    string `json:"short"`
	Color    string `json:"color"`
	Color2   string `json:"color2"`
	Division int    `json:"division"`
	City     bool   `json:"city"`
}

type TodayEvents struct {
	FixtureID int    `json:"fixtureId"`
	Derby     bool   `json:"derby"`
	Weather   string `json:"weather"`
	Press     bool   `json:"press"`  // a press conference is due before this match
	Answer    string `json:"answer"` // what you said ("" while unanswered)
	Auto      bool   `json:"auto"`   // the assistant answers (or answered) for you
	Opponent  string `json:"opponent"`
}

type EventsView struct {
	Level       int               `json:"level"`
	XP          int               `json:"xp"`
	LevelXP     int               `json:"levelXp"` // XP at the start of the current level
	NextXP      int               `json:"nextXp"`  // XP needed for the next level (0 at the top)
	Perks       ManagerPerks      `json:"perks"`
	Captain     int               `json:"captain"`
	CaptainName string            `json:"captainName"`
	Rival       *RivalView        `json:"rival"`
	Today       *TodayEvents      `json:"today"`
	Weather     map[string]string `json:"weather"` // fixture id → weather for the club's remaining fixtures
	Derbies     []int             `json:"derbies"` // fixture ids of this season's derbies
	Talks       []Talk            `json:"talks"`
	Promises    []Promise         `json:"promises"`
	Bids        []Bid             `json:"bids"`
	Youth       *YouthIntake      `json:"youth"`
	LoansOut    []LoanDeal        `json:"loansOut"`
	LoansIn     []LoanDeal        `json:"loansIn"`
	Loanees     []int             `json:"loanees"` // borrowed players: not yours to sell
	Listed      []int             `json:"listed"`
	Awards      []Award           `json:"awards"`
	PressLog    []PressConf       `json:"pressLog"`
	PressAuto   string            `json:"pressAuto"` // "" = you answer; otherwise how the assistant answers
	Log         []Happening       `json:"log"`
	NextBreak   int               `json:"nextBreak"`
	BreakDays   []int             `json:"breakDays"`
	YouthDay    int               `json:"youthDay"`
	LoanWindow  int               `json:"loanWindow"`
	MaxLoansOut int               `json:"maxLoansOut"`
	MaxLoansIn  int               `json:"maxLoansIn"`
	Waiting     int               `json:"waiting"` // decisions waiting for an answer
}

// eventsView is sent with the career state (CareerState.eventsView).
func (w *world) eventsView() any {
	c := w.career
	es := &c.Events
	es.init()
	w.ensureRival()
	v := &EventsView{Level: es.Level, XP: es.XP, LevelXP: xpForLevel(es.Level), Perks: managerPerks(es.Level), Captain: es.Captain,
		Weather: map[string]string{}, Derbies: []int{}, Talks: es.Talks, Promises: es.Promises, Bids: es.Bids, Youth: es.Youth,
		LoansOut: es.LoansOut, LoansIn: es.LoansIn, Loanees: []int{}, Listed: []int{}, Awards: es.Awards, PressLog: es.PressLog, PressAuto: es.PressAuto, Log: es.Log,
		NextBreak: nextBreak(c.Day), BreakDays: BreakDays, YouthDay: YouthDay, LoanWindow: LoanWindow, MaxLoansOut: MaxLoansOut, MaxLoansIn: MaxLoansIn}
	if es.Level < MaxManagerLevel {
		v.NextXP = xpForLevel(es.Level + 1)
	}
	if p := w.mine(es.Captain); p != nil {
		v.CaptainName = p.Name
	} else {
		v.Captain = 0
	}
	if rv := w.byID[es.Rival]; rv != nil {
		v.Rival = &RivalView{ID: rv.ID, Name: rv.Name, Short: rv.Short, Color: rv.Color, Color2: rv.Color2, Division: rv.Division, City: es.RivalCity}
	}
	for _, f := range w.fixtures {
		if f.HomeID != c.UserClubID && f.AwayID != c.UserClubID {
			continue
		}
		if !f.Played {
			v.Weather[strconv.Itoa(f.ID)] = weatherFor(f)
		}
		if w.isDerby(f) {
			v.Derbies = append(v.Derbies, f.ID)
		}
	}
	if f := w.userFixture(); f != nil {
		opp := w.byID[f.AwayID]
		if f.AwayID == c.UserClubID {
			opp = w.byID[f.HomeID]
		}
		t := &TodayEvents{FixtureID: f.ID, Derby: w.isDerby(f), Weather: weatherFor(f), Press: w.pressNotable(f), Opponent: opp.Name}
		if es.Press != nil && es.Press.FixtureID == f.ID {
			t.Answer, t.Auto = es.Press.Answer, es.Press.Auto
		} else if t.Press && es.PressAuto != "" {
			t.Answer, t.Auto = es.PressAuto, true
		}
		v.Today = t
		if t.Press && t.Answer == "" {
			v.Waiting++
		}
	}
	for _, d := range es.LoansIn {
		v.Loanees = append(v.Loanees, d.PlayerID)
	}
	for id, until := range es.Listed {
		if until > c.now() {
			v.Listed = append(v.Listed, id)
		}
	}
	for i := range v.LoansOut {
		d := &v.LoansOut[i]
		if p := w.playerByID(d.PlayerID); p != nil {
			d.Overall = p.Overall
		}
	}
	v.Waiting += len(es.Talks) + len(es.Bids)
	if es.Youth != nil {
		v.Waiting += len(es.Youth.Prospects)
	}
	if v.Talks == nil {
		v.Talks = []Talk{}
	}
	if v.Promises == nil {
		v.Promises = []Promise{}
	}
	if v.Bids == nil {
		v.Bids = []Bid{}
	}
	if v.LoansOut == nil {
		v.LoansOut = []LoanDeal{}
	}
	if v.LoansIn == nil {
		v.LoansIn = []LoanDeal{}
	}
	if v.Awards == nil {
		v.Awards = []Award{}
	}
	if v.PressLog == nil {
		v.PressLog = []PressConf{}
	}
	if v.Log == nil {
		v.Log = []Happening{}
	}
	return v
}

// ---------------------------------------------------------------- actions

type EventReq struct {
	Action   string `json:"action"` // press | talk | youth | bid | loan_out | loan_in | captain
	ID       int    `json:"id"`     // talk, prospect or bid id
	PlayerID int    `json:"playerId"`
	Choice   string `json:"choice"`
}

type EventResult struct {
	Outcome string    `json:"outcome,omitempty"`
	Amount  int64     `json:"amount,omitempty"`
	Loan    *LoanDeal `json:"loan,omitempty"`
}

// EventAction handles every club-life decision.
func (s *Store) EventAction(ctx context.Context, careerID int, req EventReq) (*EventResult, error) {
	out := &EventResult{}
	err := s.tx(ctx, func(q pgx.Tx) error {
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		r := newRand()
		w, err := loadWorld(ctx, q, r, careerID)
		if err != nil {
			return err
		}
		c := w.career
		es := &c.Events
		es.init()
		w.ensureRival()
		user := w.byID[c.UserClubID]
		switch req.Action {
		case "press_auto": // "" = ask me; bold | calm | deflect = the assistant answers that way from now on
			ok := req.Choice == ""
			for _, a := range PressAnswers {
				ok = ok || a == req.Choice
			}
			if !ok {
				return userErr("bad_choice", "Unknown answer")
			}
			es.PressAuto = req.Choice
			if es.Press != nil && es.Press.Auto { // today's automatic answer follows the new setting
				es.Press = nil
			}
			out.Outcome = req.Choice
		case "press":
			f := w.userFixture()
			if f == nil || !w.pressNotable(f) {
				return userErr("no_press", "There is no press conference today")
			}
			if es.Press != nil && es.Press.FixtureID == f.ID && !es.Press.Auto {
				return userErr("press_done", "You have already spoken to the press")
			}
			ok := false
			for _, a := range PressAnswers {
				ok = ok || a == req.Choice
			}
			if !ok {
				return userErr("bad_choice", "Unknown answer")
			}
			opp := w.byID[f.AwayID]
			if f.AwayID == c.UserClubID {
				opp = w.byID[f.HomeID]
			}
			es.Press = &PressConf{FixtureID: f.ID, Answer: req.Choice, Opponent: opp.Name, Season: c.Season, Day: c.Day}
			out.Outcome = req.Choice
		case "talk":
			i := -1
			for j, t := range es.Talks {
				if t.ID == req.ID {
					i = j
				}
			}
			if i < 0 {
				return userErr("no_talk", "He has already left your office")
			}
			t := es.Talks[i]
			if err := w.answerTalk(t, req.Choice, nil); err != nil {
				return err
			}
			es.Talks = append(es.Talks[:i], es.Talks[i+1:]...)
			out.Outcome = req.Choice
		case "youth":
			if err := w.youthAnswer(ctx, q, req.ID, req.Choice); err != nil {
				return err
			}
			out.Outcome = req.Choice
		case "bid":
			o, fee, err := w.answerBid(ctx, q, r, req.ID, req.Choice)
			if err != nil {
				return err
			}
			out.Outcome, out.Amount = o, fee
		case "loan_out":
			d, err := w.loanOut(ctx, q, r, req.PlayerID)
			if err != nil {
				return err
			}
			out.Outcome, out.Loan, out.Amount = "loaned", d, d.Fee
		case "loan_in":
			d, err := w.loanIn(ctx, q, req.PlayerID)
			if err != nil {
				return err
			}
			out.Outcome, out.Loan, out.Amount = "borrowed", d, d.Fee
		case "captain":
			p := w.mine(req.PlayerID)
			if p == nil {
				return userErr("not_yours", "This player is not at your club")
			}
			if es.Captain == p.ID {
				break
			}
			if old := w.mine(es.Captain); old != nil {
				old.Morale = clamp(old.Morale-6, 20, 100) // losing the armband stings
			}
			p.Morale = clamp(p.Morale+5, 20, 100)
			es.Captain = p.ID
			w.logHappening(ComEvent{Key: "captain_new", Name: p.Name})
			out.Outcome = "captain"
		default:
			return userErr("bad_action", "Unknown action")
		}
		if err := savePlayers(ctx, q, w.userSquad()); err != nil {
			return err
		}
		if err := saveClub(ctx, q, user); err != nil {
			return err
		}
		return saveCareer(ctx, q, c)
	})
	return out, err
}

// ---------------------------------------------------------------- loan market

type LoanMarketView struct {
	Players  []LoanCand `json:"players"`
	Budget   int64      `json:"budget"`
	Open     bool       `json:"open"`
	LoansIn  int        `json:"loansIn"`
	LoansOut int        `json:"loansOut"`
	Squad    int        `json:"squad"`
}

func (s *Store) LoanMarket(ctx context.Context, careerID int) (*LoanMarketView, error) {
	var v *LoanMarketView
	err := s.tx(ctx, func(q pgx.Tx) error {
		w, err := loadWorld(ctx, q, newRand(), careerID)
		if err != nil {
			return err
		}
		c := w.career
		user := w.byID[c.UserClubID]
		v = &LoanMarketView{Players: w.loanable(), Budget: user.Budget, Open: c.Day <= LoanWindow,
			LoansIn: len(c.Events.LoansIn), LoansOut: len(c.Events.LoansOut), Squad: len(w.userSquad())}
		ps := make([]*Player, len(v.Players))
		for i, lc := range v.Players {
			ps[i] = lc.Player
		}
		redact(ps, user.ID, coachSkill(w.coaches[user.ID], "scout"))
		if v.Players == nil {
			v.Players = []LoanCand{}
		}
		return nil
	})
	return v, err
}
