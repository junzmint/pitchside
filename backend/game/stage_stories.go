package game

import (
	"context"
	"fmt"
	"sort"
	"time"
)

// ---------------------------------------------------------------- storylines
//
// After every matchday a few headlines are written about the world (news kind "story"): the title
// race, the relegation fight, winning and losing runs, the scoring race, giant-killings in the cup,
// managers under pressure and record transfers. The hub ticker shows the latest ones.
//
// Each storyline has a cooldown key so the same story isn't told every day; the news item's
// Story field names the type and Params carries the names and numbers for the headline text.

const storiesPerDay = 3

type storyCand struct {
	key  string  // cooldown key
	cool int     // matchdays before the same key may be told again (0: once per season, the key includes it)
	pri  float64 // higher first
	item NewsItem
}

func (w *world) storylines(ctx context.Context, q DBTX, st *StageState, rep *DayReport) error {
	c := w.career
	played := c.Day - 1 // the matchday just played
	if played < 1 || played > len(Calendar) {
		return nil
	}
	cd := Calendar[played-1]
	now := c.Season*100 + played
	user := w.byID[c.UserClubID]
	if user == nil {
		return nil
	}
	var cands []storyCand
	seasonEnd := rep != nil && rep.SeasonEnd != nil
	if cd.Comp == "league" && !seasonEnd {
		cands = append(cands, w.titleStories(cd.Round)...)
		cands = append(cands, w.relegationStories(cd.Round)...)
		cands = append(cands, w.pressureStories(st, cd.Round)...)
		if cd.Round >= 6 && cd.Round%6 == 0 {
			sc, err := w.scorerStory(ctx, q)
			if err != nil {
				return err
			}
			cands = append(cands, sc...)
		}
	}
	cands = append(cands, w.streakStories(played)...)
	if cd.Comp == "cup" {
		cands = append(cands, w.giantStories(played)...)
	}
	rec, err := w.recordStories(ctx, q, st)
	if err != nil {
		return err
	}
	cands = append(cands, rec...)
	limit := storiesPerDay
	if seasonEnd {
		cands = append(cands, w.championStories()...)
		limit = 4
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].pri > cands[j].pri })
	told := 0
	perType := map[string]int{} // a mix of stories: one of each type a day (two giant-killings, every champion)
	for _, sc := range cands {
		if told >= limit {
			break
		}
		if last, ok := st.Cool[sc.key]; ok && (sc.cool == 0 || now-last < sc.cool) {
			continue
		}
		if perType[sc.item.Story] >= storyCap(sc.item.Story) {
			continue
		}
		perType[sc.item.Story]++
		n := sc.item
		n.Season, n.Day, n.Kind, n.At = c.Season, played, "story", time.Now()
		if err := insertNews(ctx, q, c.ID, &n); err != nil {
			return err
		}
		st.Cool[sc.key] = now
		told++
		if rep != nil && n.Mine {
			rep.World = append(rep.World, n)
		}
	}
	for k, v := range st.Cool { // forget what is two seasons old
		if now-v > 200 {
			delete(st.Cool, k)
		}
	}
	return nil
}

// storyCap: how many stories of one type a matchday may carry.
func storyCap(story string) int {
	switch story {
	case "giant":
		return 2
	case "champions":
		return 4
	}
	return 1
}

// storyDivisions: the user's division first, then the top division of every country.
func (w *world) storyDivisions() [][2]any {
	user := w.byID[w.career.UserClubID]
	out := [][2]any{{user.League, user.Division}}
	for _, l := range Leagues {
		if l.Code == user.League && user.Division == 1 {
			continue
		}
		out = append(out, [2]any{l.Code, 1})
	}
	return out
}

func clubRef(cl *Club) (string, int) {
	if cl == nil {
		return "", 0
	}
	return cl.Name, cl.ID
}

// titleStories: who leads each title race, by how much, with how many games left.
func (w *world) titleStories(round int) []storyCand {
	if round < 10 {
		return nil
	}
	c := w.career
	var out []storyCand
	for i, ld := range w.storyDivisions() {
		code, div := ld[0].(string), ld[1].(int)
		t := divisionTable(w.clubs, w.fixtures, code, div)
		if len(t) < 2 {
			continue
		}
		a, b := t[0], t[1]
		left := 2*(len(t)-1) - a.P
		gap := a.Pts - b.Pts
		key := leagueKey(code, div)
		pri := 2.5
		if i == 0 {
			pri = 6
		}
		if left <= 5 {
			pri += 1
		}
		mine := a.IsUser || b.IsUser
		if mine {
			pri += 3
		}
		if left <= 0 {
			continue // decided: the champions' story tells it
		}
		an, aid := clubRef(w.byID[a.ClubID])
		bn, bid := clubRef(w.byID[b.ClubID])
		item := NewsItem{Story: "title", League: key, From: an, FromID: aid, To: bn, ToID: bid, Mine: mine, Big: i == 0 || mine,
			Params: map[string]any{"league": divisionName(code, div), "n": gap, "left": left, "pts": a.Pts}}
		switch {
		case gap > 3*left:
			item.Story = "title_won"
			out = append(out, storyCand{key: fmt.Sprintf("title_won:%s:%d", key, c.Season), pri: pri + 3, item: item})
		case gap == 0:
			item.Params["v"] = "level"
			out = append(out, storyCand{key: "title:" + key, cool: map[bool]int{true: 3, false: 6}[round >= 30], pri: pri, item: item})
		default:
			item.Params["v"] = "lead"
			out = append(out, storyCand{key: "title:" + key, cool: map[bool]int{true: 3, false: 6}[round >= 30], pri: pri, item: item})
		}
	}
	return out
}

// relegationStories: the fight to stay up in the user's division.
func (w *world) relegationStories(round int) []storyCand {
	user := w.byID[w.career.UserClubID]
	if round < 20 || user.Division >= Divisions {
		return nil
	}
	t := divisionTable(w.clubs, w.fixtures, user.League, user.Division)
	n := len(t)
	if n <= PromoteCount+1 {
		return nil
	}
	safe, drop := t[n-PromoteCount-1], t[n-PromoteCount]
	left := 2*(n-1) - drop.P
	gap := safe.Pts - drop.Pts
	mine := false
	for _, row := range t[n-PromoteCount-1:] {
		if row.IsUser {
			mine = true
		}
	}
	key := leagueKey(user.League, user.Division)
	pri := 5.0
	if mine {
		pri += 3
	}
	an, aid := clubRef(w.byID[drop.ClubID])
	bn, bid := clubRef(w.byID[safe.ClubID])
	v := "gap"
	if gap == 0 {
		v = "level"
	}
	out := []storyCand{{key: "releg:" + key, cool: map[bool]int{true: 3, false: 6}[round >= 32], pri: pri,
		item: NewsItem{Story: "relegation", League: key, From: an, FromID: aid, To: bn, ToID: bid, Mine: mine, Big: true,
			Params: map[string]any{"league": divisionName(user.League, user.Division), "n": gap, "left": left, "v": v}}}}
	// the bottom club can no longer catch the line
	bottom := t[n-1]
	if l2 := 2*(n-1) - bottom.P; l2 >= 0 && safe.Pts-bottom.Pts > 3*l2 {
		cn, cid := clubRef(w.byID[bottom.ClubID])
		out = append(out, storyCand{key: fmt.Sprintf("down:%d:%d", bottom.ClubID, w.career.Season), pri: pri + 1,
			item: NewsItem{Story: "relegated", League: key, From: cn, FromID: cid, Mine: bottom.IsUser, Big: true,
				Params: map[string]any{"league": divisionName(user.League, user.Division)}}})
	}
	return out
}

// pressureStories: the AI manager furthest below what his board expects (the user's division).
func (w *world) pressureStories(st *StageState, round int) []storyCand {
	if round < 8 {
		return nil
	}
	user := w.byID[w.career.UserClubID]
	t := divisionTable(w.clubs, w.fixtures, user.League, user.Division)
	var best *Club
	var bestPos, bestExp, bestGap int
	for i, row := range t {
		cl := w.byID[row.ClubID]
		if cl == nil || cl.IsUser {
			continue
		}
		pos, exp := i+1, st.Expect[cl.ID]
		if exp == 0 || pos <= len(t)/2 {
			continue
		}
		if g := pos - exp; g >= 6 && g > bestGap {
			best, bestPos, bestExp, bestGap = cl, pos, exp, g
		}
	}
	if best == nil {
		return nil
	}
	head := headCoachOf(w.coaches[best.ID])
	if head == nil {
		return nil
	}
	return []storyCand{{key: fmt.Sprintf("press:%d", best.ID), cool: 15, pri: 4 + float64(bestGap)/4,
		item: NewsItem{Story: "pressure", League: leagueKey(user.League, user.Division), From: best.Name, FromID: best.ID, Coach: head.Name,
			Params: map[string]any{"pos": bestPos, "exp": bestExp}}}}
}

// scorerStory: the scoring race in the user's division.
func (w *world) scorerStory(ctx context.Context, q DBTX) ([]storyCand, error) {
	c := w.career
	user := w.byID[c.UserClubID]
	rows, err := q.Query(ctx, `SELECT s.player_id, p.name, s.club_id, s.goals FROM player_stats s JOIN players p ON p.id=s.player_id
		JOIN clubs k ON k.id=s.club_id WHERE s.career_id=$1 AND s.season=$2 AND s.comp='league' AND k.league=$3 AND k.division=$4
		ORDER BY s.goals DESC, s.apps ASC LIMIT 2`, c.ID, c.Season, user.League, user.Division)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type sc struct {
		id, club, goals int
		name            string
	}
	var top []sc
	for rows.Next() {
		var x sc
		if err := rows.Scan(&x.id, &x.name, &x.club, &x.goals); err != nil {
			return nil, err
		}
		top = append(top, x)
	}
	if err := rows.Err(); err != nil || len(top) < 2 || top[0].goals < 5 {
		return nil, err
	}
	a, b := top[0], top[1]
	an, aid := clubRef(w.byID[a.club])
	mine := a.club == user.ID || b.club == user.ID
	pri := 3.5
	if mine {
		pri += 3
	}
	v := "lead"
	if a.goals == b.goals {
		v = "level"
	}
	key := leagueKey(user.League, user.Division)
	return []storyCand{{key: "scorers:" + key, cool: 6, pri: pri,
		item: NewsItem{Story: "scorers", League: key, Player: a.name, PlayerID: a.id, From: an, FromID: aid, Mine: mine,
			Params: map[string]any{"league": divisionName(user.League, user.Division), "n": a.goals, "gap": a.goals - b.goals, "b": b.name, "v": v}}}}, nil
}

// streakStories: clubs on a run of wins or defeats (all competitions) that just reached a milestone.
func (w *world) streakStories(played int) []storyCand {
	c := w.career
	user := w.byID[c.UserClubID]
	watch := map[int]float64{} // club → priority
	for _, cl := range w.clubs {
		switch {
		case cl.IsUser:
			watch[cl.ID] = 8
		case cl.League == user.League && cl.Division == user.Division:
			watch[cl.ID] = 4
		case cl.Division == 1:
			watch[cl.ID] = 2.5
		}
	}
	runs := map[int][]byte{} // club → results in order (W/D/L)
	last := map[int]int{}
	for _, f := range w.fixtures {
		if !f.Played || f.Comp == "friendly" || f.Day > played {
			continue
		}
		for _, id := range []int{f.HomeID, f.AwayID} {
			if _, ok := watch[id]; !ok {
				continue
			}
			res := byte('D')
			if win := f.WinnerID(); win == id {
				res = 'W'
			} else if win != 0 {
				res = 'L'
			}
			runs[id] = append(runs[id], res)
			last[id] = f.Day
		}
	}
	milestone := map[int]bool{5: true, 7: true, 10: true, 15: true, 20: true}
	var out []storyCand
	for id, rs := range runs {
		if last[id] != played || len(rs) == 0 {
			continue // only clubs that played today: their run just grew
		}
		end := rs[len(rs)-1]
		if end == 'D' {
			continue
		}
		n := 0
		for i := len(rs) - 1; i >= 0 && rs[i] == end; i-- {
			n++
		}
		if !milestone[n] || (end == 'L' && n > 10) || (watch[id] < 4 && n < 7) {
			continue // abroad, only the long runs make the news
		}
		cl := w.byID[id]
		v := "wins"
		if end == 'L' {
			v = "losses"
		}
		out = append(out, storyCand{key: fmt.Sprintf("run:%d:%c:%d:%d", id, end, n, c.Season), pri: watch[id] + float64(n)/5,
			item: NewsItem{Story: "streak", League: leagueKey(cl.League, cl.Division), From: cl.Name, FromID: cl.ID, Mine: cl.IsUser, Big: cl.IsUser,
				Params: map[string]any{"n": n, "v": v}}})
	}
	return out
}

// giantStories: lower-league clubs knocking bigger ones out of a domestic cup today.
func (w *world) giantStories(played int) []storyCand {
	c := w.career
	user := w.byID[c.UserClubID]
	var out []storyCand
	for _, f := range w.fixtures {
		if f.Day != played || f.Comp != "cup" || !f.Played {
			continue
		}
		win := w.byID[f.WinnerID()]
		if win == nil {
			continue
		}
		loseID := f.HomeID
		if win.ID == f.HomeID {
			loseID = f.AwayID
		}
		lose := w.byID[loseID]
		if lose == nil || win.Division <= lose.Division {
			continue
		}
		size := float64(win.Division-lose.Division) + float64(lose.Reputation-win.Reputation)/10
		if size < 1.5 {
			continue
		}
		pri := 4 + size
		if f.League == user.League {
			pri += 2
		}
		mine := win.IsUser || lose.IsUser
		if mine {
			pri += 4
		}
		gw, gl := *f.HomeGoals, *f.AwayGoals
		if win.ID == f.AwayID {
			gw, gl = gl, gw
		}
		params := map[string]any{"div": win.Division, "stage": f.Stage, "score": fmt.Sprintf("%d-%d", gw, gl), "cup": f.League}
		if f.PensH != nil && f.PensA != nil {
			ph, pa := *f.PensH, *f.PensA
			if win.ID == f.AwayID {
				ph, pa = pa, ph
			}
			params["pens"] = fmt.Sprintf("%d-%d", ph, pa)
		}
		out = append(out, storyCand{key: fmt.Sprintf("giant:%d", f.ID), pri: pri,
			item: NewsItem{Story: "giant", League: f.League, From: win.Name, FromID: win.ID, To: lose.Name, ToID: lose.ID, Mine: mine, Big: true, Params: params}})
	}
	return out
}

// recordStories: a transfer that beats the world's record fee. Every transfer written to the news
// since the last look counts: the AI windows here and deals made by other parts of the game.
func (w *world) recordStories(ctx context.Context, q DBTX, st *StageState) ([]storyCand, error) {
	c := w.career
	if st.NewsSeen == 0 { // first look: remember the record so far, tell nothing
		var fee *int64
		if err := q.QueryRow(ctx, `SELECT max((data->>'fee')::bigint), COALESCE(max(id), 0) FROM news WHERE career_id=$1 AND kind='transfer'`, c.ID).
			Scan(&fee, &st.NewsSeen); err != nil {
			return nil, err
		}
		st.RecordFee = 50 * M
		if fee != nil && *fee > st.RecordFee {
			st.RecordFee = *fee
		}
		if st.NewsSeen == 0 {
			st.NewsSeen = -1 // nothing yet: every transfer from now on is new
		}
		return nil, nil
	}
	rows, err := q.Query(ctx, `SELECT id, data FROM news WHERE career_id=$1 AND kind='transfer' AND id > $2 ORDER BY id`, c.ID, max(st.NewsSeen, 0))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var best NewsItem
	for rows.Next() {
		var n NewsItem
		var id int64
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		n.ID = id
		st.NewsSeen = max(st.NewsSeen, id)
		if n.Fee > best.Fee {
			best = n
		}
	}
	if err := rows.Err(); err != nil || best.Fee <= st.RecordFee {
		return nil, err
	}
	prev := st.RecordFee
	st.RecordFee = best.Fee
	item := NewsItem{Story: "record", Player: best.Player, PlayerID: best.PlayerID, Ovr: best.Ovr, Age: best.Age, From: best.From, FromID: best.FromID,
		To: best.To, ToID: best.ToID, Fee: best.Fee, Big: true, Params: map[string]any{"prev": prev}}
	return []storyCand{{key: fmt.Sprintf("record:%d", best.ID), pri: 7, item: item}}, nil
}

// championStories: the season's champions (the user's division and every top division).
func (w *world) championStories() []storyCand {
	c := w.career
	var out []storyCand
	for i, ld := range w.storyDivisions() {
		code, div := ld[0].(string), ld[1].(int)
		t := divisionTable(w.clubs, w.fixtures, code, div)
		if len(t) == 0 {
			continue
		}
		a := t[0]
		cl := w.byID[a.ClubID]
		if cl == nil {
			continue
		}
		pri := 4.0
		if i == 0 {
			pri = 7
		}
		if a.IsUser {
			pri += 3
		}
		key := leagueKey(code, div)
		out = append(out, storyCand{key: fmt.Sprintf("champs:%s:%d", key, c.Season), pri: pri,
			item: NewsItem{Story: "champions", League: key, From: cl.Name, FromID: cl.ID, Mine: a.IsUser, Big: true,
				Params: map[string]any{"league": divisionName(code, div), "pts": a.Pts}}})
	}
	return out
}

// summerStories: the summer window's record deal, told when the new season starts.
func (w *world) summerStories(ctx context.Context, q DBTX) error {
	c := w.career
	st, err := loadStage(ctx, q, c.ID)
	if err != nil {
		return err
	}
	cands, err := w.recordStories(ctx, q, st)
	if err != nil {
		return err
	}
	for _, sc := range cands {
		n := sc.item
		n.Season, n.Day, n.Kind, n.At = c.Season, 0, "story", time.Now()
		if err := insertNews(ctx, q, c.ID, &n); err != nil {
			return err
		}
		st.Cool[sc.key] = c.Season * 100
	}
	return saveStage(ctx, q, c.ID, st)
}
