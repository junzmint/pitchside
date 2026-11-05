package game

import (
	"math"
	"math/rand"
	"testing"
)

// seasonsOf plays `seasons` seasons for players who start every match (40 a season, rated 7), train every
// matchday and age in the summer, and returns how far each ended above (or below) his potential.
func seasonsOf(players []*Player, seasons int) []float64 {
	r := rand.New(rand.NewSource(3))
	for s := 0; s < seasons; s++ {
		for _, p := range players {
			for m := 0; m < 40; m++ {
				matchGrowth(r, p, nil, true, 1, 1, 7, "league", false)
			}
			for d := 0; d < 54; d++ {
				train(r, p, nil, "normal", true, 1)
			}
			p.Fill()
			if !isLegend(p) {
				p.Age++
				devSummer(r, p)
				ageDecline(r, p, 1, 0, false)
			}
			p.Fill()
		}
	}
	out := make([]float64, len(players))
	for i, p := range players {
		out[i] = OverallAs(p, p.Position) - float64(p.Potential)
	}
	return out
}

func growthSquad(seed int64, legends bool) []*Player {
	r := rand.New(rand.NewSource(seed))
	var ps []*Player
	for i := 0; i < 300; i++ {
		p := GenPlayer(r, []string{"ES"}, []string{"DF", "MF", "FW"}[i%3], 60+r.Float64()*20, 18, 26)
		p.ID = 5000 + i
		if legends {
			p.Tag = "legend"
		}
		p.Fill()
		ps = append(ps, p)
	}
	return ps
}

// Potential guides growth but never stops it: regular starters can end past their potential, a few points at
// most, and nobody runs away; icons go further past theirs.
func TestGrowthPastPotential(t *testing.T) {
	stat := func(xs []float64) (past, mean, top float64) {
		top = math.Inf(-1)
		for _, x := range xs {
			if x > 0.5 {
				past++
			}
			mean += x
			top = math.Max(top, x)
		}
		return past / float64(len(xs)), mean / float64(len(xs)), top
	}
	run := func(legends bool, off bool) (float64, float64, float64) {
		if off {
			defer func(a, b float64) { PastPotential, IconPastPotential = a, b }(PastPotential, IconPastPotential)
			PastPotential, IconPastPotential = 0, 0
		}
		return stat(seasonsOf(growthSquad(1, legends), 6))
	}
	for _, legends := range []bool{false, true} {
		p0, m0, t0 := run(legends, true)
		p1, m1, t1 := run(legends, false)
		t.Logf("legends %-5v  potential as a wall: past it %4.1f%%, mean %+.1f, top %+.1f  |  as a guide: past it %4.1f%%, mean %+.1f, top %+.1f",
			legends, 100*p0, m0, t0, 100*p1, m1, t1)
		if p1 <= p0 {
			t.Errorf("legends %v: nobody gets past his potential (%.2f)", legends, p1)
		}
		if !legends && (t1 > 8 || m1 > 2) {
			t.Errorf("modern players run past their potential: mean %+.1f, top %+.1f", m1, t1)
		}
	}
}
