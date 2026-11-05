package game

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// lvMan: a test player with every attribute at lvl (keepers keep, outfielders don't).
func lvMan(id int, name, tag, version, pos string, lvl float64, club int) *Player {
	cid := club
	p := &Player{ID: id, Name: name, Tag: tag, Version: version, Position: pos, Age: 27, Fitness: 100, Morale: 75, ClubID: &cid, History: []int{}}
	for _, a := range AttrNames {
		*p.Attr(a) = lvl
	}
	if pos == "GK" {
		p.Goalkeeping = lvl + 5
	} else {
		p.Goalkeeping = 20
	}
	p.Fill()
	p.Potential = p.Overall
	return p
}

// lvSquad: a keeper and ten ordinary outfielders at 60, ids 1–11.
func lvSquad(club int) []*Player {
	out := []*Player{lvMan(1, "Keeper Example", "", "", "GK", 60, club)}
	pos := []string{"DF", "DF", "DF", "DF", "MF", "MF", "MF", "FW", "FW", "FW"}
	for i, ps := range pos {
		out = append(out, lvMan(2+i, "Filler "+string(rune('A'+i)), "", "", ps, 60, club))
	}
	return out
}

// lvClubs: club 5 is Real Madrix (an era club of legend cards), club 6 a world club whose name got a suffix.
func lvClubs() {
	noteClub(&Club{ID: 5, Name: "Real Madrix"})
	noteClub(&Club{ID: 6, Name: "Rio Rubro-Negro FC"})
}

func idsHave(ids []int, id int) bool {
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

func TestLegendPersonKey(t *testing.T) {
	if a, b := foldName("  Thibaut  Courtoá "), foldName("Thibaut Courtoa"); a != b || a != "thibaut courtoa" {
		t.Fatalf("fold: %q %q", a, b)
	}
	modern := &Player{ID: 1, Name: "Vini Juniór"}
	card := &Player{ID: 2, Name: "Vini Juniór", Tag: "legend", Version: "Real Madrix '24"}
	if k := personKey(modern); k == "" || k != personKey(card) || !samePerson(modern, card) {
		t.Fatalf("modern and legend Vini are not one person: %q %q", personKey(modern), personKey(card))
	}
	// accents differ between the modern player and the card: still one person
	if personKey(&Player{Name: "Thibaut Courtoa"}) != personKey(&Player{Name: "Thibaut Courtoá", Tag: "legend"}) {
		t.Fatal("Courtoa / Courtoá are not one person")
	}
	// the names legendModerns looks for: the modern stars who are also legends, in their own spelling
	names := map[string]bool{}
	for _, n := range modernNames() {
		names[n] = true
	}
	for _, n := range []string{"Vini Juniór", "Kylian Mbapé", "Thibaut Courtoa", "Robert Lewandowsky"} {
		if !names[n] {
			t.Errorf("modernNames misses %q", n)
		}
	}
	for _, p := range []*Player{
		{Name: "Vini Juniór", Tag: "custom"}, // a custom design is nobody but himself
		{Name: "Vini Juniór Jr."},            // a retired star's son is someone else
		{Name: "Somebody Ordinary"},
	} {
		if k := personKey(p); k != "" {
			t.Fatalf("%q (%s) got a person key %q", p.Name, p.Tag, k)
		}
	}
}

func TestLegendMergeFormula(t *testing.T) {
	legend := lvMan(10, "Vini Juniór", "legend", "Rio Rubro-Negro '18", "FW", 70, 5)
	legend.Pace, legend.Dribbling, legend.Defending = 80, 85, 30
	legend.Fill()
	legend.Potential, legend.Shirt, legend.Tenure = 80, 31, 0
	modern := lvMan(11, "Vini Juniór", "", "", "FW", 80, 5)
	modern.Pace, modern.Shooting, modern.Dribbling, modern.Physical, modern.Goalkeeping = 95, 88, 92, 70, 15
	modern.Fill()
	modern.Potential, modern.Shirt, modern.Tenure = 91, 7, 40
	if modern.Overall < 85 {
		t.Fatalf("test setup: the modern player should be 85+ (is %d)", modern.Overall)
	}
	want := map[string]float64{}
	for _, a := range AttrNames {
		want[a] = math.Min(IconMax, math.Max(*legend.Attr(a), *modern.Attr(a))+1)
	}
	m := mergeVersions(legend, modern, true)
	for _, a := range AttrNames {
		if got := *legend.Attr(a); got != want[a] {
			t.Errorf("%s = %v, want %v", a, got, want[a])
		}
	}
	if legend.Potential != max(91+2+2, legend.Overall) {
		t.Errorf("potential %d, want %d (91 + 2 + 2 for an 85+ contemporary)", legend.Potential, 95)
	}
	if legend.Shirt != 7 || legend.Tenure != 40 {
		t.Errorf("shirt %d tenure %d: the signed card takes the modern player's number (7) and keeps his games", legend.Shirt, legend.Tenure)
	}
	if !modern.Retired || modern.ClubID != nil {
		t.Error("the modern player is still at the club")
	}
	if m.Signed != "legend" || m.Absorbed != "Vini Juniór" || m.Name != "Vini Juniór (Rio Rubro-Negro '18)" || m.OvrAfter != legend.Overall ||
		m.PotAfter != legend.Potential || m.PotBefore != 80 || m.Legend != legend {
		t.Errorf("merge note: %+v", m)
	}
	for ovr, b := range map[int]int{70: 0, 77: 0, 78: 1, 84: 1, 85: 2, 93: 2} {
		if mergeBonus(ovr) != b {
			t.Errorf("bonus for %d: %d, want %d", ovr, mergeBonus(ovr), b)
		}
	}
	// the icon cap, and the reverse merge (the modern player signs): the legend keeps his own number
	l2 := lvMan(20, "Kylian Mbapé", "legend", "Icon", "FW", 109.5, 5)
	l2.Shirt, l2.Potential = 10, 108
	m2 := lvMan(21, "Kylian Mbapé", "", "", "FW", 100, 5)
	m2.Shirt, m2.Potential = 44, 99
	r := mergeVersions(l2, m2, false)
	if l2.Pace != IconMax || l2.Potential != IconMax || l2.Shirt != 10 || r.Signed != "modern" {
		t.Errorf("cap / reverse: pace %v pot %d shirt %d %q", l2.Pace, l2.Potential, l2.Shirt, r.Signed)
	}
	// a weak contemporary (no bonus): the higher potential + 2
	l3 := lvMan(30, "Jan Oblac", "legend", "Icon", "GK", 80, 5)
	l3.Potential = 84
	m3 := lvMan(31, "Jan Oblac", "", "", "GK", 60, 5)
	m3.Potential = 70
	mergeVersions(l3, m3, true)
	if l3.Potential != max(86, l3.Overall) {
		t.Errorf("weak contemporary: potential %d, want 86", l3.Potential)
	}
}

func TestLegendMergePartner(t *testing.T) {
	lvClubs()
	const club = 5
	home := lvMan(40, "Vini Juniór", "legend", "Real Madrix '24", "FW", 75, club)
	home.History = []int{club} // his card from an era at this club
	icon := lvMan(41, "Vini Juniór", "legend", "Icon", "FW", 90, club)
	icon.History = []int{club}
	newcomer := lvMan(42, "Vini Juniór", "", "", "FW", 85, club)
	squad := append(lvSquad(club), home, icon, newcomer)
	if !isClubVersion(home) || isClubVersion(icon) {
		t.Fatal("club version detection")
	}
	// a card whose era club is missing from this world is nobody's club version, even though the club that
	// signed him is the first in his history
	for _, c := range []struct {
		version string
		club    int
	}{{"Paris Lumière '22", 5}, {"Rio Rubro-Negro '18", 6}} {
		p := lvMan(45, "Lionel Messo", "legend", c.version, "FW", 80, c.club)
		p.History = []int{c.club}
		if !isHomeCard(p, c.club) || isClubVersion(p) {
			t.Fatalf("%s at club %d: home card %v, club version %v", c.version, c.club, isHomeCard(p, c.club), isClubVersion(p))
		}
	}
	// a modern player who joins merges into the version that plays: the club version while he is fit
	if l, m := mergePartner(newcomer, squad, nil); l != home || m != newcomer {
		t.Fatalf("partner: %v %v", l, m)
	}
	home.Injury = 3
	if l, _ := mergePartner(newcomer, squad, nil); l != icon {
		t.Fatalf("with the club version injured the best fit version takes him, got %v", l)
	}
	home.Injury = 0
	// a card that joins absorbs the modern player at the club, unless he is only borrowed or at another club
	card := lvMan(43, "Vini Juniór", "legend", "Rio Rubro-Negro '18", "FW", 70, club)
	sq := append(lvSquad(club), card, newcomer)
	if l, m := mergePartner(card, sq, nil); l != card || m != newcomer {
		t.Fatalf("card partner: %v %v", l, m)
	}
	if l, _ := mergePartner(card, sq, map[int]bool{newcomer.ID: true}); l != nil {
		t.Fatal("a borrowed player merged")
	}
	away, mine := 9, club
	newcomer.ClubID = &away
	if l, _ := mergePartner(card, sq, nil); l != nil {
		t.Fatal("a player at another club merged")
	}
	newcomer.ClubID = &mine
	custom := lvMan(44, "Vini Juniór", "custom", "", "FW", 70, club)
	if l, _ := mergePartner(custom, append(sq, custom), nil); l != nil {
		t.Fatal("a custom design merged")
	}
}

func TestBestLineupOneVersion(t *testing.T) {
	lvClubs()
	const club = 5
	home := lvMan(50, "Vini Juniór", "legend", "Real Madrix '24", "FW", 75, club)
	home.History = []int{club}
	icon := lvMan(51, "Vini Juniór", "legend", "Icon", "FW", 90, club)
	old := lvMan(52, "Vini Juniór", "legend", "Rio Rubro-Negro '18", "FW", 72, club)
	squad := append(lvSquad(club), home, icon, old)
	for _, f := range []string{"4-3-3", "4-4-2", "3-5-2"} {
		ids := BestLineup(squad, f)
		n := 0
		for _, id := range []int{50, 51, 52} {
			if idsHave(ids, id) {
				n++
			}
		}
		if n != 1 || !idsHave(ids, home.ID) {
			t.Fatalf("%s: %d versions picked (%v), want only the club version", f, n, ids)
		}
	}
	home.Injury = 2
	if ids := BestLineup(squad, "4-3-3"); !idsHave(ids, icon.ID) || idsHave(ids, home.ID) || idsHave(ids, old.ID) {
		t.Fatalf("club version injured: want the best-rated version, got %v", ids)
	}
	home.Injury, home.Rushed = 1, true // cleared to play a week early: not fit, so a fit version goes first
	if ids := BestLineup(squad, "4-3-3"); !idsHave(ids, icon.ID) || idsHave(ids, home.ID) {
		t.Fatalf("club version rushed back: want the fit version, got %v", ids)
	}
	home.Injury, home.Rushed = 0, false
	// a computer club with a modern star and a legend card of him: the best-rated one plays
	modern := lvMan(53, "Vini Juniór", "", "", "FW", 88, 7)
	card := lvMan(54, "Vini Juniór", "legend", "Icon", "FW", 84, 7)
	ai := append(lvSquad(7), modern, card)
	if ids := BestLineup(ai, "4-3-3"); !idsHave(ids, modern.ID) || idsHave(ids, card.ID) {
		t.Fatalf("AI club: %v", ids)
	}
}

func TestMatchdaySquadOneVersion(t *testing.T) {
	lvClubs()
	const club = 5
	home := lvMan(60, "Vini Juniór", "legend", "Real Madrix '24", "FW", 75, club)
	home.History = []int{club}
	icon := lvMan(61, "Vini Juniór", "legend", "Icon", "FW", 90, club)
	old := lvMan(62, "Vini Juniór", "legend", "Rio Rubro-Negro '18", "FW", 72, club)
	modern := lvMan(63, "Kylian Mbapé", "", "", "FW", 80, club) // loaned in: not merged
	mcard := lvMan(64, "Kylian Mbapé", "legend", "Monaco Rouge '17", "FW", 70, club)
	squad := append(lvSquad(club), home, icon, old, modern, mcard)
	byID := map[int]*Player{}
	for _, p := range squad {
		byID[p.ID] = p
	}
	// the bench: nobody who is another version of a starter, and one version of anyone else
	starters := []*Player{byID[1], byID[2], byID[3], byID[4], byID[5], byID[6], byID[7], byID[8], byID[9], byID[10], home}
	bench := benchOf(starters, squad)
	for _, p := range bench {
		if personKey(p) == personKey(home) {
			t.Fatalf("another version of a starter is on the bench: %s (%s)", p.Name, p.Version)
		}
	}
	nM := 0
	for _, p := range bench {
		if personKey(p) == personKey(modern) {
			nM++
			if p != modern {
				t.Fatalf("the better-rated Mbapé should be on the bench, got %s", p.Version)
			}
		}
	}
	if nM != 1 {
		t.Fatalf("%d Mbapés on the bench", nM)
	}
	// a saved line-up with two versions (an old save): the club version stays, the gap goes to someone else
	cl := &Club{Formation: "4-3-3", Lineup: []int{1, 2, 3, 4, 5, 6, 7, 8, 61, 11, 60}}
	ids := resolveLineup(cl, squad)
	if idsHave(ids, 61) || !idsHave(ids, 60) || idsHave(ids, 62) {
		t.Fatalf("resolved line-up keeps two versions or the wrong one: %v", ids)
	}
	for _, id := range ids {
		if id < 0 {
			t.Fatalf("a gap was left: %v", ids)
		}
	}
}

func TestTwoVersionsCheck(t *testing.T) {
	const club = 5
	a := lvMan(70, "Vini Juniór", "legend", "Real Madrix '24", "FW", 75, club)
	b := lvMan(71, "Vini Juniór", "legend", "Icon", "FW", 90, club)
	m := lvMan(72, "Vini Juniór", "", "", "FW", 85, club)
	c1 := lvMan(73, "Vini Juniór", "custom", "", "FW", 70, club)
	c2 := lvMan(74, "Vini Juniór", "custom", "", "FW", 70, club)
	byID := map[int]*Player{}
	for _, p := range append(lvSquad(club), a, b, m, c1, c2) {
		byID[p.ID] = p
	}
	base := []int{1, 2, 3, 4, 5, 6, 7, 8, 9}
	cases := []struct {
		add  []int
		want bool
	}{
		{[]int{70, 71}, true},  // two legend versions
		{[]int{70, 72}, true},  // a legend version and his modern self
		{[]int{70, 10}, false}, // one version
		{[]int{73, 74}, false}, // custom designs are only themselves
		{[]int{70, 70}, false}, // the same man twice is the "duplicate" error, not this one
	}
	for _, c := range cases {
		if got := twoVersions(append(append([]int{}, base...), c.add...), byID); got != c.want {
			t.Errorf("%v: %v, want %v", c.add, got, c.want)
		}
	}
}

func TestLegendLimitBreak(t *testing.T) {
	c := &Career{Season: 3, Care: Care{Breaks: map[int]int{}}}
	legend := lvMan(80, "Vini Juniór", "legend", "Rio Rubro-Negro '18", "FW", 70, 5)
	legend.Potential = 90 // far from his limit
	modern := lvMan(81, "Somebody Young", "", "", "FW", 70, 5)
	modern.Potential, modern.Age = 90, 22
	custom := lvMan(82, "My Design", "custom", "", "FW", 70, 5)
	custom.Potential = 90
	if got := breakCheck(c, legend); got != "" {
		t.Fatalf("a low-rated legend can't break his limit: %q", got)
	}
	if got := breakCheck(c, modern); got != "not_at_limit" {
		t.Fatalf("modern player far from his limit: %q", got)
	}
	if got := breakCheck(c, custom); got != "not_at_limit" {
		t.Fatalf("a custom design follows the normal rule: %q", got)
	}
	c.Care.Breaks[legend.ID] = c.Season
	if got := breakCheck(c, legend); got != "break_done" {
		t.Fatalf("second break in a season: %q", got)
	}
	c.Care.Breaks[legend.ID] = c.Season - 1
	legend.Potential = IconMax
	if got := breakCheck(c, legend); got != "max_potential" {
		t.Fatalf("at the icon cap: %q", got)
	}
	legend.Potential, legend.Age = 90, 36 // legends never age out of it
	if got := breakCheck(c, legend); got != "" {
		t.Fatalf("legend aged 36: %q", got)
	}
	modern.Age = 31
	if got := breakCheck(c, modern); got != "too_old" {
		t.Fatalf("modern player aged 31: %q", got)
	}
	modern.Age, modern.Potential = 22, modern.Overall+1 // at his limit: the normal rule lets him
	if got := breakCheck(c, modern); got != "" {
		t.Fatalf("modern player at his limit: %q", got)
	}
}

func TestLegendCardFloor(t *testing.T) {
	peak, ok := legendPeaks()[foldName("Kylian Mbapé")]
	if !ok || peak != 25 {
		t.Fatalf("Mbapé's peak age: %d %v", peak, ok)
	}
	if d := careerCurve(25, peak) - careerCurve(28, peak); math.Abs(d-2.25) > 1e-9 {
		t.Fatalf("Icon vs a 28-year-old: %v, want +2.25", d)
	}
	if d := careerCurve(19, peak) - careerCurve(28, peak); math.Abs(d+3.15) > 1e-9 {
		t.Fatalf("age-19 card vs a 28-year-old: %v, want −3.15", d)
	}
	mk := func(age int) *Player {
		p := lvMan(90+age, "Kylian Mbapé", "legend", "Real Madrix '25", "FW", 75, 0)
		p.ClubID, p.Age, p.Potential = nil, age, 92
		return p
	}
	modern := lvMan(99, "Kylian Mbapé", "", "", "FW", 80, 3)
	modern.Age, modern.Passing, modern.Physical, modern.Potential = 28, 85, 93, 99
	modern.Fill()

	icon := mk(25)
	icon.Version = "Icon"
	if !cardFloor(icon, modern) {
		t.Fatal("the Icon card was not lifted")
	}
	for _, a := range AttrNames {
		if got, want := *icon.Attr(a), math.Max(75, *modern.Attr(a)+2.25); a != "goalkeeping" && math.Abs(got-want) > 1e-9 {
			t.Errorf("Icon %s = %v, want %v", a, got, want)
		}
		if *icon.Attr(a) < *modern.Attr(a) {
			t.Errorf("Icon %s %v is below the modern player's %v", a, *icon.Attr(a), *modern.Attr(a))
		}
	}
	if icon.Potential != 101 || icon.Overall < modern.Overall {
		t.Errorf("Icon potential %d (want 101), overall %d vs modern %d", icon.Potential, icon.Overall, modern.Overall)
	}

	young := mk(19) // the Monaco '17 kind of card: below him by the curve
	young.Version = "Monaco Rouge '17"
	cardFloor(young, modern)
	if math.Abs(young.Passing-(85-3.15)) > 1e-9 || math.Abs(young.Physical-(93-3.15)) > 1e-9 || young.Potential != 96 {
		t.Errorf("young card: passing %v physical %v potential %d", young.Passing, young.Physical, young.Potential)
	}
	if young.Passing >= modern.Passing || math.Abs(young.Pace-(80-3.15)) > 1e-9 {
		t.Errorf("a younger card is not below the modern player by the curve: passing %v pace %v", young.Passing, young.Pace)
	}

	// no modern player of him (or someone else's): no change; a card already above the floor keeps his numbers
	plain := mk(27)
	attrs := func(p *Player) [8]float64 {
		return [8]float64{p.Pace, p.Shooting, p.Passing, p.Dribbling, p.Defending, p.Physical, p.Goalkeeping, float64(p.Potential)}
	}
	before := attrs(plain)
	if cardFloor(plain, nil) || cardFloor(plain, lvMan(98, "Vini Juniór", "", "", "FW", 99, 3)) || attrs(plain) != before {
		t.Fatal("changed without a modern player of the same person")
	}
	strong := mk(25)
	strong.Passing = 100
	cardFloor(strong, modern)
	if strong.Passing != 100 {
		t.Errorf("a stronger card was lowered: %v", strong.Passing)
	}
	// capped at IconMax
	top := mk(25)
	big := lvMan(97, "Kylian Mbapé", "", "", "FW", 109, 3)
	big.Age, big.Potential = 28, 109
	cardFloor(top, big)
	if top.Pace != IconMax || top.Potential != IconMax {
		t.Errorf("cap: pace %v potential %d", top.Pace, top.Potential)
	}
	// a retired modern player or a custom design does not count
	gone := lvMan(96, "Kylian Mbapé", "", "", "FW", 99, 3)
	gone.Retired = true
	if cardFloor(mk(25), gone) {
		t.Error("a retired modern player lifted the card")
	}
}

func TestLegendMergeRecords(t *testing.T) {
	c := &Career{UserClubID: 5, Contracts: Contracts{Players: map[int]int64{11: 5000}, Years: map[int]int{11: 3}, Demands: []Demand{{Kind: "player", ID: 11}, {Kind: "coach", ID: 11}}},
		Care: Care{Load: map[int]string{11: "rest"}}}
	c.Events.Captain = 11
	legend := &Player{ID: 10}
	modern := &Player{ID: 11}
	club := &Club{Lineup: []int{1, 11, 3}}
	tidyAfterMerge(c, club, legend, modern)
	if club.Lineup[1] != 10 || c.Events.Captain != 10 {
		t.Errorf("lineup %v captain %d: the legend takes his place", club.Lineup, c.Events.Captain)
	}
	if _, ok := c.Contracts.Players[11]; ok || len(c.Contracts.Demands) != 1 || c.Care.Load[11] != "" {
		t.Errorf("his contract, demands or care are still there: %+v", c.Contracts)
	}
	life := &ClubLife{Roster: []RosterEntry{{ID: 1}, {ID: 11, Ovr: 88}}, Legends: []LegendEntry{{PlayerID: 11, Reason: "active", Shirt: 7}}}
	life.Fans.Fav = 11
	handOver(life, modern, legend)
	if len(life.Roster) != 1 || life.Roster[0].ID != 1 || life.Fans.Fav != 10 || life.Legends[0].PlayerID != 10 {
		t.Errorf("club life after the merge: %+v", life)
	}
}

// nopDB accepts writes and refuses reads (the world-side merge only writes).
type nopDB struct{ execs int }

func (d *nopDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	d.execs++
	return pgconn.CommandTag{}, nil
}
func (d *nopDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("no reads in this test")
}
func (d *nopDB) QueryRow(context.Context, string, ...any) pgx.Row { return nil }

// A Deadline Day bargain (or a player back from loan) who meets a legend version of himself at the club
// merges into it: the legend keeps his number, the modern player leaves the squad lists and the log says so.
func TestArrivalMergeWorld(t *testing.T) {
	lvClubs()
	const uid = 5
	c := &Career{ID: 1, UserClubID: uid, Season: 2, Day: 10, Contracts: Contracts{Players: map[int]int64{}, Years: map[int]int{}}}
	user := &Club{ID: uid, Name: "Real Madrix", IsUser: true, Formation: "4-3-3", Lineup: []int{}}
	legend := lvMan(100, "Vini Juniór", "legend", "Real Madrix '24", "FW", 80, uid)
	legend.Shirt, legend.Potential = 7, 84
	modern := lvMan(101, "Vini Juniór", "", "", "FW", 86, uid)
	modern.Shirt, modern.Potential = 30, 92
	c.Contracts.Players[modern.ID], c.Contracts.Years[modern.ID] = 90_000, 3
	life := &ClubLife{Init: true, Roster: []RosterEntry{{ID: legend.ID}}}
	w := &world{career: c, byID: map[int]*Club{uid: user}, players: map[int][]*Player{uid: append(lvSquad(uid), legend, modern)}, life: life}
	db := &nopDB{}
	m, err := w.arrivalMerge(context.Background(), db, nil, modern)
	if err != nil || m == nil || m.Legend != legend || m.Signed != "modern" {
		t.Fatalf("merge: %v %+v", err, m)
	}
	if legend.Shirt != 7 || legend.Potential != max(92+2+2, legend.Overall) || legend.Pace != 87 {
		t.Errorf("legend after the merge: shirt %d pot %d pace %v", legend.Shirt, legend.Potential, legend.Pace)
	}
	if !modern.Retired || modern.ClubID != nil || w.mine(modern.ID) != nil {
		t.Error("the modern player is still in the squad")
	}
	for _, p := range w.players[uid] {
		if p.ID == modern.ID {
			t.Fatal("the modern player is still in the club's list")
		}
	}
	if _, ok := c.Contracts.Players[modern.ID]; ok || db.execs == 0 {
		t.Errorf("contract kept or nothing saved (%d writes)", db.execs)
	}
	if len(c.Events.Log) == 0 || c.Events.Log[0].Key != "legend_merged" || c.Events.Log[0].Name != "Vini Juniór (Real Madrix '24)" {
		t.Errorf("club log: %+v", c.Events.Log)
	}
	// someone who is nobody's other version does not merge
	plain := lvMan(102, "Somebody Ordinary", "", "", "MF", 70, uid)
	w.players[uid] = append(w.players[uid], plain)
	if m, err := w.arrivalMerge(context.Background(), db, nil, plain); m != nil || err != nil {
		t.Fatalf("an ordinary player merged: %+v %v", m, err)
	}
}
