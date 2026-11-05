package game

import (
	"context"
	"math/rand"
)

// ---------------------------------------------------------------- club life events
// Owned by the "events" work stream: press conferences, playing-time complaints, the captain,
// youth intake day, derbies, weather, awards, manager level, international breaks, loans and bids.
// The pieces live in events_*.go; this file holds the state and the four hooks.

// EventState is stored on the career (careers.events, JSONB).
type EventState struct {
	Rival       int  `json:"rival"`       // the club's fixed rival (club id)
	RivalCity   bool `json:"rivalCity"`   // a same-city (or classic) rivalry: never re-picked
	RivalSeason int  `json:"rivalSeason"` // season the rival was last checked

	Press     *PressConf  `json:"press,omitempty"`     // the answer given before today's match
	PressLog  []PressConf `json:"pressLog,omitempty"`  // settled conferences, newest first
	PressAuto string      `json:"pressAuto,omitempty"` // "" = ask me; otherwise the assistant always answers this way

	Bench      map[int]int `json:"bench,omitempty"` // player → competitive matches in a row without playing
	Talks      []Talk      `json:"talks,omitempty"` // players asking for playing time
	Promises   []Promise   `json:"promises,omitempty"`
	Quiet      map[int]int `json:"quiet,omitempty"`  // player → no new talk before season*100+day
	Listed     map[int]int `json:"listed,omitempty"` // player → put up for sale until season*100+day
	Captain    int         `json:"captain"`
	TalkSeason int         `json:"talkSeason"`
	TalksMade  int         `json:"talksMade"` // talks opened this season

	Youth       *YouthIntake `json:"youth,omitempty"`
	YouthSeason int          `json:"youthSeason"`

	Awards []Award `json:"awards,omitempty"` // newest first

	Level int `json:"level"`
	XP    int `json:"xp"` // total experience

	LoansOut []LoanDeal `json:"loansOut,omitempty"`
	LoansIn  []LoanDeal `json:"loansIn,omitempty"`
	Bids     []Bid      `json:"bids,omitempty"`
	NextID   int        `json:"nextId"`

	Log []Happening `json:"log,omitempty"` // recent happenings, newest first
}

// Happening is a logged ComEvent with its date.
type Happening struct {
	Season int    `json:"season"`
	Day    int    `json:"day"`
	Key    string `json:"key"`
	Name   string `json:"name,omitempty"`
	Amount int64  `json:"amount,omitempty"`
}

const eventLogSize = 30

func (es *EventState) init() {
	if es.Bench == nil {
		es.Bench = map[int]int{}
	}
	if es.Quiet == nil {
		es.Quiet = map[int]int{}
	}
	if es.Listed == nil {
		es.Listed = map[int]int{}
	}
	if es.Level < 1 {
		es.Level = 1
	}
}

func (es *EventState) nextID() int {
	es.NextID++
	return es.NextID
}

// happen adds a line to the day report (when there is one) and to the club-life log.
func (w *world) happen(rep *DayReport, key, name string, amount int64) {
	ev := ComEvent{Key: key, Name: name, Amount: amount}
	if rep != nil {
		rep.Happenings = append(rep.Happenings, ev)
		return // logged at the end of the tick
	}
	w.logHappening(ev)
}

func (w *world) logHappening(ev ComEvent) {
	c := w.career
	es := &c.Events
	day := min(c.Day, len(Calendar))
	es.Log = append([]Happening{{Season: c.Season, Day: day, Key: ev.Key, Name: ev.Name, Amount: ev.Amount}}, es.Log...)
	if len(es.Log) > eventLogSize {
		es.Log = es.Log[:eventLogSize]
	}
}

// userSquad: the players currently at the user's club.
func (w *world) userSquad() []*Player {
	uid := w.career.UserClubID
	var out []*Player
	for _, p := range w.players[uid] {
		if p.ClubID != nil && *p.ClubID == uid {
			out = append(out, p)
		}
	}
	return out
}

func (w *world) squadMorale(delta float64) {
	for _, p := range w.userSquad() {
		p.Morale = clamp(p.Morale+delta, 20, 100)
	}
}

func (w *world) mine(id int) *Player {
	for _, p := range w.userSquad() {
		if p.ID == id {
			return p
		}
	}
	return nil
}

// eventsTick runs once per matchday after the day's matches, money and demands.
func (w *world) eventsTick(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	c := w.career
	if c.Ended != "" {
		return nil
	}
	es := &c.Events
	es.init()
	w.ensureRival()
	if err := w.checkLoansIn(ctx, q, rep); err != nil {
		return err
	}
	w.tidyEvents()
	played := rep.Day
	if played <= len(Calendar) {
		w.expireTalks(rep)
		w.newTalks(r, rep)
		if err := w.youthTick(r, rep, played); err != nil {
			return err
		}
		w.internationalBreak(r, rep, played)
		if played%AwardEvery == 0 && played < len(Calendar) {
			if err := w.playerOfMonth(ctx, q, rep); err != nil {
				return err
			}
		}
		w.bidsTick(r, rep)
	}
	for i := len(rep.Happenings) - 1; i >= 0; i-- {
		w.logHappening(rep.Happenings[i])
	}
	// players were saved before this hook ran: write the squad again with today's club-life changes
	return savePlayers(ctx, q, w.userSquad())
}

// eventsAfterUserMatch runs right after the user's own match has been recorded.
func (w *world) eventsAfterUserMatch(ctx context.Context, q DBTX, r *rand.Rand, f *Fixture, uo *matchOutcome, rep *DayReport) error {
	c := w.career
	if c.Ended != "" || f.HomeGoals == nil || f.AwayGoals == nil {
		return nil
	}
	es := &c.Events
	es.init()
	user := w.byID[c.UserClubID]
	home := f.HomeID == user.ID
	gf, ga := *f.HomeGoals, *f.AwayGoals
	oppID := f.AwayID
	if !home {
		gf, ga = ga, gf
		oppID = f.HomeID
	}
	won := gf > ga || (gf == ga && f.WinnerID() == user.ID)
	lost := gf < ga || (gf == ga && f.WinnerID() == oppID)
	opp := w.byID[oppID]

	// manager experience
	xp := 1
	switch {
	case won:
		xp = 10
	case !lost:
		xp = 4
	}
	switch f.Comp {
	case "cup":
		xp += 2
	case "cl":
		xp += 5
	case "friendly":
		xp = max(1, xp/3)
	}

	// derby day: a fuller stadium and bigger swings in the dressing room
	if w.isDerby(f) {
		if home {
			gate := roundK(float64(user.Reputation) * 10_000 * DerbyGate * (1 + 0.18*float64(max(1, user.Stadium)-1)))
			user.Budget += gate
			rep.Money = append(rep.Money, MoneyLine{Kind: "derby_gate", Amount: gate})
			if err := addFinance(ctx, q, c, "derby_gate", gate, opp.Name); err != nil {
				return err
			}
		}
		switch {
		case won:
			w.squadMorale(DerbySwing)
			xp += 8
			w.happen(rep, "derby_win", opp.Name, 0)
		case lost:
			w.squadMorale(-DerbySwing)
			w.happen(rep, "derby_loss", opp.Name, 0)
		default:
			w.happen(rep, "derby_draw", opp.Name, 0)
		}
	}

	w.settlePress(f, opp, won, lost, rep)

	// the captain steadies the dressing room after a defeat
	if cp := w.mine(es.Captain); cp != nil && lost {
		if _, played := uo.ratings[cp.ID]; played {
			soft := 2.0
			if hasTrait(cp, "leader") {
				soft = 4
			}
			w.squadMorale(soft)
		}
	}

	if f.Comp != "friendly" {
		w.countBench(uo, rep)
	}
	w.addXP(xp, rep)
	return nil
}

// eventsSeasonEnd runs inside finishSeason, after prize money and commercial settlement.
func (w *world) eventsSeasonEnd(ctx context.Context, q DBTX, r *rand.Rand, se *SeasonEnd, rep *DayReport) error {
	c := w.career
	if c.Ended != "" {
		return nil
	}
	es := &c.Events
	es.init()
	if err := w.seasonAwards(ctx, q, rep); err != nil {
		return err
	}
	// trophies and objectives make the manager's name
	xp := 0
	if se.Position == 1 {
		xp += map[int]int{1: 250, 2: 150, 3: 100}[se.Division]
		w.happen(rep, "trophy_league", w.byID[c.UserClubID].Name, 0)
	}
	if se.Cup == "W" {
		xp += 150
		w.happen(rep, "trophy_cup", w.byID[c.UserClubID].Name, 0)
	}
	if se.CL == "W" {
		xp += 300
		w.happen(rep, "trophy_cl", w.byID[c.UserClubID].Name, 0)
	}
	if se.Move == "up" {
		xp += 120
	}
	if b := c.Commercial.Board; b != nil && b.Season == c.Season && b.Result == "met" {
		xp += 80
	}
	w.addXP(xp, rep)
	if err := w.returnLoans(ctx, q, r, rep); err != nil {
		return err
	}
	// talks, promises and bids do not carry over the summer
	es.Talks, es.Promises, es.Bids = nil, nil, nil
	es.Bench = map[int]int{}
	es.Listed = map[int]int{}
	es.Press = nil
	es.Youth = nil
	return nil
}
