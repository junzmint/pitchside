package game

import (
	"context"
	"math"
	"math/rand"
	"sort"
	"time"
)

// ---------------------------------------------------------------- Golden Ball night
//
// After the last matchday the whole world (every league in the career) hands out its awards:
//   Golden Ball   the season's top ten: match ratings against others in the same position, goals and
//                 assists, clean sheets for defenders and keepers, games played and the team's success
//   Golden Boy    the best player aged 21 or under
//   Golden Glove  the keeper who lets in the fewest goals a game (gloveLess)
//   Golden Boot   most goals in all competitions
//   Manager of the Year  the AI head coaches and the user: results against expectation and trophies
// Everyone is compared on the quick sim's scale. Watched and played matches run on the live engine, whose longer
// matches bring far more goals at both ends (and lower ratings for keepers, defenders and midfielders), so for
// those the goals and assists count at the rate the sim expected for the team, clean sheets as the chance of one
// and ratings as the sim would have given them (match.go): watching a season neither wins nor loses awards.
// The winner's value rises (about +1 overall, ~14%) and his morale goes to full; a Golden Ball for
// one of the user's players also lifts the club's reputation by one. Every night is kept for replays.

type AwardPlayer struct {
	Rank     int      `json:"rank"`
	Player   *Player  `json:"player"` // snapshot for the card (traits stay hidden)
	ClubID   int      `json:"clubId"`
	Club     string   `json:"club"`
	Short    string   `json:"short"`
	Color    string   `json:"color"`
	Color2   string   `json:"color2"`
	League   string   `json:"league"`
	Division int      `json:"division"`
	Pos      int      `json:"pos"` // the club's league position
	Trophies []string `json:"trophies"`
	Apps     int      `json:"apps"`
	Goals    int      `json:"goals"`
	Assists  int      `json:"assists"`
	CS       int      `json:"cs"`
	Rating   float64  `json:"rating"`
	Score    float64  `json:"score"`          // Golden Glove: his gloveRate (lower is better); the rest: higher is better
	Mine     bool     `json:"mine,omitempty"` // plays for the user's club
	// keepers: the goals he let in, and a game as the Golden Glove counts them (live matches at the quick sim's
	// expected goals); older award nights have neither
	Conceded int      `json:"conceded,omitempty"`
	GaRate   *float64 `json:"gaRate,omitempty"`
	// Goals, Assists, CS and Rating are on the awards' scale (the quick sim's); Real holds the numbers as they
	// were when watched or played matches made them differ
	Real *AwardReal `json:"real,omitempty"`
}

type AwardReal struct {
	Goals   int     `json:"goals"`
	Assists int     `json:"assists"`
	CS      int     `json:"cs"`
	Rating  float64 `json:"rating"`
}

type AwardManager struct {
	Rank     int      `json:"rank"`
	Name     string   `json:"name"`
	Nation   string   `json:"nation"`
	ClubID   int      `json:"clubId"`
	Club     string   `json:"club"`
	Short    string   `json:"short"`
	Color    string   `json:"color"`
	Color2   string   `json:"color2"`
	League   string   `json:"league"`
	Division int      `json:"division"`
	Pos      int      `json:"pos"`
	Expected int      `json:"expected"`
	Trophies []string `json:"trophies"`
	Score    float64  `json:"score"`
	Mine     bool     `json:"mine,omitempty"` // the user
}

// AwardEffect: what an award changed (shown in the ceremony).
type AwardEffect struct {
	Award       string `json:"award"` // ball | boy | glove | boot
	PlayerID    int    `json:"playerId"`
	Name        string `json:"name"`
	ValueBefore int64  `json:"valueBefore,omitempty"`
	ValueAfter  int64  `json:"valueAfter,omitempty"`
	OvrBefore   int    `json:"ovrBefore,omitempty"`
	OvrAfter    int    `json:"ovrAfter,omitempty"`
	Morale      bool   `json:"morale"`         // morale went to full
	Rep         int    `json:"rep,omitempty"`  // the user's club reputation change
	Mine        bool   `json:"mine,omitempty"` // one of the user's players
}

type AwardNight struct {
	Season   int            `json:"season"`
	Ball     []AwardPlayer  `json:"ball"`     // top ten, winner first
	Boy      []AwardPlayer  `json:"boy"`      // top three
	Glove    []AwardPlayer  `json:"glove"`    // top three
	Boot     []AwardPlayer  `json:"boot"`     // top three
	Managers []AwardManager `json:"managers"` // top five
	Effects  []AwardEffect  `json:"effects"`
	UserClub int            `json:"userClub"`
	Players  int            `json:"players"` // how many players were in the running
}

type awardStat struct {
	id, club, apps, goals, assists, cs, conceded int
	rsum, gaSim                                  float64 // rsum: ratings as given · gaSim: player_stats.conceded_sim
	// the season on the quick sim's scale, which the awards compare (player_stats.goals_sim, assists_sim,
	// cs_sim and rating_sim: watched and played matches as the sim would have had them)
	gSim, aSim, csSim, rSim float64
}

// avg: the average rating the awards compare (the quick sim's scale); realAvg: as the ratings were given.
func (a awardStat) avg() float64     { return a.rSim / math.Max(1, float64(a.apps)) }
func (a awardStat) realAvg() float64 { return a.rsum / math.Max(1, float64(a.apps)) }

// Golden Glove: the keeper who lets in the fewest goals a game, from GloveMinApps games. Watched and played
// matches run on the live engine, whose longer matches bring more goals at both ends, so for those the goals
// the quick simulation expected count instead (player_stats.conceded_sim): watching never costs a keeper the
// award, and the other side's keeper is not punished for your eight-goal afternoon. A few games prove little:
// GlovePrior games at GlovePriorRate join every record, so in a close race the keeper with more games wins.
const (
	GloveMinApps   = 20
	GlovePrior     = 5.0
	GlovePriorRate = 1.2
)

// gaRate: goals against a game as the Golden Glove counts them.
func (a awardStat) gaRate() float64 { return a.gaSim / math.Max(1, float64(a.apps)) }

// gloveRate: gaRate with GlovePrior games of GlovePriorRate added (what the Golden Glove ranks by).
func (a awardStat) gloveRate() float64 {
	return (a.gaSim + GlovePrior*GlovePriorRate) / (float64(a.apps) + GlovePrior)
}

// gloveLess: the Golden Glove order: the lower gloveRate, then more clean sheets a game, more games, the
// better rating.
func gloveLess(a, b awardStat) bool {
	if ra, rb := math.Round(a.gloveRate()*1000), math.Round(b.gloveRate()*1000); ra != rb {
		return ra < rb
	}
	ca, cb := a.csSim/math.Max(1, float64(a.apps)), b.csSim/math.Max(1, float64(b.apps))
	if ca != cb {
		return ca > cb
	}
	if a.apps != b.apps {
		return a.apps > b.apps
	}
	return a.avg() > b.avg()
}

// teamSeason: how a club's season went (league position, division, trophies) and what it adds to
// its players' Golden Ball scores.
type teamSeason struct {
	pos, div int
	league   string
	trophies []string // league | cup | cup_f | cl | cl_f | cl_sf | up
}

func (t teamSeason) has(k string) bool {
	for _, x := range t.trophies {
		if x == k {
			return true
		}
	}
	return false
}

func (t teamSeason) playerBonus() float64 {
	b := 0.0
	switch t.div {
	case 1:
		b += math.Max(0, float64(9-t.pos)) * 0.45
		if t.pos == 1 {
			b += 3
		}
	case 2:
		if t.pos == 1 {
			b += 1.2
		} else if t.pos <= PromoteCount {
			b += 0.6
		}
	case 3:
		if t.pos == 1 {
			b += 0.5
		}
	}
	for _, k := range t.trophies {
		b += map[string]float64{"cup": 2.5, "cup_f": 0.8, "cl": 6, "cl_f": 2.5, "cl_sf": 1}[k]
	}
	return b
}

func (t teamSeason) managerBonus() float64 {
	b := 0.0
	if t.div == 1 {
		b += math.Max(0, float64(9-t.pos)) * 0.35
	}
	for _, k := range t.trophies {
		switch k {
		case "league":
			b += map[int]float64{1: 7, 2: 3.5, 3: 2}[t.div]
		default:
			b += map[string]float64{"up": 2, "cup": 4, "cup_f": 1.2, "cl": 9, "cl_f": 3.5, "cl_sf": 1.5}[k]
		}
	}
	return b
}

// seasonOf: every competition club's season (tables and finals of the fixtures in memory).
func (w *world) seasonOf() map[int]*teamSeason {
	out := map[int]*teamSeason{}
	for _, l := range Leagues {
		for d := 1; d <= Divisions; d++ {
			for i, row := range divisionTable(w.clubs, w.fixtures, l.Code, d) {
				ts := &teamSeason{pos: i + 1, div: d, league: l.Code}
				if i == 0 {
					ts.trophies = append(ts.trophies, "league")
				}
				if d > 1 && i < PromoteCount {
					ts.trophies = append(ts.trophies, "up")
				}
				out[row.ClubID] = ts
			}
		}
	}
	add := func(id int, k string) {
		if ts := out[id]; ts != nil {
			ts.trophies = append(ts.trophies, k)
		}
	}
	for _, f := range w.fixtures {
		if !f.Played || (f.Comp != "cup" && f.Comp != "cl") {
			continue
		}
		win := f.WinnerID()
		lose := f.HomeID
		if win == f.HomeID {
			lose = f.AwayID
		}
		switch {
		case f.Stage == "F":
			add(win, f.Comp)
			add(lose, f.Comp+"_f")
		case f.Comp == "cl" && f.Stage == "SF":
			add(lose, "cl_sf")
		}
	}
	return out
}

// goldenBall: the world's awards for the season that just ended (runs on the last matchday).
func (w *world) goldenBall(ctx context.Context, q DBTX, r *rand.Rand, st *StageState, rep *DayReport) error {
	c := w.career
	night, err := w.computeAwards(ctx, q, st)
	if err != nil || night == nil || len(night.Ball) == 0 {
		return err
	}
	if err := w.awardEffects(ctx, q, night); err != nil {
		return err
	}
	if err := saveHistory(ctx, q, c.ID, night.Season, "awards", night); err != nil {
		return err
	}
	if err := w.awardNews(ctx, q, night, rep); err != nil {
		return err
	}
	st.Ceremony = night.Season
	return nil
}

func (w *world) computeAwards(ctx context.Context, q DBTX, st *StageState) (*AwardNight, error) {
	c := w.career
	rows, err := q.Query(ctx, `SELECT player_id, (array_agg(club_id ORDER BY apps DESC))[1], sum(apps)::int, sum(goals)::int,
		sum(assists)::int, sum(rating_sum)::float8, sum(cs)::int, sum(conceded)::int, sum(conceded_sim)::float8,
		sum(COALESCE(goals_sim, goals))::float8, sum(COALESCE(assists_sim, assists))::float8,
		sum(COALESCE(cs_sim, cs))::float8, sum(COALESCE(rating_sim, rating_sum))::float8
		FROM player_stats WHERE career_id=$1 AND season=$2 AND comp <> 'friendly' GROUP BY player_id HAVING sum(apps) >= 6`, c.ID, c.Season)
	if err != nil {
		return nil, err
	}
	var stats []awardStat
	for rows.Next() {
		var a awardStat
		if err := rows.Scan(&a.id, &a.club, &a.apps, &a.goals, &a.assists, &a.rsum, &a.cs, &a.conceded, &a.gaSim,
			&a.gSim, &a.aSim, &a.csSim, &a.rSim); err != nil {
			rows.Close()
			return nil, err
		}
		stats = append(stats, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(stats) == 0 {
		return nil, nil
	}
	// the players: in memory when they play in the competitions, else read them
	byID := map[int]*Player{}
	for _, ps := range w.players {
		for _, p := range ps {
			byID[p.ID] = p
		}
	}
	var missing []int
	for _, a := range stats {
		if byID[a.id] == nil {
			missing = append(missing, a.id)
		}
	}
	if len(missing) > 0 {
		extra, err := queryPlayers(ctx, q, `career_id=$1 AND id = ANY($2)`, c.ID, missing)
		if err != nil {
			return nil, err
		}
		for _, p := range extra {
			byID[p.ID] = p
		}
	}
	seasons := w.seasonOf()
	// ratings are compared within a position (forwards' ratings carry their goals)
	type agg struct{ n, sum, sq float64 }
	pos := map[string]*agg{}
	for _, a := range stats {
		p := byID[a.id]
		if p == nil || a.apps < 20 {
			continue
		}
		g := pos[p.Position]
		if g == nil {
			g = &agg{}
			pos[p.Position] = g
		}
		v := a.avg()
		g.n++
		g.sum += v
		g.sq += v * v
	}
	z := func(p *Player, v float64) float64 {
		g := pos[p.Position]
		if g == nil || g.n < 3 {
			return (v - 6.4) / 0.5
		}
		mean := g.sum / g.n
		sd := math.Sqrt(math.Max(0.01, g.sq/g.n-mean*mean))
		return (v - mean) / sd
	}
	posW := map[string]float64{"FW": 1.0, "MF": 0.96, "DF": 0.84, "GK": 0.8}
	ballScore := func(a awardStat, p *Player, ts *teamSeason) float64 {
		vol := math.Min(1, float64(a.apps)/36)
		s := 10*z(p, a.avg())*posW[p.Position]*(0.55+0.45*vol) + 0.12*a.gSim + 0.07*a.aSim
		if p.Position == "DF" || p.Position == "GK" {
			s += 0.06 * a.csSim
		}
		if ts != nil {
			s += ts.playerBonus()
		}
		return math.Round(s*10) / 10
	}
	userClub := c.UserClubID
	entry := func(a awardStat, p *Player, score float64) AwardPlayer {
		snap := *p
		snap.Traits, snap.HiddenTraits, snap.Dev, snap.Load, snap.Rushed = nil, 0, "", "", false
		ap := AwardPlayer{Player: &snap, ClubID: a.club, Apps: a.apps, Goals: int(math.Round(a.gSim)), Assists: int(math.Round(a.aSim)),
			CS: int(math.Round(a.csSim)), Rating: math.Round(a.avg()*100) / 100, Score: score, Mine: a.club == userClub}
		if real := (AwardReal{Goals: a.goals, Assists: a.assists, CS: a.cs, Rating: math.Round(a.realAvg()*100) / 100}); real.Goals != ap.Goals ||
			real.Assists != ap.Assists || real.CS != ap.CS || math.Abs(real.Rating-ap.Rating) >= 0.05 {
			ap.Real = &real
		}
		if p.ClubID != nil && *p.ClubID == userClub {
			ap.Mine = true
		}
		if p.Position == "GK" {
			r := math.Round(a.gaRate()*100) / 100
			ap.Conceded, ap.GaRate = a.conceded, &r
		}
		if cl := w.byID[a.club]; cl != nil {
			ap.Club, ap.Short, ap.Color, ap.Color2, ap.League, ap.Division = cl.Name, cl.Short, cl.Color, cl.Color2, cl.League, cl.Division
		}
		if ts := seasons[a.club]; ts != nil {
			ap.Pos, ap.Trophies = ts.pos, append([]string{}, ts.trophies...)
		}
		if ap.Trophies == nil {
			ap.Trophies = []string{}
		}
		return ap
	}
	type scored struct {
		a     awardStat
		p     *Player
		score float64
	}
	var ball, boy, glove, boot []scored
	for _, a := range stats {
		p := byID[a.id]
		if p == nil {
			continue
		}
		ts := seasons[a.club]
		if a.apps >= 20 {
			ball = append(ball, scored{a, p, ballScore(a, p, ts)})
		}
		if a.apps >= 15 && p.Age <= 21 {
			boy = append(boy, scored{a, p, ballScore(a, p, ts)})
		}
		if a.apps >= GloveMinApps && p.Position == "GK" {
			glove = append(glove, scored{a, p, math.Round(a.gloveRate()*100) / 100})
		}
		if a.gSim >= 0.5 {
			boot = append(boot, scored{a, p, math.Round(a.gSim*10) / 10})
		}
	}
	byScore := func(xs []scored) {
		sort.SliceStable(xs, func(i, j int) bool {
			if xs[i].score != xs[j].score {
				return xs[i].score > xs[j].score
			}
			return xs[i].a.avg() > xs[j].a.avg()
		})
	}
	byScore(ball)
	byScore(boy)
	sort.SliceStable(glove, func(i, j int) bool { return gloveLess(glove[i].a, glove[j].a) })
	sort.SliceStable(boot, func(i, j int) bool {
		if boot[i].score != boot[j].score { // goals on the awards' scale, to a tenth
			return boot[i].score > boot[j].score
		}
		if boot[i].a.apps != boot[j].a.apps {
			return boot[i].a.apps < boot[j].a.apps
		}
		return boot[i].a.avg() > boot[j].a.avg()
	})
	top := func(xs []scored, n int) []AwardPlayer {
		out := []AwardPlayer{}
		for i := 0; i < n && i < len(xs); i++ {
			e := entry(xs[i].a, xs[i].p, xs[i].score)
			e.Rank = i + 1
			out = append(out, e)
		}
		return out
	}
	night := &AwardNight{Season: c.Season, Ball: top(ball, 10), Boy: top(boy, 3), Glove: top(glove, 3), Boot: top(boot, 3),
		Effects: []AwardEffect{}, UserClub: userClub, Players: len(ball)}
	night.Managers = w.managerAwards(ctx, q, st, seasons)
	return night, nil
}

// managerAwards: the five best head coaches of the season, the user included.
func (w *world) managerAwards(ctx context.Context, q DBTX, st *StageState, seasons map[int]*teamSeason) []AwardManager {
	c := w.career
	var you string
	_ = q.QueryRow(ctx, `SELECT u.username FROM users u JOIN careers c ON c.user_id=u.id WHERE c.id=$1`, c.ID).Scan(&you)
	var out []AwardManager
	for _, cl := range w.clubs {
		ts := seasons[cl.ID]
		if ts == nil || cl.Division < 1 {
			continue
		}
		m := AwardManager{ClubID: cl.ID, Club: cl.Name, Short: cl.Short, Color: cl.Color, Color2: cl.Color2, League: cl.League,
			Division: cl.Division, Pos: ts.pos, Expected: st.Expect[cl.ID], Trophies: append([]string{}, ts.trophies...)}
		if m.Expected == 0 {
			m.Expected = ts.pos
		}
		if cl.IsUser {
			m.Name, m.Mine = you, true
		} else {
			head := headCoachOf(w.coaches[cl.ID])
			if head == nil {
				continue
			}
			m.Name, m.Nation = head.Name, head.Nation
		}
		divW := map[int]float64{1: 1, 2: 0.7, 3: 0.5}[cl.Division]
		m.Score = math.Round((float64(m.Expected-m.Pos)*1.2*divW+ts.managerBonus())*10) / 10
		out = append(out, m)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return out[i].Division < out[j].Division
	})
	if len(out) > 5 {
		out = out[:5]
	}
	for i := range out {
		out[i].Rank = i + 1
	}
	if out == nil {
		out = []AwardManager{}
	}
	return out
}

// bumpKeyAttrs raises the attributes behind a player's overall (≈ +n overall, value ×1.145^n).
func bumpKeyAttrs(p *Player, n float64) {
	for _, a := range keyAttrs(p.Position) {
		v := p.Attr(a)
		*v = math.Min(attrCap(p), *v+n)
	}
	if ovr := int(math.Round(OverallAs(p, p.Position))); ovr > p.Potential {
		p.Potential = min(potentialCap(p), ovr)
	}
	p.Fill()
}

// awardEffects: the Golden Ball winner's value rises and his morale goes to full; the other
// winners get full morale. A Golden Ball for the user's player adds one point of club reputation.
func (w *world) awardEffects(ctx context.Context, q DBTX, night *AwardNight) error {
	c := w.career
	user := w.byID[c.UserClubID]
	var changed []*Player
	find := func(id int) (*Player, error) {
		if p := w.playerByID(id); p != nil {
			return p, nil
		}
		return getPlayer(ctx, q, c.ID, id)
	}
	seen := map[int]bool{}
	for _, aw := range []struct {
		key  string
		list []AwardPlayer
	}{{"ball", night.Ball}, {"boy", night.Boy}, {"glove", night.Glove}, {"boot", night.Boot}} {
		if len(aw.list) == 0 {
			continue
		}
		win := aw.list[0]
		p, err := find(win.Player.ID)
		if err != nil {
			continue // retired or gone: the award still stands
		}
		e := AwardEffect{Award: aw.key, PlayerID: p.ID, Name: p.Name, Morale: true, Mine: win.Mine}
		if aw.key == "ball" {
			e.ValueBefore, e.OvrBefore = p.Value, p.Overall
			// the first Golden Ball lifts a player's game; winning it again adds glory, not ability
			won := false
			_ = q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM stage_history WHERE career_id=$1 AND kind='awards' AND season<$2
				AND (data->'ball'->0->'player'->>'id')::int = $3)`, c.ID, night.Season, p.ID).Scan(&won)
			if !won {
				bumpKeyAttrs(p, 1)
			}
			e.ValueAfter, e.OvrAfter = p.Value, p.Overall
			if win.Mine && user != nil {
				user.Reputation = min(99, user.Reputation+1)
				e.Rep = 1
			}
		}
		p.Morale = 100
		if !seen[p.ID] {
			seen[p.ID] = true
			changed = append(changed, p)
		}
		night.Effects = append(night.Effects, e)
	}
	return savePlayers(ctx, q, changed)
}

// awardNews: the night's headlines in the world news feed (the Golden Ball last, so it leads).
// They stay out of the feed until the ceremony has been shown (see News in world_ai.go).
func (w *world) awardNews(ctx context.Context, q DBTX, night *AwardNight, rep *DayReport) error {
	c := w.career
	day := min(c.Day, len(Calendar))
	add := func(n NewsItem) error {
		n.Season, n.Day, n.Kind, n.At = c.Season, day, "award", time.Now()
		return insertNews(ctx, q, c.ID, &n)
	}
	for _, aw := range []struct {
		key  string
		list []AwardPlayer
	}{{"boy", night.Boy}, {"glove", night.Glove}, {"boot", night.Boot}} {
		if len(aw.list) == 0 {
			continue
		}
		x := aw.list[0]
		if err := add(NewsItem{Story: aw.key, Player: x.Player.Name, PlayerID: x.Player.ID, Ovr: x.Player.Overall, Age: x.Player.Age,
			From: x.Club, FromID: x.ClubID, Mine: x.Mine, Params: map[string]any{"goals": x.Goals, "cs": x.CS, "rating": x.Rating}}); err != nil {
			return err
		}
	}
	if len(night.Managers) > 0 {
		m := night.Managers[0]
		if err := add(NewsItem{Story: "manager", Coach: m.Name, From: m.Club, FromID: m.ClubID, Mine: m.Mine, Big: m.Mine,
			Params: map[string]any{"pos": m.Pos, "exp": m.Expected}}); err != nil {
			return err
		}
	}
	b := night.Ball[0]
	return add(NewsItem{Story: "ball", Player: b.Player.Name, PlayerID: b.Player.ID, Ovr: b.Player.Overall, Age: b.Player.Age,
		From: b.Club, FromID: b.ClubID, Big: true, Mine: b.Mine, Params: map[string]any{"goals": b.Goals, "assists": b.Assists, "rating": b.Rating}})
}
