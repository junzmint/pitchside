package game

import (
	"context"
	"sort"
)

// ---------------------------------------------------------------- the Legends wall
//
// A player who served the club a long time joins its Legends wall when he retires or leaves:
// about 150 appearances, or five seasons, or a big haul of trophies. The club can then retire his
// shirt number: nobody else will wear it (guardShirts moves anyone who gets it to a free number).

const (
	LegendApps     = 150
	LegendSeasons  = 5
	LegendTrophies = 3
	MaxRetired     = 12 // retired shirt numbers
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
	Reason   string `json:"reason"` // retired | sold | left
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
	if !(total >= LegendApps || (seasons >= LegendSeasons && total >= 60) || (trophies >= LegendTrophies && total >= 40)) {
		return nil, nil
	}
	if from == 0 {
		from, to = c.Season, c.Season
	}
	le := &LegendEntry{PlayerID: p.ID, Name: p.Name, Nation: p.Nation, Position: p.Position, Role: NaturalRole(p), Shirt: e.Shirt,
		From: from, To: to, Apps: total, Goals: goals, Assists: assists, Trophies: trophies, Overall: max(e.Ovr, p.Overall),
		Reason: reason, Tag: p.Tag, Season: c.Season}
	if le.Shirt <= 0 {
		le.Honour = "none"
	}
	return le, nil
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
