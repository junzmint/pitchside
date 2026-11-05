package game

import (
	"context"
	"sort"
)

// ---------------------------------------------------------------- the Legends wall
//
// A player who serves the club a long time can join its Legends wall while he still plays for the club:
// at the end of every season the fans choose one current player who has earned it (inductActive): about 150
// appearances, or five seasons, or a big haul of trophies. Icons, who never age, retire or get sold off, get
// there the same way. One a season keeps the wall special (a dominant side would otherwise put its whole XI
// up at once); anyone else with such a record joins when he leaves or retires (legendCheck).
//
// The shirt number: the club can retire it for a legend who is still with the club (he keeps wearing it and
// nobody else ever will: guardShirts moves anyone who gets it to a free number) or who retired here. A player
// who was sold or let go cannot have his number retired, and selling a legend whose number is retired gives
// the number back and angers the fans.

const (
	LegendApps      = 150
	LegendSeasons   = 5
	LegendTrophies  = 3
	MaxRetired      = 12 // retired shirt numbers
	LegendPerSeason = 1  // current players the fans put on the wall at the end of a season
)

type LegendEntry struct {
	PlayerID int    `json:"playerId"`
	Name     string `json:"name"`
	Nation   string `json:"nation"`
	Position string `json:"position"`
	Role     string `json:"role"`
	Shirt    int    `json:"shirt"`
	From     int    `json:"from"` // first season with the club
	To       int    `json:"to"`   // last season with the club
	Apps     int    `json:"apps"`
	Goals    int    `json:"goals"`
	Assists  int    `json:"assists"`
	Trophies int    `json:"trophies"`
	Overall  int    `json:"overall"`
	Reason   string `json:"reason"` // active (still with the club) | retired | sold | left
	Tag      string `json:"tag,omitempty"`
	Season   int    `json:"season"` // when he joined the wall
	Honour   string `json:"honour"` // the shirt number: "" waiting | retired | kept | none
}

// rosterChanges compares the squad with the last check: who arrived, who left, and what the fans
// and the Legends wall make of it. newSeason: StartNextSeason (real retirements happen there).
func (w *world) rosterChanges(ctx context.Context, q DBTX, life *ClubLife, squad []*Player, newSeason bool, rep *DayReport) ([]FanNote, error) {
	c := w.career
	es := &c.Events
	cur := map[int]*Player{}
	for _, p := range squad {
		cur[p.ID] = p
	}
	out := map[int]bool{}
	for _, d := range es.LoansOut {
		out[d.PlayerID] = true
	}
	borrowedNow := map[int]bool{}
	for _, d := range es.LoansIn {
		borrowedNow[d.PlayerID] = true
	}
	prev := map[int]RosterEntry{}
	var prevOvr []int
	for _, e := range life.Roster {
		prev[e.ID] = e
		if !e.Borrowed {
			prevOvr = append(prevOvr, e.Ovr)
		}
	}
	top3 := topOverall(prevOvr, 3)
	var notes []FanNote
	// departures
	for _, e := range life.Roster {
		if cur[e.ID] != nil || out[e.ID] || e.Borrowed {
			continue
		}
		p, err := getPlayer(ctx, q, c.ID, e.ID)
		if err != nil {
			continue // a free agent nobody remembers is gone from the game
		}
		reason := "sold"
		if p.ClubID == nil || p.Retired {
			reason = "left" // released (free agents with a record are archived as retired)
		}
		if newSeason && p.Retired && p.Age >= 35 {
			reason = "retired"
		}
		if e.ID == life.Fans.Fav {
			if reason == "retired" {
				notes = append(notes, FanNote{Key: "fav_retired", Name: p.Name})
			} else {
				notes = append(notes, FanNote{Key: "fav_sold", V: -10, Name: p.Name})
				w.clubHappen(rep, ComEvent{Key: "fans_fav_gone", Name: p.Name})
			}
		} else if reason != "retired" && float64(e.Ovr) >= top3-1 && e.Ovr >= 70 {
			notes = append(notes, FanNote{Key: "star_sold", V: -3, Name: p.Name})
		}
		if i := life.legendIdx(e.ID); i >= 0 && life.Legends[i].Reason == "active" {
			ns, err := w.legendLeaves(ctx, q, life, i, p, e, reason, e.ID == life.Fans.Fav, rep)
			if err != nil {
				return nil, err
			}
			notes = append(notes, ns...)
			continue
		}
		le, err := w.legendCheck(ctx, q, p, e, reason)
		if err != nil {
			return nil, err
		}
		if le != nil {
			life.addLegend(*le)
			notes = append(notes, FanNote{Key: "legend", Name: le.Name})
			w.clubHappen(rep, ComEvent{Key: "legend_wall", Name: le.Name, Amount: int64(le.Apps)})
		}
	}
	// arrivals: the fans love a big name
	if life.Joined == nil {
		life.Joined = map[int]int{}
	}
	for id := range life.Joined {
		if cur[id] == nil && !out[id] {
			delete(life.Joined, id)
		}
	}
	bonus := 0.0
	for _, p := range squad {
		if _, ok := prev[p.ID]; ok {
			continue
		}
		life.Joined[p.ID] = c.now()
		v, key := 0.0, ""
		switch {
		case p.Tag == "legend":
			v, key = 6, "legend_signed"
		case p.Overall >= 84 || (float64(p.Overall) >= top3-1 && p.Overall >= 72):
			v, key = 4, "star_signed"
		}
		if key == "" {
			continue
		}
		if borrowedNow[p.ID] {
			v /= 2
		}
		v = min(v, 8-bonus)
		if v <= 0 {
			continue
		}
		bonus += v
		notes = append(notes, FanNote{Key: key, V: v, Name: p.Name})
		w.clubHappen(rep, ComEvent{Key: "fans_" + key, Name: p.Name})
	}
	return notes, nil
}

// clubHappen: a notable club-life line, in the day report (when there is one) and in the club log.
func (w *world) clubHappen(rep *DayReport, ev ComEvent) {
	if rep != nil {
		rep.Happenings = append(rep.Happenings, ev)
	}
	w.logHappening(ev)
}

// legendCheck: does a departing player belong on the wall?
func (w *world) legendCheck(ctx context.Context, q DBTX, p *Player, e RosterEntry, reason string) (*LegendEntry, error) {
	c := w.career
	var apps, goals, assists, seasons, from, to int
	if err := q.QueryRow(ctx, `SELECT COALESCE(sum(apps),0), COALESCE(sum(goals),0), COALESCE(sum(assists),0), count(DISTINCT season),
		COALESCE(min(season),0), COALESCE(max(season),0) FROM player_stats WHERE player_id=$1 AND club_id=$2 AND comp <> 'friendly'`,
		p.ID, c.UserClubID).Scan(&apps, &goals, &assists, &seasons, &from, &to); err != nil {
		return nil, err
	}
	total := max(e.Tenure, apps) // tenure counts the years before the career started
	trophies := 0
	if seasons > 0 {
		if err := q.QueryRow(ctx, `SELECT COALESCE(sum((h.league_pos = 1)::int + (h.cup = 'W')::int + (h.cl = 'W')::int), 0)
			FROM season_history h WHERE h.career_id=$1 AND h.season IN (
				SELECT season FROM player_stats WHERE player_id=$2 AND club_id=$3 AND comp <> 'friendly' GROUP BY season HAVING sum(apps) >= 10)`,
			c.ID, p.ID, c.UserClubID).Scan(&trophies); err != nil {
			return nil, err
		}
	}
	if !legendWorthy(total, seasons, trophies) {
		return nil, nil
	}
	if from == 0 {
		from, to = c.Season, c.Season
	}
	le := &LegendEntry{PlayerID: p.ID, Name: p.Name, Nation: p.Nation, Position: p.Position, Role: NaturalRole(p), Shirt: e.Shirt,
		From: from, To: to, Apps: total, Goals: goals, Assists: assists, Trophies: trophies, Overall: max(e.Ovr, p.Overall),
		Reason: reason, Tag: p.Tag, Season: c.Season}
	if le.Shirt <= 0 || reason == "sold" || reason == "left" {
		le.Honour = "none" // only a player who stayed (or retired here) can have his number retired
	}
	return le, nil
}

// legendWorthy: has he done enough for the wall? total = appearances (counting the years before the career).
func legendWorthy(total, seasons, trophies int) bool {
	return total >= LegendApps || (seasons >= LegendSeasons && total >= 60) || (trophies >= LegendTrophies && total >= 40)
}

// legendNumbers: a player's record for the user's club (competitive matches only).
type legendNumbers struct {
	apps, goals, assists, seasons, from, to, trophies int
}

// legendStats reads the records of several players for the user's club in two queries.
func (w *world) legendStats(ctx context.Context, q DBTX, ids []int) (map[int]*legendNumbers, error) {
	c := w.career
	out := map[int]*legendNumbers{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT player_id, sum(apps)::int, sum(goals)::int, sum(assists)::int, count(DISTINCT season)::int,
		min(season), max(season) FROM player_stats WHERE player_id = ANY($1) AND club_id=$2 AND comp <> 'friendly' GROUP BY player_id`,
		ids, c.UserClubID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int
		n := &legendNumbers{}
		if err := rows.Scan(&id, &n.apps, &n.goals, &n.assists, &n.seasons, &n.from, &n.to); err != nil {
			rows.Close()
			return nil, err
		}
		out[id] = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// trophies: the club's titles in the seasons he played at least 10 games
	rows, err = q.Query(ctx, `SELECT x.player_id, COALESCE(sum((h.league_pos = 1)::int + (h.cup = 'W')::int + (h.cl = 'W')::int), 0)::int
		FROM (SELECT player_id, season FROM player_stats WHERE player_id = ANY($1) AND club_id=$2 AND comp <> 'friendly'
			GROUP BY player_id, season HAVING sum(apps) >= 10) x
		JOIN season_history h ON h.career_id=$3 AND h.season = x.season GROUP BY x.player_id`, ids, c.UserClubID, c.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		if s := out[id]; s != nil {
			s.trophies = n
		}
	}
	return out, rows.Err()
}

// inductActive keeps the numbers of the wall's active legends up to date (a legend who left and came back is
// one of ours again) and, at the end of a season (induct), puts the most deserving current player who has
// earned it on the wall: icons included, who never leave.
func (w *world) inductActive(ctx context.Context, q DBTX, life *ClubLife, squad []*Player, rep *DayReport, induct bool) ([]FanNote, error) {
	c := w.career
	var ids []int
	for _, p := range squad {
		if !w.isLoanee(p.ID) && !p.Retired {
			ids = append(ids, p.ID)
		}
	}
	stats, err := w.legendStats(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	type candidate struct {
		le    LegendEntry
		score int
	}
	var cands []candidate
	for _, p := range squad {
		if w.isLoanee(p.ID) || p.Retired {
			continue
		}
		s := stats[p.ID]
		if s == nil {
			s = &legendNumbers{}
		}
		total := max(p.Tenure, s.apps)
		if i := life.legendIdx(p.ID); i >= 0 {
			le := &life.Legends[i]
			if le.Reason != "active" {
				le.Reason = "active" // back at the club
				if le.Honour == "none" && p.Shirt > 0 {
					le.Honour = ""
				}
			}
			if le.Honour != "retired" {
				le.Shirt = p.Shirt
			}
			le.Apps, le.Goals, le.Assists, le.Trophies = max(le.Apps, total), max(le.Goals, s.goals), max(le.Assists, s.assists), max(le.Trophies, s.trophies)
			le.To, le.Overall = max(le.To, s.to, c.Season), max(le.Overall, p.Overall)
			continue
		}
		if !induct || !legendWorthy(total, s.seasons, s.trophies) {
			continue
		}
		from, to := s.from, c.Season
		if from == 0 {
			from = c.Season
		}
		le := LegendEntry{PlayerID: p.ID, Name: p.Name, Nation: p.Nation, Position: p.Position, Role: NaturalRole(p), Shirt: p.Shirt,
			From: from, To: to, Apps: total, Goals: s.goals, Assists: s.assists, Trophies: s.trophies, Overall: p.Overall,
			Reason: "active", Tag: p.Tag, Season: c.Season}
		if le.Shirt <= 0 {
			le.Honour = "none"
		}
		cands = append(cands, candidate{le, total + 20*s.trophies + 10*s.seasons})
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].score > cands[j].score })
	var notes []FanNote
	for i, cd := range cands {
		if i >= LegendPerSeason {
			break
		}
		life.addLegend(cd.le)
		notes = append(notes, FanNote{Key: "legend", Name: cd.le.Name})
		w.clubHappen(rep, ComEvent{Key: "legend_wall", Name: cd.le.Name, Amount: int64(cd.le.Apps)})
	}
	return notes, nil
}

// legendLeaves: a legend who was still playing for the club has gone. Retiring here keeps the honour of his
// number (or asks again, if it was kept in use); a sale or a release takes it back, and the fans hate a sale.
func (w *world) legendLeaves(ctx context.Context, q DBTX, life *ClubLife, i int, p *Player, e RosterEntry, reason string, fav bool, rep *DayReport) ([]FanNote, error) {
	le := &life.Legends[i]
	if fin, err := w.legendCheck(ctx, q, p, e, reason); err != nil {
		return nil, err
	} else if fin != nil { // his final numbers
		le.Apps, le.Goals, le.Assists, le.Trophies = max(le.Apps, fin.Apps), max(le.Goals, fin.Goals), max(le.Assists, fin.Assists), max(le.Trophies, fin.Trophies)
		le.To = max(le.To, fin.To)
	}
	le.Reason = reason
	if reason == "retired" {
		if le.Honour == "kept" {
			le.Honour = "" // he has hung up his boots: the question comes again
		}
		w.clubHappen(rep, ComEvent{Key: "legend_retired", Name: le.Name, Amount: int64(le.Apps)})
		return []FanNote{{Key: "legend_retired", V: 2, Name: le.Name}}, nil
	}
	v := -4.0
	if le.Honour == "retired" {
		v = -8
		le.Honour = "none"
		life.unretire(le.Shirt)
		w.clubHappen(rep, ComEvent{Key: "shirt_unretired", Name: le.Name, Amount: int64(le.Shirt)})
	} else if le.Shirt > 0 {
		le.Honour = "none"
	}
	if reason != "sold" {
		v /= 2 // let go: sad, but not a betrayal
	}
	if fav {
		v = 0 // the favourite's sale has its own (bigger) reaction already
	}
	return []FanNote{{Key: "legend_" + reason, V: v, Name: le.Name}}, nil
}

// legendIdx: where a player is on the wall, or -1.
func (life *ClubLife) legendIdx(pid int) int {
	for i := range life.Legends {
		if life.Legends[i].PlayerID == pid {
			return i
		}
	}
	return -1
}

// unretire puts a number back into use, unless it still honours another legend.
func (life *ClubLife) unretire(n int) {
	for _, le := range life.Legends {
		if le.Honour == "retired" && le.Shirt == n {
			return
		}
	}
	keep := life.Retired[:0]
	for _, x := range life.Retired {
		if x != n {
			keep = append(keep, x)
		}
	}
	life.Retired = keep
}

// tidyLegends: a legend who left (sold or let go) has no number decision waiting any more (saves from
// before this rule offered one).
func (life *ClubLife) tidyLegends() {
	for i := range life.Legends {
		if le := &life.Legends[i]; (le.Reason == "sold" || le.Reason == "left") && le.Honour == "" {
			le.Honour = "none"
		}
	}
}

// addLegend puts a player on the wall (again, if he came back and left once more).
func (life *ClubLife) addLegend(le LegendEntry) {
	ret := life.retiredSet()
	if _, ok := ret[le.Shirt]; ok && le.Honour == "" {
		le.Honour = "retired" // the number is already retired in someone's honour
	}
	keep := []LegendEntry{le}
	for _, x := range life.Legends {
		if x.PlayerID == le.PlayerID {
			if x.Honour == "retired" {
				keep[0].Honour = "retired"
			}
			continue
		}
		keep = append(keep, x)
	}
	if len(keep) > 40 {
		keep = keep[:40]
	}
	life.Legends = keep
}

// retiredSet: retired number → the legend who wore it.
func (life *ClubLife) retiredSet() map[int]int {
	out := map[int]int{}
	for _, n := range life.Retired {
		out[n] = 0
	}
	for _, le := range life.Legends {
		if le.Honour == "retired" {
			if _, ok := out[le.Shirt]; ok && out[le.Shirt] == 0 {
				out[le.Shirt] = le.PlayerID
			}
		}
	}
	return out
}

// guardShirts: anyone wearing a retired number (except the legend himself) gets the next free one.
func guardShirts(life *ClubLife, squad []*Player) []*Player {
	ret := life.retiredSet()
	if len(ret) == 0 {
		return nil
	}
	used := map[int]bool{}
	for _, p := range squad {
		used[p.Shirt] = true
	}
	var changed []*Player
	for _, p := range squad {
		owner, ok := ret[p.Shirt]
		if !ok || owner == p.ID {
			continue
		}
		s := p.Shirt
		for i := 0; i < 200; i++ {
			s++
			if s > 99 {
				s = 2
			}
			if _, bad := ret[s]; !bad && !used[s] {
				break
			}
		}
		used[s] = true
		p.Shirt = s
		changed = append(changed, p)
	}
	return changed
}

// freeShirt: the next number for a new signing, past the squad's highest, skipping retired ones.
func freeShirt(life *ClubLife, squad []*Player) int {
	ret := life.retiredSet()
	used := map[int]bool{}
	top := 0
	for _, p := range squad {
		used[p.Shirt] = true
		top = max(top, p.Shirt)
	}
	s := top
	for i := 0; i < 200; i++ {
		s++
		if s > 99 {
			s = 2
		}
		if _, bad := ret[s]; !bad && !used[s] {
			return s
		}
	}
	return top + 1
}

// honourLegend: retire his number, or keep it in use.
func (w *world) honourLegend(life *ClubLife, squad []*Player, pid int, choice string) ([]*Player, *LegendEntry, error) {
	var le *LegendEntry
	for i := range life.Legends {
		if life.Legends[i].PlayerID == pid {
			le = &life.Legends[i]
		}
	}
	if le == nil {
		return nil, nil, userErr("no_legend", "He is not on the Legends wall")
	}
	if le.Honour == "retired" {
		return nil, le, nil
	}
	if le.Reason == "sold" || le.Reason == "left" {
		return nil, nil, userErr("legend_left", "Only a legend who stayed with the club can have his number retired")
	}
	switch choice {
	case "retire":
		if le.Shirt <= 0 {
			return nil, nil, userErr("no_shirt", "He had no shirt number")
		}
		ret := life.retiredSet()
		if _, ok := ret[le.Shirt]; !ok {
			if len(life.Retired) >= MaxRetired {
				return nil, nil, userErr("retire_limit", "Too many numbers are retired already")
			}
			life.Retired = append(life.Retired, le.Shirt)
			sort.Ints(life.Retired)
		}
		le.Honour = "retired"
		w.logHappening(ComEvent{Key: "shirt_retired", Name: le.Name, Amount: int64(le.Shirt)})
		return guardShirts(life, squad), le, nil
	case "keep":
		le.Honour = "kept"
		return nil, le, nil
	}
	return nil, nil, userErr("bad_choice", "Unknown answer")
}
