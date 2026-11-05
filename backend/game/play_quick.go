package game

import (
	"hash/fnv"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// ---------------------------------------------------------------- quick match (modes stream)
//
// An exhibition between any two clubs of the template world, or between Legends XIs of the
// famous clubs, built straight from the club definitions: no career is read or written, so a
// quick match never touches a save. Squads are generated with a fixed seed per club, so a club
// always brings the same players.
//
//	QuickTeams()          every pickable team (240 clubs in 4 leagues + the Legends XIs)
//	QuickMatch(req)       a MatchSetup the live engine plays as it is
//
// Team keys: "EN:0" = league code + index into CountryClubDefs (0–59), "L:EN:3" = the Legends XI
// of that club.

type PlayTeam struct {
	Key       string   `json:"key"`
	League    string   `json:"league"`
	Division  int      `json:"division"`
	Name      string   `json:"name"`
	Short     string   `json:"short"`
	Color     string   `json:"color"`
	Color2    string   `json:"color2"`
	Strength  int      `json:"strength"` // average overall of the starting XI
	Formation string   `json:"formation"`
	Stars     []string `json:"stars"`
	Legends   bool     `json:"legends"`
	Kits      Kits     `json:"kits"` // kits.go: home, away and third
}

type PlayDivision struct {
	Division int        `json:"division"`
	Name     string     `json:"name"`
	Teams    []PlayTeam `json:"teams"`
}

type PlayLeague struct {
	Code      string         `json:"code"`
	Name      string         `json:"name"`
	Country   string         `json:"country"`
	Divisions []PlayDivision `json:"divisions"`
}

type PlayTeams struct {
	Leagues []PlayLeague `json:"leagues"`
	Legends []PlayTeam   `json:"legends"`
}

type QuickReq struct {
	Home     string `json:"home"`
	Away     string `json:"away"`
	Knockout bool   `json:"knockout"` // level after 90': extra time, then penalties
	Weather  string `json:"weather"`  // clear | rain | snow | random ("" = clear)
}

// quickSquad: one team ready to play (squad, club, head coach).
type quickSquad struct {
	team  PlayTeam
	club  *Club
	squad []*Player
	head  *Coach
}

func quickSeed(key string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte("pitchside-quick:" + key))
	return int64(h.Sum64() & 0x7fffffffffffffff)
}

func parseClubKey(key string) (code string, idx int, ok bool) {
	parts := strings.Split(key, ":")
	if len(parts) != 2 {
		return "", 0, false
	}
	n, err := strconv.Atoi(parts[1])
	if err != nil || LeagueByCode(parts[0]) == nil || n < 0 || n >= Divisions*DivisionSize {
		return "", 0, false
	}
	return parts[0], n, true
}

func headCoachFor(r *rand.Rand, nations []string, def ClubDef, minSkill int) *Coach {
	head := GenCoach(r, nations, "head", 6+int(def.Base-55)/3)
	if def.Coach.Name != "" {
		head.Name, head.Nation, head.Skill = def.Coach.Name, def.Coach.Nation, def.Coach.Skill
		if st, ok := famousStyles[def.Coach.Name]; ok {
			head.Style = st
		}
	}
	head.Skill = max(head.Skill, minSkill)
	return head
}

// buildClubSquad: a league club with its stars and a generated squad around them.
func buildClubSquad(code string, idx int) *quickSquad {
	ld := LeagueByCode(code)
	def := CountryClubDefs(code)[idx]
	key := code + ":" + strconv.Itoa(idx)
	r := rand.New(rand.NewSource(quickSeed(key)))
	squad := GenSquad(r, ld.Nations, def.Base, def.Stars)
	for _, p := range squad {
		p.Tenure = 3 + r.Intn(40)
	}
	kits := DefaultKits(def.Name, def.Color, def.Color2)
	club := &Club{League: code, Division: idx/DivisionSize + 1, Name: def.Name, Short: def.Short, Color: def.Color, Color2: def.Color2,
		Reputation: def.Rep, Formation: def.Formation, Tactic: def.Tactic, FormWeeks: 6, Kits: &kits}
	club.Tactic.Normalize()
	var stars []string
	for _, s := range def.Stars {
		stars = append(stars, s.Name)
	}
	team := PlayTeam{Key: key, League: code, Division: club.Division, Name: def.Name, Short: def.Short, Color: def.Color, Color2: def.Color2,
		Formation: def.Formation, Stars: stars, Kits: kits}
	return &quickSquad{team: team, club: club, squad: squad, head: headCoachFor(r, ld.Nations, def, 0)}
}

// ---------------------------------------------------------------- Legends XIs

type legendClub struct {
	code  string
	idx   int
	def   ClubDef
	cards []LegendVersion // the best card of each legend for this club
}

// legendClubs: famous clubs with at least 13 legends, a keeper among them and enough men for a back four.
var legendClubs = sync.OnceValue(func() []legendClub {
	where := map[string][2]int{} // club name → (league index, club index)
	for li, l := range Leagues {
		for i, def := range CountryClubDefs(l.Code) {
			where[def.Name] = [2]int{li, i}
		}
	}
	best := map[string]map[string]LegendVersion{}
	for _, lv := range LegendVersions {
		if lv.Club == "" {
			continue
		}
		if _, ok := where[lv.Club]; !ok {
			continue
		}
		m := best[lv.Club]
		if m == nil {
			m = map[string]LegendVersion{}
			best[lv.Club] = m
		}
		if cur, ok := m[lv.Name]; !ok || lv.Ovr > cur.Ovr {
			m[lv.Name] = lv
		}
	}
	var out []legendClub
	for name, m := range best {
		pos := map[string]int{}
		var cards []LegendVersion
		for _, lv := range m {
			pos[lv.Pos]++
			cards = append(cards, lv)
		}
		if len(cards) < 13 || pos["GK"] < 1 || pos["DF"] < 3 || pos["MF"] < 3 || pos["FW"] < 2 {
			continue
		}
		sort.Slice(cards, func(a, b int) bool {
			if cards[a].Ovr != cards[b].Ovr {
				return cards[a].Ovr > cards[b].Ovr
			}
			return cards[a].Name < cards[b].Name
		})
		w := where[name]
		code := Leagues[w[0]].Code
		out = append(out, legendClub{code: code, idx: w[1], def: CountryClubDefs(code)[w[1]], cards: cards})
	}
	sort.Slice(out, func(a, b int) bool {
		if len(out[a].cards) != len(out[b].cards) {
			return len(out[a].cards) > len(out[b].cards)
		}
		return out[a].def.Name < out[b].def.Name
	})
	return out
})

func findLegendClub(code string, idx int) *legendClub {
	for _, lc := range legendClubs() {
		if lc.code == code && lc.idx == idx {
			c := lc
			return &c
		}
	}
	return nil
}

// bestFormation: the formation in which this squad's best XI is strongest.
func bestFormation(squad []*Player, prefer string) string {
	byID := map[int]*Player{}
	for _, p := range squad {
		byID[p.ID] = p
	}
	bestF, bestS := prefer, -1.0
	for _, f := range []string{"4-3-3", "4-4-2", "4-2-3-1", "3-5-2", "5-3-2"} {
		ids := BestLineup(squad, f)
		s := 0.0
		for i, id := range ids {
			if p := byID[id]; p != nil {
				s += Effective(p, Formations[f][i])
			}
		}
		if f == prefer {
			s += 4 // the club's own shape wins a close call
		}
		if s > bestS {
			bestF, bestS = f, s
		}
	}
	return bestF
}

func buildLegendSquad(code string, idx int) *quickSquad {
	lc := findLegendClub(code, idx)
	if lc == nil {
		return nil
	}
	key := "L:" + code + ":" + strconv.Itoa(idx)
	r := rand.New(rand.NewSource(quickSeed(key)))
	// up to 23 legends, best first, but always the two best keepers
	var picks []LegendVersion
	keepers := 0
	for _, lv := range lc.cards {
		if lv.Pos == "GK" && keepers < 2 {
			picks = append(picks, lv)
			keepers++
		}
	}
	for _, lv := range lc.cards {
		if lv.Pos != "GK" && len(picks) < 23 {
			picks = append(picks, lv)
		}
	}
	var squad []*Player
	for _, lv := range picks {
		p := MakeStar(r, StarDef{Name: lv.Name, Nation: lv.Nation, Age: lv.Age, Pos: lv.Pos, Ovr: lv.Ovr, Pot: int(lv.Ovr), Style: lv.Style})
		p.Tag = "legend"
		p.Version = lc.def.Name + " " + lv.Label
		p.Tenure = 40 + r.Intn(40)
		p.Morale = 85
		squad = append(squad, p)
	}
	// shirt numbers by line: keepers first, then defenders, midfielders and forwards
	sort.SliceStable(squad, func(a, b int) bool { return posOrder(squad[a].Position) < posOrder(squad[b].Position) })
	for i, p := range squad {
		p.Shirt = i + 1
	}
	kits := DefaultKits(lc.def.Name, lc.def.Color, lc.def.Color2) // the legends wear their club's kits
	club := &Club{League: code, Division: 1, Name: lc.def.Name + " Legends", Short: lc.def.Short, Color: lc.def.Color, Color2: lc.def.Color2,
		Reputation: 99, Tactic: lc.def.Tactic, FormWeeks: 12, Kits: &kits}
	club.Tactic.Normalize()
	for i, p := range squad {
		p.ID = i + 1 // provisional ids for the formation search; final ids are set per side
	}
	club.Formation = bestFormation(squad, lc.def.Formation)
	var stars []string
	for i := 0; i < len(lc.cards) && i < 3; i++ {
		stars = append(stars, lc.cards[i].Name) // cards are sorted best first
	}
	team := PlayTeam{Key: key, League: code, Division: 1, Name: club.Name, Short: lc.def.Short, Color: lc.def.Color, Color2: lc.def.Color2,
		Formation: club.Formation, Stars: stars, Legends: true, Kits: kits}
	head := headCoachFor(r, LeagueByCode(code).Nations, lc.def, 16)
	return &quickSquad{team: team, club: club, squad: squad, head: head}
}

func posOrder(pos string) int {
	switch pos {
	case "GK":
		return 0
	case "DF":
		return 1
	case "MF":
		return 2
	}
	return 3
}

func buildQuickSquad(key string) *quickSquad {
	if strings.HasPrefix(key, "L:") {
		code, idx, ok := parseClubKey(strings.TrimPrefix(key, "L:"))
		if !ok {
			return nil
		}
		return buildLegendSquad(code, idx)
	}
	code, idx, ok := parseClubKey(key)
	if !ok {
		return nil
	}
	return buildClubSquad(code, idx)
}

// side: give the squad its final ids (unique across both teams) and build the match sheet.
func (q *quickSquad) side(clubID, idBase int) SideSetup {
	club := *q.club
	club.ID = clubID
	club.IsUser = clubID == 1
	squad := make([]*Player, len(q.squad))
	for i, p0 := range q.squad {
		p := *p0
		p.ID = idBase + i + 1
		cid := clubID
		p.ClubID = &cid
		p.History = []int{clubID}
		p.Fitness = 100
		squad[i] = &p
	}
	club.Lineup = BestLineup(squad, club.Formation)
	st, roles := startersOf(&club, squad)
	bench := benchOf(st, squad)
	var styleT []string
	if q.head != nil {
		styleT = CoachStyles[styleFor(q.head)].Traits
	}
	fit := ComputeCoachFit(q.head, club.Formation, club.Tactic, st)
	chem := TeamChemistry(st, club.Formation, club.FormWeeks, club.ID, styleT...)
	headSkill := 10
	if q.head != nil {
		headSkill = q.head.Skill
	}
	sh := TeamSheet{Club: &club, Starters: st, Roles: roles, Bench: bench, HeadCoach: headSkill, Chem: chem, Fit: fit, Perks: Perks{}}
	return SideSetup{Club: &club, Starters: st, Roles: roles, Bench: bench, HeadCoach: headSkill, Rating: sh.Rating(), Chemistry: chem,
		CoachFit: fit, Perks: []string{}}
}

func (q *quickSquad) strength() int {
	s := q.side(1, 0)
	sum, n := 0.0, 0
	for _, p := range s.Starters {
		if p != nil {
			sum += float64(p.Overall)
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return int(math.Round(sum / float64(n)))
}

var quickTeams = sync.OnceValue(func() PlayTeams {
	out := PlayTeams{Leagues: []PlayLeague{}, Legends: []PlayTeam{}}
	for _, l := range Leagues {
		pl := PlayLeague{Code: l.Code, Name: l.Name, Country: l.Country}
		defs := CountryClubDefs(l.Code)
		for d := 1; d <= Divisions; d++ {
			div := PlayDivision{Division: d, Name: divisionName(l.Code, d)}
			for i := (d - 1) * DivisionSize; i < d*DivisionSize && i < len(defs); i++ {
				q := buildClubSquad(l.Code, i)
				q.team.Strength = q.strength()
				div.Teams = append(div.Teams, q.team)
			}
			pl.Divisions = append(pl.Divisions, div)
		}
		out.Leagues = append(out.Leagues, pl)
	}
	for _, lc := range legendClubs() {
		if q := buildLegendSquad(lc.code, lc.idx); q != nil {
			q.team.Strength = q.strength()
			out.Legends = append(out.Legends, q.team)
		}
	}
	return out
})

// QuickTeams: every team a quick match can use (computed once, the same for everybody).
func QuickTeams() PlayTeams { return quickTeams() }

// QuickMatch: the live-match setup for an exhibition (home = player 1's team).
func QuickMatch(req QuickReq) (*MatchSetup, error) {
	if req.Home == req.Away {
		return nil, userErr("same_team", "Pick two different teams")
	}
	h, a := buildQuickSquad(req.Home), buildQuickSquad(req.Away)
	if h == nil || a == nil {
		return nil, userErr("bad_team", "Unknown team")
	}
	home, away := h.side(1, 0), a.side(2, 1000)
	weather := req.Weather
	switch weather {
	case "clear", "rain", "snow":
	case "random":
		weather = []string{"clear", "clear", "clear", "rain", "rain", "snow"}[rand.Intn(6)]
	default:
		weather = "clear"
	}
	fx := FixtureView{Comp: "friendly", Stage: "FR", HomeID: 1, AwayID: 2, Home: home.Club.Name, Away: away.Club.Name,
		HomeShort: home.Club.Short, AwayShort: away.Club.Short, HomeColor: home.Club.Color, AwayColor: away.Club.Color,
		HomeColor2: home.Club.Color2, AwayColor2: away.Club.Color2, IsUser: true}
	return &MatchSetup{Fixture: fx, Home: home, Away: away, UserIsHome: true, Knockout: req.Knockout, Weather: weather}, nil
}
