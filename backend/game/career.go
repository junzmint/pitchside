package game

import (
	"context"
	"math/rand"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const (
	MaxSquad    = 50 // the user's squad cap; wages are the real limit
	AIMaxSquad  = 30
	CollapseAt  = 10 // fewer players than this after walk-outs ends the career
	MinSquad    = 14
	AIMinSquad  = 20
	CLGroups    = 8
	CLPerLeague = 8 // top 8 of each top division qualify → 32 clubs
)

func newRand() *rand.Rand { return rand.New(rand.NewSource(time.Now().UnixNano())) }

// ---------------------------------------------------------------- leagues listing

type LeagueInfo struct {
	World     bool           `json:"world"`
	Code      string         `json:"code"`
	Name      string         `json:"name"`
	Country   string         `json:"country"`
	Divisions []DivisionInfo `json:"divisions"`
	Clubs     []ClubInfo     `json:"clubs"`
}

type DivisionInfo struct {
	Division int        `json:"division"`
	Name     string     `json:"name"`
	Clubs    []ClubInfo `json:"clubs"`
}

type ClubInfo struct {
	Index     int      `json:"index"`
	Name      string   `json:"name"`
	Short     string   `json:"short"`
	Color     string   `json:"color"`
	Color2    string   `json:"color2"`
	Strength  int      `json:"strength"`
	Budget    int64    `json:"budget"`
	Formation string   `json:"formation"`
	Coach     string   `json:"coach"`
	Stars     []string `json:"stars"`
}

func ListLeagues() []LeagueInfo {
	out := []LeagueInfo{}
	for _, l := range Leagues {
		li := LeagueInfo{Code: l.Code, Name: l.Name, Country: l.Country, Clubs: []ClubInfo{}}
		defs := CountryClubDefs(l.Code)
		for d := 1; d <= Divisions; d++ {
			di := DivisionInfo{Division: d, Name: divisionName(l.Code, d)}
			for i := (d - 1) * DivisionSize; i < d*DivisionSize && i < len(defs); i++ {
				c := defs[i]
				ci := ClubInfo{Index: i, Name: c.Name, Short: c.Short, Color: c.Color, Color2: c.Color2, Strength: int(c.Base),
					Budget: c.Budget, Formation: c.Formation, Coach: c.Coach.Name}
				for _, s := range c.Stars {
					ci.Stars = append(ci.Stars, s.Name)
				}
				di.Clubs = append(di.Clubs, ci)
			}
			li.Divisions = append(li.Divisions, di)
		}
		out = append(out, li)
	}
	for _, w := range WorldLeagues {
		out = append(out, LeagueInfo{World: true, Code: w.Code, Name: w.Name, Country: w.Country, Clubs: []ClubInfo{}, Divisions: []DivisionInfo{}})
	}
	return out
}

// ---------------------------------------------------------------- new career

type CustomClub struct {
	Name   string `json:"name"`
	Short  string `json:"short"`
	Color  string `json:"color"`
	Color2 string `json:"color2"`
}

type NewCareerReq struct {
	League    string      `json:"league"`
	ClubIndex int         `json:"clubIndex"` // index into the country's 60 clubs
	Division  int         `json:"division"`  // for a custom club
	Custom    *CustomClub `json:"custom"`
}

func (s *Store) NewCareer(ctx context.Context, userID int, req NewCareerReq) (int, error) {
	ld := LeagueByCode(req.League)
	if ld == nil {
		return 0, userErr("bad_league", "Unknown league")
	}
	all := Divisions * DivisionSize
	userIdx := req.ClubIndex
	var custom *ClubDef
	if req.Custom != nil {
		name := strings.TrimSpace(req.Custom.Name)
		short := strings.ToUpper(strings.TrimSpace(req.Custom.Short))
		if name == "" || utf8.RuneCountInString(name) > 30 {
			return 0, userErr("bad_club_name", "Club name must be 1–30 characters")
		}
		if short == "" || utf8.RuneCountInString(short) > 4 {
			return 0, userErr("bad_club_short", "Short name must be 1–4 characters")
		}
		div := req.Division
		if div < 1 || div > Divisions {
			div = Divisions
		}
		userIdx = div*DivisionSize - 1 // replaces the smallest club of that division
		col, col2 := req.Custom.Color, req.Custom.Color2
		if col == "" {
			col = "#e2523f"
		}
		if col2 == "" {
			col2 = "#ffffff"
		}
		base := map[int]float64{1: 68, 2: 62, 3: 57}[div]
		custom = &ClubDef{Name: name, Short: short, Color: col, Color2: col2, Base: base, Rep: int(base) - 4, Budget: int64(base-45) * 2 * M,
			Formation: "4-4-2", Tactic: DefaultTactic()}
	} else if userIdx < 0 || userIdx >= all {
		return 0, userErr("bad_club", "Pick a club")
	}

	r := newRand()
	var id int
	err := s.tx(ctx, func(q pgx.Tx) error {
		if err := q.QueryRow(ctx, `INSERT INTO careers (user_id, league) VALUES ($1,$2) RETURNING id`, userID, ld.Code).Scan(&id); err != nil {
			return err
		}
		career := &Career{ID: id, UserID: userID, League: ld.Code, Season: 1, Day: 1, Training: Training{Intensity: "normal"}, TP: 10, Ticket: "normal"}
		var clubs []*Club
		var qualifiers []int
		var bulkPlayers []*Player
		var bulkCoaches []*Coach
		var userSquad []*Player
		var userClub *Club
		// pass 1: clubs (one round trip), pass 2: squads and staff
		type slot struct {
			c   *Club
			def ClubDef
			l   LeagueDef
		}
		var slots []slot
		for _, l := range Leagues {
			for i, def := range CountryClubDefs(l.Code) {
				isUser := l.Code == ld.Code && i == userIdx
				if isUser && custom != nil {
					def = *custom
				}
				c := &Club{CareerID: id, League: l.Code, Division: i/DivisionSize + 1, Name: def.Name, Short: def.Short, Color: def.Color,
					Color2: def.Color2, IsUser: isUser, Budget: def.Budget, Reputation: def.Rep, Formation: def.Formation, Tactic: def.Tactic, FormWeeks: 6}
				c.Tactic.Normalize()
				slots = append(slots, slot{c, def, l})
				clubs = append(clubs, c)
			}
		}
		if err := insertClubs(ctx, q, clubs); err != nil {
			return err
		}
		for idx, sl := range slots {
			c, def, l := sl.c, sl.def, sl.l
			if idx%(Divisions*DivisionSize) < CLPerLeague {
				qualifiers = append(qualifiers, c.ID) // the top 8 of each top division, best first
			}
			squad := GenSquad(r, l.Nations, def.Base, def.Stars)
			for _, p := range squad {
				cid := c.ID
				p.ClubID = &cid
				p.History = []int{}
				if r.Intn(10) < 3 {
					p.History = append(p.History, -1) // filled below with a random former club
				}
				p.History = append(p.History, cid)
				p.Tenure = 3 + r.Intn(40)
			}
			if c.IsUser {
				userSquad, userClub = squad, c
				career.UserClubID = c.ID
			} else {
				bulkPlayers = append(bulkPlayers, squad...)
			}
			head := GenCoach(r, l.Nations, "head", 6+int(def.Base-55)/3)
			if def.Coach.Name != "" {
				head.Name, head.Nation, head.Skill = def.Coach.Name, def.Coach.Nation, def.Coach.Skill
				if st, ok := famousStyles[def.Coach.Name]; ok {
					head.Style = st
				}
			}
			head.ClubID = &c.ID
			bulkCoaches = append(bulkCoaches, head)
			for _, role := range CoachRoles[1:] {
				skill := int(clamp(5+float64(def.Rep-70)/3+float64(r.Intn(4)), 3, 18))
				if c.IsUser && custom != nil {
					skill = 6
				}
				co := GenCoach(r, l.Nations, role, skill)
				co.ClubID = &c.ID
				bulkCoaches = append(bulkCoaches, co)
			}
		}
		// shared former clubs give chemistry links between some players
		fill := func(ps []*Player) {
			for _, p := range ps {
				if len(p.History) > 1 && p.History[0] == -1 {
					p.History[0] = clubs[r.Intn(len(clubs))].ID
				}
			}
		}
		fill(bulkPlayers)
		fill(userSquad)
		for _, p := range userSquad {
			if err := insertPlayer(ctx, q, id, p); err != nil {
				return err
			}
		}
		userClub.Lineup = BestLineup(userSquad, userClub.Formation)
		if err := saveClub(ctx, q, userClub); err != nil {
			return err
		}
		if err := copyPlayers(ctx, q, id, bulkPlayers); err != nil {
			return err
		}
		if err := copyCoaches(ctx, q, id, bulkCoaches); err != nil {
			return err
		}
		if err := createWorld(ctx, q, r, id); err != nil {
			return err
		}
		if err := createLegendCards(ctx, q, r, id, clubs); err != nil {
			return err
		}
		var pool []*Coach
		for _, fc := range FreeCoaches {
			pool = append(pool, &Coach{Name: fc.Name, Nation: fc.Nation, Role: "head", Skill: fc.Skill, Style: famousStyles[fc.Name]})
		}
		for _, role := range CoachRoles {
			for i := 0; i < 3; i++ {
				pool = append(pool, GenCoach(r, nil, role, 7+r.Intn(12)))
			}
		}
		if err := copyCoaches(ctx, q, id, pool); err != nil {
			return err
		}
		if err := createSeason(ctx, q, r, id, 1, clubs, qualifiers); err != nil {
			return err
		}
		if err := refreshMarket(ctx, q, r, career); err != nil {
			return err
		}
		if err := ensureQuests(ctx, q, r, career, 0); err != nil {
			return err
		}
		return saveCareer(ctx, q, career)
	})
	if err == nil {
		go Analyze(context.Background(), s.DB) // planner statistics, off the request path
	}
	return id, err
}

// createWorld adds the ~180 world clubs (about 4,500 players) that trade but play no competition.
func createWorld(ctx context.Context, q pgx.Tx, r *rand.Rand, id int) error {
	var worldPlayers []*Player
	var wclubs []*Club
	var lvls []float64
	var nats [][]string
	for _, wl := range WorldLeagues {
		for i, city := range wl.Cities {
			lvl := wl.Base[1] - (wl.Base[1]-wl.Base[0])*float64(i)/float64(len(wl.Cities)-1)
			name := city
			if r.Intn(2) == 0 {
				name = city + " " + pick(r, suffixes)
			}
			k := kitColours[r.Intn(len(kitColours))]
			if c1, c2, ok := homeColours(city); ok { // the club's real colours (data_kits.go)
				k = [2]string{c1, c2}
			}
			c := &Club{CareerID: id, League: wl.Code, Name: name, Short: shortOf(city), Color: k[0], Color2: k[1],
				Budget: int64(lvl-50) * 2 * M, Reputation: int(lvl) - 5, Formation: pick(r, []string{"4-4-2", "4-3-3", "4-2-3-1", "3-5-2"}),
				Tactic: DefaultTactic(), FormWeeks: 6}
			wclubs = append(wclubs, c)
			lvls = append(lvls, lvl)
			nats = append(nats, wl.Nations)
		}
	}
	if err := insertClubs(ctx, q, wclubs); err != nil {
		return err
	}
	for i, c := range wclubs {
		for _, p := range GenSquad(r, nats[i], lvls[i], nil) {
			cid := c.ID
			p.ClubID = &cid
			p.History = []int{cid}
			p.Tenure = 3 + r.Intn(40)
			worldPlayers = append(worldPlayers, p)
		}
	}
	return copyPlayers(ctx, q, id, worldPlayers)
}

// createLegendCards stores every legend version as a template; now and then one appears on the market.
func createLegendCards(ctx context.Context, q pgx.Tx, r *rand.Rand, careerID int, clubs []*Club) error {
	return insertLegendCards(ctx, q, r, careerID, clubs, LegendVersions)
}

func insertLegendCards(ctx context.Context, q pgx.Tx, r *rand.Rand, careerID int, clubs []*Club, versions []LegendVersion) error {
	byName := map[string]int{}
	for _, c := range clubs {
		byName[c.Name] = c.ID
	}
	rows := make([][]any, 0, len(versions))
	for _, lv := range versions {
		p := legendStar(r, lv, lv.Pot) // built for the role he played (data_legends.go)
		var cid *int
		label := lv.VersionLabel()
		if clubID, ok := byName[lv.Club]; ok {
			cid = &clubID
		}
		rows = append(rows, []any{careerID, "legend", p.Name, p.Nation, p.Age, p.Position, p.Pace, p.Shooting, p.Passing, p.Dribbling,
			p.Defending, p.Physical, p.Goalkeeping, p.Potential, label, cid})
	}
	_, err := q.CopyFrom(ctx, pgx.Identifier{"templates"}, []string{"career_id", "kind", "name", "nation", "age", "position", "pace",
		"shooting", "passing", "dribbling", "defending", "physical", "goalkeeping", "potential", "version", "club_id"}, pgx.CopyFromRows(rows))
	return err
}

// ---------------------------------------------------------------- season & calendar

func compClubs(clubs []*Club) map[string]map[int][]*Club {
	out := map[string]map[int][]*Club{}
	for _, c := range clubs {
		if !isCompLeague(c.League) || c.Division < 1 {
			continue
		}
		if out[c.League] == nil {
			out[c.League] = map[int][]*Club{}
		}
		out[c.League][c.Division] = append(out[c.League][c.Division], c)
	}
	return out
}

// cupSeeds: the four best-known clubs of a country skip the first round.
func cupSeeds(cs []*Club) map[int]bool {
	sorted := append([]*Club{}, cs...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Division != sorted[j].Division {
			return sorted[i].Division < sorted[j].Division
		}
		if sorted[i].Reputation != sorted[j].Reputation {
			return sorted[i].Reputation > sorted[j].Reputation
		}
		return sorted[i].ID < sorted[j].ID
	})
	seeds := map[int]bool{}
	for i := 0; i < 4 && i < len(sorted); i++ {
		seeds[sorted[i].ID] = true
	}
	return seeds
}

func createSeason(ctx context.Context, q DBTX, r *rand.Rand, careerID, season int, clubs []*Club, qualifiers []int) error {
	var all []*Fixture
	insertFixture := func(_ context.Context, _ DBTX, _ int, f *Fixture) error {
		all = append(all, f)
		return nil
	}
	for code, divs := range compClubs(clubs) {
		var everyone []*Club
		for div, cs := range divs {
			everyone = append(everyone, cs...)
			order := append([]*Club{}, cs...)
			r.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
			for w, matches := range RoundRobin(len(order)) {
				for _, m := range matches {
					f := &Fixture{Season: season, Day: dayOf("league", "R", w+1), Comp: "league", League: leagueKey(code, div), Stage: "R",
						HomeID: order[m[0]].ID, AwayID: order[m[1]].ID}
					if err := insertFixture(ctx, q, careerID, f); err != nil {
						return err
					}
				}
			}
		}
		// domestic cup, first round: everyone except the four seeds
		seeds := cupSeeds(everyone)
		var r1 []*Club
		for _, c := range everyone {
			if !seeds[c.ID] {
				r1 = append(r1, c)
			}
		}
		r.Shuffle(len(r1), func(i, j int) { r1[i], r1[j] = r1[j], r1[i] })
		for i := 0; i+1 < len(r1); i += 2 {
			f := &Fixture{Season: season, Day: dayOf("cup", "R1", 0), Comp: "cup", League: code, Stage: "R1", HomeID: r1[i].ID, AwayID: r1[i+1].ID}
			if err := insertFixture(ctx, q, careerID, f); err != nil {
				return err
			}
		}
	}
	// continental cup: 32 clubs in 8 groups; clubs are dealt so countries spread across groups
	if len(qualifiers) >= CLGroups*4 {
		groups := make([][]int, CLGroups)
		for i, id := range qualifiers[:CLGroups*4] {
			country, rank := i/CLPerLeague, i%CLPerLeague
			g := (rank*2 + country + rank/4) % CLGroups
			for len(groups[g]) >= 4 {
				g = (g + 1) % CLGroups
			}
			groups[g] = append(groups[g], id)
		}
		for gi, g := range groups {
			stage := "G" + string(rune('A'+gi))
			for w, matches := range RoundRobin(4) {
				for _, m := range matches {
					f := &Fixture{Season: season, Day: dayOf("cl", "G", w+1), Comp: "cl", Stage: stage, HomeID: g[m[0]], AwayID: g[m[1]]}
					if err := insertFixture(ctx, q, careerID, f); err != nil {
						return err
					}
				}
			}
		}
	}
	return copyFixtures(ctx, q, careerID, all)
}

// ensureDay draws a knockout round once the previous one is complete.
func ensureDay(ctx context.Context, q DBTX, r *rand.Rand, careerID, season, day int, clubs []*Club) error {
	if day < 1 || day > len(Calendar) {
		return nil
	}
	cd := Calendar[day-1]
	if cd.Comp == "league" || cd.Stage == "G" || cd.Stage == "R1" {
		return nil
	}
	existing, err := queryFixtures(ctx, q, `career_id=$1 AND season=$2 AND day=$3`, careerID, season, day)
	if err != nil || len(existing) > 0 {
		return err
	}
	if cd.Comp == "cup" {
		for code, divs := range compClubs(clubs) {
			prev, err := queryFixtures(ctx, q, `career_id=$1 AND season=$2 AND comp='cup' AND league=$3 AND stage=$4`, careerID, season, code, prevStage(cupStages, cd.Stage))
			if err != nil {
				return err
			}
			var w []int
			for _, f := range prev {
				if id := f.WinnerID(); id != 0 {
					w = append(w, id)
				}
			}
			if cd.Stage == "R32" {
				var everyone []*Club
				for _, cs := range divs {
					everyone = append(everyone, cs...)
				}
				for id := range cupSeeds(everyone) {
					w = append(w, id)
				}
			}
			if err := drawPairs(ctx, q, r, careerID, season, day, "cup", code, cd.Stage, w); err != nil {
				return err
			}
		}
		return stageNoteDrawn(ctx, q, careerID, season, day) // stage_draw.go: the draw ceremony
	}
	// continental cup knockouts
	if cd.Stage == "R16" {
		groups, err := queryFixtures(ctx, q, `career_id=$1 AND season=$2 AND comp='cl' AND stage LIKE 'G%'`, careerID, season)
		if err != nil || len(groups) == 0 {
			return err
		}
		for gi := 0; gi < CLGroups; gi += 2 {
			a := groupTable(clubs, groups, "G"+string(rune('A'+gi)))
			b := groupTable(clubs, groups, "G"+string(rune('A'+gi+1)))
			if len(a) < 2 || len(b) < 2 {
				continue
			}
			for _, m := range [][2]int{{a[0].ClubID, b[1].ClubID}, {b[0].ClubID, a[1].ClubID}} {
				f := &Fixture{Season: season, Day: day, Comp: "cl", Stage: "R16", HomeID: m[0], AwayID: m[1]}
				if err := insertFixture(ctx, q, careerID, f); err != nil {
					return err
				}
			}
		}
		return stageNoteDrawn(ctx, q, careerID, season, day) // stage_draw.go: the draw ceremony
	}
	prev, err := queryFixtures(ctx, q, `career_id=$1 AND season=$2 AND comp='cl' AND stage=$3`, careerID, season, prevStage(clStages, cd.Stage))
	if err != nil {
		return err
	}
	var w []int
	for _, f := range prev {
		if id := f.WinnerID(); id != 0 {
			w = append(w, id)
		}
	}
	if err := drawPairs(ctx, q, r, careerID, season, day, "cl", "", cd.Stage, w); err != nil {
		return err
	}
	return stageNoteDrawn(ctx, q, careerID, season, day) // stage_draw.go: the draw ceremony
}

// drawPairs makes a random draw of the given clubs into ties.
func drawPairs(ctx context.Context, q DBTX, r *rand.Rand, careerID, season, day int, comp, league, stage string, ids []int) error {
	r.Shuffle(len(ids), func(i, j int) { ids[i], ids[j] = ids[j], ids[i] })
	for i := 0; i+1 < len(ids); i += 2 {
		f := &Fixture{Season: season, Day: day, Comp: comp, League: league, Stage: stage, HomeID: ids[i], AwayID: ids[i+1]}
		if err := insertFixture(ctx, q, careerID, f); err != nil {
			return err
		}
	}
	return nil
}

func groupTable(clubs []*Club, fx []*Fixture, stage string) []TableRow {
	var sub []*Fixture
	ids := map[int]bool{}
	for _, f := range fx {
		if f.Stage == stage {
			sub = append(sub, f)
			ids[f.HomeID], ids[f.AwayID] = true, true
		}
	}
	var cs []*Club
	for _, c := range clubs {
		if ids[c.ID] {
			cs = append(cs, c)
		}
	}
	return buildTable(cs, sub)
}

func divisionTable(clubs []*Club, fixtures []*Fixture, code string, div int) []TableRow {
	var cs []*Club
	for _, c := range clubs {
		if c.League == code && c.Division == div {
			cs = append(cs, c)
		}
	}
	key := leagueKey(code, div)
	var fx []*Fixture
	for _, f := range fixtures {
		if f.Comp == "league" && f.League == key {
			fx = append(fx, f)
		}
	}
	return buildTable(cs, fx)
}

func buildTable(clubs []*Club, fixtures []*Fixture) []TableRow {
	rows := map[int]*TableRow{}
	for _, c := range clubs {
		rows[c.ID] = &TableRow{ClubID: c.ID, Name: c.Name, Short: c.Short, Color: c.Color, IsUser: c.IsUser}
	}
	for _, f := range fixtures {
		h, a := rows[f.HomeID], rows[f.AwayID]
		if !f.Played || f.HomeGoals == nil || h == nil || a == nil {
			continue
		}
		hg, ag := *f.HomeGoals, *f.AwayGoals
		h.P++
		a.P++
		h.GF += hg
		h.GA += ag
		a.GF += ag
		a.GA += hg
		switch {
		case hg > ag:
			h.W++
			a.L++
			h.Pts += 3
		case hg < ag:
			a.W++
			h.L++
			a.Pts += 3
		default:
			h.D++
			a.D++
			h.Pts++
			a.Pts++
		}
	}
	out := make([]TableRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, *r)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Pts != b.Pts {
			return a.Pts > b.Pts
		}
		if a.GF-a.GA != b.GF-b.GA {
			return a.GF-a.GA > b.GF-b.GA
		}
		if a.GF != b.GF {
			return a.GF > b.GF
		}
		return a.Name < b.Name
	})
	return out
}

// ---------------------------------------------------------------- views

type FixtureView struct {
	ID         int    `json:"id"`
	Day        int    `json:"day"`
	Comp       string `json:"comp"`
	League     string `json:"league"`
	Stage      string `json:"stage"`
	HomeID     int    `json:"homeId"`
	AwayID     int    `json:"awayId"`
	Home       string `json:"home"`
	Away       string `json:"away"`
	HomeShort  string `json:"homeShort"`
	AwayShort  string `json:"awayShort"`
	HomeColor  string `json:"homeColor"`
	AwayColor  string `json:"awayColor"`
	HomeColor2 string `json:"homeColor2"`
	AwayColor2 string `json:"awayColor2"`
	HomeGoals  *int   `json:"homeGoals"`
	AwayGoals  *int   `json:"awayGoals"`
	PensHome   *bool  `json:"pensHome"`
	ExtraTime  bool   `json:"extraTime"`
	PensH      *int   `json:"pensH"`
	PensA      *int   `json:"pensA"`
	Played     bool   `json:"played"`
	IsUser     bool   `json:"isUser"`
}

func viewFixture(f *Fixture, byID map[int]*Club) FixtureView {
	h, a := byID[f.HomeID], byID[f.AwayID]
	return FixtureView{ID: f.ID, Day: f.Day, Comp: f.Comp, League: f.League, Stage: f.Stage, HomeID: h.ID, AwayID: a.ID,
		Home: h.Name, Away: a.Name, HomeShort: h.Short, AwayShort: a.Short, HomeColor: h.Color, AwayColor: a.Color,
		HomeColor2: h.Color2, AwayColor2: a.Color2,
		HomeGoals: f.HomeGoals, AwayGoals: f.AwayGoals, PensHome: f.PensHome, ExtraTime: f.ExtraTime, PensH: f.PensH, PensA: f.PensA,
		Played: f.Played, IsUser: h.IsUser || a.IsUser}
}

type DayInfo struct {
	Day            int          `json:"day"`
	FriendliesLeft int          `json:"friendliesLeft"`
	Comp           string       `json:"comp"`
	Stage          string       `json:"stage"`
	Round          int          `json:"round"`
	Fixture        *FixtureView `json:"fixture"`
}

type CareerState struct {
	HotBonus    *HotBonus           `json:"hotBonus"`    // today's sponsor bonus on the match, if any
	EventsView  any                 `json:"eventsView"`  // events.go
	ExploreView any                 `json:"exploreView"` // explore.go
	MedicalView any                 `json:"medicalView"` // medical_api.go: decisions waiting in the medical room
	StaffView   any                 `json:"staffView"`   // staff_room.go: open decision cards (badges, inbox)
	Alerts      []Alert             `json:"alerts"`      // alerts.go: what needs your attention
	Career      *Career             `json:"career"`
	LeagueName  string              `json:"leagueName"`
	Division    int                 `json:"division"`
	Club        *Club               `json:"club"`
	Squad       []*Player           `json:"squad"`
	Coaches     []*Coach            `json:"coaches"`
	Table       []TableRow          `json:"table"`
	Today       *DayInfo            `json:"today"`
	Recent      []FixtureView       `json:"recent"`
	Rating      TeamRating          `json:"rating"`
	Chemistry   Chemistry           `json:"chemistry"`
	CoachFit    CoachFit            `json:"coachFit"`
	WeeklyWages int64               `json:"weeklyWages"`
	SeasonDays  int                 `json:"seasonDays"`
	Claimable   int                 `json:"claimable"`
	Formations  map[string][]string `json:"formations"`
	Promote     int                 `json:"promote"`
	Divisions   int                 `json:"divisions"`
	CLSpots     int                 `json:"clSpots"`
}

func (s *Store) State(ctx context.Context, careerID int) (*CareerState, error) {
	r := newRand()
	var st *CareerState
	err := s.tx(ctx, func(q pgx.Tx) error {
		w, err := loadWorld(ctx, q, r, careerID)
		if err != nil {
			return err
		}
		c := w.career
		club := w.byID[c.UserClubID]
		st = &CareerState{Career: c, LeagueName: divisionName(club.League, club.Division), Division: club.Division, Club: club,
			Squad: w.players[club.ID], Coaches: w.coaches[club.ID], SeasonDays: len(Calendar), Formations: Formations,
			Promote: PromoteCount, Divisions: Divisions, CLSpots: CLPerLeague}
		sort.Slice(st.Squad, func(i, j int) bool { return st.Squad[i].Shirt < st.Squad[j].Shirt })
		// this season's appearances: playing time is what makes players grow (growth.go)
		if err := seasonApps(ctx, q, c, club.ID, st.Squad); err != nil {
			return err
		}
		if err := fillKits(ctx, q, c.ID, club); err != nil { // kits.go
			return err
		}
		for _, f := range w.fixtures {
			if f.Played && (f.HomeID == club.ID || f.AwayID == club.ID) {
				st.Recent = append(st.Recent, viewFixture(f, w.byID))
			}
		}
		st.Table = divisionTable(w.clubs, w.fixtures, club.League, club.Division)
		if len(st.Recent) > 5 {
			st.Recent = st.Recent[len(st.Recent)-5:]
		}
		if c.Day <= len(Calendar) {
			cd := Calendar[c.Day-1]
			st.Today = &DayInfo{Day: c.Day, Comp: cd.Comp, Stage: cd.Stage, Round: cd.Round}
		} else {
			played := 0
			for _, f := range w.fixtures {
				if f.Comp == "friendly" && f.Played {
					played++
				}
			}
			st.Today = &DayInfo{Day: c.Day, Comp: "offseason", FriendliesLeft: MaxFriendlies - played}
		}
		if f := w.userFixture(); f != nil {
			v := viewFixture(f, w.byID)
			st.Today.Fixture = &v
			st.HotBonus = hotBonusFor(c, f, club.Reputation)
		}
		st.EventsView = w.eventsView()
		st.ExploreView = w.exploreView()
		st.MedicalView = w.medicalBadge()
		st.StaffView = w.staffBadge()
		st.Alerts = w.alerts()
		sh := w.sheet(club.ID)
		st.Rating, st.Chemistry, st.CoachFit = sh.Rating(), sh.Chem, sh.Fit
		redact(st.Squad, club.ID, coachSkill(st.Coaches, "scout"))
		for _, p := range st.Squad {
			st.WeeklyWages += p.Wage
		}
		for _, co := range st.Coaches {
			st.WeeklyWages += co.Wage
		}
		return q.QueryRow(ctx, `SELECT count(*) FROM quests WHERE career_id=$1 AND status='done'`, careerID).Scan(&st.Claimable)
	})
	return st, err
}

type CompetitionsView struct {
	Season   int                   `json:"season"`
	Day      int                   `json:"day"`
	Calendar []CalDay              `json:"calendar"`
	League   string                `json:"league"`
	Division int                   `json:"division"`
	Leagues  []LeagueTableView     `json:"leagues"`
	Fixtures []FixtureView         `json:"fixtures"` // the user's division, the user's domestic cup, and the continental cup
	Groups   map[string][]TableRow `json:"groups"`
	UserInCL bool                  `json:"userInCl"`
	Promote  int                   `json:"promote"`
	CLSpots  int                   `json:"clSpots"`
}

type LeagueTableView struct {
	Code     string     `json:"code"`
	Country  string     `json:"country"`
	Division int        `json:"division"`
	Name     string     `json:"name"`
	Table    []TableRow `json:"table"`
}

// Competitions returns every table and fixture; lite keeps only what involves the user's club
// (enough for calendars) so frequently visited pages stay light.
func (s *Store) Competitions(ctx context.Context, careerID int, lite bool) (*CompetitionsView, error) {
	r := newRand()
	var v *CompetitionsView
	err := s.tx(ctx, func(q pgx.Tx) error {
		w, err := loadWorld(ctx, q, r, careerID)
		if err != nil {
			return err
		}
		c := w.career
		user := w.byID[c.UserClubID]
		v = &CompetitionsView{Season: c.Season, Day: c.Day, Calendar: Calendar, League: user.League, Division: user.Division,
			Groups: map[string][]TableRow{}, Promote: PromoteCount, CLSpots: CLPerLeague}
		for _, l := range Leagues {
			for d := 1; d <= Divisions; d++ {
				if lite && (l.Code != user.League || d != user.Division) {
					continue
				}
				v.Leagues = append(v.Leagues, LeagueTableView{Code: leagueKey(l.Code, d), Country: l.Code, Division: d,
					Name: divisionName(l.Code, d), Table: divisionTable(w.clubs, w.fixtures, l.Code, d)})
			}
		}
		ownKey := leagueKey(user.League, user.Division)
		for _, f := range w.fixtures {
			if lite && f.HomeID != user.ID && f.AwayID != user.ID {
				continue
			}
			if f.Comp == "cl" || f.League == ownKey || (f.Comp == "cup" && f.League == user.League) || (f.Comp == "friendly" && (f.HomeID == user.ID || f.AwayID == user.ID)) {
				v.Fixtures = append(v.Fixtures, viewFixture(f, w.byID))
				if f.Comp == "cl" && (f.HomeID == user.ID || f.AwayID == user.ID) {
					v.UserInCL = true
				}
			}
		}
		for gi := 0; gi < CLGroups; gi++ {
			g := "G" + string(rune('A'+gi))
			v.Groups[g] = groupTable(w.clubs, w.fixtures, g)
		}
		return nil
	})
	return v, err
}
