package game

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
)

// ---------------------------------------------------------------- the Explore page

type ScoutInfo struct {
	ID    int    `json:"id"` // -1: the manager himself
	Name  string `json:"name"`
	Skill int    `json:"skill"`
	Eye   bool   `json:"eye"`
	Busy  bool   `json:"busy"`
}

type FindView struct {
	Find
	Player  *Player `json:"player"` // as he is today (nil: gone from the game)
	NowClub string  `json:"nowClub"`
	NowID   int     `json:"nowClubId"`
	Status  string  `json:"status"` // club | yours | free | retired | gone
}

type TrophyItem struct {
	Kind     string   `json:"kind"` // league | cup | cl | promotion
	Season   int      `json:"season"`
	Club     string   `json:"club"`
	Short    string   `json:"short,omitempty"`
	Color    string   `json:"color,omitempty"`
	Color2   string   `json:"color2,omitempty"`
	League   string   `json:"league"`
	Division int      `json:"division"`
	Opp      string   `json:"opp,omitempty"`
	Score    string   `json:"score,omitempty"`
	Pens     bool     `json:"pens,omitempty"`
	Scorers  []string `json:"scorers,omitempty"`
	Points   int      `json:"points,omitempty"`
}

func (t *TrophyItem) enrich(cb Celebration) {
	t.Short, t.Color, t.Color2 = cb.Short, cb.Color, cb.Color2
	t.Opp, t.Score, t.Pens, t.Scorers, t.Points = cb.Opp, cb.Score, cb.Pens, cb.Scorers, cb.Points
	if cb.Club != "" {
		t.Club = cb.Club
	}
}

type SeasonLine struct {
	Season   int    `json:"season"`
	Club     string `json:"club"`
	League   string `json:"league"`
	Division int    `json:"division"`
	Pos      int    `json:"pos"`
	Points   int    `json:"points"`
	Cup      string `json:"cup"`
	CL       string `json:"cl"`
	Move     string `json:"move"`
}

type HallItem struct {
	PlayerID int     `json:"playerId"`
	Name     string  `json:"name"`
	Version  string  `json:"version"`
	Tag      string  `json:"tag"`
	Position string  `json:"position"`
	Apps     int     `json:"apps"`
	Goals    int     `json:"goals"`
	Rating   float64 `json:"rating"`
}

type ExploreFull struct {
	Badge        ExploreBadge   `json:"badge"`
	Regions      []Region       `json:"regions"`
	Scouts       []ScoutInfo    `json:"scouts"`
	Missions     []Mission      `json:"missions"`
	Finds        []FindView     `json:"finds"`
	Focus        []string       `json:"focus"`
	Achievements []AchView      `json:"achievements"`
	Stats        map[string]int `json:"stats"`
	Run          RunState       `json:"run"`
	Records      Records        `json:"records"`
	Trophies     []TrophyItem   `json:"trophies"`
	Seasons      []SeasonLine   `json:"seasons"`
	Scorers      []StatLine     `json:"scorers"`
	Apps         []StatLine     `json:"apps"`
	Hall         []HallItem     `json:"hall"`
	Manager      Manager        `json:"manager"`
	Tiers        []TierInfo     `json:"tiers"`
	Reach        int            `json:"reach"`
	ClubRep      int            `json:"clubRep"`
	Titles       []string       `json:"titles"`
	Feed         []FeedItem     `json:"feed"`
	AlbumOwned   int            `json:"albumOwned"`
	AlbumTotal   int            `json:"albumTotal"`
	Budget       int64          `json:"budget"`
	TP           int            `json:"tp"`
	Season       int            `json:"season"`
	Day          int            `json:"day"`
}

type TierInfo struct {
	Key string  `json:"key"`
	Min float64 `json:"min"`
}

// lightWorld: enough of the world for the Explore page (no squads of other clubs).
func lightWorld(ctx context.Context, q DBTX, careerID int) (*world, error) {
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
	if w.coaches[c.UserClubID], err = queryCoaches(ctx, q, `career_id=$1 AND club_id=$2`, careerID, c.UserClubID); err != nil {
		return nil, err
	}
	c.Explore.ensure()
	if !c.Explore.Init {
		if err := w.exploreInit(ctx, q, 0); err != nil { // for display only; saved on the next action
			return nil, err
		}
	}
	return w, nil
}

// stintScope: an SQL condition (on alias s) for the seasons the manager spent at each club.
func stintScope(st []Stint, first int) (string, []any) {
	var parts []string
	var args []any
	for _, x := range st {
		to := x.To
		if !x.Closed {
			to = 9999
		}
		n := first + len(args)
		parts = append(parts, fmt.Sprintf("(s.club_id=$%d AND s.season BETWEEN $%d AND $%d)", n, n+1, n+2))
		args = append(args, x.ClubID, x.From, to)
	}
	if len(parts) == 0 {
		return "false", nil
	}
	return "(" + strings.Join(parts, " OR ") + ")", args
}

func (s *Store) ExploreFull(ctx context.Context, careerID int) (*ExploreFull, error) {
	w, err := lightWorld(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	c := w.career
	x := &c.Explore
	user := w.byID[c.UserClubID]
	v := &ExploreFull{Badge: w.exploreView().(ExploreBadge), Regions: w.regions(), Missions: x.Missions, Focus: MissionFocus,
		Achievements: w.achView(), Stats: x.Stats, Run: x.Run, Records: x.Records, Manager: x.Manager, Reach: reachable(x.Manager.Rep),
		ClubRep: user.Reputation, Titles: []string{}, Feed: x.Feed, AlbumOwned: len(x.Album), AlbumTotal: len(LegendVersions),
		Budget: user.Budget, TP: c.TP, Season: c.Season, Day: c.Day, Finds: []FindView{}, Trophies: []TrophyItem{}, Seasons: []SeasonLine{},
		Hall: []HallItem{}, Scorers: []StatLine{}, Apps: []StatLine{}}
	if v.Missions == nil {
		v.Missions = []Mission{}
	}
	if v.Feed == nil {
		v.Feed = []FeedItem{}
	}
	if v.Manager.Offers == nil {
		v.Manager.Offers = []JobOffer{}
	}
	for _, t := range ManagerTiers {
		v.Tiers = append(v.Tiers, TierInfo{t.Key, t.Min})
	}
	for _, d := range AchDefs {
		if a := x.Ach[d.Key]; a != nil && a.Claimed && d.Title {
			v.Titles = append(v.Titles, d.Key)
		}
	}
	// scouts
	busy := map[int]bool{}
	for _, m := range x.Missions {
		if m.Left > 0 {
			busy[m.ScoutID] = true
		}
	}
	for _, co := range w.scoutsOf() {
		si := ScoutInfo{ID: co.ID, Name: co.Name, Skill: co.Skill, Busy: busy[co.ID]}
		for _, p := range co.Perks {
			si.Eye = si.Eye || p == "talent_eye"
		}
		v.Scouts = append(v.Scouts, si)
	}
	if len(v.Scouts) == 0 {
		v.Scouts = []ScoutInfo{{ID: -1, Skill: SelfScoutSkill, Busy: busy[-1]}}
	}
	// the discovery log, with each player as he is today
	ids := []int{}
	for _, f := range x.Finds {
		ids = append(ids, f.PlayerID)
	}
	now := map[int]*Player{}
	if len(ids) > 0 {
		ps, err := queryPlayers(ctx, s.DB, `career_id=$1 AND id = ANY($2)`, careerID, ids)
		if err != nil {
			return nil, err
		}
		redact(ps, user.ID, userScoutSkill(ctx, s.DB, user.ID))
		for _, p := range ps {
			p.Price = askingPrice(p, c.Season)
			now[p.ID] = p
		}
	}
	for _, f := range x.Finds {
		fv := FindView{Find: f, Status: "gone"}
		if p := now[f.PlayerID]; p != nil {
			fv.Player = p
			switch {
			case p.Retired:
				fv.Status = "retired"
			case p.ClubID == nil:
				fv.Status = "free"
			case *p.ClubID == user.ID:
				fv.Status = "yours"
			default:
				fv.Status = "club"
				fv.NowID = *p.ClubID
				if cl := w.byID[*p.ClubID]; cl != nil {
					fv.NowClub = cl.Name
				}
			}
		}
		v.Finds = append(v.Finds, fv)
	}
	// the trophy cabinet and the season book: history rows, told with the story of the day where we have it
	detail := map[string]Celebration{}
	for _, t := range x.Trophies {
		detail[fmt.Sprintf("%d|%s", t.Season, t.Kind)] = t
	}
	addTrophy := func(ti TrophyItem) {
		k := fmt.Sprintf("%d|%s", ti.Season, ti.Kind)
		if cb, ok := detail[k]; ok {
			ti.enrich(cb)
			delete(detail, k)
		}
		v.Trophies = append(v.Trophies, ti)
	}
	rows, err := s.DB.Query(ctx, `SELECT h.season, k.name, COALESCE(h.summary->>'league', k.league), COALESCE((h.summary->>'division')::int, 0),
		h.league_pos, h.points, h.cup, h.cl, COALESCE(h.summary->>'move', '')
		FROM season_history h JOIN clubs k ON k.id=h.club_id WHERE h.career_id=$1 ORDER BY h.season`, careerID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var sl SeasonLine
		if err := rows.Scan(&sl.Season, &sl.Club, &sl.League, &sl.Division, &sl.Pos, &sl.Points, &sl.Cup, &sl.CL, &sl.Move); err != nil {
			rows.Close()
			return nil, err
		}
		v.Seasons = append(v.Seasons, sl)
		ti := TrophyItem{Season: sl.Season, Club: sl.Club, League: sl.League, Division: sl.Division}
		if sl.Pos == 1 {
			ti.Kind = "league"
			addTrophy(ti)
		}
		if sl.Cup == "W" {
			ti.Kind = "cup"
			addTrophy(ti)
		}
		if sl.CL == "W" {
			ti.Kind = "cl"
			addTrophy(ti)
		}
		if sl.Move == "up" && sl.Pos != 1 {
			ti.Kind = "promotion"
			ti.Division = max(1, sl.Division-1)
			addTrophy(ti)
		}
	}
	rows.Close()
	// titles not in the history book yet (this season's cups) or won at a club you have since left
	for _, cb := range x.Trophies {
		if _, ok := detail[fmt.Sprintf("%d|%s", cb.Season, cb.Kind)]; ok {
			ti := TrophyItem{Kind: cb.Kind, Season: cb.Season, Club: cb.Club, League: cb.League, Division: cb.Division}
			ti.enrich(cb)
			v.Trophies = append(v.Trophies, ti)
		}
	}
	kindOrder := map[string]int{"cl": 0, "league": 1, "cup": 2, "promotion": 3}
	sort.SliceStable(v.Trophies, func(i, j int) bool {
		if v.Trophies[i].Season != v.Trophies[j].Season {
			return v.Trophies[i].Season > v.Trophies[j].Season
		}
		return kindOrder[v.Trophies[i].Kind] < kindOrder[v.Trophies[j].Kind]
	})
	// all-time players under this manager, at every club he ran
	scope, args := stintScope(x.Manager.Stints, 2)
	q := `SELECT s.player_id, p.name, p.position, p.tag, p.version, sum(s.apps), sum(s.goals), sum(s.assists), sum(s.rating_sum), p.retired
		FROM player_stats s JOIN players p ON p.id=s.player_id
		WHERE s.career_id=$1 AND s.comp <> 'friendly' AND ` + scope + `
		GROUP BY s.player_id, p.name, p.position, p.tag, p.version, p.retired`
	rows, err = s.DB.Query(ctx, q, append([]any{careerID}, args...)...)
	if err != nil {
		return nil, err
	}
	var all []StatLine
	for rows.Next() {
		var l StatLine
		var tag, ver string
		var rs float64
		if err := rows.Scan(&l.PlayerID, &l.Name, &l.Position, &tag, &ver, &l.Apps, &l.Goals, &l.Assists, &rs, &l.Retired); err != nil {
			rows.Close()
			return nil, err
		}
		if l.Apps > 0 {
			l.Rating = math.Round(rs/float64(l.Apps)*100) / 100
		}
		all = append(all, l)
		if tag != "" && l.Apps > 0 {
			v.Hall = append(v.Hall, HallItem{PlayerID: l.PlayerID, Name: l.Name, Version: ver, Tag: tag, Position: l.Position, Apps: l.Apps, Goals: l.Goals, Rating: l.Rating})
		}
	}
	rows.Close()
	top := func(less func(a, b StatLine) bool) []StatLine {
		xs := append([]StatLine{}, all...)
		sort.Slice(xs, func(i, j int) bool { return less(xs[i], xs[j]) })
		if len(xs) > 5 {
			xs = xs[:5]
		}
		return xs
	}
	v.Scorers = top(func(a, b StatLine) bool { return a.Goals > b.Goals })
	v.Apps = top(func(a, b StatLine) bool { return a.Apps > b.Apps })
	sort.Slice(v.Hall, func(i, j int) bool { return v.Hall[i].Apps > v.Hall[j].Apps })
	return v, nil
}

// ---------------------------------------------------------------- legend album

type AlbumCard struct {
	Name    string  `json:"name"`
	Version string  `json:"version"`
	Pos     string  `json:"pos"`
	Nation  string  `json:"nation"`
	Ovr     float64 `json:"ovr"`
	Owned   int     `json:"owned"` // season first owned, 0 = not yet
}

type AlbumView struct {
	Cards []AlbumCard `json:"cards"`
	Owned int         `json:"owned"`
}

func (s *Store) Album(ctx context.Context, careerID int) (*AlbumView, error) {
	c, err := getCareer(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	v := &AlbumView{Cards: make([]AlbumCard, 0, len(LegendVersions)), Owned: len(c.Explore.Album)}
	for _, lv := range LegendVersions {
		label := lv.Label
		if lv.Club != "" {
			label = lv.Club + " " + lv.Label
		}
		v.Cards = append(v.Cards, AlbumCard{Name: lv.Name, Version: label, Pos: lv.Pos, Nation: lv.Nation, Ovr: lv.Ovr, Owned: c.Explore.Album[lv.Name+"|"+label]})
	}
	return v, nil
}
