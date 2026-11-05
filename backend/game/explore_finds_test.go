package game

import (
	"reflect"
	"sort"
	"testing"
)

// The scouting screen's discovery log: a player who joined your club leaves it (log, shortlist and
// feed), a report you don't shortlist fades after ScoutFindDays matchdays (the off-season counts as
// none), and a shortlisted one stays until you take him off the list.

const scoutUser, scoutOther = 1, 2

func scoutWorld(season, day int, fs ...Find) *world {
	c := &Career{Season: season, Day: day, UserClubID: scoutUser}
	c.Explore.ensure()
	c.Explore.Finds = fs
	user := &Club{ID: scoutUser, Name: "Us", IsUser: true}
	other := &Club{ID: scoutOther, Name: "Them"}
	return &world{career: c, clubs: []*Club{user, other}, byID: map[int]*Club{scoutUser: user, scoutOther: other},
		players: map[int][]*Player{}}
}

func scoutFind(id int, name string, season, day int) Find {
	return Find{PlayerID: id, Name: name, Season: season, Day: day, Rarity: "rare", ClubID: scoutOther, Club: "Them"}
}

// scoutPlayers: every reported player as he is today, at club scoutOther unless moved.
func scoutPlayers(w *world, moved map[int]int) map[int]*Player {
	now := map[int]*Player{}
	for _, f := range w.career.Explore.Finds {
		club := scoutOther
		if c, ok := moved[f.PlayerID]; ok {
			club = c
		}
		now[f.PlayerID] = &Player{ID: f.PlayerID, Name: f.Name, ClubID: &club, Age: 24, Overall: 70}
	}
	return now
}

// shownLeft: the reports on the scouting screen, player id → matchdays left (0: on the shortlist).
func shownLeft(w *world, now map[int]*Player) map[int]int {
	vs, _ := w.findViews(now)
	out := map[int]int{}
	for _, v := range vs {
		out[v.PlayerID] = v.Left
	}
	return out
}

func feedLines(items []FeedItem) []string {
	out := []string{}
	for _, it := range items {
		out = append(out, it.Key+":"+it.Name)
	}
	sort.Strings(out)
	return out
}

func TestScoutFindSignedLeavesTheScreen(t *testing.T) {
	keep := scoutFind(10, "Keeper", 2, 20)
	signed := scoutFind(11, "Signed", 2, 20)
	signed.Signed = true
	starred := scoutFind(12, "Starred", 2, 18) // on the shortlist, then signed
	starred.Star, starred.Signed = true, true
	bought := scoutFind(13, "Bought", 2, 19) // bought today: trackSquad hasn't marked him yet
	bought.Golden = true
	w := scoutWorld(2, 20, keep, signed, starred, bought)
	x := &w.career.Explore
	x.Stats["signed_finds"], x.Stats["finds"], x.Stats["found_legendary"] = 2, 9, 1
	x.Feed = []FeedItem{
		{ComEvent: ComEvent{Key: "golden_tip", Name: "Bought"}, Season: 2, Day: 19, Rarity: "golden"},
		{ComEvent: ComEvent{Key: "find_legendary", Name: "Signed"}, Season: 2, Day: 20, Rarity: "legendary"},
		{ComEvent: ComEvent{Key: "find_legendary", Name: "Keeper"}, Season: 2, Day: 20, Rarity: "legendary"},
		{ComEvent: ComEvent{Key: "mission_back", Name: "BR", Amount: 3}, Season: 2, Day: 20},
		{ComEvent: ComEvent{Key: "ach", Name: "sign_find"}, Season: 2, Day: 20, Rarity: "silver"},
	}

	now := scoutPlayers(w, map[int]int{11: scoutUser, 12: scoutUser, 13: scoutUser})
	vs, yours := w.findViews(now)
	if len(vs) != 1 || vs[0].PlayerID != 10 || vs[0].Status != "club" || vs[0].NowClub != "Them" || vs[0].Left != ScoutFindDays {
		t.Fatalf("log: %+v", vs)
	}
	if !reflect.DeepEqual(yours, map[int]bool{13: true}) {
		t.Errorf("yours: %v", yours)
	}
	got := feedLines(shownFeed(w.career, yours))
	want := []string{"ach:sign_find", "find_legendary:Keeper", "mission_back:BR"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("feed: %v, want %v", got, want)
	}
	if len(x.Finds) != 4 || len(x.Feed) != 5 {
		t.Errorf("the view must not change what is stored: %d finds, %d feed lines", len(x.Finds), len(x.Feed))
	}
	if x.Stats["signed_finds"] != 2 || x.Stats["finds"] != 9 || x.Stats["found_legendary"] != 1 {
		t.Errorf("hiding changed the counters: %v", x.Stats)
	}

	// the next matchday marks him Signed and counts him once; he stays off the screen for good
	w.players[scoutUser] = []*Player{now[13]}
	w.trackSquad()
	w.trackSquad()
	if !x.Finds[3].Signed || x.Stats["signed_finds"] != 3 || x.Stats["finds"] != 9 || x.Stats["found_legendary"] != 1 {
		t.Errorf("after the matchday: %+v, stats %v", x.Finds[3], x.Stats)
	}
	other := scoutOther
	now[13].ClubID = &other // sold on again: his report doesn't come back
	if left := shownLeft(w, now); !reflect.DeepEqual(left, map[int]int{10: ScoutFindDays}) {
		t.Errorf("after the sale: %v", left)
	}
}

func TestScoutFindFades(t *testing.T) {
	d := ScoutFindDays
	fresh := scoutFind(1, "Fresh", 3, 20)
	lastDay := scoutFind(2, "LastDay", 3, 20-(d-1))
	faded := scoutFind(3, "Faded", 3, 20-d)
	old := scoutFind(4, "Old", 3, 2)
	starred := scoutFind(5, "Starred", 3, 20-d)
	starred.Star = true
	ancient := scoutFind(6, "Ancient", 1, 3) // two seasons ago, still on the shortlist
	ancient.Star = true
	w := scoutWorld(3, 20, fresh, lastDay, faded, old, starred, ancient)
	got := shownLeft(w, scoutPlayers(w, nil))
	want := map[int]int{1: d, 2: 1, 5: 0, 6: 0}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("on show: %v, want %v", got, want)
	}

	// shortlisted reports never fade, whatever the date
	w.career.Season, w.career.Day = 9, 30
	if got := shownLeft(w, scoutPlayers(w, nil)); !reflect.DeepEqual(got, map[int]int{5: 0, 6: 0}) {
		t.Errorf("years later: %v", got)
	}
}

func TestScoutFindSeasonChange(t *testing.T) {
	last := len(Calendar)
	late := scoutFind(1, "Late", 1, last-2)     // matchday 52 of season 1
	summer := scoutFind(2, "Summer", 1, last+1) // came back during the off-season friendlies
	w := scoutWorld(1, last-2, late, summer)
	c := w.career
	check := func(f *Find, name string, season, day, want int) {
		t.Helper()
		c.Season, c.Day = season, day
		if l := findLeft(c, f); l != want {
			t.Errorf("season %d day %d: the %s report has %d matchdays left, want %d", season, day, name, l, want)
		}
	}
	lf, sf := &c.Explore.Finds[0], &c.Explore.Finds[1]
	check(lf, "late", 1, last-2, 5)
	check(lf, "late", 1, last, 3)
	check(lf, "late", 1, last+1, 2) // the off-season, however many friendlies are played in it
	check(lf, "late", 2, 1, 2)      // the summer counts as no time
	check(lf, "late", 2, 2, 1)      // matchday 2 of season 2: still there, on its last day
	check(lf, "late", 2, 3, 0)
	check(sf, "summer", 1, last+1, 5)
	check(sf, "summer", 2, 1, 5)
	check(sf, "summer", 2, 2, 4)
	check(sf, "summer", 2, 5, 1)
	check(sf, "summer", 2, 6, 0)
	check(sf, "summer", 3, 1, 0)

	c.Season, c.Day = 2, 2
	if got := shownLeft(w, scoutPlayers(w, nil)); !reflect.DeepEqual(got, map[int]int{1: 1, 2: 4}) {
		t.Errorf("matchday 2 of season 2: %v", got)
	}
	c.Day = 3
	if got := shownLeft(w, scoutPlayers(w, nil)); !reflect.DeepEqual(got, map[int]int{2: 3}) {
		t.Errorf("matchday 3 of season 2: %v", got)
	}
}

func TestScoutFindUnstar(t *testing.T) {
	last := len(Calendar)
	old := scoutFind(7, "Old", 1, 10)
	old.Star = true
	w := scoutWorld(2, last-1, old)
	c := w.career
	f := &c.Explore.Finds[0]
	if !toggleStar(c, 7) || f.Star || f.Since != c.now() {
		t.Fatalf("unstar: %+v", f)
	}
	if l := findLeft(c, f); l != ScoutFindDays {
		t.Errorf("taken off the shortlist: %d matchdays left, want a fresh %d", l, ScoutFindDays)
	}
	c.Season, c.Day = 3, 1 // matchdays 53 and 54, then the summer
	if l := findLeft(c, f); l != ScoutFindDays-2 {
		t.Errorf("next season: %d left, want %d", l, ScoutFindDays-2)
	}
	c.Day = ScoutFindDays - 2
	if got := shownLeft(w, scoutPlayers(w, nil)); !reflect.DeepEqual(got, map[int]int{7: 1}) {
		t.Errorf("its last matchday: %v", got)
	}
	c.Day = ScoutFindDays - 1
	if got := shownLeft(w, scoutPlayers(w, nil)); len(got) != 0 {
		t.Errorf("should have faded: %v", got)
	}
	if !toggleStar(c, 7) || !f.Star || f.Since != 0 { // back on the shortlist (from a page left open)
		t.Errorf("star again: %+v", f)
	}
	if got := shownLeft(w, scoutPlayers(w, nil)); !reflect.DeepEqual(got, map[int]int{7: 0}) {
		t.Errorf("on the shortlist again: %v", got)
	}
	if toggleStar(c, 99) {
		t.Error("starred a player nobody reported")
	}
}

func TestScoutFindMemory(t *testing.T) {
	var fs []Find
	fs = append(fs, scoutFind(1, "New1", 5, 30), scoutFind(2, "New2", 5, 29)) // on show
	for i := 0; i < scoutMemory+10; i++ {                                     // faded, newest first
		fs = append(fs, scoutFind(100+i, "Gone", 5, 20))
	}
	kept := scoutFind(3, "Kept", 4, 7)
	kept.Star = true
	signed := scoutFind(4, "SignedStar", 5, 21) // shortlisted and signed: memory like any other
	signed.Star, signed.Signed = true, true
	fs = append(fs, kept, signed)
	w := scoutWorld(5, 30, fs...)
	x := &w.career.Explore
	x.Stats["finds"] = 500
	pruneFinds(w.career)
	ids := []int{}
	for _, f := range x.Finds {
		ids = append(ids, f.PlayerID)
	}
	want := []int{1, 2}
	for i := 0; i < scoutMemory; i++ {
		want = append(want, 100+i)
	}
	want = append(want, 3)
	if !reflect.DeepEqual(ids, want) {
		t.Errorf("kept %v\nwant %v", ids, want)
	}
	if x.Stats["finds"] != 500 {
		t.Errorf("finds counter changed: %d", x.Stats["finds"])
	}
	if got := shownLeft(w, scoutPlayers(w, nil)); !reflect.DeepEqual(got, map[int]int{1: ScoutFindDays, 2: ScoutFindDays - 1, 3: 0}) {
		t.Errorf("on show: %v", got)
	}
}
