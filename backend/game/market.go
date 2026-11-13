package game

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

const (
	MarketSize     = 30
	MaxCustom      = 20
	QuickSellShare = 0.7
)

// ---------------------------------------------------------------- templates (legends & custom players)

type Template struct {
	ID          int     `json:"id"`
	Kind        string  `json:"kind"`
	Name        string  `json:"name"`
	Nation      string  `json:"nation"`
	Age         int     `json:"age"`
	Position    string  `json:"position"`
	Pace        float64 `json:"pace"`
	Shooting    float64 `json:"shooting"`
	Passing     float64 `json:"passing"`
	Dribbling   float64 `json:"dribbling"`
	Defending   float64 `json:"defending"`
	Physical    float64 `json:"physical"`
	Goalkeeping float64 `json:"goalkeeping"`
	Potential   int     `json:"potential"`
	Signed      bool    `json:"signed"`
	Version     string  `json:"version"`
	ClubID      *int    `json:"clubId"`
	ClubName    string  `json:"clubName"`
	Overall     int     `json:"overall"`
	Value       int64   `json:"value"`
	OnMarket    bool    `json:"onMarket"`
	Role        string  `json:"role"` // where the card plays: his era's role for a legend (legendRole), else his numbers
}

func (t *Template) toPlayer() *Player {
	p := &Player{Name: t.Name, Nation: t.Nation, Age: t.Age, Position: t.Position, Pace: t.Pace, Shooting: t.Shooting,
		Passing: t.Passing, Dribbling: t.Dribbling, Defending: t.Defending, Physical: t.Physical, Goalkeeping: t.Goalkeeping,
		Potential: t.Potential, Fitness: 100, Morale: 75, Focus: "balanced", History: []int{}, Tag: t.Kind}
	if t.Kind == "legend" || (t.Kind == "custom" && t.ClubID != nil) {
		p.Version = t.Version
		if t.ClubID != nil {
			p.History = []int{*t.ClubID}
		}
	}
	id := t.ID
	p.TemplateID = &id
	p.Fill()
	return p
}

func insertTemplate(ctx context.Context, q DBTX, careerID int, kind string, p *Player) error {
	return insertTemplateV(ctx, q, careerID, kind, p, "", nil)
}

func insertTemplateV(ctx context.Context, q DBTX, careerID int, kind string, p *Player, version string, clubID *int) error {
	_, err := q.Exec(ctx, `INSERT INTO templates (career_id, kind, name, nation, age, position, pace, shooting, passing, dribbling,
		defending, physical, goalkeeping, potential, version, club_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		careerID, kind, p.Name, p.Nation, p.Age, p.Position, p.Pace, p.Shooting, p.Passing, p.Dribbling, p.Defending,
		p.Physical, p.Goalkeeping, p.Potential, version, clubID)
	return err
}

func listTemplates(ctx context.Context, q DBTX, careerID int, where string) ([]*Template, error) {
	rows, err := q.Query(ctx, `SELECT id, kind, name, nation, age, position, pace, shooting, passing, dribbling, defending,
		physical, goalkeeping, potential, signed, version, club_id, COALESCE((SELECT name FROM clubs c WHERE c.id=t.club_id), ''),
		EXISTS (SELECT 1 FROM players p WHERE p.template_id=t.id AND p.club_id IS NULL AND NOT p.retired)
		FROM templates t WHERE career_id=$1 `+where+` ORDER BY id`, careerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Template{}
	for rows.Next() {
		t := &Template{}
		if err := rows.Scan(&t.ID, &t.Kind, &t.Name, &t.Nation, &t.Age, &t.Position, &t.Pace, &t.Shooting, &t.Passing,
			&t.Dribbling, &t.Defending, &t.Physical, &t.Goalkeeping, &t.Potential, &t.Signed, &t.Version, &t.ClubID, &t.ClubName, &t.OnMarket); err != nil {
			return nil, err
		}
		p := t.toPlayer()
		t.Overall, t.Value = p.Overall, p.Value
		out = append(out, t)
	}
	return out, rows.Err()
}

type TemplateReq struct {
	Name        string  `json:"name"`
	Nation      string  `json:"nation"`
	Age         int     `json:"age"`
	Position    string  `json:"position"`
	Pace        float64 `json:"pace"`
	Shooting    float64 `json:"shooting"`
	Passing     float64 `json:"passing"`
	Dribbling   float64 `json:"dribbling"`
	Defending   float64 `json:"defending"`
	Physical    float64 `json:"physical"`
	Goalkeeping float64 `json:"goalkeeping"`
	Potential   int     `json:"potential"`
	ClubID      *int    `json:"clubId"` // optional: the club whose colours he wears (team colour)
}

func (s *Store) CreateTemplate(ctx context.Context, careerID int, req TemplateReq) error {
	req.Name = strings.TrimSpace(req.Name)
	if n := utf8.RuneCountInString(req.Name); n < 2 || n > 30 {
		return userErr("bad_player_name", "Player name must be 2–30 characters")
	}
	if req.Age < 16 || req.Age > 38 {
		return userErr("bad_age", "Age must be between 16 and 38")
	}
	if _, ok := templates[req.Position]; !ok {
		return userErr("bad_position", "Unknown position")
	}
	if len(req.Nation) < 2 || len(req.Nation) > 3 {
		req.Nation = "EN"
	}
	p := &Player{Name: req.Name, Nation: strings.ToUpper(req.Nation), Age: req.Age, Position: req.Position, Pace: req.Pace,
		Shooting: req.Shooting, Passing: req.Passing, Dribbling: req.Dribbling, Defending: req.Defending, Physical: req.Physical,
		Goalkeeping: req.Goalkeeping, Potential: req.Potential}
	for _, a := range AttrNames {
		if v := *p.Attr(a); v < 20 || v > 95 {
			return userErr("bad_attr", "Each attribute must be between 20 and 95")
		}
	}
	ovr := int(math.Round(OverallAs(p, p.Position)))
	if p.Potential < ovr {
		p.Potential = ovr
	}
	if p.Potential > 99 {
		p.Potential = 99
	}
	var n int
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM templates WHERE career_id=$1 AND kind='custom'`, careerID).Scan(&n); err != nil {
		return err
	}
	if n >= MaxCustom {
		return userErr("too_many_custom", "You can design at most 20 players")
	}
	// optionally tied to a club: like a legend's club version he links with that badge (team colour)
	// and arrives there with +2–3 on every attribute; without one he is a plain icon
	if req.ClubID != nil && *req.ClubID > 0 {
		var name string
		if err := s.DB.QueryRow(ctx, `SELECT name FROM clubs WHERE id=$1 AND career_id=$2`, *req.ClubID, careerID).Scan(&name); err != nil {
			return userErr("bad_club", "Unknown club")
		}
		return insertTemplateV(ctx, s.DB, careerID, "custom", p, name, req.ClubID)
	}
	return insertTemplate(ctx, s.DB, careerID, "custom", p)
}

func (s *Store) DeleteTemplate(ctx context.Context, careerID, id int) error {
	tag, err := s.DB.Exec(ctx, `DELETE FROM templates WHERE career_id=$1 AND id=$2 AND kind='custom' AND NOT signed`, careerID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return userErr("cannot_delete", "This player cannot be removed")
	}
	_, err = s.DB.Exec(ctx, `DELETE FROM players WHERE template_id IS NULL AND club_id IS NULL AND career_id=$1 AND name=''`, careerID)
	return err
}

// ---------------------------------------------------------------- weekly market

// refreshMarket replaces every free agent: a fresh batch of generic players, plus—per position, by
// chance—one legend or custom-designed player.
// Legend and custom cards on the free-agent market: there is usually one, and it changes every one or two
// matchdays (a matchday is a week), so the legends you are after come round during a season.
const (
	LegendStayMin = 1   // matchdays a card stays once it turns up…
	LegendStayMax = 2   // …at most
	LegendExtra   = 0.1 // chance of a second card on the same matchday
)

// MarketArrival: a legend or custom card that has just turned up, and for how many matchdays.
type MarketArrival struct {
	Name string
	Stay int
	Age  int // which version of him: the same legend comes in several eras
}

func refreshMarket(ctx context.Context, q DBTX, r *rand.Rand, c *Career) error {
	_, err := refreshMarketNews(ctx, q, r, c)
	return err
}

// refreshMarketNews renews the free agents and returns the legend and custom cards that just arrived.
func refreshMarketNews(ctx context.Context, q DBTX, r *rand.Rand, c *Career) ([]MarketArrival, error) {
	now := c.now()
	// free agents with a recorded career leave the game (kept for the history book); the rest vanish,
	// except legend and custom cards still within their stay
	if _, err := q.Exec(ctx, `UPDATE players p SET retired=true WHERE career_id=$1 AND club_id IS NULL AND NOT retired
		AND EXISTS (SELECT 1 FROM player_stats s WHERE s.player_id=p.id)`, c.ID); err != nil {
		return nil, err
	}
	if _, err := q.Exec(ctx, `DELETE FROM players p WHERE career_id=$1 AND club_id IS NULL AND NOT retired
		AND NOT (template_id IS NOT NULL AND EXISTS (SELECT 1 FROM templates t WHERE t.id=p.template_id AND t.market_until >= $2 AND NOT t.signed))`,
		c.ID, now); err != nil {
		return nil, err
	}
	ld := LeagueByCode(c.League)
	div := 1
	_ = q.QueryRow(ctx, `SELECT division FROM clubs WHERE id=$1`, c.UserClubID).Scan(&div)
	if div < 1 || div > Divisions {
		div = 1
	}
	base := divisionAverage(c.League, div)
	positions := []string{"GK", "DF", "DF", "DF", "MF", "MF", "MF", "FW", "FW"}
	for i := 0; i < MarketSize; i++ {
		t := base - 12 + r.Float64()*16
		if r.Intn(7) == 0 {
			t = base + 4 + r.Float64()*8
		}
		minAge, maxAge := 18, 33
		if r.Intn(4) == 0 {
			minAge, maxAge, t = 17, 20, t-6
		}
		p := GenPlayer(r, ld.Nations, pick(r, positions), t, minAge, maxAge)
		if err := insertPlayer(ctx, q, c.ID, p); err != nil {
			return nil, err
		}
	}
	if err := refreshStaff(ctx, q, r, c); err != nil {
		return nil, err
	}
	// cards that can turn up: not signed, and not on the market already
	tps, err := listTemplates(ctx, q, c.ID, fmt.Sprintf(`AND NOT signed AND market_until < %d`, now))
	if err != nil {
		return nil, err
	}
	// Legends and custom designs share one slot: when no card is on the market a new one turns up, and now
	// and then a second one. Each card is a custom design only 25% of the time, so your own creations turn
	// up less often than the legends.
	var legends, custom []*Template
	for _, t := range tps {
		if t.Kind == "custom" {
			custom = append(custom, t)
		} else {
			legends = append(legends, t)
		}
	}
	showing := 0 // cards on the market now: unsigned, still within their stay
	if err := q.QueryRow(ctx, `SELECT count(*) FROM templates WHERE career_id=$1 AND NOT signed AND market_until >= $2`, c.ID, now).Scan(&showing); err != nil {
		return nil, err
	}
	n := 0
	if showing == 0 {
		n = 1
	}
	if r.Float64() < LegendExtra {
		n++
	}
	used := map[int]bool{}
	var arrived []MarketArrival
	for i := 0; i < n; i++ {
		pool := legends
		if len(custom) > 0 && (len(legends) == 0 || r.Float64() < 0.25) {
			pool = custom
		}
		if len(pool) == 0 {
			break
		}
		t := pool[r.Intn(len(pool))]
		if used[t.ID] {
			continue
		}
		used[t.ID] = true
		if err := insertPlayer(ctx, q, c.ID, floorCard(ctx, q, c.ID, t.toPlayer())); err != nil {
			return nil, err
		}
		// he stays for one or two matchdays (a summer arrival waits into the new season)
		stay := LegendStayMin + r.Intn(LegendStayMax-LegendStayMin+1)
		until := now + stay - 1 // on the market after this matchday (and the next one for a stay of 2)
		if c.Day > len(Calendar) {
			until = (c.Season+1)*100 + stay - 1
		}
		if _, err := q.Exec(ctx, `UPDATE templates SET market_until=$2 WHERE id=$1`, t.ID, until); err != nil {
			return nil, err
		}
		label := t.Name
		if t.Version != "" {
			label += " (" + t.Version + ")"
		}
		arrived = append(arrived, MarketArrival{Name: label, Stay: stay, Age: t.Age})
	}
	return arrived, nil
}

type MarketView struct {
	Players   []*Player   `json:"players"`
	Coaches   []*Coach    `json:"coaches"`
	Templates []*Template `json:"templates"`
	Legends   []*Template `json:"legends"`
	Budget    int64       `json:"budget"`
	Squad     int         `json:"squad"`
}

func (s *Store) Market(ctx context.Context, careerID int) (*MarketView, error) {
	c, err := getCareer(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	club, err := getClub(ctx, s.DB, c.UserClubID)
	if err != nil {
		return nil, err
	}
	ps, err := queryPlayers(ctx, s.DB, `career_id=$1 AND club_id IS NULL AND NOT retired ORDER BY id`, careerID)
	if err != nil {
		return nil, err
	}
	if err := floorCards(ctx, s.DB, careerID, ps...); err != nil { // legend_versions.go: a card is never below his modern self
		return nil, err
	}
	sort.Slice(ps, func(i, j int) bool { return ps[i].Overall > ps[j].Overall })
	for _, p := range ps {
		p.Price = askingPrice(p, c.Season)
	}
	redact(ps, club.ID, userScoutSkill(ctx, s.DB, club.ID))
	cs, err := queryCoaches(ctx, s.DB, `career_id=$1 AND club_id IS NULL ORDER BY role, skill DESC`, careerID)
	if err != nil {
		return nil, err
	}
	// careers started before physios, scouts and doctors existed get candidates for the new roles
	have := map[string]bool{}
	for _, co := range cs {
		have[co.Role] = true
	}
	r := newRand()
	for _, role := range []string{"physio", "scout", "doctor"} {
		if have[role] {
			continue
		}
		for i := 0; i < 4; i++ {
			co := GenCoach(r, nil, role, 6+r.Intn(13))
			if err := insertCoach(ctx, s.DB, careerID, co); err != nil {
				return nil, err
			}
			cs = append(cs, co)
		}
	}
	ts, err := listTemplates(ctx, s.DB, careerID, `AND kind='custom'`)
	if err != nil {
		return nil, err
	}
	lg, err := listTemplates(ctx, s.DB, careerID, `AND kind='legend'`)
	if err != nil {
		return nil, err
	}
	if err := floorTemplates(ctx, s.DB, careerID, lg); err != nil { // legend_versions.go: what he sees is what he gets
		return nil, err
	}
	for _, t := range append(append([]*Template{}, ts...), lg...) {
		t.Role = t.toPlayer().Role
	}
	var n int
	if err := s.DB.QueryRow(ctx, `SELECT count(*) FROM players WHERE club_id=$1`, club.ID).Scan(&n); err != nil {
		return nil, err
	}
	return &MarketView{Players: ps, Coaches: cs, Templates: ts, Legends: lg, Budget: club.Budget, Squad: n}, nil
}

// nextShirt: the squad size and the number p gets joining it (shirts.go: one that suits him, never a retired
// one); p nil: the size alone.
// regulars: the players who count towards MaxSquad. Icons (legend cards and your own designs) don't, so a
// collection of them is limited by wages only.
func regulars(squad []*Player) int {
	n := 0
	for _, p := range squad {
		if !isLegend(p) {
			n++
		}
	}
	return n
}

// squadFull: no room for p (nil: anyone) among the regulars. An icon always fits.
func squadFull(regular int, p *Player) bool {
	return regular >= MaxSquad && (p == nil || !isLegend(p))
}

// regularCount: regulars in the database (the market's own count).
func regularCount(ctx context.Context, q DBTX, clubID int) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*) FROM players WHERE club_id=$1 AND tag NOT IN ('legend', 'custom')`, clubID).Scan(&n)
	return n, err
}

func nextShirt(ctx context.Context, q DBTX, clubID int, p *Player) (int, int, error) {
	var n int
	if err := q.QueryRow(ctx, `SELECT count(*) FROM players WHERE club_id=$1`, clubID).Scan(&n); err != nil {
		return 0, 0, err
	}
	if p == nil {
		return n, 0, nil
	}
	shirt, err := dbShirt(ctx, q, clubID, p)
	return n, shirt, err
}

func (s *Store) Buy(ctx context.Context, careerID, playerID int) (*SignResult, error) {
	var out *SignResult
	err := s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		club, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		p, err := getPlayer(ctx, q, careerID, playerID)
		if err != nil {
			return err
		}
		if p.ClubID != nil || p.Retired {
			return userErr("not_on_market", "This player is no longer on the market")
		}
		// legend_versions.go: a card is never below his modern self (as the market showed him, price included)
		if err := floorCards(ctx, q, careerID, p); err != nil {
			return err
		}
		_, shirt, err := nextShirt(ctx, q, club.ID, p)
		if err != nil {
			return err
		}
		reg, err := regularCount(ctx, q, club.ID)
		if err != nil {
			return err
		}
		if squadFull(reg, p) {
			return userErr("squad_full", "Your squad is full (50, icons not counted). Sell someone first")
		}
		price := askingPrice(p, c.Season)
		if club.Budget < price {
			return userErr("no_budget", "Not enough budget")
		}
		club.Budget -= price
		moveTo(p, &club.ID, shirt)
		homecoming(newRand(), p, club.ID) // a legend back at his old club
		if err := savePlayer(ctx, q, p); err != nil {
			return err
		}
		if p.TemplateID != nil {
			if _, err := q.Exec(ctx, `UPDATE templates SET signed=true WHERE id=$1`, *p.TemplateID); err != nil {
				return err
			}
		}
		if err := addFinance(ctx, q, c, "transfer_in", -price, p.Name); err != nil {
			return err
		}
		if err := questSignedYoung(ctx, q, careerID, p.Age); err != nil {
			return err
		}
		noteSigning(c, p, price)
		out = &SignResult{Player: p}
		// legend_versions.go: a legend version and his modern self at the club merge into one
		if out.Merged, err = signingMerge(ctx, q, c, club, p); err != nil {
			return err
		}
		if err := saveCareer(ctx, q, c); err != nil {
			return err
		}
		return saveClub(ctx, q, club)
	})
	return out, err
}

// QuickSell releases a player to the market for a guaranteed 70% of his value.
func (s *Store) QuickSell(ctx context.Context, careerID, playerID int) (int64, error) {
	var got int64
	err := s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		club, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		p, err := getPlayer(ctx, q, careerID, playerID)
		if err != nil {
			return err
		}
		if p.ClubID == nil || *p.ClubID != club.ID {
			return userErr("not_yours", "This player is not at your club")
		}
		// club_deadline.go: a Deadline Day bargain can't be released straight away for a profit
		if err := checkBargainHeld(ctx, q, careerID, p.ID); err != nil {
			return err
		}
		n, _, err := nextShirt(ctx, q, club.ID, nil)
		if err != nil {
			return err
		}
		if n <= MinSquad {
			return userErr("squad_min", "You need at least 14 players")
		}
		got = int64(float64(resalePrice(c, p))*QuickSellShare/10_000) * 10_000
		club.Budget += got
		moveTo(p, nil, 0)
		if err := savePlayer(ctx, q, p); err != nil {
			return err
		}
		if err := addFinance(ctx, q, c, "transfer_out", got, p.Name); err != nil {
			return err
		}
		return saveClub(ctx, q, club)
	})
	return got, err
}

func (s *Store) Hire(ctx context.Context, careerID, coachID int) error {
	return s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		club, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		cs, err := queryCoaches(ctx, q, `career_id=$1 AND id=$2`, careerID, coachID)
		if err != nil {
			return err
		}
		if len(cs) == 0 {
			return ErrNotFound
		}
		co := cs[0]
		if co.ClubID != nil {
			return userErr("coach_taken", "This coach already has a job")
		}
		if club.Budget < co.Price {
			return userErr("no_budget", "Not enough budget")
		}
		if _, err := q.Exec(ctx, `UPDATE coaches SET club_id=NULL WHERE club_id=$1 AND role=$2`, club.ID, co.Role); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `UPDATE coaches SET club_id=$1 WHERE id=$2`, club.ID, co.ID); err != nil {
			return err
		}
		club.Budget -= co.Price
		if err := addFinance(ctx, q, c, "staff_hire", -co.Price, co.Name); err != nil {
			return err
		}
		return saveClub(ctx, q, club)
	})
}

func (s *Store) Fire(ctx context.Context, careerID, coachID int) error {
	c, err := getCareer(ctx, s.DB, careerID)
	if err != nil {
		return err
	}
	tag, err := s.DB.Exec(ctx, `UPDATE coaches SET club_id=NULL WHERE career_id=$1 AND id=$2 AND club_id=$3`, careerID, coachID, c.UserClubID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return userErr("coach_not_yours", "This coach is not at your club")
	}
	return nil
}

// ---------------------------------------------------------------- lineup & training

type LineupReq struct {
	Formation string `json:"formation"`
	Lineup    []int  `json:"lineup"`
	Tactic    Tactic `json:"tactic"`
	Locked    *[]int `json:"locked"` // starters locked into their slots (lineup_lock.go); missing: the locks stay on whoever still starts
}

func (s *Store) SetLineup(ctx context.Context, careerID int, req LineupReq) error {
	roles, ok := Formations[req.Formation]
	if !ok {
		return userErr("bad_formation", "Unknown formation")
	}
	if len(req.Lineup) != len(roles) {
		return userErr("need_11", "Pick exactly 11 players")
	}
	return s.tx(ctx, func(q pgx.Tx) error {
		// queue behind a matchday being played: saving a career read before it would undo the day
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		club, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		squad, err := queryPlayers(ctx, q, `career_id=$1 AND club_id=$2`, careerID, club.ID)
		if err != nil {
			return err
		}
		own := map[int]*Player{}
		for _, p := range squad {
			own[p.ID] = p
		}
		// a rested player you put back in the side plays after all (lineup_lock.go)
		for _, id := range req.Lineup {
			delete(c.Care.Rest, id)
		}
		applyCare(c, squad) // who is cleared to play, rested, locked
		seen := map[int]bool{}
		for _, id := range req.Lineup {
			p := own[id]
			if p == nil {
				return userErr("not_yours", "This player is not at your club")
			}
			if p.Injury > 0 && !(p.Injury == 1 && c.Care.Rush[p.ID]) {
				return userErr("injured", "An injured player is in the lineup")
			}
			if seen[id] {
				return userErr("duplicate", "A player is picked twice")
			}
			seen[id] = true
		}
		if twoVersions(req.Lineup, own) { // legend_versions.go: one version of a legend per match
			return userErr("legend_twice", "Two versions of the same legend cannot play in one match")
		}
		req.Tactic.Normalize()
		if req.Formation != club.Formation {
			club.FormWeeks = 0
		}
		// the locks (lineup_lock.go): the ones sent (none sent: the ones there were), at their new slots
		ids := lockedIDs(c)
		if req.Locked != nil {
			ids = *req.Locked
		}
		locks := lockSlots(ids, req.Lineup, c.Care.Locked, Formations[club.Formation], roles, own)
		if c.Care.AutoXI {
			// the assistant picks around the locked starters. A hand-picked eleven with nothing locked switches
			// him off (a new shape alone keeps him on)
			held := map[int]int{}
			for id, s := range locks {
				held[s] = id
			}
			best := BestLineupHeld(squad, req.Formation, held)
			same := len(best) == len(req.Lineup)
			for i := range best {
				same = same && best[i] == req.Lineup[i]
			}
			if len(locks) == 0 && !same && req.Formation == club.Formation {
				c.Care.AutoXI = false
			} else {
				req.Lineup = best
			}
		}
		c.Care.Locked = locks
		for id := range c.Care.Rest {
			if _, ok := locks[id]; !ok {
				delete(c.Care.Rest, id) // unlocked: the assistant (or you) decides again
			}
		}
		if err := saveCareer(ctx, q, c); err != nil {
			return err
		}
		club.Formation, club.Lineup, club.Tactic = req.Formation, req.Lineup, req.Tactic
		return saveClub(ctx, q, club)
	})
}

type TrainingReq struct {
	Intensity string            `json:"intensity"`
	Focus     map[string]string `json:"focus"`
}

func (s *Store) SetTraining(ctx context.Context, careerID int, req TrainingReq) error {
	if req.Intensity != "light" && req.Intensity != "normal" && req.Intensity != "hard" {
		return userErr("bad_intensity", "Unknown training intensity")
	}
	return s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		c.Training.Intensity = req.Intensity
		if err := saveCareer(ctx, q, c); err != nil {
			return err
		}
		for pidStr, f := range req.Focus {
			pid, err := strconv.Atoi(pidStr)
			if err != nil {
				return userErr("bad_player", "Unknown player")
			}
			if f != "balanced" && !isAttr(f) {
				return userErr("bad_focus", "Unknown training focus")
			}
			if _, err := q.Exec(ctx, `UPDATE players SET focus=$1 WHERE career_id=$2 AND club_id=$3 AND id=$4`, f, careerID, c.UserClubID, pid); err != nil {
				return err
			}
		}
		return nil
	})
}

// ---------------------------------------------------------------- other clubs

type ClubView struct {
	Club      *Club      `json:"club"`
	Players   []*Player  `json:"players"`
	Rating    TeamRating `json:"rating"`
	Chemistry Chemistry  `json:"chemistry"`
	Coach     string     `json:"coach"`
}

func (s *Store) ClubInfo(ctx context.Context, careerID, clubID int) (*ClubView, error) {
	club, err := getClub(ctx, s.DB, clubID)
	if err != nil || club.CareerID != careerID {
		return nil, ErrNotFound
	}
	ps, err := queryPlayers(ctx, s.DB, `career_id=$1 AND club_id=$2 ORDER BY shirt`, careerID, clubID)
	if err != nil {
		return nil, err
	}
	cs, err := queryCoaches(ctx, s.DB, `career_id=$1 AND club_id=$2`, careerID, clubID)
	if err != nil {
		return nil, err
	}
	if club.IsUser {
		club.Lineup = resolveLineup(club, ps)
	} else {
		club.Lineup = BestLineup(ps, club.Formation)
	}
	st, roles := startersOf(club, ps)
	chem := TeamChemistry(st, club.Formation, club.FormWeeks, club.ID)
	head := ""
	for _, co := range cs {
		if co.Role == "head" {
			head = co.Name
		}
	}
	var user int
	_ = s.DB.QueryRow(ctx, `SELECT user_club_id FROM careers WHERE id=$1`, careerID).Scan(&user)
	redact(ps, user, userScoutSkill(ctx, s.DB, user))
	return &ClubView{Club: club, Players: ps, Rating: RateTeam(st, roles, club.Tactic, coachSkill(cs, "head"), chem.Team), Chemistry: chem, Coach: head}, nil
}

type ScoutRow struct {
	Player  *Player `json:"player"`
	Club    string  `json:"club"`
	ClubID  int     `json:"clubId"`
	League  string  `json:"league"`
	Starter bool    `json:"starter"`
}

// Scout lists players at computer-run clubs.
func (s *Store) Scout(ctx context.Context, careerID int, league, pos string) ([]ScoutRow, error) {
	car, err := getCareer(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	clubs, err := listClubs(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	byID := map[int]*Club{}
	for _, c := range clubs {
		byID[c.ID] = c
	}
	ps, err := queryPlayers(ctx, s.DB, `career_id=$1 AND club_id IS NOT NULL`, careerID)
	if err != nil {
		return nil, err
	}
	squads := map[int][]*Player{}
	for _, p := range ps {
		squads[*p.ClubID] = append(squads[*p.ClubID], p)
	}
	starters := map[int]bool{}
	for cid, sq := range squads {
		for _, id := range BestLineup(sq, byID[cid].Formation) {
			starters[id] = true
		}
	}
	out := []ScoutRow{}
	for _, p := range ps {
		cl := byID[*p.ClubID]
		if cl.IsUser || (league != "" && cl.League != league) || (pos != "" && p.Position != pos) {
			continue
		}
		p.Price = askingPrice(p, car.Season)
		out = append(out, ScoutRow{Player: p, Club: cl.Name, ClubID: cl.ID, League: cl.League, Starter: starters[p.ID]})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Player.Overall > out[j].Player.Overall })
	if len(out) > 200 {
		out = out[:200]
	}
	var user int
	_ = s.DB.QueryRow(ctx, `SELECT user_club_id FROM careers WHERE id=$1`, careerID).Scan(&user)
	sk := userScoutSkill(ctx, s.DB, user)
	for _, row := range out {
		redact([]*Player{row.Player}, user, sk)
	}
	return out, nil
}

// refreshStaff: famous unemployed coaches stay on the list; every other candidate is replaced by a
// fresh crop each matchday, three to six per role, now and then a real catch (skill 16–20).
func refreshStaff(ctx context.Context, q DBTX, r *rand.Rand, c *Career) error {
	famous := make([]string, 0, len(FreeCoaches))
	for _, fc := range FreeCoaches {
		famous = append(famous, fc.Name)
	}
	if _, err := q.Exec(ctx, `DELETE FROM coaches WHERE career_id=$1 AND club_id IS NULL AND NOT (name = ANY($2))`, c.ID, famous); err != nil {
		return err
	}
	for _, role := range CoachRoles {
		for i, n := 0, 3+r.Intn(4); i < n; i++ {
			skill := 8 + r.Intn(10)
			if r.Float64() < 0.15 {
				skill = 16 + r.Intn(5)
			}
			if err := insertCoach(ctx, q, c.ID, GenCoach(r, nil, role, skill)); err != nil {
				return err
			}
		}
	}
	return nil
}
