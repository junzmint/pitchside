package game

import (
	"context"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

type world struct {
	career   *Career
	clubs    []*Club
	byID     map[int]*Club
	players  map[int][]*Player // by club
	coaches  map[int][]*Coach
	fixtures []*Fixture  // current season
	batch    *pgx.Batch  // per-match writes queued during a matchday
	regens   []string    // set by ageAndRetire for the season summary
	life     *ClubLife   // club_state.go: fans, tour, Deadline Day, legends (loaded on first use)
	med      *MedState   // medical.go: injuries, treatment, the medical team (loaded in loadWorld)
	crew     *StaffState // staff_life.go: the coaching staff's life (loaded in loadWorld)
	// the user's players' overall at the start of the matchday, and who played today (for the report)
	ovrBefore map[int]int
	played    map[int]bool
}

func (w *world) exec(ctx context.Context, q DBTX, sql string, args ...any) {
	if w.batch != nil {
		w.batch.Queue(sql, args...)
		return
	}
	_, _ = q.Exec(ctx, sql, args...)
}

func (w *world) flush(ctx context.Context, q pgx.Tx) error {
	if w.batch == nil || w.batch.Len() == 0 {
		w.batch = nil
		return nil
	}
	err := q.SendBatch(ctx, w.batch).Close()
	w.batch = nil
	return err
}

func loadWorld(ctx context.Context, q DBTX, r *rand.Rand, careerID int) (*world, error) {
	c, err := getCareer(ctx, q, careerID)
	if err != nil {
		return nil, err
	}
	w := &world{career: c, byID: map[int]*Club{}, players: map[int][]*Player{}, coaches: map[int][]*Coach{}}
	if w.clubs, err = listClubs(ctx, q, careerID); err != nil {
		return nil, err
	}
	for _, cl := range w.clubs {
		w.byID[cl.ID] = cl
	}
	ps, err := competitionPlayers(ctx, q, careerID)
	if err != nil {
		return nil, err
	}
	for _, p := range ps {
		w.players[*p.ClubID] = append(w.players[*p.ClubID], p)
	}
	cs, err := queryCoaches(ctx, q, `career_id=$1 AND club_id IS NOT NULL`, careerID)
	if err != nil {
		return nil, err
	}
	for _, co := range cs {
		w.coaches[*co.ClubID] = append(w.coaches[*co.ClubID], co)
	}
	applyCare(c, w.players[c.UserClubID])
	applyPay(c, w.players[c.UserClubID], w.coaches[c.UserClubID])
	// the medical room and the staff room mark players (match sharpness, mentoring) before lineups are picked
	if err := w.loadMedical(ctx, q); err != nil {
		return nil, err
	}
	if err := w.loadStaff(ctx, q); err != nil {
		return nil, err
	}
	// drop demands (and contracts) of anyone who has since been sold, released or let go
	pruneContracts(c, w.players[c.UserClubID], w.coaches[c.UserClubID])
	// …and everything else still waiting about him (a playing-time talk, a promise, a bid, a coach's card)
	w.forgetDeparted()
	sortDemands(c.Contracts.Demands)
	for _, cl := range w.clubs {
		if cl.IsUser && c.Care.AutoXI {
			// the assistant picks the strongest available eleven before every match
			cl.Lineup = BestLineup(w.players[cl.ID], cl.Formation)
		} else if cl.IsUser {
			cl.Lineup = resolveLineup(cl, w.players[cl.ID])
		} else if cl.Division > 0 {
			cl.Lineup = BestLineup(w.players[cl.ID], cl.Formation)
		}
	}
	if err := ensureDay(ctx, q, r, careerID, c.Season, c.Day, w.clubs); err != nil {
		return nil, err
	}
	w.fixtures, err = queryFixtures(ctx, q, `career_id=$1 AND season=$2`, careerID, c.Season)
	return w, err
}

// resolveLineup keeps saved choices that are fit to play and fills the gaps greedily.
func resolveLineup(club *Club, squad []*Player) []int {
	roles := Formations[club.Formation]
	byID := map[int]*Player{}
	for _, p := range squad {
		byID[p.ID] = p
	}
	out := make([]int, len(roles))
	used := map[int]bool{}
	keep := lineupKeep(club.Lineup[:min(len(club.Lineup), len(roles))], byID) // legend_versions.go: two versions of one legend saved (old saves): one stays
	inXI := map[string]bool{}
	for i := range roles {
		out[i] = -1
		if i < len(club.Lineup) {
			if p := byID[club.Lineup[i]]; p != nil && available(p) && !used[p.ID] {
				k := personKey(p)
				if k != "" && (keep[k] != p.ID || inXI[k]) {
					continue
				}
				out[i] = p.ID
				used[p.ID] = true
				if k != "" {
					inXI[k] = true
				}
			}
		}
	}
	// the gaps: one version of each legend, none of a legend already in the eleven
	var pool []*Player
	for _, p := range squad {
		if k := personKey(p); !used[p.ID] && available(p) && !p.Rushed && (k == "" || !inXI[k]) {
			pool = append(pool, p)
		}
	}
	pool = onePerPerson(pool)
	for i, role := range roles {
		if out[i] != -1 {
			continue
		}
		best, bestR := -1, -1.0
		for _, p := range pool {
			if !used[p.ID] {
				if r := Effective(p, role); r > bestR {
					best, bestR = p.ID, r
				}
			}
		}
		out[i] = best
		if best >= 0 {
			used[best] = true
		}
	}
	return out
}

func startersOf(club *Club, squad []*Player) ([]*Player, []string) {
	byID := map[int]*Player{}
	for _, p := range squad {
		byID[p.ID] = p
	}
	roles := Formations[club.Formation]
	st := make([]*Player, len(roles))
	for i, id := range club.Lineup {
		if i < len(st) {
			st[i] = byID[id]
		}
	}
	return st, roles
}

func coachSkill(coaches []*Coach, role string) int {
	for _, c := range coaches {
		if c.Role == role {
			return c.Skill
		}
	}
	return 0
}

func headCoachOf(cs []*Coach) *Coach {
	for _, c := range cs {
		if c.Role == "head" {
			return c
		}
	}
	return nil
}

func (w *world) sheet(clubID int) TeamSheet {
	cl := w.byID[clubID]
	st, roles := startersOf(cl, w.players[clubID])
	head := headCoachOf(w.coaches[clubID])
	var styleT []string
	if head != nil {
		styleT = CoachStyles[styleFor(head)].Traits
	}
	bench := benchOf(st, w.players[clubID])
	var rot []SwapNote
	if clubID == w.career.UserClubID {
		if rot = rotate(w.career.Care.Rotate, st, roles, bench); len(rot) > 0 {
			bench = benchOf(st, w.players[clubID])
		}
		// development rotation: the bench players who have waited longest start (never in a big tie)
		if f := w.userFixture(); f != nil && !bigTie(f) {
			if dev := devRotate(w.career.Care.Develop, st, roles, bench, w.career.Events.Bench); len(dev) > 0 {
				rot = append(rot, dev...)
				bench = benchOf(st, w.players[clubID])
			}
		}
	}
	ps := w.perks(clubID)
	fit := ComputeCoachFit(head, cl.Formation, cl.Tactic, st)
	if ps["tactician"] && head != nil {
		fit.Score = min(100, fit.Score+10)
	}
	return TeamSheet{Club: cl, Starters: st, Roles: roles, Bench: bench, Rotated: rot, Perks: ps, HeadCoach: coachSkill(w.coaches[clubID], "head"),
		Chem: TeamChemistry(st, cl.Formation, cl.FormWeeks, cl.ID, styleT...), Fit: fit}
}

func benchOf(starters []*Player, squad []*Player) []*Player {
	in := map[int]bool{}
	for _, p := range starters {
		if p != nil {
			in[p.ID] = true
		}
	}
	bench := []*Player{}
	for _, p := range squad {
		if !in[p.ID] && available(p) {
			bench = append(bench, p)
		}
	}
	return benchVersions(starters, bench) // legend_versions.go: no second version of a starter, one of anyone else
}

// matchDrain: fitness a full 90 minutes costs, by pressing and fixture congestion.
func matchDrain(sh TeamSheet, congested bool) float64 {
	d := map[string]float64{"high": 21, "mid": 16, "low": 13}[sh.Club.Tactic.Pressing]
	if congested {
		d *= MidweekDrain
	}
	if sh.Weather == "heat" {
		d *= HeatDrain // events.go: hot days drain the legs
	}
	return d
}

func (w *world) userFixture() *Fixture {
	for _, f := range w.fixtures {
		if f.Day == w.career.Day && !f.Played && (f.HomeID == w.career.UserClubID || f.AwayID == w.career.UserClubID) {
			return f
		}
	}
	return nil
}

func (w *world) playerByID(id int) *Player {
	for _, ps := range w.players {
		for _, p := range ps {
			if p.ID == id {
				return p
			}
		}
	}
	return nil
}

func isKnockout(f *Fixture) bool {
	return (f.Comp == "cup" || f.Comp == "cl") && !strings.HasPrefix(f.Stage, "G")
}

// ---------------------------------------------------------------- match setup

type SideSetup struct {
	Club      *Club      `json:"club"`
	Starters  []*Player  `json:"starters"`
	Roles     []string   `json:"roles"`
	Bench     []*Player  `json:"bench"`
	HeadCoach int        `json:"headCoach"`
	Rating    TeamRating `json:"rating"`
	Chemistry Chemistry  `json:"chemistry"`
	CoachFit  CoachFit   `json:"coachFit"`
	Rotated   []SwapNote `json:"rotated"`   // tired starters rested by squad rotation
	Congested bool       `json:"congested"` // second game in a week
	Perks     []string   `json:"perks"`     // staff specialities (they also boost the live match)
	// squad players who cannot play today (injured and not cleared to play), longest out first;
	// the pre-match team sheet shows the opponent's (MatchCentre OppSheet). Not used by the engine.
	Unavailable []*Player `json:"unavailable,omitempty"`
}

type MatchSetup struct {
	Fixture    FixtureView `json:"fixture"`
	Home       SideSetup   `json:"home"`
	Away       SideSetup   `json:"away"`
	UserIsHome bool        `json:"userIsHome"`
	Knockout   bool        `json:"knockout"`
	Weather    string      `json:"weather"` // events.go: clear | rain | snow | heat (stable per fixture)
	Derby      bool        `json:"derby"`   // events.go: against the club's fixed rival
	// the chance of each result in 90 minutes and the expected goals, from the model the simulated match
	// plays (sim.go MatchOdds) with everything it uses today: the occasion, the weather, the captain, the
	// press conference and the home crowd. Career matches only.
	Odds *OddsView `json:"odds,omitempty"`
}

// matchSheets: both team sheets of the user's match as it is played (PlayDay) and as its odds are worked out
// (MatchSetup): a cup or continental tie is a big game, then the weather, a derby, the captain and the press
// conference (events.go), and the home crowd (club_fans.go).
func (w *world) matchSheets(ctx context.Context, q DBTX, f *Fixture) (TeamSheet, TeamSheet) {
	home, away := w.sheet(f.HomeID), w.sheet(f.AwayID)
	home.BigGame, away.BigGame = f.Comp != "league", f.Comp != "league"
	w.matchMods(f, &home, &away)
	w.fanMods(ctx, q, f, &home, &away)
	return home, away
}

func (w *world) side(clubID int, f *Fixture) SideSetup {
	sh := w.sheet(clubID)
	return SideSetup{Club: sh.Club, Starters: sh.Starters, Roles: sh.Roles, Bench: sh.Bench, HeadCoach: sh.HeadCoach,
		Rating: sh.Rating(), Chemistry: sh.Chem, CoachFit: sh.Fit, Rotated: sh.Rotated, Congested: w.congested(clubID, f), Perks: perkList(sh.Perks),
		Unavailable: unavailableOf(w.players[clubID])}
}

// unavailableOf: the players of a squad who cannot play today (see available), longest out first.
func unavailableOf(squad []*Player) []*Player {
	var out []*Player
	for _, p := range squad {
		if !available(p) {
			out = append(out, p)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Injury != out[j].Injury {
			return out[i].Injury > out[j].Injury
		}
		return out[i].Overall > out[j].Overall
	})
	return out
}

func (s *Store) MatchSetup(ctx context.Context, careerID int) (*MatchSetup, error) {
	var ms *MatchSetup
	err := s.tx(ctx, func(q pgx.Tx) error {
		w, err := loadWorld(ctx, q, newRand(), careerID)
		if err != nil {
			return err
		}
		f := w.userFixture()
		if f == nil {
			return userErr("no_match", "Your club has no match today")
		}
		ms = &MatchSetup{Fixture: viewFixture(f, w.byID), Home: w.side(f.HomeID, f), Away: w.side(f.AwayID, f),
			UserIsHome: f.HomeID == w.career.UserClubID, Knockout: isKnockout(f), Weather: weatherFor(f), Derby: w.isDerby(f)}
		// the odds from the sheets as PlayDay will play them (nothing here is saved: if the assistant answers
		// the press for you, his answer counts in the odds and is given for real on matchday)
		ms.Odds = MatchOdds(w.matchSheets(ctx, q, f)).View()
		return fillKits(ctx, q, careerID, ms.Home.Club, ms.Away.Club) // kits.go: what each side can wear
	})
	return ms, err
}

// ---------------------------------------------------------------- play a day

type MatchResultReq struct {
	Mode      string   `json:"mode"` // live | sim (ignored when the user has no match today)
	HomeGoals int      `json:"homeGoals"`
	AwayGoals int      `json:"awayGoals"`
	Scorers   []int    `json:"scorers"`
	Assists   []int    `json:"assists"`
	PossHome  int      `json:"possHome"`
	ShotsHome int      `json:"shotsHome"`
	ShotsAway int      `json:"shotsAway"`
	Subs      []SubReq `json:"subs"`      // live mode: changes made during the match (either side)
	ExtraTime bool     `json:"extraTime"` // live mode: the tie went to extra time (goals include it)
	Pens      []int    `json:"pens"`      // live mode: shoot-out score [home, away] when there was one
	// live mode: the ratings the player saw at full time, so season averages and awards match them
	Ratings map[string]float64 `json:"ratings"`
}

type GoalEvent struct {
	PlayerID int    `json:"playerId"`
	Name     string `json:"name"`
	ClubID   int    `json:"clubId"`
	AssistID int    `json:"assistId"`
	Assist   string `json:"assist"`
}

type PlayerRating struct {
	PlayerID int     `json:"playerId"`
	Name     string  `json:"name"`
	Rating   float64 `json:"rating"`
}

type InjuryNote struct {
	Name     string `json:"name"`
	Weeks    int    `json:"weeks"`
	PlayerID int    `json:"playerId,omitempty"`
	Kind     string `json:"kind,omitempty"` // medical.go: the kind of injury (what the club's doctor diagnosed)
	Tier     int    `json:"tier,omitempty"` // 1 light · 2 medium · 3 serious · 4 career-threatening
}

type TrainChange struct {
	PlayerID int    `json:"playerId"`
	Name     string `json:"name"`
	Before   int    `json:"before"`
	After    int    `json:"after"`
	Played   bool   `json:"played"` // he was on the pitch today (most growth comes from playing)
}

type MoneyLine struct {
	Kind   string `json:"kind"`
	Amount int64  `json:"amount"`
}

type SeasonEnd struct {
	Season    int            `json:"season"`
	Division  int            `json:"division"`
	Move      string         `json:"move"` // up | down | ""
	Position  int            `json:"position"`
	Cup       string         `json:"cup"`
	CL        string         `json:"cl"`
	Prize     int64          `json:"prize"`
	Champions map[string]any `json:"champions"`
	Retired   []string       `json:"retired"`
	Qualified bool           `json:"qualified"`
}

type Departure struct {
	Name string `json:"name"`
	Club string `json:"club"`
	Fee  int64  `json:"fee"`
}

type DayReport struct {
	TP          int            `json:"tp"`          // upgrade points earned
	Youth       string         `json:"youth"`       // academy graduate who joined this week
	Unrest      []string       `json:"unrest"`      // players who asked to leave this week
	Departures  []Departure    `json:"departures"`  // players who walked out
	Subs        []SwapNote     `json:"subs"`        // the user's substitutions
	Rotated     []SwapNote     `json:"rotated"`     // starters rested by squad rotation
	Congested   bool           `json:"congested"`   // the user's second game of the week
	IconPick    bool           `json:"iconPick"`    // the shop opened a pick of three icons
	Card        *Card          `json:"card"`        // a chance card drawn today
	Happenings  []ComEvent     `json:"happenings"`  // events.go: what happened around the club today
	Discoveries []ComEvent     `json:"discoveries"` // explore.go: scouting finds, achievements, offers
	World       []NewsItem     `json:"world"`       // world_ai.go: headline transfers and sackings today
	Commercial  []ComEvent     `json:"commercial"`  // sponsors, board, billionaire
	Demands     []string       `json:"demands"`     // new wage demands
	Refusals    []string       `json:"refusals"`    // demands that ran out: name:left|stays|sulks|sold:club
	GameOver    bool           `json:"gameOver"`    // the squad fell below CollapseAt: career over
	Day         int            `json:"day"`
	Comp        string         `json:"comp"`
	Stage       string         `json:"stage"`
	Fixture     *FixtureView   `json:"fixture"`
	Events      []GoalEvent    `json:"events"`
	Stats       SimResult      `json:"stats"`
	Ratings     []PlayerRating `json:"ratings"`
	Others      []FixtureView  `json:"others"`
	Injuries    []InjuryNote   `json:"injuries"`
	Changes     []TrainChange  `json:"changes"`
	Money       []MoneyLine    `json:"money"`
	Budget      int64          `json:"budget"`
	Quests      []string       `json:"quests"` // kinds completed today
	SeasonEnd   *SeasonEnd     `json:"seasonEnd,omitempty"`
	Fans        *FanReport     `json:"fans,omitempty"`   // club_fans.go: the supporters' mood after today
	Alerts      []Alert        `json:"alerts,omitempty"` // alerts.go: what needs your attention after today
}

type matchOutcome struct {
	f        *Fixture
	res      SimResult
	ratings  map[int]float64
	goals    map[int]int
	injured  map[int]bool
	userSide int // 0 home, 1 away, -1 none
	live     bool
	oppOvr   float64
	ownOvr   float64
}

func (s *Store) PlayDay(ctx context.Context, careerID int, req MatchResultReq) (*DayReport, error) {
	var rep *DayReport
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
		cd := CalDay{Comp: "friendly", Stage: "FR"}
		if c.Day <= len(Calendar) {
			cd = Calendar[c.Day-1]
		} else if w.userFixture() == nil {
			return userErr("pick_friendly", "Pick a friendly opponent or start the new season")
		}
		rep = &DayReport{Day: c.Day, Comp: cd.Comp, Stage: cd.Stage}
		injuredToday := map[int]bool{}
		w.ovrBefore, w.played = map[int]int{}, map[int]bool{}
		for _, p := range w.players[c.UserClubID] {
			w.ovrBefore[p.ID] = int(math.Round(OverallAs(p, p.Position)))
		}
		w.batch = &pgx.Batch{}

		uf := w.userFixture()
		var uo *matchOutcome
		if uf != nil {
			home, away := w.matchSheets(ctx, q, uf) // the occasion, weather, derby, captain, press conference, home crowd
			var res SimResult
			live := req.Mode == "live"
			if req.Mode != "forfeit" {
				for _, sh := range []*TeamSheet{&home, &away} {
					if live {
						liveSubs(sh, req.Subs)
					} else {
						autoSubs(r, sh, matchDrain(*sh, w.congested(sh.Club.ID, uf)))
					}
				}
			}
			if req.Mode == "forfeit" {
				res = SimResult{PossHome: 50, Forfeit: true}
				if uf.HomeID == c.UserClubID {
					res.AwayGoals = 3
				} else {
					res.HomeGoals = 3
				}
			} else if live {
				if req.HomeGoals < 0 || req.AwayGoals < 0 || req.HomeGoals > 30 || req.AwayGoals > 30 {
					return userErr("bad_score", "Invalid score")
				}
				res = SimResult{HomeGoals: req.HomeGoals, AwayGoals: req.AwayGoals, PossHome: req.PossHome, ShotsHome: req.ShotsHome, ShotsAway: req.ShotsAway,
					ExtraTime: req.ExtraTime && isKnockout(uf)}
				if len(req.Pens) == 2 && isKnockout(uf) && req.HomeGoals == req.AwayGoals && req.Pens[0] != req.Pens[1] &&
					req.Pens[0] >= 0 && req.Pens[1] >= 0 && req.Pens[0] <= 40 && req.Pens[1] <= 40 {
					res.Shootout, res.PensH, res.PensA = true, req.Pens[0], req.Pens[1]
				}
				valid := map[int]int{}
				for _, sh := range []TeamSheet{home, away} {
					for _, p := range sh.Starters {
						if p != nil {
							valid[p.ID] = sh.Club.ID
						}
					}
					for _, s := range sh.Subs {
						valid[s.In.ID] = sh.Club.ID
					}
				}
				// the live ratings, for players who were in this match only
				res.Ratings = map[int]float64{}
				for k, v := range req.Ratings {
					if id, err := strconv.Atoi(k); err == nil && valid[id] != 0 && v >= 1 && v <= 10 {
						res.Ratings[id] = v
					}
				}
				for i, id := range req.Scorers {
					as := 0
					if i < len(req.Assists) && valid[req.Assists[i]] != 0 && valid[req.Assists[i]] == valid[id] && req.Assists[i] != id {
						as = req.Assists[i]
					}
					if valid[id] != 0 {
						res.Scorers = append(res.Scorers, id)
						res.Assists = append(res.Assists, as)
					}
				}
			} else {
				res = Simulate(r, home, away)
				creditSubs(r, &res, &home, &away)
				settleKnockout(r, uf, home, away, &res)
			}
			us := home
			if uf.AwayID == c.UserClubID {
				us = away
			}
			rep.Rotated, rep.Congested = us.Rotated, w.congested(c.UserClubID, uf)
			for _, s := range us.Subs {
				rep.Subs = append(rep.Subs, SwapNote{Out: s.Out.Name, In: s.In.Name, OutFit: math.Round(s.Out.Fitness), InFit: math.Round(s.In.Fitness), Minute: s.Minute,
					Bring: s.In.Bring > 0})
			}
			uo = w.record(ctx, q, r, uf, res, home, away, injuredToday)
			if err := w.eventsAfterUserMatch(ctx, q, r, uf, uo, rep); err != nil {
				return err
			}
			uo.live = live
			if uf.HomeID == c.UserClubID {
				uo.userSide = 0
				uo.ownOvr, uo.oppOvr = home.Rating().Overall, away.Rating().Overall
			} else {
				uo.userSide = 1
				uo.ownOvr, uo.oppOvr = away.Rating().Overall, home.Rating().Overall
			}
			v := viewFixture(uf, w.byID)
			rep.Fixture = &v
			rep.Stats = res
			for i, id := range res.Scorers {
				p := w.playerByID(id)
				if p == nil {
					continue
				}
				ev := GoalEvent{PlayerID: id, Name: p.Name, ClubID: *p.ClubID}
				if a := w.playerByID(at(res.Assists, i)); a != nil {
					ev.AssistID, ev.Assist = a.ID, a.Name
				}
				rep.Events = append(rep.Events, ev)
			}
			for _, p := range w.players[c.UserClubID] {
				if rt, ok := uo.ratings[p.ID]; ok {
					rep.Ratings = append(rep.Ratings, PlayerRating{PlayerID: p.ID, Name: p.Name, Rating: rt})
				}
				if uo.injured[p.ID] {
					rep.Injuries = append(rep.Injuries, InjuryNote{Name: p.Name, Weeks: p.Injury})
				}
			}
			sort.Slice(rep.Ratings, func(i, j int) bool { return rep.Ratings[i].Rating > rep.Ratings[j].Rating })
		}
		for _, f := range w.fixtures {
			if f.Day != c.Day || f.Played {
				continue
			}
			home, away := w.sheet(f.HomeID), w.sheet(f.AwayID)
			home.BigGame, away.BigGame = f.Comp != "league", f.Comp != "league"
			w.matchMods(f, &home, &away)
			autoSubs(r, &home, matchDrain(home, w.congested(home.Club.ID, f)))
			autoSubs(r, &away, matchDrain(away, w.congested(away.Club.ID, f)))
			res := Simulate(r, home, away)
			creditSubs(r, &res, &home, &away)
			settleKnockout(r, f, home, away, &res)
			w.record(ctx, q, r, f, res, home, away, injuredToday)
			if f.Comp == "cl" || f.League == c.League {
				rep.Others = append(rep.Others, viewFixture(f, w.byID))
			}
		}
		if err := w.flush(ctx, q); err != nil {
			return err
		}
		return w.advance(ctx, q, r, rep, uo, injuredToday)
	})
	return rep, err
}

// record stores a result: player stats, ratings, fatigue, injuries, morale and chemistry growth.
func (w *world) record(ctx context.Context, q DBTX, r *rand.Rand, f *Fixture, res SimResult, home, away TeamSheet, injuredToday map[int]bool) *matchOutcome {
	hg, ag := res.HomeGoals, res.AwayGoals
	f.HomeGoals, f.AwayGoals, f.Played = &hg, &ag, true
	f.ExtraTime = res.ExtraTime
	if isKnockout(f) && hg == ag {
		if !res.Shootout { // a level knockout that skipped extra time (e.g. an older live client)
			res.Shootout = true
			res.PensH, res.PensA = shootout(r, home, away)
		}
		ph := res.PensH > res.PensA
		pa, pb := res.PensH, res.PensA
		f.PensHome, f.PensH, f.PensA = &ph, &pa, &pb
	}
	o := &matchOutcome{f: f, res: res, ratings: map[int]float64{}, goals: map[int]int{}, injured: map[int]bool{}, userSide: -1}
	assists := map[int]int{}
	for i, id := range res.Scorers {
		o.goals[id]++
		if a := at(res.Assists, i); a != 0 {
			assists[a]++
		}
	}
	for side, sh := range []TeamSheet{home, away} {
		gf, ga := hg, ag
		if side == 1 {
			gf, ga = ag, hg
		}
		result := 0.0
		switch {
		case gf > ga:
			result = 0.4
		case gf < ga:
			result = -0.3
		}
		congested := w.congested(sh.Club.ID, f)
		drain := matchDrain(sh, congested)
		// everyone who played, with the share of the 90 minutes he was on the pitch
		type part struct {
			p     *Player
			role  string
			share float64
			sub   bool
		}
		learns := !res.Forfeit && isCompLeague(sh.Club.League)
		var parts []part
		offAt := map[int]int{}
		for _, s := range sh.Subs {
			offAt[s.Out.ID] = s.Minute
		}
		for i, p := range sh.Starters {
			if p != nil {
				share := 1.0
				if m, ok := offAt[p.ID]; ok {
					share = float64(m) / 90
				}
				parts = append(parts, part{p, sh.Roles[i], share, false})
			}
		}
		for _, s := range sh.Subs {
			share := float64(90-s.Minute) / 90
			if m, ok := offAt[s.In.ID]; ok { // came on and went off again
				share = float64(m-s.Minute) / 90
			}
			parts = append(parts, part{s.In, sh.Roles[s.Slot], math.Max(0.05, share), true})
		}
		physio := coachSkill(w.coaches[sh.Club.ID], "physio")
		for _, pt := range parts {
			p := pt.p
			cat := RoleCat(pt.role)
			rt := 6.3 + (Effective(p, pt.role)-70)/25 + float64(o.goals[p.ID])*1.0 + float64(assists[p.ID])*0.6 + result + r.NormFloat64()*0.35
			// a short cameo pulls the rating towards the middle
			rt = 6.3 + (rt-6.3)*(0.5+0.5*pt.share)
			cs := 0
			if ga == 0 && (cat == "GK" || cat == "DF") {
				cs = 1
				if cat == "GK" {
					rt += 0.8
				} else {
					rt += 0.4
				}
			}
			if cat == "GK" || cat == "DF" {
				rt -= float64(ga) * 0.15
			}
			if v, ok := res.Ratings[p.ID]; ok { // a live match: the rating the player saw
				rt = v
			}
			rt = math.Round(clamp(rt, 4, 10)*10) / 10
			o.ratings[p.ID] = rt
			w.exec(ctx, q, `INSERT INTO player_stats (career_id, player_id, season, comp, club_id, apps, goals, assists, rating_sum, cs)
				VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8,$9)
				ON CONFLICT (player_id, season, comp) DO UPDATE SET apps=player_stats.apps+1, goals=player_stats.goals+$6,
				assists=player_stats.assists+$7, rating_sum=player_stats.rating_sum+$8, cs=player_stats.cs+$9, club_id=$5`,
				w.career.ID, p.ID, w.career.Season, f.Comp, sh.Club.ID, o.goals[p.ID], assists[p.ID], rt, cs)
			if w.matchInjury(r, p, sh, f, congested, pt.share, physio) { // injury.go
				o.injured[p.ID] = true
				injuredToday[p.ID] = true
			}
			p.Fitness = math.Max(20, p.Fitness-drain*(1.15-p.Physical/250)*(0.2+0.8*pt.share)*staminaAge(p))
			p.Tenure++
			// playing is how players improve (growth.go): minutes, a good game and a big night all count
			if learns {
				matchGrowth(r, p, w.coaches[sh.Club.ID], sh.Club.IsUser, sh.Club.TrainLvl, pt.share, rt, f.Comp, pt.sub)
				if sh.Club.IsUser && w.played != nil {
					w.played[p.ID] = true
				}
			}
		}
		dm := 0.0
		switch {
		case gf > ga:
			dm = 6
		case gf < ga:
			dm = -6
		}
		if sh.Perks["motivator"] {
			dm += 2 // a motivator lifts the dressing room after every game
		}
		for _, p := range w.players[sh.Club.ID] {
			// results swing the mood; between them it drifts back towards normal, so a bad run
			// hurts without trapping a struggling side at rock bottom
			p.Morale = clamp(p.Morale+dm+(MoraleRest-p.Morale)*MoraleDrift, 20, 100)
		}
		sh.Club.FormWeeks++
	}
	var evs []map[string]any
	for i, id := range res.Scorers {
		if p := w.playerByID(id); p != nil {
			e := map[string]any{"playerId": id, "name": p.Name, "clubId": *p.ClubID}
			if a := w.playerByID(at(res.Assists, i)); a != nil {
				e["assist"] = a.Name
			}
			evs = append(evs, e)
		}
	}
	w.exec(ctx, q, `UPDATE fixtures SET home_goals=$2, away_goals=$3, pens_home=$4, played=true, report=$5, extra_time=$6, pens_h=$7, pens_a=$8 WHERE id=$1`,
		f.ID, f.HomeGoals, f.AwayGoals, f.PensHome, map[string]any{"events": evs, "possHome": res.PossHome, "shotsHome": res.ShotsHome, "shotsAway": res.ShotsAway},
		f.ExtraTime, f.PensH, f.PensA)
	return o
}

func (w *world) advance(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport, uo *matchOutcome, injuredToday map[int]bool) error {
	c := w.career
	user := w.byID[c.UserClubID]
	intensity := c.Training.Intensity
	var toSave []*Player
	clubPerks := map[int]Perks{}
	for cid := range w.players {
		clubPerks[cid] = w.perks(cid)
	}
	for cid, ps := range w.players {
		isUser := cid == user.ID
		if !isCompLeague(w.byID[cid].League) {
			continue // world clubs progress once per season (see ageAndRetire)
		}
		for _, p := range ps {
			w.healDay(r, p, cid, clubPerks[cid], injuredToday) // injury.go
			before := int(math.Round(OverallAs(p, p.Position)))
			if b, ok := w.ovrBefore[p.ID]; ok && isUser {
				before = b // today's match already counted towards his growth
			}
			load := intensity
			if isUser && p.Load != "" {
				load = p.Load
			}
			train(r, p, w.coaches[cid], load, isUser, w.byID[cid].TrainLvl)
			if isUser { // training knocks: hard sessions on tired legs
				w.trainingKnock(r, p, cid, load, clubPerks[cid], injuredToday, rep)
			}
			p.Fill()
			if isUser && p.Overall != before {
				rep.Changes = append(rep.Changes, TrainChange{PlayerID: p.ID, Name: p.Name, Before: before, After: p.Overall, Played: w.played[p.ID]})
			}
			toSave = append(toSave, p)
		}
	}
	if err := savePlayers(ctx, q, toSave); err != nil {
		return err
	}

	applyPay(c, w.players[user.ID], w.coaches[user.ID]) // training refreshed market wages; contracts still apply
	if err := w.weeklyMoney(ctx, q, rep, uo); err != nil {
		return err
	}
	if err := w.wageUnrest(ctx, q, r, rep); err != nil {
		return err
	}
	if err := w.academy(ctx, q, r, rep); err != nil {
		return err
	}
	if uo != nil {
		done, err := w.progressQuests(ctx, q, uo)
		if err != nil {
			return err
		}
		rep.Quests = done
	}
	// AI clubs keep a playable squad
	for _, cl := range w.clubs {
		if cl.IsUser || cl.Division == 0 {
			continue
		}
		for len(w.players[cl.ID]) < AIMinSquad {
			pos := []string{"GK", "DF", "MF", "FW"}[r.Intn(4)]
			np := GenPlayer(r, nationsOf(cl.League), pos, 60+r.Float64()*6, 17, 20)
			moveTo(np, &cl.ID, pickShirt(w.players[cl.ID], nil, np))
			if err := insertPlayer(ctx, q, c.ID, np); err != nil {
				return err
			}
			w.players[cl.ID] = append(w.players[cl.ID], np)
		}
	}
	for _, cl := range w.clubs {
		if cl.Division == 0 {
			continue
		}
		if err := saveClub(ctx, q, cl); err != nil {
			return err
		}
	}
	arrived, err := refreshMarketNews(ctx, q, r, c)
	if err != nil {
		return err
	}
	for _, a := range arrived { // market.go: a legend (or your own design) is on the market for a matchday or two
		rep.Happenings = append(rep.Happenings, ComEvent{Key: "legend_market", Name: a.Name, Amount: int64(a.Stay), Age: a.Age})
	}
	if c.Day <= len(Calendar) {
		c.Day++
		if c.Day > len(Calendar) {
			if err := w.finishSeason(ctx, q, rep); err != nil {
				return err
			}
		}
	}
	pruneCare(c, w.players[user.ID])
	if err := w.iconPickTick(ctx, q, r, rep); err != nil {
		return err
	}
	if err := w.commercialTick(ctx, q, r, rep); err != nil {
		return err
	}
	w.clubLife(ctx, q) // club_state.go: loaded before the bids, which leave Deadline Day bargains alone
	if err := w.eventsTick(ctx, q, r, rep); err != nil {
		return err
	}
	if err := w.exploreTick(ctx, q, r, rep); err != nil {
		return err
	}
	if err := w.worldTick(ctx, q, r, rep); err != nil {
		return err
	}
	if err := w.expireDemands(ctx, q, r, rep); err != nil {
		return err
	}
	pruneContracts(c, w.players[user.ID], w.coaches[user.ID])
	w.newDemands(r, rep)
	w.renewalDemands(rep)
	if err := w.clubTick(ctx, q, r, rep, uo, injuredToday); err != nil { // club_state.go: fans, tour, Deadline Day, legends
		return err
	}
	if err := w.medicalTick(ctx, q, r, rep, uo, injuredToday); err != nil { // medical.go: treatment, rehab, the medical team
		return err
	}
	if err := w.staffTick(ctx, q, r, rep, uo); err != nil { // staff_life.go: the coaching staff
		return err
	}
	rep.Budget = user.Budget
	rep.Alerts = w.alerts()
	if err := saveClub(ctx, q, user); err != nil {
		return err
	}
	return saveCareer(ctx, q, c)
}

// ---------------------------------------------------------------- season end

// leaguePrize: 1st place earns the most; lower divisions pay a fraction.
func leaguePrize(pos, div int) int64 {
	base := []float64{0, 30, 9, 3.5}[div]
	return int64(base*float64(DivisionSize+1-pos)/float64(DivisionSize)*6) * 100_000
}

var stageRank = map[string]int{"": 0, "G": 1, "R1": 1, "R32": 2, "R16": 3, "QF": 4, "SF": 5, "F": 6, "W": 7}

func (w *world) knockoutResult(comp, league string, clubID int) string {
	best := ""
	for _, f := range w.fixtures {
		if f.Comp != comp || (league != "" && f.League != league) || (f.HomeID != clubID && f.AwayID != clubID) {
			continue
		}
		st := f.Stage
		if strings.HasPrefix(st, "G") {
			st = "G"
		}
		if st == "F" && f.Played && f.WinnerID() == clubID {
			st = "W"
		}
		if stageRank[st] > stageRank[best] {
			best = st
		}
	}
	return best
}

// finishSeason pays prizes and writes the season into the history book. The club then enters the
// off-season (friendlies) until the user starts the next season, when promotion and relegation apply.
func (w *world) finishSeason(ctx context.Context, q DBTX, rep *DayReport) error {
	c := w.career
	user := w.byID[c.UserClubID]
	se := &SeasonEnd{Season: c.Season, Champions: map[string]any{}, Division: user.Division}
	for _, l := range Leagues {
		for d := 1; d <= Divisions; d++ {
			table := divisionTable(w.clubs, w.fixtures, l.Code, d)
			for i, row := range table {
				cl := w.byID[row.ClubID]
				cl.Reputation = int(clamp(float64(cl.Reputation)+float64(10-i)/4, 35, 99))
				if row.IsUser {
					se.Position = i + 1
					se.Prize += leaguePrize(i+1, d)
					switch {
					case d > 1 && i < PromoteCount:
						se.Move = "up"
						se.Prize += map[int]int64{2: 6 * M, 3: 2 * M}[d]
					case d < Divisions && i >= len(table)-PromoteCount:
						se.Move = "down"
					}
					if d == 1 && i < CLPerLeague {
						se.Qualified = true
					}
				}
			}
			if len(table) > 0 {
				se.Champions["league_"+leagueKey(l.Code, d)] = table[0].Name
			}
		}
		for _, f := range w.fixtures {
			if f.Comp == "cup" && f.League == l.Code && f.Stage == "F" && f.Played {
				se.Champions["cup_"+l.Code] = w.byID[f.WinnerID()].Name
			}
		}
	}
	for _, f := range w.fixtures {
		if f.Comp == "cl" && f.Stage == "F" && f.Played {
			se.Champions["cl"] = w.byID[f.WinnerID()].Name
		}
	}
	se.Cup = w.knockoutResult("cup", user.League, user.ID)
	se.CL = w.knockoutResult("cl", "", user.ID)
	se.Prize += map[string]int64{"W": 10 * M, "F": 4 * M, "SF": 2 * M, "QF": 1 * M}[se.Cup]
	se.Prize += map[string]int64{"W": 30 * M, "F": 15 * M, "SF": 9 * M, "QF": 6 * M, "R16": 4 * M, "G": 2 * M}[se.CL]
	user.Reputation = int(clamp(float64(user.Reputation)+map[string]float64{"W": 3, "F": 1}[se.Cup]+map[string]float64{"W": 5, "F": 3, "SF": 2}[se.CL], 35, 99))
	user.Budget += se.Prize
	if err := addFinance(ctx, q, c, "prize", se.Prize, ""); err != nil {
		return err
	}
	rep.Money = append(rep.Money, MoneyLine{Kind: "prize", Amount: se.Prize})
	// season summary: top scorer & best player of the user's club
	summary := map[string]any{"champions": se.Champions, "division": user.Division, "league": user.League, "move": se.Move}
	var tsName string
	var tsGoals int
	_ = q.QueryRow(ctx, `SELECT p.name, sum(s.goals) g FROM player_stats s JOIN players p ON p.id=s.player_id
		WHERE s.career_id=$1 AND s.season=$2 AND s.club_id=$3 GROUP BY p.name ORDER BY g DESC LIMIT 1`, c.ID, c.Season, user.ID).Scan(&tsName, &tsGoals)
	var bpName string
	var bpAvg float64
	_ = q.QueryRow(ctx, `SELECT p.name, sum(s.rating_sum)/sum(s.apps) a FROM player_stats s JOIN players p ON p.id=s.player_id
		WHERE s.career_id=$1 AND s.season=$2 AND s.club_id=$3 GROUP BY p.name HAVING sum(s.apps) >= 5 ORDER BY a DESC LIMIT 1`, c.ID, c.Season, user.ID).Scan(&bpName, &bpAvg)
	summary["topScorer"], summary["topScorerGoals"] = tsName, tsGoals
	summary["bestPlayer"], summary["bestRating"] = bpName, math.Round(bpAvg*100)/100
	pts := 0
	for _, row := range divisionTable(w.clubs, w.fixtures, user.League, user.Division) {
		if row.IsUser {
			pts = row.Pts
		}
	}
	if _, err := q.Exec(ctx, `INSERT INTO season_history (career_id, season, club_id, league_pos, points, cup, cl, prize, summary)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, c.ID, c.Season, user.ID, se.Position, pts, se.Cup, se.CL, se.Prize, summary); err != nil {
		return err
	}
	if err := w.commercialSeasonEnd(ctx, q, se, rep); err != nil {
		return err
	}
	if err := w.eventsSeasonEnd(ctx, q, newRand(), se, rep); err != nil {
		return err
	}
	if err := w.exploreSeasonEnd(ctx, q, newRand(), se, rep); err != nil {
		return err
	}
	for _, cl := range w.clubs {
		if cl.Division > 0 {
			if err := saveClub(ctx, q, cl); err != nil {
				return err
			}
		}
	}
	rep.SeasonEnd = se
	return nil
}

// qualifiersFrom: the top eight of every top division, country by country, best first.
func qualifiersFrom(clubs []*Club, fixtures []*Fixture) []int {
	var out []int
	for _, l := range Leagues {
		t := divisionTable(clubs, fixtures, l.Code, 1)
		for i := 0; i < CLPerLeague && i < len(t); i++ {
			out = append(out, t[i].ClubID)
		}
	}
	return out
}

// promoteRelegate swaps the bottom three of each division with the top three of the one below.
func promoteRelegate(clubs []*Club, fixtures []*Fixture) []*Club {
	var changed []*Club
	for _, l := range Leagues {
		tables := map[int][]TableRow{}
		for d := 1; d <= Divisions; d++ {
			tables[d] = divisionTable(clubs, fixtures, l.Code, d)
		}
		byID := map[int]*Club{}
		for _, c := range clubs {
			byID[c.ID] = c
		}
		for d := 1; d < Divisions; d++ {
			upper, lower := tables[d], tables[d+1]
			if len(upper) < PromoteCount || len(lower) < PromoteCount {
				continue
			}
			for i := 0; i < PromoteCount; i++ {
				down := byID[upper[len(upper)-1-i].ClubID]
				up := byID[lower[i].ClubID]
				down.Division, up.Division = d+1, d
				changed = append(changed, down, up)
			}
		}
	}
	return changed
}

// StartNextSeason ends the off-season: promotion/relegation, ageing, retirements, new fixtures.
type NewSeasonResult struct {
	Retired   []string   `json:"retired"`
	Aged      []AgeNote  `json:"aged"`
	Expired   []string   `json:"expired"`   // players whose contracts ran out and left for free
	Promoted  []string   `json:"promoted"`  // academy youngsters called up to keep the squad at SquadFloor
	Regens    []string   `json:"regens"`    // sons of your retired stars, and where they start
	Transfers []NewsItem `json:"transfers"` // headline moves of the summer window (world_ai.go)
}

func (s *Store) StartNextSeason(ctx context.Context, careerID int) (*NewSeasonResult, error) {
	res := &NewSeasonResult{}
	lap := profiler("new-season")
	err := s.tx(ctx, func(q pgx.Tx) error {
		// one season change at a time: a second click waits here, then finds the season running
		// (without the lock both would age the squads and create the season's fixtures twice)
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		r := newRand()
		w, err := loadWorld(ctx, q, r, careerID)
		if err != nil {
			return err
		}
		lap("load world")
		c := w.career
		if c.Day <= len(Calendar) {
			return userErr("season_running", "The season is still running")
		}
		res.Retired, res.Aged, err = w.ageAndRetire(ctx, q, r)
		lap("age and retire")
		if err != nil {
			return err
		}
		res.Regens = w.regens
		if res.Expired, err = w.expireContracts(ctx, q, r); err != nil {
			return err
		}
		if res.Promoted, err = w.academyTopUp(ctx, q, r); err != nil {
			return err
		}
		lap("contracts")
		qualifiers := qualifiersFrom(w.clubs, w.fixtures)
		for _, cl := range promoteRelegate(w.clubs, w.fixtures) {
			if err := saveClub(ctx, q, cl); err != nil {
				return err
			}
		}
		lap("promotion")
		c.Season++
		c.Day = 1
		for i := range c.Contracts.Demands {
			c.Contracts.Demands[i].Until = 4
		}
		if err := createSeason(ctx, q, r, c.ID, c.Season, w.clubs, qualifiers); err != nil {
			return err
		}
		lap("fixtures")
		// the summer transfer window among the computer's clubs (world_ai.go)
		news, err := w.summerWindow(ctx, q, r)
		if err != nil {
			return err
		}
		lap("summer window")
		for _, n := range news {
			if n.Big {
				res.Transfers = append(res.Transfers, n)
			}
		}
		if err := refreshMarket(ctx, q, r, c); err != nil {
			return err
		}
		lap("market")
		if err := w.clubNewSeason(ctx, q, r, res); err != nil { // club_state.go: farewells, tour, summer Deadline Day
			return err
		}
		lap("club life")
		// the seasons gone by keep only your own matches (fixtures_prune.go)
		if _, err := pruneFixtures(ctx, q, c); err != nil {
			return err
		}
		lap("prune fixtures")
		return saveCareer(ctx, q, c)
	})
	lap("commit")
	if err == nil {
		// fresh planner statistics after a season's worth of changes, without making the player wait
		go Analyze(context.Background(), s.DB)
	}
	lap("analyze")
	return res, err
}

func (w *world) ageAndRetire(ctx context.Context, q DBTX, r *rand.Rand) ([]string, []AgeNote, error) {
	c := w.career
	user := w.byID[c.UserClubID]
	var retiredNames []string
	var aged []AgeNote
	var regens []string
	lap := profiler("age")
	ps, err := queryPlayers(ctx, q, `career_id=$1 AND NOT retired`, c.ID)
	if err != nil {
		return nil, nil, err
	}
	lap("query")
	fitCoach := coachSkill(w.coaches[user.ID], "fitness")
	byID := map[int]*Club{}
	for _, cl := range w.clubs {
		byID[cl.ID] = cl
	}
	var toSave, born []*Player
	pool := map[int][]*Player{} // a season of development for the world pool (growth.go)
	for _, p := range ps {
		if p.ClubID != nil && byID[*p.ClubID] != nil && !isCompLeague(byID[*p.ClubID].League) {
			pool[*p.ClubID] = append(pool[*p.ClubID], p)
		}
	}
	for _, squad := range pool {
		worldSeasonGrowth(r, squad)
	}
	for _, p := range ps {
		p.Fitness = 100
		p.Injury = summerInjury(p) // injury.go: long injuries carry over, minus the summer's rest
		if isLegend(p) {           // legends don't age, decline or retire
			// ...and a legend kept at your club creeps towards the modern ceiling, season by season
			if p.ClubID != nil && *p.ClubID == user.ID && p.Potential < potentialCap(p) {
				p.Potential++
			}
			p.Fill()
			toSave = append(toSave, p)
			continue
		}
		p.Age++
		isMine := p.ClubID != nil && *p.ClubID == user.ID
		before := int(math.Round(OverallAs(p, p.Position)))
		lvl, fc := 1, 0
		if p.ClubID != nil && byID[*p.ClubID] != nil {
			lvl = byID[*p.ClubID].TrainLvl
		}
		if isMine {
			fc = fitCoach
		}
		devSummer(r, p)
		vet := p.ClubID != nil && perksOf(w.coaches[*p.ClubID])["veteran_care"]
		ageDecline(r, p, lvl, fc, vet)
		if after := int(math.Round(OverallAs(p, p.Position))); isMine && after < before {
			aged = append(aged, AgeNote{Name: p.Name, Age: p.Age, Before: before, After: after})
		}
		// careers wind down from 35: a quarter retire at 35, half at 36, most by 37
		if p.Age >= 38 || (p.Age >= 35 && r.Float64() < 0.25*float64(p.Age-34)) {
			if p.ClubID != nil && *p.ClubID == user.ID {
				retiredNames = append(retiredNames, p.Name)
			}
			old := p.ClubID
			peak := int(math.Round(OverallAs(p, p.Position)))
			p.Retired = true
			p.ClubID = nil
			// a well-known name comes back as a teenage "Jr." with a ceiling near his father's best,
			// so the world never runs out of stars; ordinary players are replaced by an academy kid
			star := peak >= 78 || before >= 80
			if old != nil && (star || *old != user.ID) {
				home := old
				if *old == user.ID || w.byID[*old] == nil { // your retiree's son starts at another club in your league
					var cands []*Club
					for _, cl := range w.clubs {
						if !cl.IsUser && cl.League == user.League && cl.Division > 0 {
							cands = append(cands, cl)
						}
					}
					if len(cands) > 0 {
						home = &cands[r.Intn(len(cands))].ID
					}
				}
				cl := w.byID[*home]
				var np *Player
				if star {
					np = regen(r, p, max(peak, before))
				} else if cl != nil {
					np = GenPlayer(r, nationsOf(cl.League), p.Position, float64(cl.Reputation)-12+r.Float64()*6, 17, 19)
				}
				if np != nil && cl != nil {
					// the number of the man he replaces if it suits him and is free there, else one that does
					np.Shirt = p.Shirt
					var others []*Player
					for _, x := range w.players[*home] {
						if x.ID != p.ID {
							others = append(others, x)
						}
					}
					moveTo(np, home, pickShirt(others, w.retiredOf(ctx, q, *home), np))
					born = append(born, np)
					if star && *old == user.ID {
						regens = append(regens, np.Name+" → "+cl.Name)
					}
				}
			}
		}
		p.Fill()
		toSave = append(toSave, p)
	}
	lap("loop")
	if err := insertPlayers(ctx, q, c.ID, born); err != nil {
		return nil, nil, err
	}
	lap("newcomers")
	if err := savePlayers(ctx, q, toSave); err != nil {
		return nil, nil, err
	}
	lap("save")
	lap("done")
	sort.Slice(aged, func(i, j int) bool { return aged[i].Before-aged[i].After > aged[j].Before-aged[j].After })
	w.regens = regens
	return retiredNames, aged, nil
}

// ---------------------------------------------------------------- friendlies

const MaxFriendlies = 4

func (s *Store) SetupFriendly(ctx context.Context, careerID, opponentID int) error {
	return s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		if c.Day <= len(Calendar) {
			return userErr("season_running", "Friendlies are played in the off-season")
		}
		opp, err := getClub(ctx, q, opponentID)
		if err != nil || opp.CareerID != careerID || opp.IsUser {
			return userErr("bad_opponent", "Pick another club")
		}
		var played, open int
		if err := q.QueryRow(ctx, `SELECT count(*) FILTER (WHERE played), count(*) FILTER (WHERE NOT played) FROM fixtures
			WHERE career_id=$1 AND season=$2 AND comp='friendly'`, careerID, c.Season).Scan(&played, &open); err != nil {
			return err
		}
		if played >= MaxFriendlies {
			return userErr("friendly_limit", "No more friendlies this off-season")
		}
		if _, err := q.Exec(ctx, `DELETE FROM fixtures WHERE career_id=$1 AND season=$2 AND comp='friendly' AND NOT played`, careerID, c.Season); err != nil {
			return err
		}
		f := &Fixture{Season: c.Season, Day: c.Day, Comp: "friendly", Stage: "FR", HomeID: c.UserClubID, AwayID: opp.ID}
		return insertFixture(ctx, q, careerID, f)
	})
}

func at(xs []int, i int) int {
	if i < len(xs) {
		return xs[i]
	}
	return 0
}

// ---------------------------------------------------------------- unpaid wages

const UnrestWeeks = 3 // a transfer request turns into a walk-out after this many matchdays

// wageUnrest: while the club is in the red, the best-paid players ask to leave. If nobody buys them
// within a couple of weeks they move on by themselves and the fee lands in the club's account.
func (w *world) wageUnrest(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	c := w.career
	user := w.byID[c.UserClubID]
	squad := w.players[user.ID]
	// players were saved before money was settled, so write the ones touched here again
	defer func() { _ = savePlayers(ctx, q, squad) }()
	if user.Budget >= 0 {
		for _, p := range squad {
			p.Unrest = 0
		}
		return nil
	}
	// existing requests grow; old ones walk out
	left := 0
	for _, p := range squad {
		if p.Unrest == 0 {
			continue
		}
		p.Unrest++
		if p.Unrest <= UnrestWeeks {
			continue
		}
		var dest []*Club
		for _, cl := range w.clubs {
			if !cl.IsUser && cl.Division > 0 && len(w.players[cl.ID]) < AIMaxSquad {
				dest = append(dest, cl)
			}
		}
		if len(dest) == 0 {
			continue
		}
		to := dest[r.Intn(len(dest))]
		fee := int64(float64(p.Value)*0.6/10_000) * 10_000
		user.Budget += fee
		to.Budget -= fee
		moveTo(p, &to.ID, w.shirtFor(ctx, q, to.ID, p))
		p.Unrest = 0
		w.players[to.ID] = append(w.players[to.ID], p)
		left++
		rep.Departures = append(rep.Departures, Departure{Name: p.Name, Club: to.Name, Fee: fee})
		if err := addFinance(ctx, q, c, "forced_sale", fee, p.Name); err != nil {
			return err
		}
	}
	if left > 0 {
		remain := 0
		for _, p := range squad {
			if p.ClubID != nil && *p.ClubID == user.ID {
				remain++
			}
		}
		if remain < CollapseAt {
			c.Ended = "collapse"
			rep.GameOver = true
			return nil
		}
	}
	if user.Budget >= 0 {
		return nil
	}
	// new requests: best-paid players first, enough to cover the hole (at most three a week)
	cands := []*Player{}
	for _, p := range squad {
		if p.Unrest == 0 && (p.ClubID != nil && *p.ClubID == user.ID) {
			cands = append(cands, p)
		}
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].Wage > cands[j].Wage })
	cover := int64(0)
	for _, p := range squad {
		if p.Unrest > 0 && p.ClubID != nil && *p.ClubID == user.ID {
			cover += int64(float64(p.Value) * 0.6)
		}
	}
	for i := 0; i < len(cands) && i < 3 && cover < -user.Budget; i++ {
		p := cands[i]
		p.Unrest = 1
		p.Morale = clamp(p.Morale-12, 20, 100)
		cover += int64(float64(p.Value) * 0.6)
		rep.Unrest = append(rep.Unrest, p.Name)
	}
	return nil
}

// academy: now and then a prospect graduates into the first-team squad; a better academy produces
// them more often and with higher potential.
func (w *world) academy(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	user := w.byID[w.career.UserClubID]
	lvl := max(1, user.Academy)
	if len(w.players[user.ID]) >= MaxSquad || r.Float64() > 0.035*float64(lvl) {
		return nil
	}
	base := divisionLevel(user.League, user.Division)
	pos := []string{"GK", "DF", "DF", "MF", "MF", "FW", "FW"}[r.Intn(7)]
	p := GenPlayer(r, nationsOf(user.League), pos, base-10+r.Float64()*4, 16, 17)
	p.Potential = int(math.Min(95, float64(p.Potential)+float64(lvl*3)))
	moveTo(p, &user.ID, w.shirtFor(ctx, q, user.ID, p))
	p.Fill()
	if err := insertPlayer(ctx, q, w.career.ID, p); err != nil {
		return err
	}
	w.players[user.ID] = append(w.players[user.ID], p)
	rep.Youth = p.Name
	return nil
}
