package game

import (
	"testing"
)

// Each level swaps at most its number of starters, in their own line, never for someone far below the man
// rested, and the man who has waited longest comes in first.
func TestDevRotateLevels(t *testing.T) {
	for seed := int64(1); seed <= 20; seed++ {
		for level := 0; level < len(DevRotation); level++ {
			sh, _ := bringSheet(seed)
			waited := map[int]int{}
			for i, b := range sh.Bench {
				waited[b.ID] = 1 + i%4
			}
			before := append([]*Player{}, sh.Starters...)
			notes := devRotate(level, sh.Starters, sh.Roles, sh.Bench, waited)
			if len(notes) > DevRotation[level].Swaps {
				t.Fatalf("seed %d level %d: %d swaps", seed, level, len(notes))
			}
			if level > 0 && len(notes) == 0 {
				t.Errorf("seed %d level %d: nobody rotated in", seed, level)
			}
			for i, p := range sh.Starters {
				old := before[i]
				if p == old {
					continue
				}
				role := sh.Roles[i]
				if RoleCat(role) != p.Position && !(role == "GK" && p.Position == "GK") {
					t.Errorf("seed %d level %d: %s (%s) put in as %s", seed, level, p.Name, p.Position, role)
				}
				if Effective(p, role) < Effective(old, role)*DevRotation[level].Floor {
					t.Errorf("seed %d level %d: %s far below %s", seed, level, p.Name, old.Name)
				}
				// nobody fit for the same line who waited longer was left out
				for _, b := range sh.Bench {
					if b.Position == p.Position && b.Injury == 0 && waited[b.ID] > waited[p.ID] &&
						Effective(b, role) >= Effective(old, role)*DevRotation[level].Floor && !inXI(sh.Starters, b) {
						t.Errorf("seed %d level %d: %s (waited %d) started before %s (waited %d)", seed, level, p.Name, waited[p.ID], b.Name, waited[b.ID])
					}
				}
			}
		}
	}
}

func inXI(st []*Player, p *Player) bool {
	for _, x := range st {
		if x == p {
			return true
		}
	}
	return false
}

// The reserve keeper starts only on Medium and Heavy, after 5 (Medium) or 4 (Heavy) matches without a game.
func TestDevRotateKeeper(t *testing.T) {
	sh0, _ := bringSheet(3)
	var gk *Player
	for _, b := range sh0.Bench {
		if b.Position == "GK" {
			gk = b
		}
	}
	if gk == nil {
		t.Fatal("no reserve keeper")
	}
	cases := []struct {
		level, waited int
		want          bool
	}{{1, 9, false}, {2, 4, false}, {2, 5, true}, {3, 3, false}, {3, 4, true}}
	for _, c := range cases {
		sh, _ := bringSheet(3)
		var keeper *Player
		for _, b := range sh.Bench {
			if b.Position == "GK" {
				keeper = b
			}
		}
		// the keeper is the only one waiting, and nearly as good as the starter
		keeper.Goalkeeping, keeper.Fitness = 95, 100
		keeper.Fill()
		waited := map[int]int{keeper.ID: c.waited}
		devRotate(c.level, sh.Starters, sh.Roles, sh.Bench, waited)
		got := inXI(sh.Starters, keeper)
		if got != c.want {
			t.Errorf("level %d, waited %d: reserve keeper starts %v, want %v", c.level, c.waited, got, c.want)
		}
	}
}

// Over a run of matches the rotation spreads the starts: every outfield squad player gets games on Medium,
// while without it the bench never starts. The same input always gives the same changes.
func TestDevRotateSpreadsStarts(t *testing.T) {
	run := func(level int) (map[int]int, *TeamSheet) {
		sh, squad := bringSheet(9)
		base := append([]*Player{}, sh.Starters...)
		waited := map[int]int{}
		starts := map[int]int{}
		for m := 0; m < 30; m++ {
			st := append([]*Player{}, base...) // the saved lineup, every match
			bench := benchOf(st, squad)
			devRotate(level, st, sh.Roles, bench, waited)
			on := map[int]bool{}
			for _, p := range st {
				on[p.ID] = true
				starts[p.ID]++
			}
			for _, p := range squad {
				if on[p.ID] {
					waited[p.ID] = 0
					p.Fitness = max(55, p.Fitness-22)
				} else {
					waited[p.ID]++
					p.Fitness = min(100, p.Fitness+14)
				}
			}
		}
		return starts, sh
	}
	off, sh := run(0)
	mid, _ := run(2)
	_, squad := bringSheet(9)
	benchNever, benchMid := 0, 0
	for _, p := range squad {
		if inXI(sh.Starters, p) || p.Position == "GK" {
			continue
		}
		if off[p.ID] == 0 {
			benchNever++
		}
		if mid[p.ID] > 0 {
			benchMid++
		}
	}
	if benchNever == 0 {
		t.Fatal("without rotation the bench started anyway: the test proves nothing")
	}
	if benchMid < benchNever*3/4 {
		t.Errorf("Medium rotation over 30 matches gave starts to %d of %d bench players", benchMid, benchNever)
	}
	// determinism
	a, _ := bringSheet(5)
	b, _ := bringSheet(5)
	w := map[int]int{}
	for _, p := range a.Bench {
		w[p.ID] = p.ID % 5
	}
	na := devRotate(3, a.Starters, a.Roles, a.Bench, w)
	nb := devRotate(3, b.Starters, b.Roles, b.Bench, w)
	if len(na) != len(nb) {
		t.Fatalf("same input, %d and %d changes", len(na), len(nb))
	}
	for i := range na {
		if na[i] != nb[i] {
			t.Errorf("same input, change %d differs: %+v vs %+v", i, na[i], nb[i])
		}
	}
}

// Big ties are left alone: cup ties from the quarter-finals on and European knockout ties.
func TestBigTie(t *testing.T) {
	for _, c := range []struct {
		comp, stage string
		big         bool
	}{
		{"league", "R", false}, {"friendly", "", false}, {"cup", "R1", false}, {"cup", "R32", false}, {"cup", "R16", false},
		{"cup", "QF", true}, {"cup", "SF", true}, {"cup", "F", true}, {"cl", "G1", false}, {"cl", "G6", false},
		{"cl", "R16", true}, {"cl", "QF", true}, {"cl", "F", true},
	} {
		if got := bigTie(&Fixture{Comp: c.comp, Stage: c.stage}); got != c.big {
			t.Errorf("%s %s: big %v, want %v", c.comp, c.stage, got, c.big)
		}
	}
	if bigTie(nil) {
		t.Error("no fixture counted as a big tie")
	}
}

// A promise of starts counts the eleven who really kicked off: a player rotated into the side gets his start,
// one rested from the saved lineup who only came off the bench does not, and the bench streak follows who played.
func TestPromiseCountsRealStarts(t *testing.T) {
	uid := 1
	mk := func(id int) *Player {
		cid := uid
		return &Player{ID: id, Name: "P", ClubID: &cid, Morale: 60, Fitness: 90}
	}
	kept, rested, rotated, unused := mk(1), mk(2), mk(3), mk(4)
	club := &Club{ID: uid, IsUser: true, Lineup: []int{1, 2}} // the saved lineup: 1 and 2
	c := &Career{UserClubID: uid, Season: 1, Day: 5}
	c.Events.Bench = map[int]int{}
	for _, id := range []int{1, 2, 3, 4} {
		c.Events.Promises = append(c.Events.Promises, Promise{PlayerID: id, Name: "P", Need: 3, Left: 4})
	}
	w := &world{career: c, byID: map[int]*Club{uid: club}, players: map[int][]*Player{uid: {kept, rested, rotated, unused}}}
	// 2 was rested by the rotation and came on as a substitute; 3 was rotated in; 4 never played
	uo := &matchOutcome{ratings: map[int]float64{1: 6.5, 2: 6.1, 3: 7.0}, starters: map[int]bool{1: true, 3: true}}
	w.countBench(uo, &DayReport{})
	got := map[int]int{}
	for _, pr := range c.Events.Promises {
		got[pr.PlayerID] = pr.Got
	}
	if got[1] != 1 || got[2] != 0 || got[3] != 1 || got[4] != 0 {
		t.Errorf("starts counted %v, want 1:1 2:0 3:1 4:0", got)
	}
	if c.Events.Bench[3] != 0 || c.Events.Bench[4] != 1 {
		t.Errorf("bench streaks %v", c.Events.Bench)
	}
}
