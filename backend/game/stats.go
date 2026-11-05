package game

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
)

type StatLine struct {
	PlayerID int     `json:"playerId"`
	Name     string  `json:"name"`
	Position string  `json:"position"`
	Club     string  `json:"club"`
	ClubID   int     `json:"clubId"`
	Apps     int     `json:"apps"`
	Goals    int     `json:"goals"`
	Assists  int     `json:"assists"`
	Rating   float64 `json:"rating"`
	CS       int     `json:"cs"`
	Retired  bool    `json:"retired"`
}

type StatsView struct {
	Season  int        `json:"season"`
	Comp    string     `json:"comp"`
	Goals   []StatLine `json:"goals"`
	Assists []StatLine `json:"assists"`
	Ratings []StatLine `json:"ratings"`
	Squad   []StatLine `json:"squad"`
}

// Stats for one season and competition ("all" sums every competitive match).
func (s *Store) Stats(ctx context.Context, careerID, season int, comp string) (*StatsView, error) {
	c, err := getCareer(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	if season <= 0 {
		season = c.Season
	}
	compFilter := `AND s.comp <> 'friendly'`
	args := []any{careerID, season}
	if comp == "league" || comp == "cup" || comp == "cl" || comp == "friendly" {
		compFilter = `AND s.comp = $3`
		args = append(args, comp)
	} else {
		comp = "all"
	}
	scope := ""
	var user Club
	_ = s.DB.QueryRow(ctx, `SELECT league, division FROM clubs WHERE id=$1`, c.UserClubID).Scan(&user.League, &user.Division)
	switch comp {
	case "league":
		scope = fmt.Sprintf(` AND k.league = '%s' AND k.division = %d`, user.League, user.Division)
	case "cup":
		scope = fmt.Sprintf(` AND k.league = '%s'`, user.League)
	}
	rows, err := s.DB.Query(ctx, `SELECT s.player_id, p.name, p.position, k.name, k.id, sum(s.apps), sum(s.goals), sum(s.assists),
		sum(s.rating_sum), sum(s.cs), p.retired
		FROM player_stats s JOIN players p ON p.id=s.player_id JOIN clubs k ON k.id=s.club_id
		WHERE s.career_id=$1 AND s.season=$2 `+compFilter+scope+`
		GROUP BY s.player_id, p.name, p.position, k.name, k.id, p.retired`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var all []StatLine
	for rows.Next() {
		var l StatLine
		var rs float64
		if err := rows.Scan(&l.PlayerID, &l.Name, &l.Position, &l.Club, &l.ClubID, &l.Apps, &l.Goals, &l.Assists, &rs, &l.CS, &l.Retired); err != nil {
			return nil, err
		}
		if l.Apps > 0 {
			l.Rating = math.Round(rs/float64(l.Apps)*100) / 100
		}
		all = append(all, l)
	}
	v := &StatsView{Season: season, Comp: comp}
	top := func(less func(a, b StatLine) bool, keep func(StatLine) bool) []StatLine {
		xs := []StatLine{}
		for _, l := range all {
			if keep(l) {
				xs = append(xs, l)
			}
		}
		sort.Slice(xs, func(i, j int) bool { return less(xs[i], xs[j]) })
		if len(xs) > 10 {
			xs = xs[:10]
		}
		return xs
	}
	v.Goals = top(func(a, b StatLine) bool { return a.Goals > b.Goals || (a.Goals == b.Goals && a.Apps < b.Apps) }, func(l StatLine) bool { return l.Goals > 0 })
	v.Assists = top(func(a, b StatLine) bool { return a.Assists > b.Assists || (a.Assists == b.Assists && a.Apps < b.Apps) }, func(l StatLine) bool { return l.Assists > 0 })
	minApps := 3
	v.Ratings = top(func(a, b StatLine) bool { return a.Rating > b.Rating }, func(l StatLine) bool { return l.Apps >= minApps })
	v.Squad = []StatLine{}
	for _, l := range all {
		if l.ClubID == c.UserClubID {
			v.Squad = append(v.Squad, l)
		}
	}
	sort.Slice(v.Squad, func(i, j int) bool { return v.Squad[i].Apps > v.Squad[j].Apps })
	return v, rows.Err()
}

// ---------------------------------------------------------------- history

type SeasonRecord struct {
	Season    int             `json:"season"`
	ClubName  string          `json:"clubName"`
	LeaguePos int             `json:"leaguePos"`
	Points    int             `json:"points"`
	Cup       string          `json:"cup"`
	CL        string          `json:"cl"`
	Prize     int64           `json:"prize"`
	Summary   json.RawMessage `json:"summary"`
}

type Legend struct {
	StatLine
	Tier    string   `json:"tier"`    // legend | icon
	Reasons []string `json:"reasons"` // codes
}

type HistoryView struct {
	Seasons []SeasonRecord `json:"seasons"`
	Matches []HistMatch    `json:"matches"`
	Scorers []StatLine     `json:"scorers"`
	Apps    []StatLine     `json:"apps"`
	Legends []Legend       `json:"legends"`
	Totals  map[string]int `json:"totals"`
}

type HistMatch struct {
	FixtureView
	Season int `json:"season"`
}

func (s *Store) History(ctx context.Context, careerID int) (*HistoryView, error) {
	c, err := getCareer(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	v := &HistoryView{Seasons: []SeasonRecord{}, Matches: []HistMatch{}, Totals: map[string]int{}}
	rows, err := s.DB.Query(ctx, `SELECT h.season, k.name, h.league_pos, h.points, h.cup, h.cl, h.prize, h.summary
		FROM season_history h JOIN clubs k ON k.id=h.club_id WHERE h.career_id=$1 ORDER BY h.season DESC`, careerID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var r SeasonRecord
		var sum []byte
		if err := rows.Scan(&r.Season, &r.ClubName, &r.LeaguePos, &r.Points, &r.Cup, &r.CL, &r.Prize, &sum); err != nil {
			rows.Close()
			return nil, err
		}
		r.Summary = sum
		v.Seasons = append(v.Seasons, r)
		if r.LeaguePos == 1 {
			v.Totals["leagueTitles"]++
		}
		if r.Cup == "W" {
			v.Totals["cups"]++
		}
		if r.CL == "W" {
			v.Totals["cl"]++
		}
	}
	rows.Close()

	clubs, err := listClubs(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	byID := map[int]*Club{}
	for _, k := range clubs {
		byID[k.ID] = k
	}
	fx, err := queryFixtures(ctx, s.DB, `career_id=$1 AND played AND (home_id=$2 OR away_id=$2)`, careerID, c.UserClubID)
	if err != nil {
		return nil, err
	}
	for i := len(fx) - 1; i >= 0; i-- {
		f := fx[i]
		v.Matches = append(v.Matches, HistMatch{FixtureView: viewFixture(f, byID), Season: f.Season})
		if f.Comp == "friendly" {
			continue
		}
		gf, ga := *f.HomeGoals, *f.AwayGoals
		if f.AwayID == c.UserClubID {
			gf, ga = ga, gf
		}
		v.Totals["played"]++
		v.Totals["goalsFor"] += gf
		v.Totals["goalsAgainst"] += ga
		switch {
		case gf > ga:
			v.Totals["won"]++
		case gf == ga:
			v.Totals["drawn"]++
		default:
			v.Totals["lost"]++
		}
	}
	// sort fixtures newest first (season desc, day desc)
	sort.SliceStable(v.Matches, func(i, j int) bool {
		if v.Matches[i].Season != v.Matches[j].Season {
			return v.Matches[i].Season > v.Matches[j].Season
		}
		return v.Matches[i].Day > v.Matches[j].Day
	})

	// all-time competitive stats for the user's club
	rows, err = s.DB.Query(ctx, `SELECT s.player_id, p.name, p.position, sum(s.apps), sum(s.goals), sum(s.assists), sum(s.rating_sum), sum(s.cs), p.retired
		FROM player_stats s JOIN players p ON p.id=s.player_id
		WHERE s.career_id=$1 AND s.club_id=$2 AND s.comp <> 'friendly'
		GROUP BY s.player_id, p.name, p.position, p.retired`, careerID, c.UserClubID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var all []StatLine
	for rows.Next() {
		var l StatLine
		var rs float64
		if err := rows.Scan(&l.PlayerID, &l.Name, &l.Position, &l.Apps, &l.Goals, &l.Assists, &rs, &l.CS, &l.Retired); err != nil {
			return nil, err
		}
		if l.Apps > 0 {
			l.Rating = math.Round(rs/float64(l.Apps)*100) / 100
		}
		all = append(all, l)
	}
	cp := func(less func(a, b StatLine) bool) []StatLine {
		xs := append([]StatLine{}, all...) // never nil: the UI maps over it
		sort.Slice(xs, func(i, j int) bool { return less(xs[i], xs[j]) })
		if len(xs) > 10 {
			xs = xs[:10]
		}
		return xs
	}
	v.Scorers = cp(func(a, b StatLine) bool { return a.Goals > b.Goals })
	v.Apps = cp(func(a, b StatLine) bool { return a.Apps > b.Apps })
	// Legend criteria:
	//   legend: 100+ appearances, or 50+ goals, or 40+ assists
	//   icon:   50+ appearances, or 25+ goals, or 20+ assists, or avg rating ≥ 7.5 over 25+ games
	v.Legends = []Legend{}
	for _, l := range all {
		var reasons []string
		tier := ""
		if l.Apps >= 100 || l.Goals >= 50 || l.Assists >= 40 {
			tier = "legend"
		} else if l.Apps >= 50 || l.Goals >= 25 || l.Assists >= 20 || (l.Apps >= 25 && l.Rating >= 7.5) {
			tier = "icon"
		}
		if tier == "" {
			continue
		}
		if l.Apps >= 50 {
			reasons = append(reasons, "apps")
		}
		if l.Goals >= 25 {
			reasons = append(reasons, "goals")
		}
		if l.Assists >= 20 {
			reasons = append(reasons, "assists")
		}
		if l.Apps >= 25 && l.Rating >= 7.5 {
			reasons = append(reasons, "rating")
		}
		v.Legends = append(v.Legends, Legend{StatLine: l, Tier: tier, Reasons: reasons})
	}
	sort.Slice(v.Legends, func(i, j int) bool {
		if v.Legends[i].Tier != v.Legends[j].Tier {
			return v.Legends[i].Tier == "legend"
		}
		return v.Legends[i].Apps > v.Legends[j].Apps
	})
	return v, rows.Err()
}
