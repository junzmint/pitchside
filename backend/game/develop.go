package game

import (
	"math"
	"math/rand"
	"sync"
)

// ---------------------------------------------------------------- hidden development and asking prices

// Every modern player has a hidden development class. A pricey teenager can turn out a flop:
// he trains at a crawl and his ceiling drops each summer. A wonderkid does the opposite.
// It shows once his traits do (a good scout, or five games for your club).
var devGain = map[string]float64{"flop": 0.35, "slow": 0.7, "normal": 1, "fast": 1.3, "wonder": 1.7}

// devCache: the class depends only on the player's id, and seeding a generator is costly
// (training asks for it every session), so each id is worked out once.
var devCache sync.Map

func devClass(p *Player) string {
	if isLegend(p) || p.ID == 0 {
		return ""
	}
	if v, ok := devCache.Load(p.ID); ok {
		return v.(string)
	}
	cls := "wonder"
	x := rand.New(rand.NewSource(int64(p.ID)*104729 + 7)).Float64()
	switch {
	case x < 0.12:
		cls = "flop"
	case x < 0.32:
		cls = "slow"
	case x < 0.80:
		cls = "normal"
	case x < 0.95:
		cls = "fast"
	}
	devCache.Store(p.ID, cls)
	return cls
}

func devFactor(p *Player) float64 {
	if f, ok := devGain[devClass(p)]; ok {
		return f
	}
	return 1
}

// devSummer: young players' ceilings drift with their class at every season change.
func devSummer(r *rand.Rand, p *Player) {
	if p.Age > 23 || isLegend(p) {
		return
	}
	ovr := int(math.Round(OverallAs(p, p.Position)))
	switch devClass(p) {
	case "flop":
		p.Potential = max(ovr, p.Potential-(2+r.Intn(3)))
	case "slow":
		p.Potential = max(ovr, p.Potential-r.Intn(2))
	case "wonder":
		p.Potential = min(95, p.Potential+1+r.Intn(2))
	}
}

// askingPrice: what the selling side wants this season. Most players go for about their value;
// some are bargains, some are hyped — young talents with a big gap to their potential most of all.
func askingPrice(p *Player, season int) int64 {
	if isLegend(p) {
		return p.Value
	}
	r := rand.New(rand.NewSource(int64(p.ID)*7919 + int64(season)*131))
	f := math.Exp(r.NormFloat64() * 0.22) // ±25% for most
	switch x := r.Float64(); {
	case x < 0.15:
		f *= 0.6 + r.Float64()*0.2 // bargain
	case x < 0.30:
		f *= 1.3 + r.Float64()*0.5 // hyped
	}
	if p.Age <= 21 && float64(p.Potential)-OverallAs(p, p.Position) >= 12 && r.Float64() < 0.5 {
		f *= 1.5 + r.Float64()*1.5 // the next big thing (maybe)
	}
	return int64(float64(p.Value)*f/10_000) * 10_000
}

// regen: a retired star's teenage namesake, same nation and position, with a ceiling near the
// father's best. His development class is his own (he may still flop).
func regen(r *rand.Rand, old *Player, peak int) *Player {
	np := GenPlayer(r, []string{old.Nation}, old.Position, 56+r.Float64()*8, 17, 19)
	np.Name = old.Name + " Jr."
	np.Nation = old.Nation
	np.Potential = min(95, max(np.Overall+8, peak-3+r.Intn(7)))
	np.Fill()
	return np
}
