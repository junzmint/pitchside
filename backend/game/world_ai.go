package game

import (
	"context"
	"math"
	"math/rand"
	"sort"
	"time"
)

// ---------------------------------------------------------------- the living world
//
// Computer-run clubs are not frozen any more: they buy and sell among themselves in two transfer
// windows (summer: the start of a season; winter: matchdays 24–29), sack managers who fail, and
// earn money every season. Everything that happens is written to a news feed the user can read.

// NewsItem: one line of world news.
type NewsItem struct {
	ID       int64          `json:"id"`
	Season   int            `json:"season"`
	Day      int            `json:"day"`
	Kind     string         `json:"kind"`            // transfer | sacked | story | award | intl (the last three: stage*.go)
	Story    string         `json:"story,omitempty"` // story/award/intl: what kind of headline (see stage_stories.go)
	Player   string         `json:"player,omitempty"`
	PlayerID int            `json:"playerId,omitempty"`
	Ovr      int            `json:"ovr,omitempty"`
	Age      int            `json:"age,omitempty"`
	From     string         `json:"from,omitempty"`
	FromID   int            `json:"fromId,omitempty"`
	To       string         `json:"to,omitempty"`
	ToID     int            `json:"toId,omitempty"`
	Fee      int64          `json:"fee,omitempty"`
	Coach    string         `json:"coach,omitempty"`
	League   string         `json:"league,omitempty"` // competition key (e.g. "EN-1") or country code
	Params   map[string]any `json:"params,omitempty"` // names and numbers for the headline text
	Big      bool           `json:"big,omitempty"`    // a headline: a big fee, a star, or your league
	Mine     bool           `json:"mine,omitempty"`   // about the user's club or its players
	At       time.Time      `json:"at"`
	// club crests, filled in when the feed is read (not stored)
	FromShort  string `json:"fromShort,omitempty"`
	FromColor  string `json:"fromColor,omitempty"`
	FromColor2 string `json:"fromColor2,omitempty"`
	ToShort    string `json:"toShort,omitempty"`
	ToColor    string `json:"toColor,omitempty"`
	ToColor2   string `json:"toColor2,omitempty"`
}

const (
	winterWindowFrom = 24
	winterWindowTo   = 29
	summerDeals      = 26 // AI-to-AI transfers when a new season starts
)

func inWinterWindow(day int) bool { return day >= winterWindowFrom && day <= winterWindowTo }

func insertNews(ctx context.Context, q DBTX, careerID int, n *NewsItem) error {
	return q.QueryRow(ctx, `INSERT INTO news (career_id, season, day, kind, data) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		careerID, n.Season, n.Day, n.Kind, n).Scan(&n.ID)
}

// News returns the latest world news, newest first (only the given kinds when there are any),
// with the clubs' crests filled in.
func (s *Store) News(ctx context.Context, careerID, limit int, kinds ...string) ([]NewsItem, error) {
	if limit <= 0 || limit > 200 {
		limit = 60
	}
	sql, args := `SELECT id, data FROM news WHERE career_id=$1 ORDER BY id DESC LIMIT $2`, []any{careerID, limit}
	if len(kinds) > 0 {
		sql, args = `SELECT id, data FROM news WHERE career_id=$1 AND kind = ANY($3) ORDER BY id DESC LIMIT $2`, append(args, kinds)
	}
	// no spoilers: the awards night and the summer tournament stay out of the feed until their pop-up was shown
	st, err := loadStage(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	hidden := func(n NewsItem) bool {
		return (n.Kind == "award" && st.Ceremony > 0 && n.Season == st.Ceremony) || (n.Kind == "intl" && st.Tournament > 0 && n.Season == st.Tournament+1)
	}
	rows, err := s.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	out := []NewsItem{}
	ids := map[int]bool{}
	for rows.Next() {
		var n NewsItem
		var id int64
		if err := rows.Scan(&id, &n); err != nil {
			rows.Close()
			return nil, err
		}
		n.ID = id
		if hidden(n) {
			continue
		}
		if n.FromID > 0 {
			ids[n.FromID] = true
		}
		if n.ToID > 0 {
			ids[n.ToID] = true
		}
		out = append(out, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(ids) == 0 {
		return out, err
	}
	list := make([]int, 0, len(ids))
	for id := range ids {
		list = append(list, id)
	}
	type crest struct{ short, c1, c2 string }
	crests := map[int]crest{}
	cr, err := s.DB.Query(ctx, `SELECT id, short, color, color2 FROM clubs WHERE career_id=$1 AND id = ANY($2)`, careerID, list)
	if err != nil {
		return nil, err
	}
	defer cr.Close()
	for cr.Next() {
		var id int
		var k crest
		if err := cr.Scan(&id, &k.short, &k.c1, &k.c2); err != nil {
			return nil, err
		}
		crests[id] = k
	}
	for i := range out {
		if k, ok := crests[out[i].FromID]; ok {
			out[i].FromShort, out[i].FromColor, out[i].FromColor2 = k.short, k.c1, k.c2
		}
		if k, ok := crests[out[i].ToID]; ok {
			out[i].ToShort, out[i].ToColor, out[i].ToColor2 = k.short, k.c1, k.c2
		}
	}
	return out, cr.Err()
}

// aiMarket holds what a transfer round needs: clubs, their squads and the user's league.
type aiMarket struct {
	clubs   []*Club
	byID    map[int]*Club
	squads  map[int][]*Player
	user    *Club
	season  int
	day     int
	changed map[int]bool // clubs whose budget changed
	skip    map[int]bool // players who must not move (on loan from the user's club)
}

// onLoan: players the user has lent out stay where they are until they come back.
func onLoan(c *Career) map[int]bool {
	out := map[int]bool{}
	for _, l := range c.Events.LoansOut {
		out[l.PlayerID] = true
	}
	for _, l := range c.Events.LoansIn {
		out[l.PlayerID] = true
	}
	return out
}

// weakestSlot: the position where the club's starter is furthest below the rest of its XI.
func (m *aiMarket) weakestSlot(cl *Club) (string, float64) {
	roles := Formations[cl.Formation]
	if len(roles) == 0 {
		return "", 0
	}
	ids := BestLineup(m.squads[cl.ID], cl.Formation)
	byID := map[int]*Player{}
	for _, p := range m.squads[cl.ID] {
		byID[p.ID] = p
	}
	worst, worstV := "", math.MaxFloat64
	for i, id := range ids {
		p := byID[id]
		v := 0.0
		if p != nil {
			v = OverallAs(p, RoleCat(roles[i]))
		}
		if v < worstV {
			worst, worstV = RoleCat(roles[i]), v
		}
	}
	return worst, worstV
}

// round runs up to n AI-to-AI transfers. Clubs strengthen their weakest position by buying a
// better player from a club that can spare him; stars tend to move up to bigger clubs.
func (m *aiMarket) round(ctx context.Context, q DBTX, r *rand.Rand, careerID, n int) ([]NewsItem, error) {
	var buyers []*Club
	for _, cl := range m.clubs {
		if !cl.IsUser && cl.Division > 0 && cl.Budget > 2*M {
			buyers = append(buyers, cl)
		}
	}
	var news []NewsItem
	if len(buyers) == 0 {
		return nil, nil
	}
	for tries := 0; len(news) < n && tries < n*6; tries++ {
		buyer := buyers[r.Intn(len(buyers))]
		if len(m.squads[buyer.ID]) >= AIMaxSquad {
			continue
		}
		pos, floor := m.weakestSlot(buyer)
		if pos == "" {
			continue
		}
		// candidates: better than the weak spot, affordable, from a club that can spare them
		type cand struct {
			p    *Player
			from *Club
			fee  int64
			w    float64
		}
		var cands []cand
		for _, from := range m.clubs {
			if from.ID == buyer.ID || from.IsUser || len(m.squads[from.ID]) <= AIMinSquad+1 {
				continue
			}
			// a club rarely sells to a much smaller one
			if from.Reputation > buyer.Reputation+6 {
				continue
			}
			for _, p := range m.squads[from.ID] {
				if p.Position != pos || p.Age > 31 || isLegend(p) || p.Injury > 0 || m.skip[p.ID] {
					continue
				}
				ovr := OverallAs(p, pos)
				if ovr < floor+2 || ovr > floor+14 {
					continue
				}
				fee := askingPrice(p, m.season)
				fee = int64(float64(fee)*(1.0+r.Float64()*0.25)/10_000) * 10_000
				if fee > buyer.Budget*6/10 || fee <= 0 {
					continue
				}
				// prefer real upgrades at a sensible price; young talent gets a premium of interest
				w := (ovr - floor) / (1 + float64(fee)/float64(20*M))
				if p.Age <= 23 && p.Potential-int(ovr) >= 6 {
					w *= 1.4
				}
				cands = append(cands, cand{p, from, fee, w})
			}
		}
		if len(cands) == 0 {
			continue
		}
		sort.Slice(cands, func(i, j int) bool { return cands[i].w > cands[j].w })
		pick := cands[r.Intn(min(4, len(cands)))]
		item, err := m.move(ctx, q, careerID, pick.p, pick.from, buyer, pick.fee)
		if err != nil {
			return news, err
		}
		news = append(news, item)
	}
	return news, nil
}

// move transfers a player between two AI clubs and writes the news item.
func (m *aiMarket) move(ctx context.Context, q DBTX, careerID int, p *Player, from, to *Club, fee int64) (NewsItem, error) {
	shirt := 1
	used := map[int]bool{}
	for _, x := range m.squads[to.ID] {
		used[x.Shirt] = true
	}
	for used[shirt] && shirt < 99 {
		shirt++
	}
	moveTo(p, &to.ID, shirt)
	keep := m.squads[from.ID][:0]
	for _, x := range m.squads[from.ID] {
		if x.ID != p.ID {
			keep = append(keep, x)
		}
	}
	m.squads[from.ID] = keep
	m.squads[to.ID] = append(m.squads[to.ID], p)
	from.Budget += fee
	to.Budget -= fee
	m.changed[from.ID], m.changed[to.ID] = true, true
	if err := savePlayers(ctx, q, []*Player{p}); err != nil {
		return NewsItem{}, err
	}
	ovr := int(math.Round(OverallAs(p, p.Position)))
	n := NewsItem{Season: m.season, Day: m.day, Kind: "transfer", Player: p.Name, PlayerID: p.ID, Ovr: ovr, Age: p.Age,
		From: from.Name, FromID: from.ID, To: to.Name, ToID: to.ID, Fee: fee, At: time.Now(),
		Big: fee >= 30*M || ovr >= 84 || (m.user != nil && (from.League == m.user.League && from.Division == m.user.Division ||
			to.League == m.user.League && to.Division == m.user.Division))}
	return n, insertNews(ctx, q, careerID, &n)
}

func (m *aiMarket) saveClubs(ctx context.Context, q DBTX) error {
	for id := range m.changed {
		if err := saveClub(ctx, q, m.byID[id]); err != nil {
			return err
		}
	}
	return nil
}

// worldTick runs every matchday: winter-window transfers and managers who lose their job.
func (w *world) worldTick(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	c := w.career
	m := &aiMarket{clubs: w.clubs, byID: w.byID, squads: w.players, user: w.byID[c.UserClubID], season: c.Season, day: c.Day, changed: map[int]bool{}, skip: onLoan(c)}
	if inWinterWindow(c.Day) {
		news, err := m.round(ctx, q, r, c.ID, 2+r.Intn(4))
		if err != nil {
			return err
		}
		for _, n := range news {
			if n.Big {
				rep.World = append(rep.World, n)
			}
		}
	}
	// a struggling side sacks its manager (twice a season the boards take stock)
	if c.Day == 20 || c.Day == 40 {
		sacked, err := w.sackings(ctx, q, r)
		if err != nil {
			return err
		}
		rep.World = append(rep.World, sacked...)
	}
	if err := m.saveClubs(ctx, q); err != nil {
		return err
	}
	// the world stage: awards night, early cup draws, storylines (stage.go)
	return w.stageTick(ctx, q, r, rep)
}

// sackings: the bottom three of every top division, and clubs far below their expected place,
// may lose their head coach; the best available manager takes over.
func (w *world) sackings(ctx context.Context, q DBTX, r *rand.Rand) ([]NewsItem, error) {
	c := w.career
	user := w.byID[c.UserClubID]
	var out []NewsItem
	free, err := queryCoaches(ctx, q, `career_id=$1 AND club_id IS NULL AND role='head' ORDER BY skill DESC`, c.ID)
	if err != nil {
		return nil, err
	}
	for _, l := range Leagues {
		for d := 1; d <= Divisions; d++ {
			table := divisionTable(w.clubs, w.fixtures, l.Code, d)
			for i, row := range table {
				cl := w.byID[row.ClubID]
				if cl == nil || cl.IsUser {
					continue
				}
				exp := w.expectedRank(cl.ID)
				pos := i + 1
				// boards are patient: the bottom three and clubs far below expectations are at risk
				chance := 0.0
				if pos > len(table)-3 {
					chance = 0.16
				}
				if pos-exp >= 8 {
					chance += 0.12
				}
				if chance == 0 || r.Float64() > chance {
					continue
				}
				head := headCoachOf(w.coaches[cl.ID])
				if head == nil {
					continue
				}
				if _, err := q.Exec(ctx, `UPDATE coaches SET club_id=NULL WHERE id=$1`, head.ID); err != nil {
					return nil, err
				}
				var next *Coach
				for i, fc := range free {
					if fc != nil && fc.Skill <= head.Skill+4 {
						next, free[i] = fc, nil
						break
					}
				}
				if next == nil {
					next = GenCoach(r, nationsOf(cl.League), "head", max(6, head.Skill-1+r.Intn(4)))
					if err := insertCoach(ctx, q, c.ID, next); err != nil {
						return nil, err
					}
				}
				if _, err := q.Exec(ctx, `UPDATE coaches SET club_id=$1 WHERE id=$2`, cl.ID, next.ID); err != nil {
					return nil, err
				}
				n := NewsItem{Season: c.Season, Day: c.Day, Kind: "sacked", Coach: head.Name, To: next.Name, From: cl.Name, FromID: cl.ID,
					At: time.Now(), Big: cl.League == user.League}
				if err := insertNews(ctx, q, c.ID, &n); err != nil {
					return nil, err
				}
				if n.Big {
					out = append(out, n)
				}
			}
		}
	}
	return out, nil
}

// summerWindow runs when a new season starts: every club gets its season's income, then a busy
// transfer window. Players are read fresh (ageing and retirements were just written).
func (w *world) summerWindow(ctx context.Context, q DBTX, r *rand.Rand) ([]NewsItem, error) {
	c := w.career
	// every second summer the international tournament comes first: it changes the fitness and morale
	// of the players called up, so the window below reads them afterwards (stage_intl.go)
	if err := w.summerTournament(ctx, q, r); err != nil {
		return nil, err
	}
	ps, err := competitionPlayers(ctx, q, c.ID)
	if err != nil {
		return nil, err
	}
	squads := map[int][]*Player{}
	for _, p := range ps {
		if p.ClubID != nil {
			squads[*p.ClubID] = append(squads[*p.ClubID], p)
		}
	}
	m := &aiMarket{clubs: w.clubs, byID: w.byID, squads: squads, user: w.byID[c.UserClubID], season: c.Season, day: 0, changed: map[int]bool{}, skip: onLoan(c)}
	for _, cl := range w.clubs {
		if cl.IsUser || cl.Division == 0 {
			continue
		}
		// a season of gate money, TV and sponsors for the computer's clubs
		cl.Budget += int64(cl.Reputation*cl.Reputation) * 2_500 / int64(max(1, cl.Division))
		m.changed[cl.ID] = true
	}
	news, err := m.round(ctx, q, r, c.ID, summerDeals)
	if err != nil {
		return nil, err
	}
	if err := w.summerStories(ctx, q); err != nil {
		return nil, err
	}
	return news, m.saveClubs(ctx, q)
}
