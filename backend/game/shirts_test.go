package game

import (
	"math/rand"
	"testing"
)

func shirtSquad(seed int64) []*Player {
	r := rand.New(rand.NewSource(seed))
	sq := GenSquad(r, []string{"EN"}, 74, nil)
	for i, p := range sq {
		p.ID = i + 1
	}
	return sq
}

func checkShirts(t *testing.T, label string, sq []*Player, retired map[int]int) {
	t.Helper()
	seen := map[int]string{}
	for _, p := range sq {
		if p.Shirt < 1 || p.Shirt > ShirtHigh {
			t.Errorf("%s: %s (%s) wears %d", label, p.Name, p.Position, p.Shirt)
		}
		if who, ok := seen[p.Shirt]; ok {
			t.Errorf("%s: %s and %s both wear %d", label, who, p.Name, p.Shirt)
		}
		seen[p.Shirt] = p.Name
		if !shirtFits(p, p.Shirt) {
			t.Errorf("%s: %s (%s %s) wears %d, which doesn't suit him", label, p.Name, p.Position, p.Role, p.Shirt)
		}
		if owner, ok := retired[p.Shirt]; ok && owner != p.ID {
			t.Errorf("%s: %s wears the retired %d", label, p.Name, p.Shirt)
		}
	}
}

// A generated squad is numbered like a real one: the first keeper 1, the best striker 9, nobody above 40.
func TestFreshShirts(t *testing.T) {
	for seed := int64(1); seed <= 20; seed++ {
		sq := shirtSquad(seed)
		checkShirts(t, "fresh", sq, nil)
		var bestGK, bestST *Player
		for _, p := range sq {
			if p.Position == "GK" && (bestGK == nil || p.Overall > bestGK.Overall) {
				bestGK = p
			}
			if p.Role == "ST" && (bestST == nil || p.Overall > bestST.Overall) {
				bestST = p
			}
		}
		if bestGK.Shirt != 1 {
			t.Errorf("seed %d: the best keeper wears %d", seed, bestGK.Shirt)
		}
		if bestST != nil && bestST.Shirt != 9 && bestST.Shirt != 10 {
			t.Errorf("seed %d: the best striker wears %d", seed, bestST.Shirt)
		}
	}
}

// Years of buying and selling keep the numbers low: each newcomer takes a free number that suits him.
func TestShirtsStayLowThroughTransfers(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	sq := shirtSquad(3)
	retired := map[int]int{7: 0, 23: 0} // two retired numbers whose legends have gone
	for _, p := range sq {
		if _, ok := retired[p.Shirt]; ok {
			p.Shirt = 0
		}
	}
	tidyShirts(sq, retired, nil, false)
	next := 1000
	for i := 0; i < 300; i++ {
		out := r.Intn(len(sq))
		pos := sq[out].Position
		sq = append(sq[:out], sq[out+1:]...)
		np := GenPlayer(r, []string{"EN"}, pos, 70+r.Float64()*12, 18, 32)
		next++
		np.ID = next
		np.Shirt = 40 + r.Intn(60) // whatever he wore at his last club
		np.Shirt = pickShirt(sq, retired, np)
		sq = append(sq, np)
	}
	checkShirts(t, "after 300 transfers", sq, retired)
}

// A newcomer good enough to start takes the free classic number of his role; a reserve takes a squad number.
func TestPickShirtClassic(t *testing.T) {
	sq := shirtSquad(5)
	var nine *Player
	for i, p := range sq {
		if p.Shirt == 9 {
			nine = p
			sq = append(sq[:i], sq[i+1:]...)
			break
		}
	}
	if nine == nil {
		t.Fatal("nobody wore 9")
	}
	star := GenPlayer(rand.New(rand.NewSource(1)), []string{"EN"}, "FW", 95, 25, 27)
	star.ID, star.Role = 500, "ST"
	star.Fill()
	star.Role = "ST"
	if n := pickShirt(sq, nil, star); n != 9 {
		t.Errorf("a star striker joining got %d, want the free 9", n)
	}
	kid := GenPlayer(rand.New(rand.NewSource(2)), []string{"EN"}, "FW", 50, 17, 17)
	kid.ID = 501
	if n := pickShirt(sq, nil, kid); n <= 11 || n > ShirtHigh {
		t.Errorf("a reserve striker joining got %d, want a squad number", n)
	}
	if n := pickShirt(sq, map[int]int{9: 0}, star); n == 9 {
		t.Error("a retired 9 was handed out")
	}
}

// Old saves: one past the highest for every signing, keepers on 2 and 3, a striker on 4. The tidy fixes them and
// leaves your own picks and the legends alone.
func TestTidyOldNumbers(t *testing.T) {
	sq := shirtSquad(9)
	for i, p := range sq {
		p.Shirt = i + 1 // the old generator: by line
	}
	sq[3].Shirt, sq[20].Shirt = 47, 66 // signings past the highest
	sq[5].Shirt = sq[6].Shirt          // a clash
	legend, mine := sq[22], sq[12]
	legend.Shirt, mine.Shirt = 4, 77 // a legend whose 4 was retired for him; a number you picked
	if legend.Position == "DF" {
		legend.Shirt = 9
	}
	retired := map[int]int{legend.Shirt: legend.ID}
	keepL, keepM := legend.Shirt, mine.Shirt
	changed := tidyShirts(sq, retired, map[int]bool{mine.ID: true}, true)
	if len(changed) == 0 {
		t.Fatal("nothing changed")
	}
	if legend.Shirt != keepL || mine.Shirt != keepM {
		t.Errorf("legend %d → %d, your pick %d → %d", keepL, legend.Shirt, keepM, mine.Shirt)
	}
	var rest []*Player
	for _, p := range sq {
		if p != legend && p != mine {
			rest = append(rest, p)
		}
	}
	checkShirts(t, "tidied", rest, retired)
	// a second tidy changes nothing
	if again := tidyShirts(sq, retired, map[int]bool{mine.ID: true}, true); len(again) != 0 {
		t.Errorf("a second tidy moved %d players", len(again))
	}
}

// You give a player a number: whoever wore it takes the old one (or a better one); a retired number is refused.
func TestSetShirt(t *testing.T) {
	sq := shirtSquad(11)
	life := &ClubLife{}
	var st, gk *Player
	for _, p := range sq {
		if p.Position == "FW" && st == nil && p.Shirt != 9 {
			st = p
		}
		if p.Shirt == 1 {
			gk = p
		}
	}
	nine := func() *Player {
		for _, p := range sq {
			if p.Shirt == 9 {
				return p
			}
		}
		return nil
	}()
	if nine == nil {
		t.Fatal("nobody wears 9")
	}
	old := st.Shirt
	if _, err := setShirt(life, sq, st.ID, 9); err != nil {
		t.Fatal(err)
	}
	if st.Shirt != 9 || nine == nil || nine.Shirt == 9 {
		t.Fatalf("swap: %s wears %d, the old 9 wears %d", st.Name, st.Shirt, nine.Shirt)
	}
	if nine.Shirt != old && !shirtFits(nine, nine.Shirt) {
		t.Errorf("the old 9 ended on %d", nine.Shirt)
	}
	if len(life.Shirts) != 1 || life.Shirts[0] != st.ID {
		t.Errorf("your pick isn't remembered: %v", life.Shirts)
	}
	life.Retired = []int{23}
	if _, err := setShirt(life, sq, gk.ID, 23); err == nil {
		t.Error("a retired number was given out")
	}
	if _, err := setShirt(life, sq, gk.ID, 100); err == nil {
		t.Error("100 was accepted")
	}
	// your pick survives the daily tidy, even on 77
	if _, err := setShirt(life, sq, gk.ID, 77); err != nil {
		t.Fatal(err)
	}
	tidyShirts(sq, life.retiredSet(), life.keepShirts(), true)
	if gk.Shirt != 77 {
		t.Errorf("your 77 became %d", gk.Shirt)
	}
}
