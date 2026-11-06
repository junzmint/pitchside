package game

import "testing"

// Lower divisions spread like real second and third tiers: at 0.4 a place they were a coin toss (the champion on
// about 72 points, half a real table's spread). Every club, the poorest too, has money to spend.
func TestLowerDivisionSpread(t *testing.T) {
	for _, l := range Leagues {
		defs := CountryClubDefs(l.Code)
		for div := 1; div < Divisions; div++ {
			top, bottom := defs[div*DivisionSize].Base, defs[(div+1)*DivisionSize-1].Base
			if top-bottom < 13 {
				t.Errorf("%s division %d: bases %.1f → %.1f, a spread of only %.1f", l.Code, div+1, top, bottom, top-bottom)
			}
		}
		for _, d := range defs {
			if d.Budget < 2*M {
				t.Errorf("%s %s: budget %d", l.Code, d.Name, d.Budget)
			}
		}
	}
}

// A save's youth intake and market follow its division's level as it was before the spread: only a new career's
// squads changed (division 1 never did).
func TestDivisionLevelUnchanged(t *testing.T) {
	near := func(a, b float64) bool { return a-b < 1e-9 && b-a < 1e-9 }
	for _, l := range Leagues {
		defs := CountryClubDefs(l.Code)
		d1avg := 0.0
		for i := 0; i < DivisionSize; i++ {
			d1avg += defs[i].Base / DivisionSize
		}
		for _, c := range []struct {
			div       int
			mid, mean float64
		}{{1, defs[DivisionSize/2].Base, d1avg}, {2, 62, 62.2}, {3, 56, 56.2}} {
			if got := divisionLevel(l.Code, c.div); !near(got, c.mid) {
				t.Errorf("%s division %d: level %.2f, want %.2f", l.Code, c.div, got, c.mid)
			}
			if got := divisionAverage(l.Code, c.div); !near(got, c.mean) {
				t.Errorf("%s division %d: average %.2f, want %.2f", l.Code, c.div, got, c.mean)
			}
		}
	}
}
