package game

import (
	"math"
	"math/rand"
	"testing"
)

// The Golden Glove goes to the keeper who lets in the fewest goals a game, not to the one with more clean sheets.
func TestGloveFewestGoalsAGame(t *testing.T) {
	stingy := awardStat{id: 1, apps: 52, cs: 30, conceded: 22, gaSim: 22, rsum: 52 * 7.9}      // 0.42 a game
	cleanSheets := awardStat{id: 2, apps: 50, cs: 34, conceded: 28, gaSim: 28, rsum: 50 * 8.1} // 0.56 a game
	if !gloveLess(stingy, cleanSheets) || gloveLess(cleanSheets, stingy) {
		t.Fatalf("0.42 a game should beat 0.56 a game with more clean sheets (%.3f vs %.3f)", stingy.gloveRate(), cleanSheets.gloveRate())
	}
}

// Watched and played matches count the goals the quick sim expected: a season of long live matches, with many
// goals at both ends and few clean sheets, is judged as the simulation would have judged it.
func TestGloveLiveMatchesUseExpectedGoals(t *testing.T) {
	watched := awardStat{id: 1, apps: 53, cs: 22, conceded: 69, gaSim: 21.5, rsum: 53 * 6.9} // 1.30 a game live, 0.41 expected
	ai := awardStat{id: 2, apps: 48, cs: 29, conceded: 26, gaSim: 26, rsum: 48 * 8.1}        // 0.54 a game
	if !gloveLess(watched, ai) {
		t.Fatalf("the watched season (%.3f expected a game) should beat %.3f", watched.gaRate(), ai.gaRate())
	}
	if r := watched.gaRate(); r < 0.40 || r > 0.41 {
		t.Fatalf("gaRate = %.3f, want the expected goals a game (0.406)", r)
	}
}

// A few lucky games do not beat a whole season at a slightly worse rate, and at the same rate more games win.
func TestGloveGamesCount(t *testing.T) {
	few := awardStat{id: 1, apps: 21, cs: 16, conceded: 5, gaSim: 5}    // 0.24 a game
	full := awardStat{id: 2, apps: 50, cs: 35, conceded: 15, gaSim: 15} // 0.30 a game
	if !gloveLess(full, few) {
		t.Fatalf("50 games at 0.30 should beat 21 games at 0.24 (%.3f vs %.3f)", full.gloveRate(), few.gloveRate())
	}
	half := awardStat{id: 3, apps: 25, cs: 15, conceded: 10, gaSim: 10}  // 0.40 a game
	whole := awardStat{id: 4, apps: 50, cs: 30, conceded: 20, gaSim: 20} // 0.40 a game
	if !gloveLess(whole, half) {
		t.Fatal("at the same rate the keeper with more games should win")
	}
}

// Level on goals a game: more clean sheets a game, then more games.
func TestGloveTieBreak(t *testing.T) {
	a := awardStat{id: 1, apps: 40, cs: 25, conceded: 18, gaSim: 18, csSim: 25}
	b := awardStat{id: 2, apps: 40, cs: 22, conceded: 18, gaSim: 18, csSim: 22}
	if !gloveLess(a, b) || gloveLess(b, a) {
		t.Fatal("level on goals: more clean sheets should win")
	}
}

// A season won game by game gets its own pop-up (and achievement); a season only unbeaten keeps the old one.
func TestPerfectSeason(t *testing.T) {
	const us, them = 1, 2
	build := func(league [][2]int, other ...*Fixture) *world {
		c := &Career{UserClubID: us, Season: 1, Day: 60}
		user := &Club{ID: us, League: "EN", Division: 1, Name: "Us", Short: "US", IsUser: true}
		opp := &Club{ID: them, League: "EN", Division: 1, Name: "Them", Short: "TH"}
		w := &world{career: c, clubs: []*Club{user, opp}, byID: map[int]*Club{us: user, them: opp}}
		for i, sc := range league {
			w.fixtures = append(w.fixtures, fx("league", i%2 == 0, sc[0], sc[1]))
		}
		w.fixtures = append(w.fixtures, other...)
		return w
	}
	wins := func(n int) [][2]int {
		out := make([][2]int, n)
		for i := range out {
			out[i] = [2]int{2, 0}
		}
		return out
	}
	feats := func(w *world) map[string]Celebration {
		w.celebrateSeason(&SeasonEnd{Season: 1, Division: 1, Position: 1})
		out := map[string]Celebration{}
		for _, cb := range w.career.Explore.Celebrate {
			if cb.Kind == "feat" {
				out[cb.Key] = cb
			}
		}
		return out
	}

	// every league and cup game won (the friendly loss does not count)
	w := build(wins(34), fx("cup", true, 1, 0), fx("cl", false, 3, 1), fx("friendly", true, 0, 3))
	rec := w.seasonRecord()
	if rec.played != 34 || rec.won != 34 || rec.allPlayed != 36 || rec.allWon != 36 || !rec.perfect() || !rec.unbeaten() {
		t.Fatalf("record = %+v", rec)
	}
	f := feats(w)
	if p, ok := f["perfect"]; !ok || p.Wins != 34 || p.AllWins != 36 || p.Points != 102 {
		t.Fatalf("perfect pop-up = %+v (all: %v)", p, f)
	}
	if _, ok := f["invincible"]; ok {
		t.Fatal("a perfect season shows its own pop-up, not the unbeaten one as well")
	}

	// a cup tie won on penalties is a drawn game: still a perfect league season, but not every game won
	w = build(wins(34), fx("cup", true, 1, 1))
	if p := feats(w)["perfect"]; p.Wins != 34 || p.AllWins != 0 {
		t.Fatalf("perfect pop-up with a shoot-out = %+v", p)
	}

	// one league draw: unbeaten, not perfect
	league := wins(34)
	league[10] = [2]int{1, 1}
	w = build(league)
	rec = w.seasonRecord()
	if rec.perfect() || !rec.unbeaten() {
		t.Fatalf("record with a draw = %+v", rec)
	}
	f = feats(w)
	if _, ok := f["perfect"]; ok {
		t.Fatal("a draw is no perfect season")
	}
	if _, ok := f["invincible"]; !ok {
		t.Fatal("an unbeaten season keeps its pop-up")
	}

	// too short a season for either
	if rec := build(wins(20)).seasonRecord(); rec.perfect() || rec.unbeaten() {
		t.Fatalf("20 games: %+v", rec)
	}
}

// fx: a played fixture between the user (1) and club 2, with the user's goals first.
func fx(comp string, home bool, gf, ga int) *Fixture {
	f := &Fixture{Season: 1, Comp: comp, League: leagueKey("EN", 1), Stage: "R1", Played: true, HomeID: 1, AwayID: 2}
	h, a := gf, ga
	if !home {
		f.HomeID, f.AwayID = 2, 1
		h, a = ga, gf
	}
	f.HomeGoals, f.AwayGoals = &h, &a
	return f
}

// simRating is the rating formula record used inline before it was shared with the awards' scale: same numbers.
func TestSimRatingUnchanged(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	cats := []string{"GK", "DF", "MF", "FW"}
	for i := 0; i < 20000; i++ {
		eff, g, a := 50+r.Float64()*60, r.Intn(4), r.Intn(3)
		result := []float64{0.4, 0, -0.3}[r.Intn(3)]
		noise, share := r.NormFloat64()*0.35, 0.05+r.Float64()*0.95
		cat, ga := cats[r.Intn(4)], r.Intn(5)
		// the old inline formula
		old := 6.3 + (eff-70)/25 + float64(g)*1.0 + float64(a)*0.6 + result + noise
		old = 6.3 + (old-6.3)*(0.5+0.5*share)
		cs := 0
		if ga == 0 && (cat == "GK" || cat == "DF") {
			cs = 1
			if cat == "GK" {
				old += 0.8
			} else {
				old += 0.4
			}
		}
		if cat == "GK" || cat == "DF" {
			old -= float64(ga) * 0.15
		}
		got := simRating(6.3+(eff-70)/25, float64(g), float64(a), result, noise, share, cat, float64(cs), float64(ga))
		if math.Round(clamp(got, 4, 10)*10) != math.Round(clamp(old, 4, 10)*10) {
			t.Fatalf("case %d: simRating %.6f, old formula %.6f", i, got, old)
		}
	}
}
