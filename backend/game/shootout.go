package game

import (
	"math/rand"
	"sort"
)

// ---------------------------------------------------------------- extra time and penalty shoot-outs
//
// A knockout tie that is level after 90 minutes goes to extra time (about a third of a match, on
// tired legs). Still level: a shoot-out, five kicks each and then sudden death, taken by the best
// shooters first; every kick depends on the taker's shooting against the keeper's goalkeeping.

// extraTime adds the goals of 30 more minutes to a simulated result.
func extraTime(r *rand.Rand, home, away TeamSheet, res *SimResult) {
	res.ExtraTime = true
	more := Simulate(r, home, away)
	// keep each simulated goal with the chance a third of a match (on tired legs) would produce it
	const keep = 0.29
	for i, id := range more.Scorers {
		if r.Float64() >= keep {
			continue
		}
		if i < more.HomeGoals {
			res.HomeGoals++
		} else {
			res.AwayGoals++
		}
		res.Scorers = append(res.Scorers, id)
		res.Assists = append(res.Assists, at(more.Assists, i))
	}
	res.ShotsHome += more.ShotsHome / 3
	res.ShotsAway += more.ShotsAway / 3
}

func keeperOf(t TeamSheet) float64 {
	for i, p := range t.Starters {
		if p != nil && t.Roles[i] == "GK" {
			return p.Goalkeeping
		}
	}
	return 50
}

// takers: outfield starters by shooting (big-game players step up), the keeper last.
func takers(t TeamSheet) []*Player {
	var out, gk []*Player
	for i, p := range t.Starters {
		if p == nil {
			continue
		}
		if t.Roles[i] == "GK" {
			gk = append(gk, p)
		} else {
			out = append(out, p)
		}
	}
	score := func(p *Player) float64 {
		s := p.Shooting
		if hasTrait(p, "big_game") {
			s += 6
		}
		return s
	}
	sort.SliceStable(out, func(i, j int) bool { return score(out[i]) > score(out[j]) })
	return append(out, gk...)
}

func penaltyScored(r *rand.Rand, taker *Player, keeper float64) bool {
	p := 0.76 + (taker.Shooting-70)/220 - (keeper-70)/260
	if hasTrait(taker, "big_game") {
		p += 0.04
	}
	if hasTrait(taker, "hothead") {
		p -= 0.04
	}
	return r.Float64() < clamp(p, 0.5, 0.93)
}

// shootout plays a full shoot-out and returns the kicks scored by each side.
func shootout(r *rand.Rand, home, away TeamSheet) (int, int) {
	ht, at := takers(home), takers(away)
	if len(ht) == 0 || len(at) == 0 {
		if r.Intn(2) == 0 {
			return 1, 0
		}
		return 0, 1
	}
	hk, ak := keeperOf(home), keeperOf(away)
	h, a := 0, 0
	for k := 0; k < 30; k++ {
		if penaltyScored(r, ht[k%len(ht)], ak) {
			h++
		}
		// best of five: stop as soon as one side can no longer be caught
		if k < 5 && (h > a+(5-k) || a > h+(5-k-1)) {
			break
		}
		if penaltyScored(r, at[k%len(at)], hk) {
			a++
		}
		if k < 5 && (h > a+(5-k-1) || a > h+(5-k-1)) {
			break
		}
		if k >= 4 && h != a {
			break
		}
	}
	return h, a
}

// creditExtraTime: goals and assists in extra time (from index n) belong to the men on the pitch,
// so a player substituted during the 90 minutes hands them to whoever replaced him.
func creditExtraTime(res *SimResult, n int, sheets ...*TeamSheet) {
	repl := map[int]int{}
	for _, sh := range sheets {
		for _, s := range sh.Subs {
			repl[s.Out.ID] = s.In.ID
		}
	}
	onPitch := func(id int) int {
		for i := 0; i < SubsMax*2; i++ { // a substitute may have been replaced in turn
			next, ok := repl[id]
			if !ok {
				break
			}
			id = next
		}
		return id
	}
	for i := n; i < len(res.Scorers); i++ {
		res.Scorers[i] = onPitch(res.Scorers[i])
		if i < len(res.Assists) && res.Assists[i] != 0 {
			if a := onPitch(res.Assists[i]); a != res.Scorers[i] {
				res.Assists[i] = a
			} else {
				res.Assists[i] = 0
			}
		}
	}
}

// settleKnockout finishes a level knockout tie in a simulated match: extra time, then penalties.
func settleKnockout(r *rand.Rand, f *Fixture, home, away TeamSheet, res *SimResult) {
	if !isKnockout(f) || res.HomeGoals != res.AwayGoals {
		return
	}
	n := len(res.Scorers) // the first 90 minutes were credited already (creditSubs)
	extraTime(r, home, away, res)
	creditExtraTime(res, n, &home, &away)
	if res.HomeGoals == res.AwayGoals {
		res.Shootout = true
		res.PensH, res.PensA = shootout(r, home, away)
	}
}
