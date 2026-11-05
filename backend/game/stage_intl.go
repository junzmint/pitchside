package game

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"time"
)

// ---------------------------------------------------------------- the summer international tournament
//
// Every second summer the world's best players go away with their countries: a World Cup with every
// nation that can name a squad (16, or 32 when that many can), alternating with a European
// Championship (8 nations). A national team is the best 23 players of a nation in this world.
// Groups of four, then knockouts with extra time and penalties, simulated with the club engine.
//
// Afterwards: called-up players start the season a little tired (fitness −10 to −20, more for those
// who played every game), morale rises for the winners and for good tournaments and drops after a
// group-stage exit, and the three best performers gain a little value (about +7%).

const (
	IntlSquad = 23
	intlCoach = 12 // every national coach: the same small boost on all lines
	intlChem  = 70
)

var europeNations = map[string]bool{"EN": true, "ES": true, "FR": true, "DE": true, "IT": true, "PT": true, "NL": true, "BE": true,
	"AT": true, "CH": true, "SC": true, "WA": true, "DK": true, "HR": true, "RS": true, "SI": true, "HU": true, "PL": true, "SE": true,
	"NO": true, "TR": true, "GE": true}

// intlKind: the tournament played in the summer after a season ("" = none that summer).
// Seasons 1, 5, 9… are followed by a World Cup, seasons 3, 7… by a European Championship.
func intlKind(endedSeason int) string {
	if endedSeason < 1 || endedSeason%2 == 0 {
		return ""
	}
	if (endedSeason/2)%2 == 0 {
		return "world"
	}
	return "euro"
}

type IntlPlayer struct {
	ID      int     `json:"id"`
	Name    string  `json:"name"`
	Nation  string  `json:"nation"`
	Pos     string  `json:"pos"`
	Role    string  `json:"role"`
	Age     int     `json:"age"`
	Ovr     int     `json:"ovr"`
	ClubID  int     `json:"clubId"`
	Club    string  `json:"club"`
	Short   string  `json:"short"`
	Color   string  `json:"color"`
	Color2  string  `json:"color2"`
	Tag     string  `json:"tag,omitempty"`
	Mine    bool    `json:"mine,omitempty"`
	Apps    int     `json:"apps"`
	Goals   int     `json:"goals"`
	Assists int     `json:"assists"`
	Rating  float64 `json:"rating"`           // average match rating
	Result  string  `json:"result,omitempty"` // his nation's result (in Mine / Scorers)
	rsum    float64
}

type IntlTeam struct {
	Nation    string        `json:"nation"`
	Strength  int           `json:"strength"`
	Group     string        `json:"group"`
	Pot       int           `json:"pot"`
	Result    string        `json:"result"` // G | R16 | QF | SF | F | W
	Formation string        `json:"formation"`
	Squad     []*IntlPlayer `json:"squad"`
	Mine      int           `json:"mine"` // players from the user's club in the squad
	club      *Club
	players   []*Player // tournament copies (their fitness drains and recovers between games)
	real      map[int]*Player
	stats     map[int]*IntlPlayer
	games     int
}

type IntlGoal struct {
	PlayerID int    `json:"playerId"`
	Name     string `json:"name"`
	Side     int    `json:"side"` // 0 home, 1 away
	Assist   string `json:"assist,omitempty"`
	Mine     bool   `json:"mine,omitempty"`
}

type IntlMatch struct {
	Stage string     `json:"stage"` // GA… | R16 | QF | SF | F
	Round int        `json:"round"` // group matchday 1–3 (0 for knockouts)
	Home  string     `json:"home"`
	Away  string     `json:"away"`
	HG    int        `json:"hg"`
	AG    int        `json:"ag"`
	ET    bool       `json:"et,omitempty"`
	PH    *int       `json:"ph,omitempty"`
	PA    *int       `json:"pa,omitempty"`
	Goals []IntlGoal `json:"goals"`
	Mine  bool       `json:"mine,omitempty"` // a player from the user's club played
}

type IntlRow struct {
	Nation string `json:"nation"`
	P      int    `json:"p"`
	W      int    `json:"w"`
	D      int    `json:"d"`
	L      int    `json:"l"`
	GF     int    `json:"gf"`
	GA     int    `json:"ga"`
	Pts    int    `json:"pts"`
}

type IntlBoost struct {
	PlayerID int    `json:"playerId"`
	Name     string `json:"name"`
	Nation   string `json:"nation"`
	Before   int64  `json:"before"`
	After    int64  `json:"after"`
	Mine     bool   `json:"mine,omitempty"`
}

type IntlEffects struct {
	Tired      int         `json:"tired"`  // called-up players who start the season tired
	FitMin     int         `json:"fitMin"` // fitness lost: least and most
	FitMax     int         `json:"fitMax"`
	MoraleUp   int         `json:"moraleUp"`
	MoraleDown int         `json:"moraleDown"`
	Boosted    []IntlBoost `json:"boosted"`
}

type Tournament struct {
	Season   int                  `json:"season"` // the season just ended (played in the summer after it)
	Kind     string               `json:"kind"`   // world | euro
	Edition  int                  `json:"edition"`
	Teams    []*IntlTeam          `json:"teams"`
	Groups   map[string][]IntlRow `json:"groups"`
	Matches  []IntlMatch          `json:"matches"`
	Champion string               `json:"champion"`
	RunnerUp string               `json:"runnerUp"`
	Final    *IntlMatch           `json:"final"`
	Scorers  []*IntlPlayer        `json:"scorers"` // top ten by goals
	Best     *IntlPlayer          `json:"best"`    // player of the tournament
	Mine     []*IntlPlayer        `json:"mine"`    // the user's called-up players
	Effects  IntlEffects          `json:"effects"`
	UserClub int                  `json:"userClub"`
}

func (t *Tournament) brief() IntlBrief {
	b := IntlBrief{Season: t.Season, Kind: t.Kind, Edition: t.Edition, Champion: t.Champion, RunnerUp: t.RunnerUp, Mine: len(t.Mine)}
	if t.Final != nil {
		b.Score = fmt.Sprintf("%d-%d", t.Final.HG, t.Final.AG)
		if t.Final.PH != nil && t.Final.PA != nil {
			b.Score += fmt.Sprintf(" (%d-%d)", *t.Final.PH, *t.Final.PA)
		}
	}
	if len(t.Scorers) > 0 {
		b.Scorer, b.Goals = t.Scorers[0].Name, t.Scorers[0].Goals
	}
	return b
}

// pickSquad: a nation's best 23 (3 keepers, 8 defenders, 7 midfielders, 5 forwards, topped up with
// the best of the rest when a line is short). nil when the nation can't name a squad.
func pickSquad(list []*Player) []*Player {
	if len(list) < IntlSquad {
		return nil
	}
	sorted := append([]*Player{}, list...)
	sort.SliceStable(sorted, func(i, j int) bool {
		a, b := OverallAs(sorted[i], sorted[i].Position), OverallAs(sorted[j], sorted[j].Position)
		if a != b {
			return a > b
		}
		return sorted[i].ID < sorted[j].ID
	})
	quota := map[string]int{"GK": 3, "DF": 8, "MF": 7, "FW": 5}
	used := map[int]bool{}
	var out []*Player
	for _, p := range sorted {
		if quota[p.Position] > 0 {
			quota[p.Position]--
			used[p.ID] = true
			out = append(out, p)
		}
	}
	if quota["GK"] >= 2 { // fewer than two keepers: no team
		return nil
	}
	for _, p := range sorted {
		if len(out) >= IntlSquad {
			break
		}
		if !used[p.ID] && p.Position != "GK" {
			used[p.ID] = true
			out = append(out, p)
		}
	}
	if len(out) < IntlSquad {
		return nil
	}
	return out
}

// bestShape: the formation that rates the squad highest, and that rating.
func bestShape(squad []*Player) (string, float64) {
	best, bestV := "4-3-3", -1.0
	for _, f := range []string{"4-3-3", "4-4-2", "4-2-3-1", "3-5-2", "5-3-2"} {
		roles := Formations[f]
		byID := map[int]*Player{}
		for _, p := range squad {
			byID[p.ID] = p
		}
		var st []*Player
		for _, id := range BestLineup(squad, f) {
			st = append(st, byID[id])
		}
		if v := RateTeam(st, roles, DefaultTactic(), intlCoach, intlChem).Overall; v > bestV {
			best, bestV = f, v
		}
	}
	return best, bestV
}

func (t *IntlTeam) sheet() TeamSheet {
	roles := Formations[t.club.Formation]
	byID := map[int]*Player{}
	for _, p := range t.players {
		byID[p.ID] = p
	}
	st := make([]*Player, len(roles))
	for i, id := range BestLineup(t.players, t.club.Formation) {
		st[i] = byID[id]
	}
	return TeamSheet{Club: t.club, Starters: st, Roles: roles, HeadCoach: intlCoach, Chem: Chemistry{Team: intlChem},
		Fit: CoachFit{Score: 50}, BigGame: true, Perks: Perks{}, Bench: benchOf(st, t.players)}
}

// play simulates one tournament match on neutral ground (who counts as "home" is a coin toss).
func playIntl(r *rand.Rand, a, b *IntlTeam, stage string, round int, knockout bool) IntlMatch {
	m := IntlMatch{Stage: stage, Round: round, Home: a.Nation, Away: b.Nation, Goals: []IntlGoal{}}
	sa, sb := a.sheet(), b.sheet()
	flip := r.Intn(2) == 1
	hs, as := sa, sb
	if flip {
		hs, as = sb, sa
	}
	res := Simulate(r, hs, as)
	if knockout {
		settleKnockout(r, &Fixture{Comp: "cup", Stage: "F"}, hs, as, &res)
	}
	hg, ag := res.HomeGoals, res.AwayGoals
	ph, pa := res.PensH, res.PensA
	if flip {
		hg, ag, ph, pa = ag, hg, pa, ph
	}
	m.HG, m.AG, m.ET = hg, ag, res.ExtraTime
	if res.Shootout {
		m.PH, m.PA = &ph, &pa
	}
	goals := map[int]int{}
	assists := map[int]int{}
	for i, id := range res.Scorers {
		goals[id]++
		if as := at(res.Assists, i); as != 0 {
			assists[as]++
		}
	}
	// goals in order, each credited to its side
	for i, id := range res.Scorers {
		side := 0
		if _, ok := b.stats[id]; ok {
			side = 1
		}
		var name, assist string
		mine := false
		if s := a.stats[id]; s != nil {
			name, mine = s.Name, s.Mine
		} else if s := b.stats[id]; s != nil {
			name, mine = s.Name, s.Mine
		}
		if s := a.stats[at(res.Assists, i)]; s != nil {
			assist = s.Name
		} else if s := b.stats[at(res.Assists, i)]; s != nil {
			assist = s.Name
		}
		if name != "" {
			m.Goals = append(m.Goals, IntlGoal{PlayerID: id, Name: name, Side: side, Assist: assist, Mine: mine})
		}
	}
	// ratings, appearances and tired legs
	for side, t := range []*IntlTeam{a, b} {
		sh := sa
		gf, ga := hg, ag
		if side == 1 {
			sh, gf, ga = sb, ag, hg
		}
		result := 0.0
		won := gf > ga || (gf == ga && m.PH != nil && ((side == 0 && *m.PH > *m.PA) || (side == 1 && *m.PA > *m.PH)))
		lost := gf < ga || (gf == ga && m.PH != nil && !won)
		if won {
			result = 0.4
		} else if lost {
			result = -0.3
		}
		t.games++
		played := map[int]bool{}
		for i, p := range sh.Starters {
			if p == nil {
				continue
			}
			played[p.ID] = true
			cat := RoleCat(sh.Roles[i])
			rt := 6.3 + (Effective(p, sh.Roles[i])-70)/25 + float64(goals[p.ID]) + 0.6*float64(assists[p.ID]) + result + r.NormFloat64()*0.35
			if ga == 0 && cat == "GK" {
				rt += 0.8
			} else if ga == 0 && cat == "DF" {
				rt += 0.4
			}
			if cat == "GK" || cat == "DF" {
				rt -= float64(ga) * 0.15
			}
			rt = math.Round(clamp(rt, 4, 10)*10) / 10
			if s := t.stats[p.ID]; s != nil {
				s.Apps++
				s.Goals += goals[p.ID]
				s.Assists += assists[p.ID]
				s.rsum += rt
				if s.Mine {
					m.Mine = true
				}
			}
			p.Fitness = math.Max(55, p.Fitness-15)
		}
		for _, p := range t.players {
			if !played[p.ID] {
				p.Fitness = math.Min(100, p.Fitness+4)
			}
		}
	}
	// a few days between games
	for _, t := range []*IntlTeam{a, b} {
		for _, p := range t.players {
			p.Fitness = math.Min(100, p.Fitness+7)
		}
	}
	return m
}

func (m IntlMatch) winner() string {
	if m.HG > m.AG || (m.HG == m.AG && m.PH != nil && *m.PH > *m.PA) {
		return m.Home
	}
	return m.Away
}

// summerTournament runs inside summerWindow (world_ai.go), after ageing and before the transfer
// window, in the summer after every odd season.
func (w *world) summerTournament(ctx context.Context, q DBTX, r *rand.Rand) error {
	c := w.career
	ended := c.Season - 1 // StartNextSeason has already moved the season on
	kind := intlKind(ended)
	if kind == "" {
		return nil
	}
	var exists bool
	if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM stage_history WHERE career_id=$1 AND season=$2 AND kind='intl')`, c.ID, ended).Scan(&exists); err != nil || exists {
		return err
	}
	ps, err := queryPlayers(ctx, q, `career_id=$1 AND NOT retired AND club_id IS NOT NULL`, c.ID)
	if err != nil {
		return err
	}
	byNation := map[string][]*Player{}
	for _, p := range ps {
		byNation[p.Nation] = append(byNation[p.Nation], p)
	}
	type cand struct {
		nation   string
		squad    []*Player
		form     string
		strength float64
	}
	var all []cand
	for n, list := range byNation {
		sq := pickSquad(list)
		if sq == nil {
			continue
		}
		f, s := bestShape(sq)
		all = append(all, cand{n, sq, f, s})
	}
	sort.Slice(all, func(i, j int) bool {
		if all[i].strength != all[j].strength {
			return all[i].strength > all[j].strength
		}
		return all[i].nation < all[j].nation
	})
	pool := all
	if kind == "euro" {
		pool = nil
		for _, x := range all {
			if europeNations[x.nation] {
				pool = append(pool, x)
			}
		}
		if len(pool) < 8 {
			kind, pool = "world", all
		}
	}
	size := 0
	switch {
	case kind == "euro":
		size = 8
		if len(pool) >= 16 {
			size = 16
		}
	case len(pool) >= 32:
		size = 32
	case len(pool) >= 16:
		size = 16
	case len(pool) >= 8:
		size = 8
	}
	if size == 0 {
		return nil
	}
	pool = pool[:size]
	userClub := c.UserClubID
	t := &Tournament{Season: ended, Kind: kind, Groups: map[string][]IntlRow{}, Matches: []IntlMatch{}, UserClub: userClub,
		Effects: IntlEffects{Boosted: []IntlBoost{}}}
	for s := 1; s <= ended; s++ {
		if intlKind(s) == kind {
			t.Edition++
		}
	}
	teams := map[string]*IntlTeam{}
	for i, x := range pool {
		tm := &IntlTeam{Nation: x.nation, Strength: int(math.Round(x.strength)), Formation: x.form, Pot: i/(size/4) + 1,
			club: &Club{ID: -(i + 1), Name: x.nation, Short: x.nation, Formation: x.form, Tactic: DefaultTactic(), Color: "#888888", Color2: "#ffffff"},
			real: map[int]*Player{}, stats: map[int]*IntlPlayer{}, Squad: []*IntlPlayer{}}
		for _, p := range x.squad {
			cp := *p
			cp.Fitness, cp.Injury, cp.Rushed = 100, 0, false
			tm.players = append(tm.players, &cp)
			tm.real[p.ID] = p
			ip := &IntlPlayer{ID: p.ID, Name: p.Name, Nation: p.Nation, Pos: p.Position, Role: NaturalRole(p), Age: p.Age, Ovr: p.Overall, Tag: p.Tag}
			if p.ClubID != nil {
				ip.ClubID = *p.ClubID
				if cl := w.byID[*p.ClubID]; cl != nil {
					ip.Club, ip.Short, ip.Color, ip.Color2 = cl.Name, cl.Short, cl.Color, cl.Color2
				}
				ip.Mine = *p.ClubID == userClub
			}
			if ip.Mine {
				tm.Mine++
			}
			tm.stats[p.ID] = ip
			tm.Squad = append(tm.Squad, ip)
		}
		teams[x.nation] = tm
		t.Teams = append(t.Teams, tm)
	}
	// the draw: one team from each pot in every group
	groups := size / 4
	names := make([][]*IntlTeam, groups)
	for pot := 0; pot < 4; pot++ {
		slice := append([]*IntlTeam{}, t.Teams[pot*groups:(pot+1)*groups]...)
		r.Shuffle(len(slice), func(i, j int) { slice[i], slice[j] = slice[j], slice[i] })
		for g, tm := range slice {
			tm.Group = "G" + string(rune('A'+g))
			names[g] = append(names[g], tm)
		}
	}
	// group stage: three matchdays, everyone plays everyone once
	rows := map[string]*IntlRow{}
	for _, tm := range t.Teams {
		rows[tm.Nation] = &IntlRow{Nation: tm.Nation}
	}
	rr := RoundRobin(4)[:3]
	for round, pairs := range rr {
		for g := 0; g < groups; g++ {
			for _, pr := range pairs {
				a, b := names[g][pr[0]], names[g][pr[1]]
				m := playIntl(r, a, b, a.Group, round+1, false)
				t.Matches = append(t.Matches, m)
				ra, rb := rows[a.Nation], rows[b.Nation]
				ra.P++
				rb.P++
				ra.GF += m.HG
				ra.GA += m.AG
				rb.GF += m.AG
				rb.GA += m.HG
				switch {
				case m.HG > m.AG:
					ra.W++
					rb.L++
					ra.Pts += 3
				case m.HG < m.AG:
					rb.W++
					ra.L++
					rb.Pts += 3
				default:
					ra.D++
					rb.D++
					ra.Pts++
					rb.Pts++
				}
			}
		}
	}
	standings := make([][]*IntlTeam, groups)
	for g := 0; g < groups; g++ {
		st := append([]*IntlTeam{}, names[g]...)
		sort.SliceStable(st, func(i, j int) bool {
			a, b := rows[st[i].Nation], rows[st[j].Nation]
			if a.Pts != b.Pts {
				return a.Pts > b.Pts
			}
			if a.GF-a.GA != b.GF-b.GA {
				return a.GF-a.GA > b.GF-b.GA
			}
			if a.GF != b.GF {
				return a.GF > b.GF
			}
			return st[i].Strength > st[j].Strength
		})
		standings[g] = st
		key := "G" + string(rune('A'+g))
		for _, tm := range st {
			t.Groups[key] = append(t.Groups[key], *rows[tm.Nation])
			tm.Result = "G"
		}
	}
	// knockouts: group winners meet runners-up of the neighbouring group, and stay apart until the final
	var ko []*IntlTeam
	for g := 0; g+1 < groups; g += 2 {
		ko = append(ko, standings[g][0], standings[g+1][1])
	}
	for g := 0; g+1 < groups; g += 2 {
		ko = append(ko, standings[g+1][0], standings[g][1])
	}
	stageOf := map[int]string{16: "R16", 8: "QF", 4: "SF", 2: "F"}
	for len(ko) >= 2 {
		stage := stageOf[len(ko)]
		var next []*IntlTeam
		for i := 0; i+1 < len(ko); i += 2 {
			a, b := ko[i], ko[i+1]
			a.Result, b.Result = stage, stage
			m := playIntl(r, a, b, stage, 0, true)
			t.Matches = append(t.Matches, m)
			if m.winner() == a.Nation {
				next = append(next, a)
			} else {
				next = append(next, b)
			}
			if stage == "F" {
				fm := m
				t.Final = &fm
			}
		}
		ko = next
	}
	if len(ko) == 1 {
		ko[0].Result = "W"
		t.Champion = ko[0].Nation
		if t.Final != nil {
			t.RunnerUp = t.Final.Home
			if t.RunnerUp == t.Champion {
				t.RunnerUp = t.Final.Away
			}
		}
	}
	// averages, the scorers' list, the player of the tournament, the user's players
	var everyone []*IntlPlayer
	for _, tm := range t.Teams {
		for _, ip := range tm.Squad {
			if ip.Apps > 0 {
				ip.Rating = math.Round(ip.rsum/float64(ip.Apps)*100) / 100
			}
			ip.Result = tm.Result
			everyone = append(everyone, ip)
			if ip.Mine {
				t.Mine = append(t.Mine, ip)
			}
		}
		sort.SliceStable(tm.Squad, func(i, j int) bool {
			oi, oj := catOrder[tm.Squad[i].Pos], catOrder[tm.Squad[j].Pos]
			if oi != oj {
				return oi < oj
			}
			return tm.Squad[i].Ovr > tm.Squad[j].Ovr
		})
	}
	scorers := append([]*IntlPlayer{}, everyone...)
	sort.SliceStable(scorers, func(i, j int) bool {
		a, b := scorers[i], scorers[j]
		if a.Goals != b.Goals {
			return a.Goals > b.Goals
		}
		if a.Assists != b.Assists {
			return a.Assists > b.Assists
		}
		return a.Apps < b.Apps
	})
	for _, s := range scorers {
		if len(t.Scorers) >= 10 || s.Goals == 0 {
			break
		}
		t.Scorers = append(t.Scorers, s)
	}
	perf := func(p *IntlPlayer) float64 {
		bonus := map[string]float64{"W": 0.35, "F": 0.15, "SF": 0.05}[p.Result]
		return p.Rating + 0.15*float64(p.Goals) + 0.1*float64(p.Assists) + bonus
	}
	ranked := []*IntlPlayer{}
	for _, p := range everyone {
		if p.Apps >= 3 {
			ranked = append(ranked, p)
		}
	}
	sort.SliceStable(ranked, func(i, j int) bool { return perf(ranked[i]) > perf(ranked[j]) })
	if len(ranked) > 0 {
		t.Best = ranked[0]
	}
	sort.SliceStable(t.Mine, func(i, j int) bool {
		if t.Mine[i].Goals != t.Mine[j].Goals {
			return t.Mine[i].Goals > t.Mine[j].Goals
		}
		return t.Mine[i].Apps > t.Mine[j].Apps
	})
	if t.Mine == nil {
		t.Mine = []*IntlPlayer{}
	}
	if t.Scorers == nil {
		t.Scorers = []*IntlPlayer{}
	}
	if err := w.intlEffects(ctx, q, t, teams, ranked); err != nil {
		return err
	}
	if err := saveHistory(ctx, q, c.ID, ended, "intl", t); err != nil {
		return err
	}
	if err := w.intlNews(ctx, q, t); err != nil {
		return err
	}
	st, err := loadStage(ctx, q, c.ID)
	if err != nil {
		return err
	}
	st.Tournament = ended
	return saveStage(ctx, q, c.ID, st)
}

// intlEffects: tired legs, morale and the best performers' value, on the real players.
func (w *world) intlEffects(ctx context.Context, q DBTX, t *Tournament, teams map[string]*IntlTeam, ranked []*IntlPlayer) error {
	var changed []*Player
	t.Effects.FitMin, t.Effects.FitMax = 100, 0
	for _, tm := range t.Teams {
		for _, ip := range tm.Squad {
			p := tm.real[ip.ID]
			if p == nil {
				continue
			}
			loss := 10 + int(math.Round(10*float64(ip.Apps)/math.Max(1, float64(tm.games))))
			p.Fitness = clamp(p.Fitness-float64(loss), 50, 100)
			t.Effects.Tired++
			t.Effects.FitMin, t.Effects.FitMax = min(t.Effects.FitMin, loss), max(t.Effects.FitMax, loss)
			dm := 0.0
			switch tm.Result {
			case "W":
				dm += 15
			case "F":
				dm += 6
			case "G":
				if ip.Apps > 0 {
					dm -= 8
				}
			}
			if (ip.Apps >= 3 && ip.Rating >= 7.2) || ip.Goals >= 3 {
				dm += 8
			}
			if dm > 0 {
				t.Effects.MoraleUp++
			} else if dm < 0 {
				t.Effects.MoraleDown++
			}
			p.Morale = clamp(p.Morale+dm, 20, 100)
			changed = append(changed, p)
		}
	}
	// the three best performers (the player of the tournament and the top scorer first) gain a little value
	var picks []*IntlPlayer
	seen := map[int]bool{}
	addPick := func(p *IntlPlayer) {
		if p != nil && !seen[p.ID] && len(picks) < 3 {
			seen[p.ID] = true
			picks = append(picks, p)
		}
	}
	addPick(t.Best)
	if len(t.Scorers) > 0 {
		addPick(t.Scorers[0])
	}
	for _, p := range ranked {
		addPick(p)
	}
	for _, ip := range picks {
		p := teams[ip.Nation].real[ip.ID]
		if p == nil {
			continue
		}
		before := p.Value
		bumpKeyAttrs(p, 0.5)
		t.Effects.Boosted = append(t.Effects.Boosted, IntlBoost{PlayerID: p.ID, Name: p.Name, Nation: p.Nation, Before: before, After: p.Value, Mine: ip.Mine})
	}
	if t.Effects.FitMin > t.Effects.FitMax {
		t.Effects.FitMin = t.Effects.FitMax
	}
	return savePlayers(ctx, q, changed)
}

// intlNews: headlines for the champions and the tournament's top scorer. They stay out of the feed
// until the tournament pop-up has been shown (see News in world_ai.go).
func (w *world) intlNews(ctx context.Context, q DBTX, t *Tournament) error {
	c := w.career
	if t.Champion == "" {
		return nil
	}
	params := map[string]any{"kind": t.Kind, "nation": t.Champion, "runnerUp": t.RunnerUp, "edition": t.Edition}
	if t.Final != nil {
		gw, gl := t.Final.HG, t.Final.AG
		if t.Final.winner() == t.Final.Away {
			gw, gl = gl, gw
		}
		params["score"] = fmt.Sprintf("%d-%d", gw, gl)
		if t.Final.PH != nil && t.Final.PA != nil {
			params["pens"] = true
		}
	}
	mine := 0
	for _, p := range t.Mine {
		if p.Result == "W" {
			mine++
		}
	}
	// the top scorer first, so the champions lead the feed
	if len(t.Scorers) > 0 {
		s := t.Scorers[0]
		n := NewsItem{Season: c.Season, Day: 0, Kind: "intl", Story: "scorer", Player: s.Name, PlayerID: s.ID, From: s.Club, FromID: s.ClubID,
			Big: true, Mine: s.Mine, Params: map[string]any{"kind": t.Kind, "nation": s.Nation, "n": s.Goals}, At: time.Now()}
		if err := insertNews(ctx, q, c.ID, &n); err != nil {
			return err
		}
	}
	n := NewsItem{Season: c.Season, Day: 0, Kind: "intl", Story: "champion", Big: true, Mine: mine > 0, Params: params, At: time.Now()}
	return insertNews(ctx, q, c.ID, &n)
}
