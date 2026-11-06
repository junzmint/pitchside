package game

import (
	"context"
	"encoding/json"
	"math"
	"math/rand"
	"sort"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- club life
// Owned by the "club" work stream: the supporters and their mood (club_fans.go), the pre-season
// tour (club_tour.go), Deadline Day (club_deadline.go) and the Legends wall with retired shirt
// numbers (club_legends.go).
//
// The state lives on the career (careers.club_life, JSONB) and is loaded on first use (w.clubLife).
// Hooks: fanMods (PlayDay, before the user's match), clubTick (end of advance) and clubNewSeason
// (end of StartNextSeason). economy.go reads fanGate / fanMerch for tickets and shirt sales.

type ClubLife struct {
	Init     bool           `json:"init"`
	Fans     FanState       `json:"fans"`
	Tour     *TourState     `json:"tour,omitempty"`
	Deadline *DeadlineState `json:"deadline,omitempty"`
	Legends  []LegendEntry  `json:"legends,omitempty"` // newest first
	Retired  []int          `json:"retired,omitempty"` // retired shirt numbers
	Roster   []RosterEntry  `json:"roster,omitempty"`  // the squad at the last check (to notice arrivals and departures)
	Joined   map[int]int    `json:"joined,omitempty"`  // player → when he arrived (season*100+day), for recent signings
	Shirts   []int          `json:"shirts,omitempty"`  // players whose number you picked yourself (shirts.go leaves it alone)
}

// RosterEntry: one player of the squad as it was at the last check.
type RosterEntry struct {
	ID       int  `json:"id"`
	Shirt    int  `json:"shirt"`
	Tenure   int  `json:"tenure"`
	Ovr      int  `json:"ovr"`
	Loan     bool `json:"loan,omitempty"`     // out on loan: still ours
	Borrowed bool `json:"borrowed,omitempty"` // on loan here: not ours to miss
}

func loadClubLife(ctx context.Context, q DBTX, careerID int) (*ClubLife, error) {
	var raw []byte
	if err := q.QueryRow(ctx, `SELECT club_life FROM careers WHERE id=$1`, careerID).Scan(&raw); err != nil {
		return nil, notFound(err)
	}
	cl := &ClubLife{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, cl)
	}
	cl.tidyLegends()
	return cl, nil
}

func saveClubLife(ctx context.Context, q DBTX, careerID int, cl *ClubLife) error {
	_, err := q.Exec(ctx, `UPDATE careers SET club_life=$2 WHERE id=$1`, careerID, cl)
	return err
}

// clubLife loads the club-life state once per request.
func (w *world) clubLife(ctx context.Context, q DBTX) *ClubLife {
	if w.life == nil {
		cl, err := loadClubLife(ctx, q, w.career.ID)
		if err != nil || cl == nil {
			cl = &ClubLife{}
		}
		w.life = cl
	}
	return w.life
}

// mineOnly: the players of a list who are at the user's club.
func (w *world) mineOnly(ps []*Player) []*Player {
	uid := w.career.UserClubID
	out := []*Player{}
	for _, p := range ps {
		if p.ClubID != nil && *p.ClubID == uid {
			out = append(out, p)
		}
	}
	return out
}

func (w *world) initClubLife(life *ClubLife, squad []*Player) {
	life.Init = true
	life.Fans = FanState{Mood: FanStart, Season: w.career.Season}
	life.Roster = w.snapshotRoster(life, squad)
}

// snapshotRoster remembers the squad (and the players out on loan) for the next check.
func (w *world) snapshotRoster(life *ClubLife, squad []*Player) []RosterEntry {
	es := &w.career.Events
	borrowed := map[int]bool{}
	for _, d := range es.LoansIn {
		borrowed[d.PlayerID] = true
	}
	prev := map[int]RosterEntry{}
	for _, e := range life.Roster {
		prev[e.ID] = e
	}
	out := make([]RosterEntry, 0, len(squad)+len(es.LoansOut))
	seen := map[int]bool{}
	for _, p := range squad {
		seen[p.ID] = true
		out = append(out, RosterEntry{ID: p.ID, Shirt: p.Shirt, Tenure: p.Tenure, Ovr: p.Overall, Borrowed: borrowed[p.ID]})
	}
	for _, d := range es.LoansOut {
		if seen[d.PlayerID] {
			continue
		}
		e := RosterEntry{ID: d.PlayerID, Shirt: prev[d.PlayerID].Shirt, Tenure: d.Tenure, Ovr: d.Overall, Loan: true}
		if e.Shirt == 0 {
			e.Shirt = prev[d.PlayerID].Shirt
		}
		out = append(out, e)
	}
	return out
}

// ---------------------------------------------------------------- the matchday hook

// clubTick runs at the end of every matchday (advance): arrivals and departures, the fans' verdict
// on today's match and season, the tour's lasting effects, Deadline Day, retired shirt numbers.
func (w *world) clubTick(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport, uo *matchOutcome, injuredToday map[int]bool) error {
	c := w.career
	if c.Ended != "" || rep == nil {
		return nil
	}
	life := w.clubLife(ctx, q)
	squad := w.userSquad()
	before := life.Fans.Mood
	var notes []FanNote
	var changed []*Player
	if !life.Init {
		w.initClubLife(life, squad)
		before = life.Fans.Mood
	} else {
		ns, err := w.rosterChanges(ctx, q, life, squad, false, rep)
		if err != nil {
			return err
		}
		notes = append(notes, ns...)
	}
	// club_legends.go: the wall's active legends keep their numbers up to date (new ones join at the season's end)
	ns, err := w.inductActive(ctx, q, life, squad, rep, false)
	if err != nil {
		return err
	}
	notes = append(notes, ns...)
	if life.Fans.Season != c.Season && c.Day <= len(Calendar) {
		life.Fans.Season, life.Fans.Trend = c.Season, nil
	}
	home := uo != nil && uo.userSide == 0 && uo.f.Comp != "friendly"
	if uo != nil {
		notes = append(notes, w.fansAfterMatch(life, uo)...)
	}
	if rep.SeasonEnd != nil {
		notes = append(notes, w.fansSeasonEnd(rep.SeasonEnd)...)
		w.offerTours(life, rep)
	}
	if uo != nil || len(notes) > 0 || rep.Day <= len(Calendar) {
		w.applyFanNotes(life, notes, true)
	}
	if home {
		life.Fans.Gate = attendance(w.byID[c.UserClubID], before, c.Ticket)
	}
	changed = append(changed, w.tourLasting(r, life, squad, rep, injuredToday)...)
	if err := w.deadlineTick(ctx, q, r, life, rep); err != nil {
		return err
	}
	if err := w.pickFavourite(ctx, q, life, squad); err != nil {
		return err
	}
	w.pickVoice(life, notes, rep.Day)
	life.pruneShirts(squad)
	changed = append(changed, guardShirts(life, squad)...)
	life.Roster = w.snapshotRoster(life, squad)
	w.fanReport(life, before, uo, home, rep, notes)
	if len(changed) > 0 {
		if err := savePlayers(ctx, q, uniquePlayers(changed)); err != nil {
			return err
		}
	}
	return saveClubLife(ctx, q, c.ID, life)
}

// clubNewSeason runs at the end of StartNextSeason, after ageing, retirements, expired contracts and
// the summer window: farewells, summer optimism, the tour's season-start effects and Deadline Day.
func (w *world) clubNewSeason(ctx context.Context, q DBTX, r *rand.Rand, res *NewSeasonResult) error {
	c := w.career
	if c.Ended != "" {
		return nil
	}
	life := w.clubLife(ctx, q)
	// the world loaded at the start of the request is stale now: read the players again
	fresh, err := competitionPlayers(ctx, q, c.ID)
	if err != nil {
		return err
	}
	squads := map[int][]*Player{}
	for _, p := range fresh {
		if p.ClubID != nil {
			squads[*p.ClubID] = append(squads[*p.ClubID], p)
		}
	}
	squad := squads[c.UserClubID]
	var notes []FanNote
	if !life.Init {
		w.initClubLife(life, squad)
	} else {
		ns, err := w.rosterChanges(ctx, q, life, squad, true, nil)
		if err != nil {
			return err
		}
		notes = append(notes, ns...)
	}
	if ns, err := w.inductActive(ctx, q, life, squad, nil, true); err != nil { // the fans' pick of the season
		return err
	} else {
		notes = append(notes, ns...)
	}
	// a new season, new hope: the mood moves a good way back towards the hopeful middle
	notes = append(notes, FanNote{Key: "summer", V: math.Round((FanSummer-life.Fans.Mood)*0.35*10) / 10})
	w.applyFanNotes(life, notes, false)
	fs := &life.Fans
	fs.Season, fs.Trend, fs.Form = c.Season, []int{int(math.Round(fs.Mood))}, ""
	changed := w.tourSeasonStart(life, squad)
	news, err := w.openDeadline(ctx, q, r, life, "summer", squads, nil)
	if err != nil {
		return err
	}
	for _, n := range news {
		if n.Big {
			res.Transfers = append(res.Transfers, n)
		}
	}
	if err := w.pickFavourite(ctx, q, life, squad); err != nil {
		return err
	}
	w.pickVoice(life, notes, 0)
	// shirts.go: every squad's numbers in order for the new season (a freed 9 goes to the best striker)
	changed = append(changed, seasonShirts(life, c.UserClubID, squads)...)
	life.Roster = w.snapshotRoster(life, squad)
	if len(changed) > 0 {
		if err := savePlayers(ctx, q, uniquePlayers(changed)); err != nil {
			return err
		}
	}
	return saveClubLife(ctx, q, c.ID, life)
}

func uniquePlayers(ps []*Player) []*Player {
	seen := map[int]bool{}
	out := ps[:0:0]
	for _, p := range ps {
		if !seen[p.ID] {
			seen[p.ID] = true
			out = append(out, p)
		}
	}
	return out
}

// ---------------------------------------------------------------- view

type ClubLifeView struct {
	Season    int           `json:"season"`
	Day       int           `json:"day"`
	Offseason bool          `json:"offseason"`
	Budget    int64         `json:"budget"`
	Short     string        `json:"short"`
	Fans      FanView       `json:"fans"`
	Tour      *TourView     `json:"tour"`
	Deadline  *DeadlineView `json:"deadline"`
	Legends   []LegendEntry `json:"legends"`
	Retired   []int         `json:"retired"`
	Honour    *LegendEntry  `json:"honour"` // a new legend whose shirt number waits for a decision
	Waiting   int           `json:"waiting"`
}

func (s *Store) ClubLifeInfo(ctx context.Context, careerID int) (*ClubLifeView, error) {
	c, err := getCareer(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	user, err := getClub(ctx, s.DB, c.UserClubID)
	if err != nil {
		return nil, err
	}
	squad, err := queryPlayers(ctx, s.DB, `club_id=$1`, user.ID)
	if err != nil {
		return nil, err
	}
	life, err := loadClubLife(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	if !life.Init {
		life.Fans = FanState{Mood: FanStart, Season: c.Season}
	}
	v := &ClubLifeView{Season: c.Season, Day: c.Day, Offseason: c.Day > len(Calendar), Budget: user.Budget, Short: user.Short,
		Legends: append([]LegendEntry{}, life.Legends...), Retired: life.Retired}
	// legends still playing for the club first (most games first), then the others, newest first
	sort.SliceStable(v.Legends, func(i, j int) bool {
		ai, aj := v.Legends[i].Reason == "active", v.Legends[j].Reason == "active"
		if ai != aj {
			return ai
		}
		return ai && v.Legends[i].Apps > v.Legends[j].Apps
	})
	if v.Retired == nil {
		v.Retired = []int{}
	}
	v.Fans = fanView(ctx, s.DB, c, user, squad, life)
	v.Tour = tourView(c, user, life)
	v.Deadline = deadlineView(c, user, squad, life)
	for i := range life.Legends {
		if life.Legends[i].Honour == "" {
			le := life.Legends[i]
			v.Honour = &le
			break
		}
	}
	if v.Tour != nil && v.Tour.Open && v.Tour.Chosen == "" {
		v.Waiting++
	}
	if v.Honour != nil {
		v.Waiting++
	}
	return v, nil
}

// ---------------------------------------------------------------- actions

type ClubReq struct {
	Action   string `json:"action"` // tour | bargain | honour
	Key      string `json:"key"`    // tour: far | local | camp
	PlayerID int    `json:"playerId"`
	Choice   string `json:"choice"` // honour: retire | keep
	Shirt    int    `json:"shirt"`  // shirt: the number you give him
}

type ClubResult struct {
	Outcome string  `json:"outcome,omitempty"`
	Amount  int64   `json:"amount,omitempty"`
	Name    string  `json:"name,omitempty"`
	Shirt   int     `json:"shirt,omitempty"`
	Player  *Player `json:"player,omitempty"` // a bargain just signed (for the card reveal)
	Moved   []Moved `json:"moved,omitempty"`  // shirt: everyone whose number changed, with the new one
}

// Moved: a player and his new shirt number.
type Moved struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Shirt int    `json:"shirt"`
}

// ClubAction handles the club-life decisions: pick a pre-season tour, sign a Deadline Day bargain,
// retire (or keep) a legend's shirt number.
func (s *Store) ClubAction(ctx context.Context, careerID int, req ClubReq) (*ClubResult, error) {
	out := &ClubResult{}
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
		user := w.byID[c.UserClubID]
		life := w.clubLife(ctx, q)
		squad := w.userSquad()
		if !life.Init {
			w.initClubLife(life, squad)
		}
		var touched []*Player
		switch req.Action {
		case "tour":
			ps, amount, err := w.chooseTour(ctx, q, life, squad, req.Key)
			if err != nil {
				return err
			}
			touched, out.Outcome, out.Amount = ps, req.Key, amount
		case "bargain":
			p, price, err := w.buyBargain(ctx, q, life, req.PlayerID)
			if err != nil {
				return err
			}
			out.Outcome, out.Amount, out.Name, out.Shirt, out.Player = "signed", price, p.Name, p.Shirt, p
		case "honour":
			ps, le, err := w.honourLegend(life, squad, req.PlayerID, req.Choice)
			if err != nil {
				return err
			}
			touched, out.Outcome, out.Name, out.Shirt = ps, le.Honour, le.Name, le.Shirt
		case "shirt":
			ps, err := setShirt(life, squad, req.PlayerID, req.Shirt)
			if err != nil {
				return err
			}
			touched, out.Outcome, out.Shirt = ps, "shirt", req.Shirt
			for _, p := range ps {
				out.Moved = append(out.Moved, Moved{ID: p.ID, Name: p.Name, Shirt: p.Shirt})
			}
		default:
			return userErr("bad_action", "Unknown action")
		}
		if len(touched) > 0 {
			if err := savePlayers(ctx, q, uniquePlayers(touched)); err != nil {
				return err
			}
		}
		if err := saveClub(ctx, q, user); err != nil {
			return err
		}
		if err := saveClubLife(ctx, q, c.ID, life); err != nil {
			return err
		}
		return saveCareer(ctx, q, c)
	})
	return out, err
}

// topOverall: the average of the best n overalls (0 when the list is empty).
func topOverall(ovr []int, n int) float64 {
	if len(ovr) == 0 {
		return 0
	}
	s := append([]int{}, ovr...)
	sort.Sort(sort.Reverse(sort.IntSlice(s)))
	if n > len(s) {
		n = len(s)
	}
	t := 0
	for _, v := range s[:n] {
		t += v
	}
	return float64(t) / float64(n)
}
