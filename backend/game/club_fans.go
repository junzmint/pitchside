package game

import (
	"context"
	"math"
	"strconv"
	"strings"
)

// ---------------------------------------------------------------- the supporters
//
// One number from 0 to 100: the fans' mood. Results move it (measured against what the fans
// expected, derbies count double, knockout ties and streaks a little more), so do cup runs,
// promotion or relegation, a star signing, selling the fan favourite and the ticket price. With
// nothing happening it drifts back towards the middle.
//
// It pays back in small, visible ways: a fuller stadium (tickets ×0.85 to ×1.12), shirt sales
// (×0.9 to ×1.1) and, at 80 or more, a roaring home crowd (up to +1.5 on every rating line in
// simulated home matches; a hostile one at 20 or less costs up to 1).

const (
	FanStart  = 60.0  // a new career's mood
	FanRest   = 55.0  // with nothing happening the mood drifts back towards this
	FanDrift  = 0.035 // share of that gap closed every matchday
	FanSummer = 62.0  // a new season brings hope: the summer pulls the mood towards this
	FanMaxDay = 18.0  // the most one matchday can move the mood
)

type FanState struct {
	Mood   float64   `json:"mood"`
	Delta  int       `json:"delta"` // change on the last matchday (rounded as shown)
	Voice  FanVoice  `json:"voice"`
	Fav    int       `json:"fav"` // the fan favourite (player id)
	Form   string    `json:"form"`
	Gate   int       `json:"gate"`  // attendance at the last home match
	Trend  []int     `json:"trend"` // mood after every matchday this season
	Season int       `json:"season"`
	Notes  []FanNote `json:"notes"` // what moved the mood on the last matchday
}

// FanVoice: what the stands are saying: a chant, a banner or a post on social media.
type FanVoice struct {
	Style string `json:"style"` // chant | banner | post
	Key   string `json:"key"`
	Name  string `json:"name,omitempty"`
	N     int    `json:"n,omitempty"`
	Seed  int    `json:"seed"`
}

// FanNote: one reason the mood moved.
type FanNote struct {
	Key  string  `json:"key"`
	V    float64 `json:"v"`
	Name string  `json:"name,omitempty"`
	N    int     `json:"n,omitempty"`
}

// FanReport: the fans' line in the day report.
type FanReport struct {
	Mood  int       `json:"mood"`
	Delta int       `json:"delta"`
	Band  int       `json:"band"`
	Gate  int       `json:"gate,omitempty"`
	Voice FanVoice  `json:"voice"`
	Notes []FanNote `json:"notes"`
}

// fanBand: 0 furious, 1 upset, 2 calm, 3 happy, 4 ecstatic.
func fanBand(m float64) int {
	switch r := math.Round(m); {
	case r < 20:
		return 0
	case r < 40:
		return 1
	case r < 60:
		return 2
	case r < 80:
		return 3
	}
	return 4
}

var fanFaces = []string{"😡", "😟", "😐", "😊", "🤩"}

// fanGateMul: how full the stands are, as a multiplier on ticket income (1 at a mood of 50).
func fanGateMul(m float64) float64 {
	if m >= 50 {
		return 1 + (m-50)/50*0.12
	}
	return 1 - (50-m)/50*0.15
}

// fanMerchMul: happy fans buy more shirts.
func fanMerchMul(m float64) float64 { return 0.9 + clamp(m, 0, 100)/100*0.2 }

// fanBoost: the home crowd in simulated matches, added to every rating line.
func fanBoost(m float64) float64 {
	switch {
	case m >= 80:
		return math.Round((0.75+(math.Min(m, 100)-80)*0.0375)*100) / 100
	case m <= 20:
		return -math.Round((0.5+(20-math.Max(m, 0))*0.025)*100) / 100
	}
	return 0
}

// ticketFans: what the ticket price does to the mood after every home game.
var ticketFans = map[string]float64{"low": 1.2, "normal": 0, "high": -1.5}

// stadiumCapacity grows with the club's standing and the stadium level.
func stadiumCapacity(cl *Club) int {
	r := float64(cl.Reputation)
	base := 6000 + r*r*6.5
	return int(base*(1+0.12*float64(max(1, cl.Stadium)-1))/100) * 100
}

// attendanceFill: the share of seats taken.
func attendanceFill(mood float64, ticket string) float64 {
	f := 0.6 + clamp(mood, 0, 100)*0.0038
	switch ticket {
	case "low":
		f += 0.07
	case "high":
		f -= 0.07
	}
	return clamp(f, 0.35, 1)
}

func attendance(cl *Club, mood float64, ticket string) int {
	return int(float64(stadiumCapacity(cl))*attendanceFill(mood, ticket)/10) * 10
}

// fanGate / fanMerch: multipliers for economy.go (1 until the club-life state is loaded).
func (w *world) fanGate() float64 {
	if w.life == nil || !w.life.Init {
		return 1
	}
	return fanGateMul(w.life.Fans.Mood)
}

func (w *world) fanMerch() float64 {
	if w.life == nil || !w.life.Init {
		return 1
	}
	return fanMerchMul(w.life.Fans.Mood) * w.life.tourMerch(w.career)
}

// fanMods: before the user's match, the home crowd lifts (or weighs on) the team.
func (w *world) fanMods(ctx context.Context, q DBTX, f *Fixture, home, away *TeamSheet) {
	life := w.clubLife(ctx, q)
	if !life.Init || f == nil || f.Comp == "friendly" || f.HomeID != w.career.UserClubID {
		return
	}
	home.Boost += fanBoost(life.Fans.Mood)
}

// ---------------------------------------------------------------- what moves the mood

// fansAfterMatch: the verdict on the user's match, measured against what the fans expected.
func (w *world) fansAfterMatch(life *ClubLife, uo *matchOutcome) []FanNote {
	c := w.career
	f := uo.f
	if f.HomeGoals == nil || f.AwayGoals == nil {
		return nil
	}
	home := uo.userSide == 0
	gf, ga := *f.HomeGoals, *f.AwayGoals
	oppID := f.AwayID
	if !home {
		gf, ga = ga, gf
		oppID = f.HomeID
	}
	opp := w.byID[oppID]
	oppName := ""
	if opp != nil {
		oppName = opp.Name
	}
	res := "D"
	switch f.WinnerID() {
	case c.UserClubID:
		res = "W"
	case oppID:
		res = "L"
	}
	pts := map[string]float64{"W": 3, "D": 1, "L": 0}[res]
	if f.PensHome != nil { // settled on penalties: a win, but a nervy one; a defeat, but an honourable one
		pts = map[string]float64{"W": 2.2, "L": 0.7}[res]
	}
	d := uo.ownOvr - uo.oppOvr
	if home {
		d += 2.5
	} else {
		d -= 2.5
	}
	exp := clamp(1.35+clamp(d, -15, 15)*0.09, 0.3, 2.6)
	v := 1.6 * (pts - exp)
	if res == "W" {
		v += 0.6
	}
	kind := map[string]string{"W": "win", "D": "draw", "L": "loss"}[res]
	mult := 1.0
	switch {
	case f.Comp == "friendly":
		mult = 0.25
	case w.isDerby(f):
		mult, kind = 2, "derby_"+kind
	case isKnockout(f):
		mult = 1.5
	case f.Comp == "cl":
		mult = 1.2
	}
	notes := []FanNote{{Key: kind, V: round1(v * mult), Name: oppName}}
	if f.Comp == "friendly" {
		return notes
	}
	// a hiding hurts most against a side the fans expected to beat; a rout of a giant is golden
	switch {
	case gf-ga >= 3:
		notes = append(notes, FanNote{Key: "thrash", V: round1(clamp(2.4-exp, 0.4, 1.4)), Name: oppName, N: gf - ga})
	case ga-gf >= 3:
		notes = append(notes, FanNote{Key: "humbled", V: -round1(clamp(exp-0.2, 0.3, 1.4)), Name: oppName, N: ga - gf})
	}
	fs := &life.Fans
	fs.Form += res
	if len(fs.Form) > 10 {
		fs.Form = fs.Form[len(fs.Form)-10:]
	}
	if c.Streak >= 3 {
		notes = append(notes, FanNote{Key: "streak", V: round1(0.3 * float64(min(c.Streak, 8)-2)), N: c.Streak})
	}
	if n := len(fs.Form) - len(strings.TrimRight(fs.Form, "L")); n >= 3 {
		notes = append(notes, FanNote{Key: "slump", V: -round1(0.3 * float64(min(n, 8)-2)), N: n})
	}
	// cup runs: every round won makes the next one bigger; a final is a party
	if isKnockout(f) {
		if res == "W" {
			bonus := map[string]float64{"R1": 0.3, "R32": 0.5, "R16": 1, "QF": 1.5, "SF": 2.5, "F": 7}[f.Stage]
			key := "cup_run"
			if f.Comp == "cl" {
				bonus = map[string]float64{"R16": 1, "QF": 2, "SF": 3, "F": 9}[f.Stage]
			}
			if f.Stage == "F" {
				key = "trophy"
			}
			if bonus > 0 {
				notes = append(notes, FanNote{Key: key, V: bonus, Name: f.Comp + ":" + f.Stage})
			}
		} else if res == "L" && f.Stage == "F" {
			notes = append(notes, FanNote{Key: "final_lost", V: -1.5, Name: f.Comp})
		}
	}
	if home {
		if v := ticketFans[c.Ticket]; v != 0 {
			notes = append(notes, FanNote{Key: "ticket_" + c.Ticket, V: v})
		}
	}
	return notes
}

// fansSeasonEnd: promotion, relegation, a title or a European place.
func (w *world) fansSeasonEnd(se *SeasonEnd) []FanNote {
	c := w.career
	var notes []FanNote
	switch se.Move {
	case "up":
		notes = append(notes, FanNote{Key: "promoted", V: 12})
	case "down":
		notes = append(notes, FanNote{Key: "relegated", V: -14})
	}
	if se.Position == 1 {
		notes = append(notes, FanNote{Key: "title", V: 10})
	} else if se.Qualified {
		notes = append(notes, FanNote{Key: "europe", V: 3})
	}
	if b := c.Commercial.Board; b != nil && b.Season == c.Season && b.Result == "missed" {
		notes = append(notes, FanNote{Key: "board_missed", V: -2})
	}
	return notes
}

// fanEvents: the big moments, which move the mood in full however happy or angry the fans are.
var fanEvents = map[string]bool{"trophy": true, "final_lost": true, "promoted": true, "relegated": true, "title": true, "europe": true,
	"board_missed": true, "star_signed": true, "legend_signed": true, "star_sold": true, "fav_sold": true, "summer": true}

// applyFanNotes adds up today's reasons (one matchday moves the mood by at most FanMaxDay). Week to
// week results matter less near the ends of the scale: happy fans start to take wins for granted,
// and the faithful stay behind the team when things go badly, so the meter stays lively.
func (w *world) applyFanNotes(life *ClubLife, notes []FanNote, drift bool) {
	fs := &life.Fans
	before := math.Round(fs.Mood)
	up, down := 1.0, 1.0
	if fs.Mood > 65 {
		up = clamp((105-fs.Mood)/40, 0.3, 1)
	}
	if fs.Mood < 45 {
		down = clamp((fs.Mood+5)/50, 0.3, 1)
	}
	sum := 0.0
	for i := range notes {
		n := &notes[i]
		if !fanEvents[n.Key] {
			switch {
			case n.V > 0:
				n.V = round1(n.V * up)
			case n.V < 0:
				n.V = round1(n.V * down)
			}
		}
		sum += n.V
	}
	m := fs.Mood + clamp(sum, -FanMaxDay, FanMaxDay)
	if drift {
		m += (FanRest - m) * FanDrift
	}
	fs.Mood = math.Round(clamp(m, 0, 100)*10) / 10
	fs.Delta = int(math.Round(fs.Mood) - before)
	keep := []FanNote{}
	for _, n := range notes {
		if n.V != 0 || n.Key == "fav_retired" || n.Key == "legend" {
			keep = append(keep, n)
		}
	}
	fs.Notes = keep
	if w.career.Day <= len(Calendar) || len(fs.Trend) == 0 {
		fs.Trend = append(fs.Trend, int(math.Round(fs.Mood)))
		if len(fs.Trend) > 70 {
			fs.Trend = fs.Trend[len(fs.Trend)-70:]
		}
	}
}

// pickFavourite: the player the fans love most: appearances for the club plus his goals and assists.
func (w *world) pickFavourite(ctx context.Context, q DBTX, life *ClubLife, squad []*Player) error {
	es := &w.career.Events
	borrowed := map[int]bool{}
	for _, d := range es.LoansIn {
		borrowed[d.PlayerID] = true
	}
	ids := make([]int32, 0, len(squad))
	for _, p := range squad {
		if !borrowed[p.ID] {
			ids = append(ids, int32(p.ID))
		}
	}
	if len(ids) == 0 {
		life.Fans.Fav = 0
		return nil
	}
	ga, err := clubGoals(ctx, q, ids, w.career.UserClubID)
	if err != nil {
		return err
	}
	best, bestS := 0, -1.0
	for _, p := range squad {
		if borrowed[p.ID] {
			continue
		}
		s := float64(p.Tenure) + 2*float64(ga[p.ID][0]) + float64(ga[p.ID][1]) + float64(p.Overall)/100
		if p.Tag == "legend" {
			s += 10
		}
		if s > bestS {
			best, bestS = p.ID, s
		}
	}
	life.Fans.Fav = best
	return nil
}

// clubGoals: goals and assists for the club, per player.
func clubGoals(ctx context.Context, q DBTX, ids []int32, clubID int) (map[int][2]int, error) {
	out := map[int][2]int{}
	rows, err := q.Query(ctx, `SELECT player_id, COALESCE(sum(goals),0), COALESCE(sum(assists),0) FROM player_stats
		WHERE player_id = ANY($1::int[]) AND club_id=$2 AND comp <> 'friendly' GROUP BY player_id`, ids, clubID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, g, a int
		if err := rows.Scan(&id, &g, &a); err != nil {
			return nil, err
		}
		out[id] = [2]int{g, a}
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------- the voice of the stands

// pickVoice chooses what the fans are chanting, waving or posting after today.
func (w *world) pickVoice(life *ClubLife, notes []FanNote, day int) {
	c := w.career
	fs := &life.Fans
	seed := c.Season*100 + day
	has := map[string]*FanNote{}
	for i := range notes {
		if _, ok := has[notes[i].Key]; !ok {
			has[notes[i].Key] = &notes[i]
		}
	}
	set := func(style, key, name string, n int) {
		fs.Voice = FanVoice{Style: style, Key: key, Name: name, N: n, Seed: seed}
	}
	first := func(keys ...string) *FanNote {
		for _, k := range keys {
			if n := has[k]; n != nil {
				return n
			}
		}
		return nil
	}
	switch {
	case has["promoted"] != nil:
		set("chant", "promoted", "", 0)
	case has["relegated"] != nil:
		set("post", "relegated", "", 0)
	case has["title"] != nil:
		set("chant", "title", "", 0)
	case has["trophy"] != nil:
		set("chant", "trophy", "", 0)
	case has["fav_sold"] != nil:
		set("post", "fav_sold", has["fav_sold"].Name, 0)
	case first("legend_signed", "star_signed") != nil:
		n := first("legend_signed", "star_signed")
		set("banner", "welcome", n.Name, 0)
	case first("fav_retired", "legend") != nil:
		set("banner", "farewell", first("fav_retired", "legend").Name, 0)
	case has["derby_win"] != nil:
		set("chant", "derby_win", has["derby_win"].Name, 0)
	case has["derby_loss"] != nil:
		set("post", "derby_loss", has["derby_loss"].Name, 0)
	case has["final_lost"] != nil:
		set("post", "final_lost", "", 0)
	case has["thrash"] != nil:
		set("chant", "thrash", has["thrash"].Name, has["thrash"].N)
	case has["humbled"] != nil:
		set("post", "humbled", has["humbled"].Name, has["humbled"].N)
	case has["streak"] != nil && has["streak"].N >= 4:
		set("chant", "streak", "", has["streak"].N)
	case has["slump"] != nil:
		set("post", "slump", "", has["slump"].N)
	case has["cup_run"] != nil && strings.HasSuffix(has["cup_run"].Name, ":SF"):
		set("banner", "final_next", "", 0)
	case has["cup_run"] != nil && (strings.HasSuffix(has["cup_run"].Name, ":QF") || strings.HasSuffix(has["cup_run"].Name, ":R16")):
		set("banner", "cup_run", "", 0)
	case has["ticket_high"] != nil && fs.Mood < 50:
		set("post", "prices", "", 0)
	case has["summer"] != nil:
		set("banner", "summer", "", 0)
	case fs.Fav != 0 && seed%5 == 0:
		if p := w.favPlayer(fs.Fav); p != nil {
			set("banner", "fav", p.Name, p.Shirt)
			return
		}
		w.genericVoice(fs, seed)
	default:
		w.genericVoice(fs, seed)
	}
}

func (w *world) favPlayer(id int) *Player {
	for _, p := range w.players[w.career.UserClubID] {
		if p.ID == id {
			return p
		}
	}
	return nil
}

// genericVoice: a line that fits the mood (the frontend picks one of its variants by Seed).
func (w *world) genericVoice(fs *FanState, seed int) {
	b := fanBand(fs.Mood)
	style := []string{"post", "post", "post", "chant", "chant"}[b]
	fs.Voice = FanVoice{Style: style, Key: "g" + strconv.Itoa(b), Seed: seed}
}

// fanReport writes the fans' line into the day report.
func (w *world) fanReport(life *ClubLife, before float64, uo *matchOutcome, home bool, rep *DayReport, notes []FanNote) {
	fs := &life.Fans
	if uo == nil && len(notes) == 0 {
		return
	}
	fr := &FanReport{Mood: int(math.Round(fs.Mood)), Delta: fs.Delta, Band: fanBand(fs.Mood), Voice: fs.Voice, Notes: fs.Notes}
	if home {
		fr.Gate = fs.Gate
	}
	rep.Fans = fr
	key := "fans_flat"
	switch {
	case fs.Delta > 0:
		key = "fans_gain"
	case fs.Delta < 0:
		key = "fans_loss"
	}
	rep.Happenings = append(rep.Happenings, ComEvent{Key: key, Name: fanFaces[fr.Band] + " " + strconv.Itoa(fr.Mood), Amount: int64(fs.Delta)})
	_ = before
}

// ---------------------------------------------------------------- view

type FanView struct {
	Mood       int       `json:"mood"`
	Delta      int       `json:"delta"`
	Band       int       `json:"band"`
	Voice      FanVoice  `json:"voice"`
	Notes      []FanNote `json:"notes"`
	Attendance int       `json:"attendance"` // expected at the next home game
	LastGate   int       `json:"lastGate"`   // at the last home game
	Capacity   int       `json:"capacity"`
	Fill       float64   `json:"fill"`
	Gate       float64   `json:"gate"`  // ticket income multiplier
	Merch      float64   `json:"merch"` // shirt sales multiplier
	Boost      float64   `json:"boost"` // home rating lines in simulated matches
	Ticket     string    `json:"ticket"`
	TicketFans float64   `json:"ticketFans"` // mood after every home game from the ticket price
	Fav        *FavView  `json:"fav"`
	Trend      []int     `json:"trend"`
	Form       string    `json:"form"`
}

type FavView struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Shirt    int    `json:"shirt"`
	Position string `json:"position"`
	Role     string `json:"role"`
	Overall  int    `json:"overall"`
	Apps     int    `json:"apps"`
	Goals    int    `json:"goals"`
	Assists  int    `json:"assists"`
	Nation   string `json:"nation"`
}

func fanView(ctx context.Context, q DBTX, c *Career, user *Club, squad []*Player, life *ClubLife) FanView {
	fs := &life.Fans
	ticket := c.Ticket
	if ticket == "" {
		ticket = "normal"
	}
	v := FanView{Mood: int(math.Round(fs.Mood)), Delta: fs.Delta, Band: fanBand(fs.Mood), Voice: fs.Voice, Notes: fs.Notes,
		Capacity: stadiumCapacity(user), Fill: math.Round(attendanceFill(fs.Mood, ticket)*1000) / 1000,
		Attendance: attendance(user, fs.Mood, ticket), LastGate: fs.Gate,
		Gate: math.Round(fanGateMul(fs.Mood)*1000) / 1000, Merch: math.Round(fanMerchMul(fs.Mood)*1000) / 1000, Boost: fanBoost(fs.Mood),
		Ticket: ticket, TicketFans: ticketFans[ticket], Trend: fs.Trend, Form: fs.Form}
	if v.Notes == nil {
		v.Notes = []FanNote{}
	}
	if v.Trend == nil {
		v.Trend = []int{}
	}
	if v.Voice.Key == "" {
		v.Voice = FanVoice{Style: "chant", Key: "g" + strconv.Itoa(v.Band)}
		if v.Band < 3 {
			v.Voice.Style = "post"
		}
	}
	fav := fs.Fav
	var fp *Player
	for _, p := range squad {
		if p.ID == fav {
			fp = p
		}
	}
	if fp == nil { // not chosen yet: the longest-serving player
		for _, p := range squad {
			if fp == nil || p.Tenure > fp.Tenure {
				fp = p
			}
		}
	}
	if fp != nil {
		f := &FavView{ID: fp.ID, Name: fp.Name, Shirt: fp.Shirt, Position: fp.Position, Role: fp.Role, Overall: fp.Overall, Apps: fp.Tenure, Nation: fp.Nation}
		if ga, err := clubGoals(ctx, q, []int32{int32(fp.ID)}, user.ID); err == nil {
			f.Goals, f.Assists = ga[fp.ID][0], ga[fp.ID][1]
		}
		v.Fav = f
	}
	return v
}
