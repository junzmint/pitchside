package game

import (
	"context"
	"math"
	"sort"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- achievements
//
// Every achievement watches one counter in ExploreState.Stats and unlocks when it reaches the
// target. Hidden ones show as "???" until earned. Rewards (TP, money, a cosmetic title) are
// collected on the Explore page.

type AchDef struct {
	Key    string `json:"key"`
	Group  string `json:"group"` // match | glory | squad | explore | career
	Tier   string `json:"tier"`  // bronze | silver | gold | platinum
	Hidden bool   `json:"hidden"`
	Stat   string `json:"stat"`
	Target int    `json:"target"`
	TP     int    `json:"tp"`
	Money  int64  `json:"money"`
	Title  bool   `json:"title"` // unlocks a cosmetic title
}

type AchState struct {
	Season  int  `json:"season"`
	Day     int  `json:"day"`
	Claimed bool `json:"claimed"`
}

var AchDefs = []AchDef{
	// matches
	{Key: "first_win", Group: "match", Tier: "bronze", Stat: "wins", Target: 1, TP: 1},
	{Key: "wins_25", Group: "match", Tier: "silver", Stat: "wins", Target: 25, TP: 2, Money: 1 * M},
	{Key: "wins_100", Group: "match", Tier: "gold", Stat: "wins", Target: 100, TP: 4, Money: 5 * M, Title: true},
	{Key: "wins_250", Group: "match", Tier: "platinum", Stat: "wins", Target: 250, TP: 8, Money: 10 * M, Title: true},
	{Key: "streak_5", Group: "match", Tier: "silver", Stat: "streak", Target: 5, TP: 2},
	{Key: "streak_10", Group: "match", Tier: "gold", Stat: "streak", Target: 10, TP: 4, Title: true},
	{Key: "unbeaten_15", Group: "match", Tier: "silver", Stat: "unbeaten", Target: 15, TP: 2},
	{Key: "unbeaten_30", Group: "match", Tier: "gold", Stat: "unbeaten", Target: 30, TP: 4, Money: 3 * M, Title: true},
	{Key: "big_win", Group: "match", Tier: "silver", Stat: "margin", Target: 5, TP: 2},
	{Key: "seven_up", Group: "match", Tier: "gold", Hidden: true, Stat: "scored", Target: 7, TP: 3},
	{Key: "hat_trick", Group: "match", Tier: "bronze", Stat: "haul", Target: 3, TP: 1},
	{Key: "haul_4", Group: "match", Tier: "gold", Hidden: true, Stat: "haul", Target: 4, TP: 3},
	{Key: "clean_15", Group: "match", Tier: "silver", Stat: "clean_season", Target: 15, TP: 2},
	{Key: "giant_killer", Group: "match", Tier: "silver", Stat: "giant", Target: 1, TP: 2},
	{Key: "giant_5", Group: "match", Tier: "gold", Stat: "giant", Target: 5, TP: 3, Title: true},
	{Key: "goals_100", Group: "match", Tier: "gold", Stat: "season_goals", Target: 100, TP: 4, Money: 3 * M, Title: true},
	{Key: "humbled", Group: "match", Tier: "bronze", Hidden: true, Stat: "humbled", Target: 1, TP: 1},
	// glory
	{Key: "euro_debut", Group: "glory", Tier: "bronze", Stat: "euro_apps", Target: 1, TP: 1, Money: 1 * M},
	{Key: "promoted", Group: "glory", Tier: "silver", Stat: "promoted", Target: 1, TP: 3, Money: 2 * M},
	{Key: "league_title", Group: "glory", Tier: "gold", Stat: "league_titles", Target: 1, TP: 4, Money: 2 * M},
	{Key: "top_title", Group: "glory", Tier: "platinum", Stat: "top_titles", Target: 1, TP: 6, Money: 10 * M, Title: true},
	{Key: "titles_5", Group: "glory", Tier: "platinum", Stat: "league_titles", Target: 5, TP: 8, Money: 10 * M, Title: true},
	{Key: "cup_win", Group: "glory", Tier: "gold", Stat: "cups", Target: 1, TP: 3, Money: 2 * M},
	{Key: "euro_win", Group: "glory", Tier: "platinum", Stat: "euro", Target: 1, TP: 8, Money: 15 * M, Title: true},
	{Key: "double", Group: "glory", Tier: "platinum", Hidden: true, Stat: "double", Target: 1, TP: 6, Money: 5 * M},
	{Key: "treble", Group: "glory", Tier: "platinum", Hidden: true, Stat: "treble", Target: 1, TP: 10, Money: 20 * M, Title: true},
	{Key: "invincible", Group: "glory", Tier: "platinum", Hidden: true, Stat: "invincible", Target: 1, TP: 8, Money: 10 * M, Title: true},
	{Key: "seasons_5", Group: "glory", Tier: "silver", Stat: "seasons", Target: 5, TP: 3},
	{Key: "seasons_10", Group: "glory", Tier: "gold", Stat: "seasons", Target: 10, TP: 5, Title: true},
	// squad
	{Key: "sign_legend", Group: "squad", Tier: "silver", Stat: "legends", Target: 1, TP: 2},
	{Key: "legends_5", Group: "squad", Tier: "gold", Stat: "legends", Target: 5, TP: 3},
	{Key: "icons_11", Group: "squad", Tier: "platinum", Hidden: true, Stat: "icons11", Target: 1, TP: 5, Title: true},
	{Key: "star_90", Group: "squad", Tier: "gold", Stat: "star", Target: 90, TP: 2},
	{Key: "youth_80", Group: "squad", Tier: "gold", Stat: "youth80", Target: 1, TP: 4, Title: true},
	{Key: "album_10", Group: "squad", Tier: "silver", Stat: "album", Target: 10, TP: 2},
	{Key: "album_40", Group: "squad", Tier: "gold", Stat: "album", Target: 40, TP: 5, Title: true},
	// exploration
	{Key: "first_mission", Group: "explore", Tier: "bronze", Stat: "missions", Target: 1, TP: 1},
	{Key: "missions_20", Group: "explore", Tier: "silver", Stat: "missions", Target: 20, TP: 3},
	{Key: "find_wonder", Group: "explore", Tier: "silver", Stat: "found_wonder", Target: 1, TP: 2},
	{Key: "find_legendary", Group: "explore", Tier: "gold", Stat: "found_legendary", Target: 1, TP: 3},
	{Key: "sign_find", Group: "explore", Tier: "silver", Stat: "signed_finds", Target: 1, TP: 2},
	{Key: "sign_finds_5", Group: "explore", Tier: "gold", Stat: "signed_finds", Target: 5, TP: 3, Title: true},
	{Key: "globetrotter", Group: "explore", Tier: "gold", Stat: "regions", Target: len(Leagues) + len(WorldLeagues), TP: 4, Title: true},
	{Key: "golden", Group: "explore", Tier: "gold", Hidden: true, Stat: "golden", Target: 1, TP: 2},
	// manager career
	{Key: "rep_50", Group: "career", Tier: "silver", Stat: "rep", Target: 50, TP: 2},
	{Key: "rep_75", Group: "career", Tier: "gold", Stat: "rep", Target: 75, TP: 4},
	{Key: "rep_95", Group: "career", Tier: "platinum", Stat: "rep", Target: 95, TP: 8, Title: true},
	{Key: "rich", Group: "career", Tier: "gold", Stat: "rich", Target: 150, TP: 2},
	{Key: "debt_survivor", Group: "career", Tier: "silver", Hidden: true, Stat: "debt_survivor", Target: 1, TP: 2},
}

func achDef(key string) *AchDef {
	for i := range AchDefs {
		if AchDefs[i].Key == key {
			return &AchDefs[i]
		}
	}
	return nil
}

func (x *ExploreState) best(stat string, v int) {
	if v > x.Stats[stat] {
		x.Stats[stat] = v
	}
}

// unlock marks every achievement whose counter reached its target.
func (w *world) unlock(rep *DayReport) error {
	x := &w.career.Explore
	x.Stats["rep"] = int(x.Manager.Rep)
	for _, d := range AchDefs {
		if x.Ach[d.Key] != nil || x.Stats[d.Stat] < d.Target {
			continue
		}
		x.Ach[d.Key] = &AchState{Season: w.career.Season, Day: w.career.Day}
		w.say(rep, "ach", d.Key, 0, d.Tier)
		if d.Tier == "platinum" && !celebratedElsewhere[d.Key] {
			w.celebrate(Celebration{Kind: "ach", Key: d.Key})
		}
	}
	return nil
}

// trackMatch counts the user's competitive match of the day.
func (w *world) trackMatch(rep *DayReport) {
	if rep == nil || rep.Fixture == nil || rep.Fixture.Comp == "friendly" || !rep.Fixture.Played || rep.Fixture.HomeGoals == nil {
		return
	}
	c := w.career
	x := &c.Explore
	f := rep.Fixture
	if f.ID == x.Run.LastFx {
		return
	}
	x.Run.LastFx = f.ID
	home := f.HomeID == c.UserClubID
	gf, ga := *f.HomeGoals, *f.AwayGoals
	opp, oppID := f.Away, f.AwayID
	if !home {
		gf, ga, opp, oppID = ga, gf, f.Home, f.HomeID
	}
	win := gf > ga || (gf == ga && f.PensHome != nil && *f.PensHome == home)
	loss := gf < ga || (gf == ga && f.PensHome != nil && *f.PensHome != home)
	club := w.byID[c.UserClubID]
	x.Stats["played"]++
	switch {
	case win:
		x.Stats["wins"]++
		x.Run.Streak++
		x.Run.Unbeaten++
		x.Manager.Rep += 0.25
		if o := w.byID[oppID]; o != nil && o.Reputation >= club.Reputation+12 {
			x.Stats["giant"]++
			x.Manager.Rep += 0.5
		}
	case loss:
		x.Run.Streak, x.Run.Unbeaten = 0, 0
		x.Manager.Rep -= 0.15
	default:
		x.Run.Streak = 0
		x.Run.Unbeaten++
		x.Manager.Rep += 0.05
	}
	x.Manager.Rep = clamp(x.Manager.Rep, 0, 100)
	x.best("streak", x.Run.Streak)
	x.best("unbeaten", x.Run.Unbeaten)
	if gf > ga {
		x.best("margin", gf-ga)
	}
	x.best("scored", gf)
	if ga-gf >= 5 {
		x.Stats["humbled"]++
	}
	x.Run.Goals += gf
	x.best("season_goals", x.Run.Goals)
	if ga == 0 {
		x.Run.Clean++
		x.best("clean_season", x.Run.Clean)
	}
	goals := map[int]int{}
	names := map[int]string{}
	for _, e := range rep.Events {
		if e.ClubID == c.UserClubID {
			goals[e.PlayerID]++
			names[e.PlayerID] = e.Name
		}
	}
	for id, n := range goals {
		x.best("haul", n)
		if x.Records.Haul == nil || n > x.Records.Haul.N {
			x.Records.Haul = &HaulRec{Name: names[id], N: n, Season: c.Season}
		}
	}
	rec := &MatchRec{GF: gf, GA: ga, Opp: opp, Club: club.Name, Season: c.Season, Comp: f.Comp}
	if gf > ga && (x.Records.BigWin == nil || gf-ga > x.Records.BigWin.GF-x.Records.BigWin.GA || (gf-ga == x.Records.BigWin.GF-x.Records.BigWin.GA && gf > x.Records.BigWin.GF)) {
		x.Records.BigWin = rec
	}
	if ga > gf && (x.Records.BigLoss == nil || ga-gf > x.Records.BigLoss.GA-x.Records.BigLoss.GF) {
		x.Records.BigLoss = rec
	}
	if x.Records.MostGoal == nil || gf > x.Records.MostGoal.GF {
		x.Records.MostGoal = rec
	}
	// eleven icons on the pitch
	byID := map[int]*Player{}
	for _, p := range w.players[c.UserClubID] {
		byID[p.ID] = p
	}
	icons := 0
	for _, id := range club.Lineup {
		if p := byID[id]; p != nil && isLegend(p) {
			icons++
		}
	}
	if icons >= 11 {
		x.Stats["icons11"] = 1
	}
}

// trackSquad: legends, the album, academy heroes, money, signed discoveries.
func (w *world) trackSquad() {
	c := w.career
	x := &c.Explore
	user := w.byID[c.UserClubID]
	squad := w.players[c.UserClubID]
	legends := 0
	in := map[int]bool{}
	for _, p := range squad {
		in[p.ID] = true
		if p.Tag == "legend" {
			legends++
			key := p.Name + "|" + p.Version
			if _, ok := x.Album[key]; !ok {
				x.Album[key] = c.Season
			}
		}
		if x.Records.BestOvr == nil || p.Overall > x.Records.BestOvr.N {
			x.Records.BestOvr = &HaulRec{Name: p.Name, N: p.Overall, Season: c.Season}
		}
		x.best("star", p.Overall)
		if _, ok := x.Youth[p.ID]; !ok && !isLegend(p) && p.Age <= 19 {
			x.Youth[p.ID] = p.Overall
		}
		if start, ok := x.Youth[p.ID]; ok && start <= 72 && p.Overall >= 80 {
			x.Stats["youth80"] = 1
		}
	}
	for id := range x.Youth {
		if !in[id] {
			delete(x.Youth, id)
		}
	}
	x.best("legends", legends)
	x.Stats["album"] = len(x.Album)
	if user.Budget < 0 {
		x.Run.InDebt = true
	} else if x.Run.InDebt && user.Budget >= 5*M {
		x.Stats["debt_survivor"] = 1
		x.Run.InDebt = false
	}
	x.best("rich", int(user.Budget/M))
	for i := range x.Finds {
		if f := &x.Finds[i]; !f.Signed && in[f.PlayerID] {
			f.Signed = true
			x.Stats["signed_finds"]++
		}
	}
}

// trackSeason: what the season brought.
func (w *world) trackSeason(se *SeasonEnd) {
	x := &w.career.Explore
	x.Stats["seasons"]++
	league := se.Position == 1
	if league {
		x.Stats["league_titles"]++
		if se.Division == 1 {
			x.Stats["top_titles"]++
		}
	}
	if se.Move == "up" {
		x.Stats["promoted"]++
	}
	if se.Cup == "W" {
		x.Stats["cups"]++
	}
	if se.CL == "W" {
		x.Stats["euro"]++
	}
	if se.CL != "" {
		x.Stats["euro_apps"]++
	}
	if league && se.Cup == "W" {
		x.Stats["double"]++
		if se.Division == 1 && se.CL == "W" {
			x.Stats["treble"]++
		}
	}
	played, lost := w.leagueRecord()
	if played >= 30 && lost == 0 {
		x.Stats["invincible"]++
	}
}

// exploreInit starts the state for a career, back-filling what the history book already knows.
func (w *world) exploreInit(ctx context.Context, q DBTX, skipSeason int) error {
	c := w.career
	x := &c.Explore
	x.ensure()
	x.Init = true
	user := w.byID[c.UserClubID]
	x.Manager.Rep = startRep(user)
	if len(x.Manager.Stints) == 0 {
		x.Manager.Stints = []Stint{stintOf(user, c.Season)}
	}
	x.Run.Season = c.Season
	rows, err := q.Query(ctx, `SELECT league_pos, cup, cl, COALESCE((summary->>'division')::int, 0), COALESCE(summary->>'move', '')
		FROM season_history WHERE career_id=$1 AND season <> $2`, c.ID, skipSeason)
	if err != nil {
		return err
	}
	for rows.Next() {
		var se SeasonEnd
		if err := rows.Scan(&se.Position, &se.Cup, &se.CL, &se.Division, &se.Move); err != nil {
			rows.Close()
			return err
		}
		x.Stats["seasons"]++
		if se.Position == 1 {
			x.Stats["league_titles"]++
			if se.Division == 1 {
				x.Stats["top_titles"]++
			}
		}
		if se.Move == "up" {
			x.Stats["promoted"]++
		}
		if se.Cup == "W" {
			x.Stats["cups"]++
		}
		if se.CL == "W" {
			x.Stats["euro"]++
		}
		if se.CL != "" {
			x.Stats["euro_apps"]++
		}
	}
	rows.Close()
	fx, err := queryFixtures(ctx, q, `career_id=$1 AND played AND comp <> 'friendly' AND (home_id=$2 OR away_id=$2)`, c.ID, user.ID)
	if err != nil {
		return err
	}
	sort.SliceStable(fx, func(i, j int) bool {
		if fx[i].Season != fx[j].Season {
			return fx[i].Season < fx[j].Season
		}
		return fx[i].Day < fx[j].Day
	})
	for _, f := range fx {
		if f.HomeGoals == nil || f.AwayGoals == nil {
			continue
		}
		h, a := w.byID[f.HomeID], w.byID[f.AwayID]
		if h == nil || a == nil {
			continue
		}
		v := viewFixture(f, w.byID)
		if f.Season != x.Run.Season {
			x.Run.Season, x.Run.Goals, x.Run.Clean = f.Season, 0, 0
		}
		w.trackMatch(&DayReport{Fixture: &v})
	}
	x.Run.Season = c.Season
	x.Manager.Rep = math.Max(startRep(user), x.Manager.Rep)
	return nil
}

// ---------------------------------------------------------------- rewards and titles

type ClaimResult struct {
	TP     int      `json:"tp"`
	Money  int64    `json:"money"`
	Titles []string `json:"titles"`
	Keys   []string `json:"keys"`
}

// ClaimAchievements collects one reward (key) or all of them (key "").
func (s *Store) ClaimAchievements(ctx context.Context, careerID int, key string) (*ClaimResult, error) {
	res := &ClaimResult{Titles: []string{}, Keys: []string{}}
	err := s.exploreTx(ctx, careerID, func(w *world, q pgx.Tx) error {
		c := w.career
		x := &c.Explore
		user := w.byID[c.UserClubID]
		for _, d := range AchDefs {
			a := x.Ach[d.Key]
			if a == nil || a.Claimed || (key != "" && key != d.Key) {
				continue
			}
			a.Claimed = true
			c.TP += d.TP
			user.Budget += d.Money
			res.TP += d.TP
			res.Money += d.Money
			res.Keys = append(res.Keys, d.Key)
			if d.Title {
				res.Titles = append(res.Titles, d.Key)
			}
		}
		if len(res.Keys) == 0 {
			return userErr("nothing_to_claim", "Nothing to collect")
		}
		return addFinance(ctx, q, c, "achievement", res.Money, "")
	})
	return res, err
}

// SetTitle equips a cosmetic title from a collected achievement ("" takes it off).
func (s *Store) SetTitle(ctx context.Context, careerID int, key string) error {
	return s.exploreTx(ctx, careerID, func(w *world, q pgx.Tx) error {
		x := &w.career.Explore
		if key != "" {
			d, a := achDef(key), x.Ach[key]
			if d == nil || !d.Title || a == nil || !a.Claimed {
				return userErr("title_locked", "You haven't earned this title yet")
			}
		}
		x.Title = key
		return nil
	})
}

type AchView struct {
	AchDef
	Progress int  `json:"progress"`
	Got      bool `json:"got"`
	Claimed  bool `json:"claimed"`
	Season   int  `json:"season"`
}

func (w *world) achView() []AchView {
	x := &w.career.Explore
	out := make([]AchView, 0, len(AchDefs))
	for i, d := range AchDefs {
		v := AchView{AchDef: d, Progress: min(x.Stats[d.Stat], d.Target)}
		if a := x.Ach[d.Key]; a != nil {
			v.Got, v.Claimed, v.Season = true, a.Claimed, a.Season
		} else if d.Hidden {
			v.AchDef = AchDef{Key: "hidden_" + itoa(i), Group: d.Group, Tier: d.Tier, Hidden: true}
			v.Progress = 0
		}
		out = append(out, v)
	}
	return out
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	s := ""
	for i > 0 {
		s = string(rune('0'+i%10)) + s
		i /= 10
	}
	return s
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }
