package game

import (
	"math/rand"
	"testing"
)

// lockSquad: a numbered squad of fresh players.
func lockSquad(seed int64) []*Player {
	squad := GenSquad(rand.New(rand.NewSource(seed)), []string{"EN"}, 74, nil)
	for i, p := range squad {
		p.ID = i + 1
		p.Fitness = 100
	}
	return squad
}

// weakest: the lowest-rated fit outfield player of a position the assistant leaves out.
func weakest(squad []*Player, pos string, xi []int) *Player {
	in := map[int]bool{}
	for _, id := range xi {
		in[id] = true
	}
	var w *Player
	for _, p := range squad {
		if p.Position == pos && !in[p.ID] && (w == nil || p.Overall < w.Overall) {
			w = p
		}
	}
	return w
}

func slotOf(xi []int, id int) int {
	for s, x := range xi {
		if x == id {
			return s
		}
	}
	return -1
}

func checkXI(t *testing.T, xi []int, n int) {
	t.Helper()
	seen := map[int]bool{}
	for _, id := range xi {
		if id <= 0 || seen[id] {
			t.Fatalf("bad eleven %v", xi)
		}
		seen[id] = true
	}
	if len(xi) != n {
		t.Fatalf("%d players for %d slots", len(xi), n)
	}
}

// A locked bench-level player keeps his slot in the assistant's eleven; the rest is still the best around him,
// and with nothing locked the pick is BestLineup's.
func TestBestLineupHeld(t *testing.T) {
	for seed := int64(1); seed <= 20; seed++ {
		squad := lockSquad(seed)
		best := BestLineup(squad, "4-4-2")
		if got := BestLineupHeld(squad, "4-4-2", nil); slotOf(got, best[0]) != 0 || len(got) != len(best) {
			t.Fatalf("seed %d: nothing held changed the pick", seed)
		}
		roles := Formations["4-4-2"]
		st := -1
		for s, r := range roles {
			if RoleCat(r) == "FW" {
				st = s
			}
		}
		kid := weakest(squad, "FW", best)
		if kid == nil {
			continue
		}
		xi := BestLineupHeld(squad, "4-4-2", map[int]int{st: kid.ID})
		checkXI(t, xi, len(roles))
		if xi[st] != kid.ID {
			t.Errorf("seed %d: the locked %s is at %d, want %d", seed, kid.Name, slotOf(xi, kid.ID), st)
		}
		// the keeper and the back four are untouched by a lock up front
		for s, r := range roles {
			if RoleCat(r) == "DF" || r == "GK" {
				if xi[s] != best[s] {
					t.Errorf("seed %d: slot %s changed from %d to %d", seed, r, best[s], xi[s])
				}
			}
		}
	}
}

// A locked legend keeps his slot and his other version sits out; an injured locked player is covered, and is
// back in his slot (also in a saved eleven) once fit.
func TestLockedLegendAndInjury(t *testing.T) {
	squad := lockSquad(3)
	a := GenPlayer(rand.New(rand.NewSource(1)), []string{"EN"}, "FW", 70, 20, 20)
	b := GenPlayer(rand.New(rand.NewSource(2)), []string{"EN"}, "FW", 95, 25, 25)
	a.Name, b.Name = "Raul Testez", "Raul Testez"
	a.Tag, b.Tag = "legend", "legend"
	a.Version, b.Version = "Old '97", "Old '01"
	a.ID, b.ID = 500, 501
	a.Fitness, b.Fitness = 100, 100
	squad = append(squad, a, b)
	if !samePerson(a, b) {
		t.Fatal("the two cards are not one person: the test proves nothing")
	}
	roles := Formations["4-3-3"]
	free := BestLineup(squad, "4-3-3")
	if slotOf(free, b.ID) < 0 || slotOf(free, a.ID) >= 0 {
		t.Fatalf("the assistant should pick the better version: %v", free)
	}
	slot := slotOf(free, b.ID)
	xi := BestLineupHeld(squad, "4-3-3", map[int]int{slot: a.ID})
	checkXI(t, xi, len(roles))
	if xi[slot] != a.ID || slotOf(xi, b.ID) >= 0 {
		t.Errorf("locked young version at %d, other version at %d", slotOf(xi, a.ID), slotOf(xi, b.ID))
	}
	// he gets hurt: someone covers; healed, he is back, also in a saved (manager's) eleven
	a.Injury = 3
	xi = BestLineupHeld(squad, "4-3-3", map[int]int{slot: a.ID})
	checkXI(t, xi, len(roles))
	if slotOf(xi, a.ID) >= 0 {
		t.Error("an injured locked player was picked")
	}
	saved := append([]int(nil), xi...)
	a.Injury = 0
	back := placeHeld(saved, len(roles), map[int]int{slot: a.ID}, squad)
	club := &Club{Formation: "4-3-3", Lineup: back}
	back = resolveLineup(club, squad)
	checkXI(t, back, len(roles))
	if back[slot] != a.ID || slotOf(back, b.ID) >= 0 {
		t.Errorf("healed: locked one at %d, other version at %d", slotOf(back, a.ID), slotOf(back, b.ID))
	}
}

// A locked starter in another slot of the saved eleven is moved back to his own; whoever stood there swaps.
func TestPlaceHeldSwaps(t *testing.T) {
	squad := lockSquad(5)
	xi := BestLineup(squad, "4-4-2")
	held := map[int]int{1: xi[2]}
	out := placeHeld(xi, len(xi), held, squad)
	if out[1] != xi[2] || out[2] != xi[1] {
		t.Errorf("got %v from %v", out, xi)
	}
}

// Locks follow the player to his slot; an injured locked player keeps his slot (by role in a new shape) unless a
// starter is now locked there; a player taken out of the side loses his lock.
func TestLockSlots(t *testing.T) {
	own := map[int]*Player{}
	for id := 1; id <= 14; id++ {
		own[id] = &Player{ID: id}
	}
	own[13].Injury = 2
	lineup := []int{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11}
	r442, r433 := Formations["4-4-2"], Formations["4-3-3"]
	locks := lockSlots([]int{3, 11, 13, 14}, lineup, map[int]int{13: 10}, r442, r442, own)
	if len(locks) != 3 || locks[3] != 2 || locks[11] != 10 || locks[13] != 10 && locks[11] == 10 {
		// 11 is locked at 10 by the starter rule, so the injured 13 cannot have 10 too
	}
	if locks[3] != 2 || locks[11] != 10 {
		t.Errorf("starter locks: %v", locks)
	}
	if _, ok := locks[13]; ok {
		t.Errorf("an injured player kept a slot a starter is now locked in: %v", locks)
	}
	if _, ok := locks[14]; ok {
		t.Errorf("a player out of the side kept his lock: %v", locks)
	}
	locks = lockSlots([]int{13}, lineup, map[int]int{13: 9}, r442, r442, own)
	if locks[13] != 9 {
		t.Errorf("an injured locked player lost his slot: %v", locks)
	}
	// a new shape: the first free slot with his old role
	locks = lockSlots([]int{13}, lineup, map[int]int{13: 0}, r442, r433, own)
	if s, ok := locks[13]; !ok || r433[s] != r442[0] {
		t.Errorf("new shape: %v", locks)
	}
	if heldSlots(&Career{Care: Care{Locked: map[int]int{4: 3, 5: 40}}}, 11)[3] != 4 || len(heldSlots(&Career{Care: Care{Locked: map[int]int{5: 40}}}, 11)) != 0 {
		t.Error("heldSlots kept a slot past the formation")
	}
}

// No rotation rests a locked starter and no automatic substitution takes him (or a locked keeper) off, however
// tired he is; the unlocked men around him still change.
func TestLockedNeverRotatedOrSubbed(t *testing.T) {
	for seed := int64(1); seed <= 20; seed++ {
		squad := lockSquad(seed)
		club := &Club{ID: 1, Formation: "4-4-2", IsUser: true}
		club.Lineup = BestLineup(squad, club.Formation)
		st, roles := startersOf(club, squad)
		for _, p := range st {
			p.Fitness = 40
		}
		lockedFW, lockedGK := -1, -1
		for s, r := range roles {
			if RoleCat(r) == "FW" {
				lockedFW = s
			}
			if r == "GK" {
				lockedGK = s
			}
		}
		st[lockedFW].Locked, st[lockedGK].Locked = true, true
		fw, gk := st[lockedFW], st[lockedGK]
		bench := benchOf(st, squad)
		for _, b := range bench {
			b.Fitness = 100
			if b.Position == "GK" {
				b.Bring = 1 // a marked reserve keeper would come on for the keeper
			}
		}
		rotate(70, st, roles, bench)
		if st[lockedFW] != fw || st[lockedGK] != gk {
			t.Fatalf("seed %d: the fitness rotation rested a locked starter", seed)
		}
		devRotate(3, st, roles, bench, map[int]int{})
		if st[lockedFW] != fw || st[lockedGK] != gk {
			t.Fatalf("seed %d: the development rotation rested a locked starter", seed)
		}
		sh := &TeamSheet{Club: club, Starters: st, Roles: roles, Bench: benchOf(st, squad)}
		autoSubs(rand.New(rand.NewSource(seed)), sh, 30)
		if len(sh.Subs) == 0 {
			t.Fatalf("seed %d: nobody came off a side at 40%% fitness: the test proves nothing", seed)
		}
		for _, s := range sh.Subs {
			if s.Out.Locked {
				t.Errorf("seed %d: locked %s came off for %s", seed, s.Out.Name, s.In.Name)
			}
		}
	}
}

// An extra limit break needs the season's own break first; the money grows with each extra one and stays
// within its bounds.
func TestExtraBreak(t *testing.T) {
	c := &Career{Season: 4}
	p := &Player{ID: 9, Tag: "legend", Age: 24, Potential: 90}
	p.Fill()
	if got := breakWhy(c, p, true); got != "break_first" {
		t.Errorf("extra before the season's break: %q", got)
	}
	c.Care.Breaks = map[int]int{9: 4}
	if got := breakWhy(c, p, false); got != "break_done" {
		t.Errorf("second own break: %q", got)
	}
	if got := breakWhy(c, p, true); got != "" {
		t.Errorf("extra after the season's break: %q", got)
	}
	c.Care.Breaks[9] = 3 // last season's: the own break comes first again
	if got := breakWhy(c, p, true); got != "break_first" {
		t.Errorf("extra with last season's break: %q", got)
	}
	if f := ExtraBreakFee(1_000_000, 0); f != ExtraBreakMin {
		t.Errorf("cheap player: %d", f)
	}
	if f := ExtraBreakFee(2_000_000_000, 0); f != ExtraBreakMax {
		t.Errorf("dear player: %d", f)
	}
	if a, b := ExtraBreakFee(100_000_000, 0), ExtraBreakFee(100_000_000, 2); a != 4_000_000 || b != 3*a {
		t.Errorf("fees %d then %d", a, b)
	}
}

// The assistant speaks up about a locked starter who is tired, playing through a knock or low on morale (one
// word each, no second morale alert), says nothing once you keep him on, and says he is rested once you rest him.
func TestLockAlerts(t *testing.T) {
	squad := lockSquad(2)
	uid := 1
	for _, p := range squad {
		p.ClubID = &uid
		p.Morale = 70
	}
	tired, knock, sad, fine, hurt := squad[0], squad[1], squad[2], squad[3], squad[4]
	tired.Fitness, sad.Morale = 52, 30
	knock.Injury, hurt.Injury = 1, 3
	c := &Career{UserClubID: uid, Season: 1, Day: 5}
	c.Care.Locked = map[int]int{tired.ID: 0, knock.ID: 1, sad.ID: 2, fine.ID: 3, hurt.ID: 4}
	c.Care.Rush = map[int]bool{knock.ID: true}
	w := &world{career: c, byID: map[int]*Club{uid: {ID: uid, IsUser: true, Formation: "4-4-2"}}, players: map[int][]*Player{uid: squad}}
	applyCare(c, squad)
	keys := func() map[int]string {
		m := map[int]string{}
		for _, a := range w.alerts() {
			if a.Kind == "player" && (a.Key[:5] == "lock_" || a.Key == "player_unhappy") {
				if m[a.ID] != "" {
					t.Errorf("two alerts about %s", a.Name)
				}
				m[a.ID] = a.Key
			}
		}
		return m
	}
	got := keys()
	want := map[int]string{tired.ID: "lock_tired", knock.ID: "lock_knock", sad.ID: "lock_morale"}
	for id, k := range want {
		if got[id] != k {
			t.Errorf("player %d: %q, want %q", id, got[id], k)
		}
	}
	if got[fine.ID] != "" || got[hurt.ID] != "" {
		t.Errorf("a fit or an injured locked player got advice: %v", got)
	}
	c.Care.Keep = map[int]bool{tired.ID: true}
	c.Care.Rest = map[int]bool{sad.ID: true}
	applyCare(c, squad)
	got = keys()
	if got[tired.ID] != "" || got[sad.ID] != "lock_resting" {
		t.Errorf("after keep and rest: %v", got)
	}
	if available(sad) {
		t.Error("a rested player is still available")
	}
}
