package game

import (
	"context"
	"math"
	"math/rand"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- scouting missions
//
// Send a scout to a region for a few matchdays. He comes back with a handful of reports on real
// players at the clubs there, with their hidden development class and traits revealed. Better
// scouts (and the Talent eye perk) misjudge less and bring back more. Each find gets a rarity.

type Region struct {
	Code    string `json:"code"`
	Country string `json:"country"`
	Name    string `json:"name"`
	World   bool   `json:"world"` // a transfer-world league (not in the competitions)
	Days    int    `json:"days"`
	Cost    int64  `json:"cost"`
	Clubs   int    `json:"clubs"`
	Visits  int    `json:"visits"`
	Finds   int    `json:"finds"`
	Home    bool   `json:"home"`
}

var regionTravel = map[string][2]int64{ // days, cost in thousands
	"FR": {3, 250}, "PT": {3, 250}, "NL": {3, 250}, "BE": {3, 220}, "SC": {3, 200},
	"TR": {4, 350}, "BR": {5, 450}, "AR": {5, 450}, "US": {5, 420}, "JP": {5, 420},
}

func (w *world) regions() []Region {
	home := w.byID[w.career.UserClubID].League
	clubs := map[string]int{}
	for _, cl := range w.clubs {
		if !cl.IsUser {
			clubs[cl.League]++
		}
	}
	var out []Region
	for _, l := range Leagues {
		rg := Region{Code: l.Code, Country: l.Country, Name: l.Name, Days: 3, Cost: 300_000}
		if l.Code == home {
			rg.Days, rg.Cost, rg.Home = 2, 150_000, true
		}
		out = append(out, rg)
	}
	for _, l := range WorldLeagues {
		t := regionTravel[l.Code]
		if t[0] == 0 {
			t = [2]int64{4, 350}
		}
		out = append(out, Region{Code: l.Code, Country: l.Country, Name: l.Name, World: true, Days: int(t[0]), Cost: t[1] * 1000})
	}
	x := &w.career.Explore
	for i := range out {
		out[i].Clubs = clubs[out[i].Code]
		out[i].Visits = x.Regions[out[i].Code]
		for _, f := range x.Finds {
			if f.Region == out[i].Code {
				out[i].Finds++
			}
		}
	}
	return out
}

func (w *world) region(code string) *Region {
	for _, rg := range w.regions() {
		if rg.Code == code {
			return &rg
		}
	}
	return nil
}

var MissionFocus = []string{"any", "talent", "bargain", "star"}

type Mission struct {
	ID      int    `json:"id"`
	Region  string `json:"region"`
	Pos     string `json:"pos"`   // "" = any position
	Focus   string `json:"focus"` // any | talent | bargain | star
	ScoutID int    `json:"scoutId"`
	Scout   string `json:"scout"`
	Skill   int    `json:"skill"`
	Eye     bool   `json:"eye"`
	Season  int    `json:"season"`
	Day     int    `json:"day"`
	Days    int    `json:"days"`
	Left    int    `json:"left"` // matchdays until he is back
	Cost    int64  `json:"cost"`
	Finds   []int  `json:"finds"`
	Best    string `json:"best"` // best rarity he brought back
	Seen    bool   `json:"seen"`
}

type Find struct {
	PlayerID int      `json:"playerId"`
	Name     string   `json:"name"`
	Nation   string   `json:"nation"`
	Pos      string   `json:"pos"`
	Role     string   `json:"role"`
	Age      int      `json:"age"`
	Ovr      int      `json:"ovr"`
	Pot      int      `json:"pot"`
	Dev      string   `json:"dev"`
	Traits   []string `json:"traits"`
	Club     string   `json:"club"`
	ClubID   int      `json:"clubId"`
	Value    int64    `json:"value"`
	Ask      int64    `json:"ask"`
	Rarity   string   `json:"rarity"` // common | rare | epic | legendary
	Tags     []string `json:"tags"`   // wonder, fast, flop, bargain, hyped, jr, teen, gem, golden
	Region   string   `json:"region"`
	Mission  int      `json:"mission"`
	Season   int      `json:"season"`
	Day      int      `json:"day"`
	Star     bool     `json:"star"`            // on the shortlist
	Signed   bool     `json:"signed"`          // he joined your club
	Since    int      `json:"since,omitempty"` // Career.now() when he came off the shortlist: his ScoutFindDays start again there
	Golden   bool     `json:"golden"`
}

var rarityRank = map[string]int{"": 0, "common": 1, "rare": 2, "epic": 3, "legendary": 4}

var devBonus = map[string]float64{"wonder": 25, "fast": 12, "normal": 0, "slow": -8, "flop": -20}

// gemScore: how exciting the player really is for a mission's focus.
func gemScore(p *Player, ask int64, focus string) float64 {
	dev := devBonus[devClass(p)]
	gap := float64(p.Potential - p.Overall)
	deal := 0.0
	if ask > 0 {
		deal = float64(p.Value)/float64(ask) - 1
	}
	switch focus {
	case "talent":
		return gap + dev + float64(21-p.Age)*1.5 + float64(p.Potential)*0.2
	case "bargain":
		return deal*60 + float64(p.Overall)*0.3 + dev*0.4
	case "star":
		return float64(p.Overall) + dev*0.15 + deal*8
	}
	return dev + gap*0.5 + deal*30 + float64(p.Overall)*0.15
}

func findRarity(p *Player, ask int64) (string, []string) {
	dev := devClass(p)
	tags := []string{}
	if dev == "wonder" || dev == "fast" || dev == "flop" {
		tags = append(tags, dev)
	}
	ratio := 1.0
	if p.Value > 0 {
		ratio = float64(ask) / float64(p.Value)
	}
	if ratio <= 0.8 {
		tags = append(tags, "bargain")
	} else if ratio >= 1.3 {
		tags = append(tags, "hyped")
	}
	if strings.HasSuffix(p.Name, " Jr.") {
		tags = append(tags, "jr")
	}
	if p.Age <= 19 {
		tags = append(tags, "teen")
	}
	switch {
	case (dev == "wonder" && p.Potential >= 90) || (ratio <= 0.6 && p.Overall >= 80) || (p.Age <= 20 && p.Potential >= 92 && dev == "fast"):
		return "legendary", tags
	case (dev == "wonder" && p.Potential >= 78) || (dev == "fast" && p.Potential >= 84) || p.Overall >= 86 || (ratio <= 0.7 && p.Overall >= 74):
		return "epic", tags
	case dev == "wonder" || dev == "fast" || p.Potential-p.Overall >= 12 || ratio <= 0.8 || p.Overall >= 80:
		return "rare", tags
	}
	return "common", tags
}

func (w *world) makeFind(p *Player, ask int64, region string, mission int) Find {
	rar, tags := findRarity(p, ask)
	f := Find{PlayerID: p.ID, Name: p.Name, Nation: p.Nation, Pos: p.Position, Role: p.Role, Age: p.Age, Ovr: p.Overall, Pot: p.Potential,
		Dev: devClass(p), Traits: append([]string{}, p.Traits...), Value: p.Value, Ask: ask, Rarity: rar, Tags: tags, Region: region,
		Mission: mission, Season: w.career.Season, Day: w.career.Day}
	if p.ClubID != nil {
		f.ClubID = *p.ClubID
		if cl := w.byID[*p.ClubID]; cl != nil {
			f.Club = cl.Name
		}
	}
	return f
}

// regionPlayers: modern players at computer clubs in a region.
func (w *world) regionPlayers(ctx context.Context, q DBTX, code, pos string) ([]*Player, error) {
	return queryPlayers(ctx, q, `career_id=$1 AND NOT retired AND tag='' AND ($3='' OR position=$3)
		AND club_id IN (SELECT id FROM clubs WHERE career_id=$1 AND league=$2 AND NOT is_user)`, w.career.ID, code, pos)
}

func (w *world) addFinds(ctx context.Context, q DBTX, fs []Find) error {
	x := &w.career.Explore
	ids := []int{}
	for _, f := range fs {
		ids = append(ids, f.PlayerID)
	}
	if len(ids) > 0 {
		if _, err := q.Exec(ctx, `UPDATE players SET traits_known=true WHERE career_id=$1 AND id = ANY($2)`, w.career.ID, ids); err != nil {
			return err
		}
	}
	for _, f := range fs {
		switch f.Rarity {
		case "legendary":
			x.Stats["found_legendary"]++
		case "epic":
			x.Stats["found_epic"]++
		}
		if f.Dev == "wonder" {
			x.Stats["found_wonder"]++
		}
		x.Stats["finds"]++
	}
	x.Finds = append(fs, x.Finds...)
	pruneFinds(w.career)
	return nil
}

// ---------------------------------------------------------------- the discovery log
//
// A report stays on the scouting screen for ScoutFindDays matchdays unless you shortlist (★) the
// player; the shortlist keeps him until you take him off it. Once he joins your club (bought,
// swapped in, signed as a free agent) his report has done its job and leaves the screen for good.
// Reports off the screen stay behind as the scouts' memory (the latest scoutMemory of them): the
// next trips don't bring the same players back, and signing one of them later still counts for
// the achievements.

// ScoutFindDays: matchdays an unstarred report stays on show, counted from the day it came in. Only
// matchdays played count: the off-season between two seasons counts as none, so a report from the
// last weeks of a season is still there when the next one starts.
const ScoutFindDays = 5

// scoutMemory: reports kept off the screen, besides the ones on show.
const scoutMemory = 60

// matchdayNo numbers the career's matchdays across seasons. The off-season (day len(Calendar)+1)
// shares its number with matchday 1 of the next season, so the summer counts as no time at all.
func matchdayNo(season, day int) int {
	return season*len(Calendar) + min(max(day, 1), len(Calendar)+1)
}

// findAge: matchdays played since the report came in, or since he came off the shortlist.
func findAge(c *Career, f *Find) int {
	from := matchdayNo(f.Season, f.Day)
	if f.Since > 0 {
		from = max(from, matchdayNo(f.Since/100, f.Since%100))
	}
	return max(0, matchdayNo(c.Season, c.Day)-from)
}

// findLeft: matchdays an unstarred report has left on show (0: it has faded).
func findLeft(c *Career, f *Find) int {
	return max(0, ScoutFindDays-findAge(c, f))
}

// findOnShow: whether a report shows on the scouting screen (the log, the shortlist and the feed
// lines about him). yours: he plays for the user's club now, even before trackSquad marks him Signed.
func findOnShow(c *Career, f *Find, yours bool) bool {
	if f.Signed || yours {
		return false
	}
	return f.Star || findLeft(c, f) > 0
}

// pruneFinds keeps every report on show plus the latest scoutMemory others.
func pruneFinds(c *Career) {
	x := &c.Explore
	keep := x.Finds[:0]
	n := 0
	for i := range x.Finds {
		f := x.Finds[i]
		on := findOnShow(c, &f, false)
		if on || n < scoutMemory {
			keep = append(keep, f)
			if !on {
				n++
			}
		}
	}
	x.Finds = keep
}

// toggleStar puts a reported player on (or off) the shortlist. Taken off it, his report gets a
// fresh ScoutFindDays before it fades, so it never vanishes under the user's finger.
func toggleStar(c *Career, playerID int) bool {
	for i := range c.Explore.Finds {
		if f := &c.Explore.Finds[i]; f.PlayerID == playerID {
			f.Star, f.Since = !f.Star, 0
			if !f.Star {
				f.Since = c.now()
			}
			return true
		}
	}
	return false
}

// findFeedKeys: the feed lines about one reported player ("Legendary find: X", "Golden tip: X").
var findFeedKeys = map[string]bool{"find_legendary": true, "golden_tip": true}

// shownFeed: the Explore feed without the lines about reports that are off the scouting screen. A
// line is matched to its report by the player's name and the day, both written in the same tick;
// a line whose report is gone from the scouts' memory too is old enough to go.
func shownFeed(c *Career, yours map[int]bool) []FeedItem {
	type stamp struct {
		name        string
		season, day int
	}
	x := &c.Explore
	on := map[stamp]bool{}
	for i := range x.Finds {
		f := &x.Finds[i]
		k := stamp{f.Name, f.Season, f.Day}
		on[k] = on[k] || findOnShow(c, f, yours[f.PlayerID])
	}
	out := make([]FeedItem, 0, len(x.Feed))
	for _, it := range x.Feed {
		if !findFeedKeys[it.Key] || on[stamp{it.Name, it.Season, it.Day}] {
			out = append(out, it)
		}
	}
	return out
}

// resolveMission: the scout's reports.
func (w *world) resolveMission(ctx context.Context, q DBTX, r *rand.Rand, m *Mission) error {
	x := &w.career.Explore
	ps, err := w.regionPlayers(ctx, q, m.Region, m.Pos)
	if err != nil {
		return err
	}
	known := map[int]bool{}
	for _, f := range x.Finds {
		known[f.PlayerID] = true
	}
	sd := math.Max(2.5, 16-float64(m.Skill)*0.65)
	if m.Eye {
		sd *= 0.6
	}
	type cand struct {
		p    *Player
		ask  int64
		seen float64
		real float64
	}
	var cs []cand
	for _, p := range ps {
		if known[p.ID] {
			continue
		}
		ask := askingPrice(p, w.career.Season)
		real := gemScore(p, ask, m.Focus)
		cs = append(cs, cand{p, ask, real + r.NormFloat64()*sd, real})
	}
	sort.Slice(cs, func(i, j int) bool { return cs[i].seen > cs[j].seen })
	n := 2 + m.Skill/7
	if m.Eye {
		n++
	}
	n = min(n, 5, len(cs))
	picked := cs[:n]
	// now and then he stumbles on the region's real hidden gem
	if len(cs) > n && r.Float64() < 0.05+float64(m.Skill)*0.004+map[bool]float64{true: 0.05}[m.Eye] {
		best := -1
		for i := n; i < len(cs); i++ {
			if devClass(cs[i].p) == "wonder" && (best < 0 || cs[i].real > cs[best].real) {
				best = i
			}
		}
		if best >= 0 {
			picked = append(picked, cs[best])
		}
	}
	var fs []Find
	for i, c := range picked {
		f := w.makeFind(c.p, c.ask, m.Region, m.ID)
		if i >= n {
			f.Tags = append(f.Tags, "gem")
			if rarityRank[f.Rarity] < rarityRank["epic"] {
				f.Rarity = "epic"
			}
		}
		fs = append(fs, f)
		m.Finds = append(m.Finds, c.p.ID)
		if rarityRank[f.Rarity] > rarityRank[m.Best] {
			m.Best = f.Rarity
		}
	}
	return w.addFinds(ctx, q, fs)
}

func (w *world) missionsTick(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	x := &w.career.Explore
	for i := range x.Missions {
		m := &x.Missions[i]
		if m.Left <= 0 {
			continue
		}
		m.Left--
		if m.Left > 0 {
			continue
		}
		if err := w.resolveMission(ctx, q, r, m); err != nil {
			return err
		}
		x.Stats["missions"]++
		w.say(rep, "mission_back", m.Region, int64(len(m.Finds)), m.Best)
		for _, f := range x.Finds {
			if f.Mission == m.ID && f.Rarity == "legendary" {
				w.say(rep, "find_legendary", f.Name, 0, "legendary")
			}
		}
	}
	// keep every mission still out plus the latest eight reports
	var keep []Mission
	back := 0
	for i := len(x.Missions) - 1; i >= 0; i-- {
		m := x.Missions[i]
		if m.Left > 0 || back < 8 {
			keep = append([]Mission{m}, keep...)
			if m.Left <= 0 {
				back++
			}
		}
	}
	x.Missions = keep
	return nil
}

// ---------------------------------------------------------------- golden events

// goldenTick: rare, lucky moments (at most two a season).
func (w *world) goldenTick(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	c := w.career
	x := &c.Explore
	if c.Day > len(Calendar) || x.Golden[c.Season] >= 2 || r.Float64() >= 0.014 {
		return nil
	}
	user := w.byID[c.UserClubID]
	x.Golden[c.Season]++
	x.Stats["golden"]++
	switch k := r.Float64(); {
	case k < 0.45:
		regs := w.regions()
		rg := regs[r.Intn(len(regs))]
		ps, err := w.regionPlayers(ctx, q, rg.Code, "")
		if err != nil {
			return err
		}
		known := map[int]bool{}
		for _, f := range x.Finds {
			known[f.PlayerID] = true
		}
		var best *Player
		bestS := -1e9
		for _, p := range ps {
			if s := gemScore(p, askingPrice(p, c.Season), "talent"); s > bestS && p.Age <= 21 && !known[p.ID] {
				best, bestS = p, s
			}
		}
		if best != nil {
			f := w.makeFind(best, askingPrice(best, c.Season), rg.Code, 0)
			f.Golden = true
			f.Tags = append(f.Tags, "golden")
			if rarityRank[f.Rarity] < rarityRank["epic"] {
				f.Rarity = "epic"
			}
			if err := w.addFinds(ctx, q, []Find{f}); err != nil {
				return err
			}
			w.say(rep, "golden_tip", best.Name, 0, "golden")
			return nil
		}
		fallthrough
	case k < 0.75:
		c.TP += 3
		w.say(rep, "golden_tp", "", 3, "golden")
	default:
		amt := int64(1+r.Intn(3)) * M * map[int]int64{1: 10, 2: 6, 3: 4}[max(1, user.Division)] / 10
		user.Budget += amt
		if err := addFinance(ctx, q, c, "golden", amt, ""); err != nil {
			return err
		}
		w.say(rep, "golden_cash", "", amt, "golden")
	}
	return nil
}

// ---------------------------------------------------------------- actions

type MissionReq struct {
	Region  string `json:"region"`
	Pos     string `json:"pos"`
	Focus   string `json:"focus"`
	ScoutID int    `json:"scoutId"`
}

// exploreTx runs an Explore action and saves the career (and the user's budget) afterwards.
func (s *Store) exploreTx(ctx context.Context, careerID int, fn func(w *world, q pgx.Tx) error) error {
	return s.tx(ctx, func(q pgx.Tx) error {
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		w, err := lightWorld(ctx, q, careerID) // clubs, the user's staff and the explore state are all an action needs
		if err != nil {
			return err
		}
		if err := fn(w, q); err != nil {
			return err
		}
		user := w.byID[w.career.UserClubID]
		if _, err := q.Exec(ctx, `UPDATE clubs SET budget=$2 WHERE id=$1`, user.ID, user.Budget); err != nil {
			return err
		}
		return saveCareer(ctx, q, w.career)
	})
}

// scoutsOf: the user's scouts; with none, the manager goes himself (a poor eye).
func (w *world) scoutsOf() []*Coach {
	var out []*Coach
	for _, co := range w.coaches[w.career.UserClubID] {
		if co.Role == "scout" {
			out = append(out, co)
		}
	}
	return out
}

const SelfScoutSkill = 6

func (s *Store) StartMission(ctx context.Context, careerID int, req MissionReq) (*Mission, error) {
	var out *Mission
	err := s.exploreTx(ctx, careerID, func(w *world, q pgx.Tx) error {
		c := w.career
		x := &c.Explore
		rg := w.region(req.Region)
		if rg == nil {
			return userErr("bad_region", "Unknown region")
		}
		if req.Pos != "" && req.Pos != "GK" && req.Pos != "DF" && req.Pos != "MF" && req.Pos != "FW" {
			return userErr("bad_request", "Invalid position")
		}
		okFocus := false
		for _, f := range MissionFocus {
			okFocus = okFocus || f == req.Focus
		}
		if !okFocus {
			req.Focus = "any"
		}
		busy := map[int]bool{}
		for _, m := range x.Missions {
			if m.Left > 0 {
				busy[m.ScoutID] = true
			}
		}
		m := Mission{Region: rg.Code, Pos: req.Pos, Focus: req.Focus, Season: c.Season, Day: c.Day, Days: rg.Days, Left: rg.Days, Cost: rg.Cost}
		scouts := w.scoutsOf()
		if len(scouts) == 0 {
			if busy[-1] {
				return userErr("scouts_busy", "All your scouts are out on missions")
			}
			m.ScoutID, m.Scout, m.Skill = -1, "", SelfScoutSkill
		} else {
			var pickC *Coach
			for _, co := range scouts {
				if !busy[co.ID] && (req.ScoutID == 0 || req.ScoutID == co.ID) {
					pickC = co
					break
				}
			}
			if pickC == nil {
				return userErr("scouts_busy", "All your scouts are out on missions")
			}
			m.ScoutID, m.Scout, m.Skill = pickC.ID, pickC.Name, pickC.Skill
			for _, p := range pickC.Perks {
				if p == "talent_eye" {
					m.Eye = true
				}
			}
		}
		user := w.byID[c.UserClubID]
		if user.Budget < m.Cost {
			return userErr("no_budget", "Not enough budget")
		}
		user.Budget -= m.Cost
		if err := addFinance(ctx, q, c, "scouting", -m.Cost, rg.Country); err != nil {
			return err
		}
		x.NextID++
		m.ID = x.NextID
		x.Missions = append(x.Missions, m)
		x.Regions[rg.Code]++
		x.Stats["regions"] = len(x.Regions)
		out = &m
		return w.unlock(nil)
	})
	return out, err
}

// MarkSeen: the returned reports have been read.
func (s *Store) MarkExploreSeen(ctx context.Context, careerID int) error {
	return s.exploreTx(ctx, careerID, func(w *world, q pgx.Tx) error {
		for i := range w.career.Explore.Missions {
			if w.career.Explore.Missions[i].Left <= 0 {
				w.career.Explore.Missions[i].Seen = true
			}
		}
		return nil
	})
}

// StarFind puts a discovered player on (or off) the shortlist (see toggleStar).
func (s *Store) StarFind(ctx context.Context, careerID, playerID int) error {
	return s.exploreTx(ctx, careerID, func(w *world, q pgx.Tx) error {
		if !toggleStar(w.career, playerID) {
			return ErrNotFound
		}
		return nil
	})
}
