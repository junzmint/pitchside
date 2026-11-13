package game

import (
	"math"
	"sort"
)

// ---------------------------------------------------------------- alerts: "needs your attention"
//
// Things that need the manager, worked out fresh every time the career is loaded and after every
// matchday (nothing is stored): unhappy coaches and players, contracts running out, talks waiting
// for an answer, money trouble, empty staff roles, and decisions waiting in the staff and medical
// rooms. Each alert says what to do about it (Action) so the UI can offer a one-click fix or open
// the right page. The UI text is "al." + Key.

type Alert struct {
	Key    string   `json:"key"`
	Level  string   `json:"level"`          // bad | warn | info
	Kind   string   `json:"kind,omitempty"` // player | coach
	ID     int      `json:"id,omitempty"`
	Name   string   `json:"name,omitempty"`
	Role   string   `json:"role,omitempty"`
	N      int      `json:"n,omitempty"`      // morale, days or seasons left, a count…
	Amount int64    `json:"amount,omitempty"` // a bonus's cost, a debt, a wage asked…
	Names  []string `json:"names,omitempty"`  // grouped alerts: who
	Action string   `json:"action"`           // bonus | renew | talks | staff | medical | squad | finance | rest | unrest
	Ready  bool     `json:"ready,omitempty"`  // the action can be taken right now (a bonus is allowed)
}

const (
	AlertCoachMorale  = 45.0 // a coach below this is unhappy (StaffUnhappy and below: he works worse and may walk out)
	AlertPlayerMorale = 40.0
	AlertGroupAbove   = 3 // more players than this with the same problem make one grouped alert
)

var alertRank = map[string]int{"bad": 0, "warn": 1, "info": 2}

func (w *world) alerts() []Alert {
	c := w.career
	user := w.byID[c.UserClubID]
	if c.Ended != "" || user == nil {
		return []Alert{}
	}
	out := []Alert{}
	add := func(a Alert) { out = append(out, a) }
	inSeason := c.Day <= len(Calendar)

	// money: unpaid wages drive players away
	if user.Budget < 0 {
		add(Alert{Key: "debt", Level: "bad", Amount: -user.Budget, Action: "finance"})
	}

	// coaches: mood, contracts, retirement
	st := w.crew
	have := map[string]bool{}
	for _, co := range w.coaches[user.ID] {
		have[co.Role] = true
		if st == nil {
			continue
		}
		l := st.People[co.ID]
		if l == nil {
			continue
		}
		if l.Morale < AlertCoachMorale {
			a := Alert{Key: "coach_unhappy", Level: "warn", Kind: "coach", ID: co.ID, Name: co.Name, Role: co.Role,
				N: int(math.Round(l.Morale)), Amount: roundK(float64(co.Wage) * StaffBonusWeeks), Action: "bonus", Ready: st.Tick >= l.BonusUntil}
			if l.Morale <= StaffUnhappy {
				a.Key, a.Level = "coach_angry", "bad"
			}
			add(a)
		}
		if l.Retiring {
			add(Alert{Key: "coach_retiring", Level: "warn", Kind: "coach", ID: co.ID, Name: co.Name, Role: co.Role, Action: "staff"})
		} else if inSeason && l.Years <= 1 && !l.Leaving {
			add(Alert{Key: "coach_contract", Level: "info", Kind: "coach", ID: co.ID, Name: co.Name, Role: co.Role, Action: "staff"})
		}
	}
	for _, role := range CoachRoles {
		if !have[role] {
			add(Alert{Key: "role_vacant", Level: "warn", Role: role, Action: "staff"})
		}
	}

	// decisions waiting in the staff room and the medical room
	if b := w.staffBadge(); b != nil && b.Waiting > 0 {
		lvl := "warn"
		if b.Urgent > 0 {
			lvl = "bad"
		}
		add(Alert{Key: "staff_cards", Level: lvl, N: b.Waiting, Action: "staff"})
	}
	if w.med != nil {
		if n := len(w.liveCards()); n > 0 {
			add(Alert{Key: "medical_cards", Level: "warn", N: n, Action: "medical"})
		}
	}

	// talks waiting for an answer: raises and renewals, players and coaches
	for _, d := range c.Contracts.Demands {
		left := max(0, d.Until-c.Day)
		lvl := "warn"
		if left <= 1 {
			lvl = "bad"
		}
		key := "talks_raise"
		if d.Renewal {
			key = "talks_renewal"
		}
		add(Alert{Key: key, Level: lvl, Kind: d.Kind, ID: d.ID, Name: d.Name, Role: d.Role, N: left, Amount: d.Ask, Action: "talks"})
	}

	// locked starters the assistant would rest (lineup_lock.go)
	locks, tipped := w.lockAlerts()
	out = append(out, locks...)

	// players: walking out over unpaid wages, contracts running out, low morale
	var expiring, unhappy []*Player
	for _, p := range w.players[user.ID] {
		if p.Unrest > 0 {
			add(Alert{Key: "player_unrest", Level: "bad", Kind: "player", ID: p.ID, Name: p.Name, N: max(0, UnrestWeeks-p.Unrest), Action: "finance"})
			continue
		}
		if p.Contract == 1 && !isLegend(p) && c.demandFor("player", p.ID) < 0 && !w.isLoanee(p.ID) {
			expiring = append(expiring, p)
		}
		if p.Morale < AlertPlayerMorale && p.Injury == 0 && !tipped[p.ID] {
			unhappy = append(unhappy, p)
		}
	}
	byOvr := func(ps []*Player) {
		sort.SliceStable(ps, func(i, j int) bool { return ps[i].Overall > ps[j].Overall })
	}
	byOvr(expiring)
	byOvr(unhappy)
	if len(expiring) > AlertGroupAbove {
		a := Alert{Key: "contracts_many", Level: "info", N: len(expiring), Action: "squad"}
		for _, p := range expiring[:AlertGroupAbove] {
			a.Names = append(a.Names, p.Name)
		}
		add(a)
	} else {
		for _, p := range expiring {
			add(Alert{Key: "player_contract", Level: "info", Kind: "player", ID: p.ID, Name: p.Name, Action: "renew", Ready: true})
		}
	}
	if len(unhappy) > AlertGroupAbove {
		a := Alert{Key: "players_unhappy", Level: "warn", N: len(unhappy), Action: "squad"}
		for _, p := range unhappy[:AlertGroupAbove] {
			a.Names = append(a.Names, p.Name)
		}
		add(a)
	} else {
		for _, p := range unhappy {
			add(Alert{Key: "player_unhappy", Level: "warn", Kind: "player", ID: p.ID, Name: p.Name, N: int(math.Round(p.Morale)), Action: "squad"})
		}
	}

	sort.SliceStable(out, func(i, j int) bool { return alertRank[out[i].Level] < alertRank[out[j].Level] })
	return out
}
