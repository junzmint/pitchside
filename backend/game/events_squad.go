package game

import (
	"context"
	"math"
	"math/rand"
	"sort"
)

// ---------------------------------------------------------------- playing time

const (
	BenchLimit     = 5 // competitive matches in a row without playing before a good player asks why
	TalkDays       = 3 // matchdays to answer him
	PromiseNeed    = 2 // starts he is promised…
	PromiseWindow  = 3 // …within this many matches
	TalksPerSeason = 4 // at most this many playing-time talks a season
)

// Talk: a player who wants to play more.
type Talk struct {
	ID       int    `json:"id"`
	PlayerID int    `json:"playerId"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Overall  int    `json:"overall"`
	Benched  int    `json:"benched"`
	Until    int    `json:"until"`
}

// Promise: start him in Need of the next Left matches.
type Promise struct {
	PlayerID int    `json:"playerId"`
	Name     string `json:"name"`
	Need     int    `json:"need"`
	Got      int    `json:"got"`
	Left     int    `json:"left"`
}

func (es *EventState) talkFor(pid int) int {
	for i, t := range es.Talks {
		if t.PlayerID == pid {
			return i
		}
	}
	return -1
}

func (es *EventState) promiseFor(pid int) int {
	for i, p := range es.Promises {
		if p.PlayerID == pid {
			return i
		}
	}
	return -1
}

func (w *world) isLoanee(pid int) bool {
	for _, l := range w.career.Events.LoansIn {
		if l.PlayerID == pid {
			return true
		}
	}
	return false
}

// countBench: who played, who sat out, and whether promises were kept.
func (w *world) countBench(uo *matchOutcome, rep *DayReport) {
	c := w.career
	es := &c.Events
	user := w.byID[c.UserClubID]
	inXI := map[int]bool{}
	for _, id := range user.Lineup {
		inXI[id] = true
	}
	for _, p := range w.userSquad() {
		if _, ok := uo.ratings[p.ID]; ok {
			es.Bench[p.ID] = 0
		} else if available(p) {
			es.Bench[p.ID]++
		}
	}
	keep := es.Promises[:0]
	for _, pr := range es.Promises {
		p := w.mine(pr.PlayerID)
		if p == nil {
			continue
		}
		pr.Left--
		if _, played := uo.ratings[p.ID]; played && inXI[p.ID] {
			pr.Got++
		}
		switch {
		case pr.Got >= pr.Need:
			p.Morale = clamp(p.Morale+6, 20, 100)
			es.Quiet[p.ID] = c.now() + 20
			w.happen(rep, "promise_kept", p.Name, 0)
		case pr.Got+pr.Left < pr.Need:
			p.Morale = clamp(p.Morale-18, 20, 100)
			w.squadMorale(-2) // the dressing room notices
			es.Quiet[p.ID] = c.now() + 15
			if rand.Float64() < 0.3 {
				es.Listed[p.ID] = c.now() + 10 // he wants out
				w.happen(rep, "promise_broken_out", p.Name, 0)
			} else {
				w.happen(rep, "promise_broken", p.Name, 0)
			}
		default:
			keep = append(keep, pr)
		}
	}
	es.Promises = keep
}

// talkCut: the overall a player needs to think he deserves a starting place.
func talkCut(squad []*Player) int {
	ovr := make([]int, 0, len(squad))
	for _, p := range squad {
		ovr = append(ovr, p.Overall)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(ovr)))
	if len(ovr) < 12 {
		return 999
	}
	return ovr[10] - 1
}

func (w *world) newTalks(r *rand.Rand, rep *DayReport) {
	c := w.career
	es := &c.Events
	if es.TalkSeason != c.Season {
		es.TalkSeason, es.TalksMade = c.Season, 0
	}
	if len(es.Talks) > 0 || c.Day > len(Calendar) || es.TalksMade >= TalksPerSeason {
		return
	}
	squad := w.userSquad()
	cut := talkCut(squad)
	// the weakest starter in each position: a player only complains if he is about as good
	user := w.byID[c.UserClubID]
	xi := map[int]bool{}
	for _, id := range user.Lineup {
		xi[id] = true
	}
	worst := map[string]int{}
	for _, p := range squad {
		if xi[p.ID] {
			if v, ok := worst[p.Position]; !ok || p.Overall < v {
				worst[p.Position] = p.Overall
			}
		}
	}
	var best *Player
	for _, p := range squad {
		ws, ok := worst[p.Position]
		if !ok || p.Overall < ws-3 {
			continue
		}
		if es.Bench[p.ID] < BenchLimit || p.Overall < cut-2 || p.Age < 18 || !available(p) || w.isLoanee(p.ID) ||
			es.Quiet[p.ID] > c.now() || es.Listed[p.ID] > c.now() || es.promiseFor(p.ID) >= 0 {
			continue
		}
		if best == nil || p.Overall > best.Overall {
			best = p
		}
	}
	if best == nil || r.Float64() > 0.45 {
		return
	}
	es.TalksMade++
	es.Talks = append(es.Talks, Talk{ID: es.nextID(), PlayerID: best.ID, Name: best.Name, Role: best.Role, Overall: best.Overall,
		Benched: es.Bench[best.ID], Until: c.Day + TalkDays})
	w.happen(rep, "talk_new", best.Name, 0)
}

// answerTalk: promise him games, tell him to be patient, or put him up for sale.
func (w *world) answerTalk(t Talk, choice string, rep *DayReport) error {
	c := w.career
	es := &c.Events
	p := w.mine(t.PlayerID)
	if p == nil {
		return nil
	}
	switch choice {
	case "promise":
		p.Morale = clamp(p.Morale+6, 20, 100)
		es.Promises = append(es.Promises, Promise{PlayerID: p.ID, Name: p.Name, Need: PromiseNeed, Left: PromiseWindow})
		w.happen(rep, "talk_promise", p.Name, 0)
	case "wait", "timeout":
		d := -6.0
		if choice == "timeout" {
			d = -10
		}
		p.Morale = clamp(p.Morale+d, 20, 100)
		es.Quiet[p.ID] = c.now() + 8
		es.Bench[p.ID] = 2
		w.happen(rep, "talk_"+choice, p.Name, 0)
	case "sell":
		p.Morale = clamp(p.Morale+2, 20, 100)
		es.Listed[p.ID] = c.now() + 8
		es.Quiet[p.ID] = c.now() + 20
		w.happen(rep, "talk_sell", p.Name, 0)
	default:
		return userErr("bad_choice", "Unknown answer")
	}
	return nil
}

func (w *world) expireTalks(rep *DayReport) {
	es := &w.career.Events
	keep := []Talk{}
	for _, t := range es.Talks {
		if w.career.Day <= t.Until {
			keep = append(keep, t)
			continue
		}
		_ = w.answerTalk(t, "timeout", rep)
	}
	es.Talks = keep
}

// forgetDeparted runs on every load, so nothing waits in the inbox about a player who has just been sold,
// swapped, released or loaned out: his playing-time talk, a promise to him and bids for him (tidyEvents),
// and the staff room's cards, promises and mentoring about him. (The matchday tick did this only the next day.)
func (w *world) forgetDeparted() {
	w.tidyEvents()
	st := w.crew
	if st == nil {
		return
	}
	have := map[int]bool{}
	for _, p := range w.userSquad() {
		have[p.ID] = true
	}
	keepD := st.Decisions[:0]
	for _, d := range st.Decisions {
		if d.PlayerID == 0 || have[d.PlayerID] {
			keepD = append(keepD, d)
		}
	}
	st.Decisions = keepD
	keepP := st.Promises[:0]
	for _, pr := range st.Promises {
		if pr.PlayerID == 0 || have[pr.PlayerID] {
			keepP = append(keepP, pr)
		}
	}
	st.Promises = keepP
	for pid := range st.Mentees {
		if !have[pid] {
			delete(st.Mentees, pid)
		}
	}
}

// tidyEvents forgets players who have left the club.
func (w *world) tidyEvents() {
	c := w.career
	es := &c.Events
	have := map[int]bool{}
	for _, p := range w.userSquad() {
		have[p.ID] = true
	}
	if es.Captain != 0 && !have[es.Captain] {
		es.Captain = 0
	}
	keepT := es.Talks[:0]
	for _, t := range es.Talks {
		if have[t.PlayerID] {
			keepT = append(keepT, t)
		}
	}
	es.Talks = keepT
	keepP := es.Promises[:0]
	for _, p := range es.Promises {
		if have[p.PlayerID] {
			keepP = append(keepP, p)
		}
	}
	es.Promises = keepP
	keepB := es.Bids[:0]
	for _, b := range es.Bids {
		if have[b.PlayerID] {
			keepB = append(keepB, b)
		}
	}
	es.Bids = keepB
	for id := range es.Bench {
		if !have[id] {
			delete(es.Bench, id)
		}
	}
	for id, until := range es.Listed {
		if !have[id] || until <= c.now() {
			delete(es.Listed, id)
		}
	}
	for id, until := range es.Quiet {
		if until <= c.now() {
			delete(es.Quiet, id)
		}
	}
}

// ---------------------------------------------------------------- youth intake day

const YouthDay = 20 // after this matchday the academy presents its new class

type Prospect struct {
	ID     int     `json:"id"`
	Player *Player `json:"player"`
	Est    int     `json:"est"` // the academy's estimate of his potential
}

type YouthIntake struct {
	Season    int        `json:"season"`
	Until     int        `json:"until"`
	Prospects []Prospect `json:"prospects"`
}

func (w *world) youthTick(r *rand.Rand, rep *DayReport, played int) error {
	c := w.career
	es := &c.Events
	if es.Youth != nil && c.Day > es.Youth.Until {
		if n := len(es.Youth.Prospects); n > 0 {
			w.happen(rep, "youth_gone", "", int64(n))
		}
		es.Youth = nil
	}
	if played != YouthDay || es.YouthSeason == c.Season {
		return nil
	}
	es.YouthSeason = c.Season
	user := w.byID[c.UserClubID]
	lvl := max(1, user.Academy)
	base := divisionLevel(user.League, user.Division)
	n := 3 + r.Intn(3)
	yi := &YouthIntake{Season: c.Season, Until: c.Day + 5}
	pk := managerPerks(es.Level)
	for i := 0; i < n; i++ {
		pos := []string{"GK", "DF", "DF", "MF", "MF", "FW", "FW"}[r.Intn(7)]
		p := GenPlayer(r, nationsOf(user.League), pos, base-13+float64(lvl)*1.5+r.Float64()*5, 16, 17)
		p.Potential = int(math.Min(95, float64(p.Potential)+float64(lvl*3+pk.YouthBonus)+r.Float64()*4))
		if r.Float64() < 0.04*float64(lvl) { // now and then a real gem
			p.Potential = int(math.Min(97, float64(p.Potential)+6))
		}
		p.Fill()
		fuzz := 7 - lvl
		est := p.Potential + r.Intn(2*fuzz+1) - fuzz
		yi.Prospects = append(yi.Prospects, Prospect{ID: es.nextID(), Player: p, Est: min(99, est)})
	}
	es.Youth = yi
	w.happen(rep, "youth_day", "", int64(n))
	return nil
}

func (w *world) youthAnswer(ctx context.Context, q DBTX, id int, choice string) error {
	c := w.career
	es := &c.Events
	if es.Youth == nil {
		return userErr("no_youth", "There is no youth intake right now")
	}
	idx := -1
	for i, p := range es.Youth.Prospects {
		if p.ID == id {
			idx = i
		}
	}
	if idx < 0 {
		return userErr("no_prospect", "This prospect has gone")
	}
	pr := es.Youth.Prospects[idx]
	if choice == "sign" {
		user := w.byID[c.UserClubID]
		squad := w.userSquad()
		if len(squad) >= MaxSquad {
			return userErr("squad_full", "Your squad is full")
		}
		shirt := 30
		for _, x := range squad {
			if x.Shirt >= shirt {
				shirt = x.Shirt + 1
			}
		}
		p := pr.Player
		moveTo(p, &user.ID, shirt)
		p.Fill()
		if err := insertPlayer(ctx, q, c.ID, p); err != nil {
			return err
		}
		w.players[user.ID] = append(w.players[user.ID], p)
		if err := questSignedYoung(ctx, q, c.ID, p.Age); err != nil {
			return err
		}
		w.logHappening(ComEvent{Key: "youth_signed", Name: p.Name})
	} else if choice != "release" {
		return userErr("bad_choice", "Unknown answer")
	}
	es.Youth.Prospects = append(es.Youth.Prospects[:idx], es.Youth.Prospects[idx+1:]...)
	if len(es.Youth.Prospects) == 0 {
		es.Youth = nil
	}
	return nil
}

// ---------------------------------------------------------------- international breaks

var BreakDays = []int{12, 28, 44} // the matchdays after which national teams meet

func isBreak(day int) bool {
	for _, d := range BreakDays {
		if d == day {
			return true
		}
	}
	return false
}

func nextBreak(day int) int {
	for _, d := range BreakDays {
		if d >= day {
			return d
		}
	}
	return 0
}

// internationalBreak: the best players join their national teams. They come back tired, now and
// then hurt, but proud (morale) and with their stock up.
func (w *world) internationalBreak(r *rand.Rand, rep *DayReport, played int) {
	if !isBreak(played) {
		return
	}
	var cands []*Player
	for _, p := range w.userSquad() {
		if p.Injury == 0 && p.Overall >= 66 && !w.isLoanee(p.ID) {
			cands = append(cands, p)
		}
	}
	sort.Slice(cands, func(i, j int) bool { return cands[i].Overall > cands[j].Overall })
	n := 0
	for _, p := range cands {
		if n >= 4 || (n >= 2 && p.Overall < 72) {
			break
		}
		n++
		p.Fitness = math.Max(40, p.Fitness-12)
		p.Morale = clamp(p.Morale+5, 20, 100)
		if !isLegend(p) && p.Age <= 25 && p.Potential < potentialCap(p) && r.Float64() < 0.3 {
			p.Potential++
		}
		if r.Float64() < 0.06 {
			p.Injury = 1 + r.Intn(2)
			rep.Injuries = append(rep.Injuries, InjuryNote{Name: p.Name, Weeks: p.Injury})
			w.happen(rep, "intl_injury", p.Name, int64(p.Injury))
		} else {
			w.happen(rep, "intl_call", p.Name, 0)
		}
		p.Fill()
	}
	if n == 0 {
		w.happen(rep, "intl_none", "", 0)
	}
}

// ---------------------------------------------------------------- awards

const AwardEvery = 9 // a player of the month every nine matchdays

type Award struct {
	Season   int     `json:"season"`
	Day      int     `json:"day"`
	Kind     string  `json:"kind"` // potm | best | scorer | young | tots
	PlayerID int     `json:"playerId"`
	Name     string  `json:"name"`
	Club     string  `json:"club"`
	ClubID   int     `json:"clubId"`
	Pos      string  `json:"pos"`
	Value    float64 `json:"value"` // average rating or goals
	Mine     bool    `json:"mine"`
}

type awardRow struct {
	id, club, age, apps, goals, assists int
	name, pos                           string
	ratingSum                           float64
}

func (a awardRow) avg() float64 { return a.ratingSum / math.Max(1, float64(a.apps)) }

// divisionStats: league numbers this season for every player in the user's division.
func (w *world) divisionStats(ctx context.Context, q DBTX) ([]awardRow, error) {
	c := w.career
	user := w.byID[c.UserClubID]
	var ids []int32
	for _, cl := range w.clubs {
		if cl.League == user.League && cl.Division == user.Division {
			ids = append(ids, int32(cl.ID))
		}
	}
	rows, err := q.Query(ctx, `SELECT s.player_id, p.name, p.position, p.age, s.club_id, s.apps, s.goals, s.assists, s.rating_sum
		FROM player_stats s JOIN players p ON p.id=s.player_id
		WHERE s.career_id=$1 AND s.season=$2 AND s.comp='league' AND s.club_id = ANY($3) AND s.apps > 0`, c.ID, c.Season, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []awardRow
	for rows.Next() {
		var a awardRow
		var rs float32
		if err := rows.Scan(&a.id, &a.name, &a.pos, &a.age, &a.club, &a.apps, &a.goals, &a.assists, &rs); err != nil {
			return nil, err
		}
		a.ratingSum = float64(rs)
		out = append(out, a)
	}
	return out, rows.Err()
}

func (w *world) giveAward(a awardRow, kind string, value float64, rep *DayReport) Award {
	c := w.career
	es := &c.Events
	cl := w.byID[a.club]
	aw := Award{Season: c.Season, Day: min(c.Day, len(Calendar)), Kind: kind, PlayerID: a.id, Name: a.name, ClubID: a.club, Pos: a.pos,
		Value: math.Round(value*100) / 100, Mine: a.club == c.UserClubID}
	if cl != nil {
		aw.Club = cl.Name
	}
	es.Awards = append([]Award{aw}, es.Awards...)
	if len(es.Awards) > 40 {
		es.Awards = es.Awards[:40]
	}
	if aw.Mine {
		if p := w.mine(a.id); p != nil {
			boost := map[string]float64{"potm": 8, "best": 10, "scorer": 10, "young": 10, "tots": 5}[kind]
			p.Morale = clamp(p.Morale+boost, 20, 100)
			if kind != "tots" && !isLegend(p) && p.Potential < potentialCap(p) {
				p.Potential++ // the award puts his price up
				p.Fill()
			}
		}
		w.addXP(map[string]int{"potm": 10, "best": 25, "scorer": 20, "young": 20, "tots": 5}[kind], rep)
	}
	if kind != "tots" {
		key := "award_" + kind
		if aw.Mine {
			key += "_mine"
		}
		w.happen(rep, key, a.name+" ("+aw.Club+")", 0)
	}
	return aw
}

func (w *world) playerOfMonth(ctx context.Context, q DBTX, rep *DayReport) error {
	rows, err := w.divisionStats(ctx, q)
	if err != nil {
		return err
	}
	c := w.career
	won := map[int]bool{}
	for _, a := range c.Events.Awards {
		if a.Season == c.Season && a.Kind == "potm" {
			won[a.PlayerID] = true
		}
	}
	minApps := 3
	var best *awardRow
	bestS := -1.0
	for i := range rows {
		a := &rows[i]
		if a.apps < minApps || won[a.id] {
			continue
		}
		s := a.avg() + 0.06*float64(a.goals) + 0.04*float64(a.assists) + 0.01*float64(a.apps)
		if s > bestS {
			best, bestS = a, s
		}
	}
	if best != nil {
		w.giveAward(*best, "potm", best.avg(), rep)
	}
	return nil
}

// seasonAwards: player of the season, top scorer, young player and the team of the season.
func (w *world) seasonAwards(ctx context.Context, q DBTX, rep *DayReport) error {
	rows, err := w.divisionStats(ctx, q)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return nil
	}
	pick := func(ok func(a awardRow) bool, score func(a awardRow) float64) *awardRow {
		var b *awardRow
		bs := math.Inf(-1)
		for i := range rows {
			if ok(rows[i]) {
				if s := score(rows[i]); s > bs {
					b, bs = &rows[i], s
				}
			}
		}
		return b
	}
	regular := func(a awardRow) bool { return a.apps >= 15 }
	if b := pick(regular, func(a awardRow) float64 { return a.avg() + 0.01*float64(a.goals+a.assists) }); b != nil {
		w.giveAward(*b, "best", b.avg(), rep)
	}
	if b := pick(func(a awardRow) bool { return a.goals > 0 }, func(a awardRow) float64 { return float64(a.goals) + float64(a.assists)/100 }); b != nil {
		w.giveAward(*b, "scorer", float64(b.goals), rep)
	}
	if b := pick(func(a awardRow) bool { return a.apps >= 10 && a.age <= 21 }, func(a awardRow) float64 { return a.avg() }); b != nil {
		w.giveAward(*b, "young", b.avg(), rep)
	}
	// team of the season: 1 keeper, 4 defenders, 3 midfielders, 3 forwards
	mine := 0
	for _, slot := range []struct {
		pos string
		n   int
	}{{"GK", 1}, {"DF", 4}, {"MF", 3}, {"FW", 3}} {
		var cs []awardRow
		for _, a := range rows {
			if a.pos == slot.pos && a.apps >= 12 {
				cs = append(cs, a)
			}
		}
		sort.Slice(cs, func(i, j int) bool { return cs[i].avg() > cs[j].avg() })
		for i := 0; i < slot.n && i < len(cs); i++ {
			if w.giveAward(cs[i], "tots", cs[i].avg(), rep).Mine {
				mine++
			}
		}
	}
	if mine > 0 {
		w.happen(rep, "award_tots_mine", "", int64(mine))
	}
	return nil
}
