package game

import (
	"math/rand"
	"sort"
	"testing"
)

// bringSheet: a user side in a 4-4-2 with everyone fresh, so nobody has to come off.
func bringSheet(seed int64) (*TeamSheet, []*Player) {
	r := rand.New(rand.NewSource(seed))
	squad := GenSquad(r, []string{"EN"}, 74, nil)
	for i, p := range squad {
		p.ID = i + 1
		p.Fitness = 100
	}
	club := &Club{ID: 1, Formation: "4-4-2", IsUser: true}
	club.Lineup = BestLineup(squad, club.Formation)
	st, roles := startersOf(club, squad)
	return &TeamSheet{Club: club, Starters: st, Roles: roles, Bench: benchOf(st, squad)}, squad
}

func subFor(sh *TeamSheet, p *Player) *Sub {
	for i := range sh.Subs {
		if sh.Subs[i].In == p {
			return &sh.Subs[i]
		}
	}
	return nil
}

// Marked bench players come on around the hour, in their own line, before anyone else, three changes at most.
func TestBringOnMarked(t *testing.T) {
	for seed := int64(1); seed <= 30; seed++ {
		sh, _ := bringSheet(seed)
		var mf, fw *Player
		for _, b := range sh.Bench {
			if b.Position == "MF" && mf == nil {
				mf = b
			}
			if b.Position == "FW" && fw == nil {
				fw = b
			}
		}
		if mf == nil || fw == nil {
			continue
		}
		mf.Bring, fw.Bring = 1, 2
		autoSubs(rand.New(rand.NewSource(seed)), sh, 16)
		if len(sh.Subs) > SubsPlanned {
			t.Errorf("seed %d: %d changes with nobody exhausted", seed, len(sh.Subs))
		}
		for _, b := range []*Player{mf, fw} {
			s := subFor(sh, b)
			if s == nil {
				t.Errorf("seed %d: marked %s (%s %d) never came on", seed, b.Name, b.Position, b.Overall)
				continue
			}
			if s.Minute < 55 || s.Minute > 70 {
				t.Errorf("seed %d: %s came on at %d", seed, b.Name, s.Minute)
			}
			if RoleCat(sh.Roles[s.Slot]) != b.Position {
				t.Errorf("seed %d: %s (%s) went on as %s", seed, b.Name, b.Position, sh.Roles[s.Slot])
			}
			if Effective(b, sh.Roles[s.Slot]) < Effective(s.Out, sh.Roles[s.Slot])*BringFloor {
				t.Errorf("seed %d: %s is far below %s", seed, b.Name, s.Out.Name)
			}
		}
		// the first two changes are the marked players, in their order
		if len(sh.Subs) >= 2 && (sh.Subs[0].In != mf || sh.Subs[1].In != fw) {
			t.Errorf("seed %d: marked players were not the first changes", seed)
		}
	}
}

// A marked player far below the man he would replace stays on the bench; a marked keeper replaces the keeper.
func TestBringOnFloorAndKeeper(t *testing.T) {
	sh, _ := bringSheet(4)
	kid := GenPlayer(rand.New(rand.NewSource(9)), []string{"EN"}, "MF", 25, 16, 16)
	kid.ID, kid.Fitness, kid.Bring = 900, 100, 1
	kid.Fill()
	var gk *Player
	for _, b := range sh.Bench {
		if b.Position == "GK" {
			gk = b
		}
	}
	if gk == nil {
		t.Fatal("no keeper on the bench")
	}
	gk.Bring = 2
	sh.Bench = append(sh.Bench, kid)
	autoSubs(rand.New(rand.NewSource(4)), sh, 16)
	if s := subFor(sh, kid); s != nil {
		t.Errorf("a %d-rated kid came on for %s", kid.Overall, s.Out.Name)
	}
	s := subFor(sh, gk)
	if s == nil {
		t.Fatalf("the marked keeper (%d) never came on", gk.Overall)
	}
	if sh.Roles[s.Slot] != "GK" {
		t.Errorf("the marked keeper went on as %s", sh.Roles[s.Slot])
	}
}

// Nobody marked: the usual changes, for fresh legs only from someone nearly as good.
func TestAutoSubsUnmarked(t *testing.T) {
	for seed := int64(1); seed <= 20; seed++ {
		sh, _ := bringSheet(seed)
		for _, p := range sh.Starters {
			p.Fitness = 72 // tired, but nobody exhausted (projectedEnd stays above 50)
		}
		autoSubs(rand.New(rand.NewSource(seed)), sh, 16)
		if len(sh.Subs) > SubsPlanned {
			t.Errorf("seed %d: %d changes", seed, len(sh.Subs))
		}
		for _, s := range sh.Subs {
			if Effective(s.In, sh.Roles[s.Slot]) < Effective(s.Out, sh.Roles[s.Slot])*0.9 {
				t.Errorf("seed %d: %s on for %s is a big step down", seed, s.In.Name, s.Out.Name)
			}
			if s.Minute < 60 || s.Minute > 79 {
				t.Errorf("seed %d: a change at %d", seed, s.Minute)
			}
		}
	}
}

// Marked players are ranked: the one who has waited longest for a game first, then the one with most room to grow.
func TestBringOrder(t *testing.T) {
	a := &Player{ID: 1, Overall: 60, Potential: 70, Age: 19}
	b := &Player{ID: 2, Overall: 60, Potential: 80, Age: 20}
	c := &Player{ID: 3, Overall: 60, Potential: 90, Age: 18}
	d := &Player{ID: 4, Overall: 70, Potential: 72, Age: 25}
	cr := &Career{Care: Care{Bring: map[int]bool{1: true, 2: true, 3: true}}}
	cr.Events.Bench = map[int]int{1: 6, 2: 2, 3: 2}
	applyCare(cr, []*Player{a, b, c, d})
	if a.Bring != 1 || c.Bring != 2 || b.Bring != 3 || d.Bring != 0 {
		t.Errorf("order a=%d b=%d c=%d d=%d, want 1 3 2 0", a.Bring, b.Bring, c.Bring, d.Bring)
	}
	delete(cr.Care.Bring, 1)
	applyCare(cr, []*Player{a, b, c, d})
	if a.Bring != 0 || c.Bring != 1 {
		t.Errorf("after unmarking: a=%d c=%d", a.Bring, c.Bring)
	}
}

// oldAutoSubs: autoSubs before marked players existed, kept to check that sides without marks (every CPU side)
// make exactly the same changes as before.
func oldAutoSubs(r *rand.Rand, sh *TeamSheet, drain float64) {
	type cand struct {
		slot int
		end  float64
		need bool
	}
	var cs []cand
	for i, p := range sh.Starters {
		if p == nil || sh.Roles[i] == "GK" {
			continue
		}
		end := projectedEnd(p, drain)
		cs = append(cs, cand{i, end, end < 50 || p.Rushed})
	}
	sort.Slice(cs, func(a, b int) bool {
		if cs[a].need != cs[b].need {
			return cs[a].need
		}
		return cs[a].end < cs[b].end
	})
	used := map[int]bool{}
	for _, p := range sh.Starters {
		if p != nil {
			used[p.ID] = true
		}
	}
	for _, c := range cs {
		if len(sh.Subs) >= SubsMax || (!c.need && len(sh.Subs) >= 3) {
			break
		}
		out := sh.Starters[c.slot]
		role := sh.Roles[c.slot]
		var best *Player
		bestR := 0.0
		for _, b := range sh.Bench {
			if used[b.ID] || b.Rushed || b.Position == "GK" || b.Fitness < 60 {
				continue
			}
			if v := Effective(b, role); v > bestR {
				best, bestR = b, v
			}
		}
		floor := 0.9
		if c.need {
			floor = 0.75
		}
		if best == nil || bestR < Effective(out, role)*floor {
			continue
		}
		used[best.ID] = true
		min := 60 + r.Intn(20)
		if c.need {
			min = 52 + r.Intn(16)
		}
		sh.Subs = append(sh.Subs, Sub{Slot: c.slot, Out: out, In: best, Minute: min})
	}
}

func TestAutoSubsSameWithoutMarks(t *testing.T) {
	for seed := int64(1); seed <= 400; seed++ {
		r := rand.New(rand.NewSource(seed))
		a, _ := bringSheet(seed)
		for _, p := range append(append([]*Player{}, a.Starters...), a.Bench...) {
			p.Fitness = 40 + r.Float64()*60
			p.Rushed = r.Float64() < 0.04
		}
		b := *a
		b.Subs = nil
		drain := 13 + r.Float64()*12
		autoSubs(rand.New(rand.NewSource(seed)), a, drain)
		oldAutoSubs(rand.New(rand.NewSource(seed)), &b, drain)
		if len(a.Subs) != len(b.Subs) {
			t.Fatalf("seed %d: %d changes, before %d", seed, len(a.Subs), len(b.Subs))
		}
		// the same men in the same order; the minute is drawn from the same window (the old code drew twice for a
		// forced change, so the random numbers differ)
		for i := range a.Subs {
			x, y := a.Subs[i], b.Subs[i]
			if x.Slot != y.Slot || x.In != y.In || x.Out != y.Out {
				t.Fatalf("seed %d change %d: %s→%s, before %s→%s", seed, i, x.Out.Name, x.In.Name, y.Out.Name, y.In.Name)
			}
			lo, hi := 60, 79
			if y.Minute < 60 || projectedEnd(y.Out, drain) < 50 || y.Out.Rushed {
				lo, hi = 52, 67
			}
			if x.Minute < lo || x.Minute > hi || y.Minute < lo || y.Minute > hi {
				t.Fatalf("seed %d change %d: at %d, before at %d (window %d–%d)", seed, i, x.Minute, y.Minute, lo, hi)
			}
		}
	}
}

// With the whole side exhausted, at most three of the players you marked come on that way; the rest of the
// changes go to whoever is best.
func TestBringOnCapWhenExhausted(t *testing.T) {
	for seed := int64(1); seed <= 20; seed++ {
		sh, _ := bringSheet(seed)
		for _, p := range sh.Starters {
			p.Fitness = 45
		}
		n := 0
		for _, b := range sh.Bench {
			if b.Position != "GK" && n < 5 {
				n++
				b.Bring = n
			}
		}
		autoSubs(rand.New(rand.NewSource(seed)), sh, 16)
		marked := 0
		for _, s := range sh.Subs {
			if s.In.Bring > 0 {
				marked++
			}
		}
		if marked > SubsPlanned || len(sh.Subs) > SubsMax {
			t.Errorf("seed %d: %d marked players among %d changes", seed, marked, len(sh.Subs))
		}
	}
}
