package game

import (
	"math"
	"math/rand"
)

type namePool struct{ first, last []string }

var nations = map[string]namePool{
	"EN": {[]string{"Jack", "Harry", "Oliver", "George", "Charlie", "Callum", "Ethan", "Jamie", "Mason", "Reece", "Tyler", "Kieran"},
		[]string{"Smith", "Walker", "Taylor", "Brown", "Hughes", "Turner", "Clarke", "Wright", "Barnes", "Mills", "Cooper", "Ward"}},
	"ES": {[]string{"Alejandro", "Pablo", "Diego", "Javier", "Sergio", "Iker", "Álvaro", "Marcos", "Hugo", "Adrián", "Rodrigo", "Unai"},
		[]string{"García", "Martínez", "López", "Sánchez", "Romero", "Navarro", "Torres", "Ruiz", "Moreno", "Ortega", "Vidal", "Herrera"}},
	"BR": {[]string{"Thiago", "Lucas", "Gabriel", "Mateus", "Rafael", "Felipe", "Caio", "Bruno", "Vinícius", "Rodrigo", "Danilo", "Everton"},
		[]string{"Silva", "Santos", "Oliveira", "Souza", "Lima", "Costa", "Pereira", "Almeida", "Ribeiro", "Carvalho", "Rocha", "Barbosa"}},
	"FR": {[]string{"Hugo", "Théo", "Louis", "Antoine", "Maxime", "Julien", "Baptiste", "Enzo", "Rayan", "Mathis", "Nolan", "Yanis"},
		[]string{"Martin", "Bernard", "Dubois", "Moreau", "Laurent", "Girard", "Lefèvre", "Roux", "Fournier", "Mercier", "Blanc", "Faure"}},
	"DE": {[]string{"Lukas", "Jonas", "Leon", "Felix", "Niklas", "Paul", "Tim", "Moritz", "Jannik", "Florian", "Maximilian", "Kai"},
		[]string{"Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Wagner", "Becker", "Hoffmann", "Krüger", "Vogel", "Neumann", "Brandt"}},
	"IT": {[]string{"Marco", "Luca", "Matteo", "Andrea", "Lorenzo", "Federico", "Davide", "Simone", "Riccardo", "Giacomo", "Nicolò", "Tommaso"},
		[]string{"Rossi", "Russo", "Ferrari", "Esposito", "Bianchi", "Romano", "Colombo", "Ricci", "Marino", "Greco", "Bruno", "Gallo"}},
	"PT": {[]string{"João", "Diogo", "Rúben", "Gonçalo", "Tiago", "Pedro", "Rafael", "Nuno", "André", "Vitinha"},
		[]string{"Silva", "Pereira", "Ferreira", "Costa", "Rodrigues", "Martins", "Gomes", "Lopes", "Neves", "Mendes"}},
	"AR": {[]string{"Facundo", "Nicolás", "Thiago", "Valentín", "Lautaro", "Gonzalo", "Exequiel", "Leandro", "Rodrigo", "Giuliano"},
		[]string{"Fernández", "González", "Rodríguez", "Gómez", "Díaz", "Acuña", "Paredes", "Molina", "Correa", "Simeone"}},
	"NL": {[]string{"Daan", "Sem", "Milan", "Lars", "Jurriën", "Ryan", "Teun", "Joey", "Stefan", "Bram"},
		[]string{"de Jong", "Jansen", "de Vries", "van Dijk", "Bakker", "Visser", "Smit", "Mulder", "de Boer", "Koopmeiners"}},
	"BE": {[]string{"Arthur", "Lucas", "Noah", "Jules", "Romeo", "Leandro", "Charles", "Maxim"}, []string{"Peeters", "Janssens", "Maes", "Jacobs", "Mertens", "Willems", "Claes", "Wouters"}},
	"UY": {[]string{"Facundo", "Agustín", "Matías", "Rodrigo", "Maximiliano", "Darwin"}, []string{"Pellistri", "Ugarte", "Olivera", "Viña", "Cáceres", "Rodríguez"}},
	"NG": {[]string{"Chidi", "Emeka", "Tunde", "Femi", "Ikenna", "Segun", "Obinna", "Kelechi", "Ade", "Uche"},
		[]string{"Okafor", "Adeyemi", "Nwosu", "Balogun", "Eze", "Okonkwo", "Bello", "Ojo", "Afolabi", "Nnamdi"}},
	"JP": {[]string{"Haruto", "Ren", "Sota", "Yuki", "Daiki", "Kaito", "Riku", "Takumi", "Shun", "Kenta"},
		[]string{"Sato", "Suzuki", "Takahashi", "Tanaka", "Watanabe", "Ito", "Yamamoto", "Nakamura", "Kobayashi", "Kato"}},
	"KR": {[]string{"Min-jun", "Ji-ho", "Seo-jun", "Do-yun", "Hyun-woo", "Jae-won", "Woo-jin", "Sung-min"},
		[]string{"Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Yoon", "Han"}},
	"AT": {[]string{"David", "Marcel", "Konrad", "Florian", "Stefan", "Patrick"}, []string{"Gruber", "Huber", "Bauer", "Wagner", "Pichler", "Steiner"}},
	"CH": {[]string{"Noah", "Luca", "Fabian", "Remo", "Silvan", "Dominik"}, []string{"Müller", "Meier", "Keller", "Frei", "Widmer", "Zuber"}},
}

var globalNations = []string{"EN", "ES", "BR", "FR", "DE", "IT", "PT", "AR", "NL", "BE", "NG", "JP", "KR", "UY"}

func pick[T any](r *rand.Rand, xs []T) T { return xs[r.Intn(len(xs))] }

func RandName(r *rand.Rand, pool []string) (name, nation string) {
	if len(pool) == 0 || r.Intn(4) == 0 {
		pool = globalNations
	}
	nation = pick(r, pool)
	np, ok := nations[nation]
	if !ok {
		nation = "EN"
		np = nations["EN"]
	}
	return pick(r, np.first) + " " + pick(r, np.last), nation
}

// attribute offsets from target overall per position category
var templates = map[string]map[string]float64{
	"GK": {"goalkeeping": 4, "physical": -8, "passing": -18, "pace": -22, "shooting": -38, "dribbling": -32, "defending": -28},
	"DF": {"defending": 4, "physical": 2, "pace": -1, "passing": -5, "dribbling": -11, "shooting": -22, "goalkeeping": -50},
	"MF": {"passing": 4, "dribbling": 1, "defending": -6, "shooting": -3, "pace": -2, "physical": -4, "goalkeeping": -50},
	"FW": {"shooting": 4, "pace": 2, "dribbling": 2, "physical": -4, "passing": -8, "defending": -30, "goalkeeping": -50},
}

func clamp(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

func genAttrs(r *rand.Rand, p *Player, target float64, style string) {
	pos := p.Position
	for _, a := range AttrNames {
		v := target + templates[pos][a] + styles[style][a] + r.NormFloat64()*4
		*p.Attr(a) = math.Round(clamp(v, 15, 98))
	}
	pullOverall(p, target)
}

// pullOverall moves the key attributes (the ones his position counts) together, so his overall comes to target.
func pullOverall(p *Player, target float64) {
	pos := p.Position
	for i := 0; i < 3; i++ {
		diff := target - OverallAs(p, pos)
		for _, a := range AttrNames {
			if templates[pos][a] > -15 {
				*p.Attr(a) = math.Round(clamp(*p.Attr(a)+diff, 15, 98))
			}
		}
	}
}

// ---------------------------------------------------------------- legend cards built for their role

// roleLine: a role without its side (LB/RB → FB, LM/RM → WM, LW/RW → W); the others stay as they are.
func roleLine(role string) string {
	switch role {
	case "LB", "RB":
		return "FB"
	case "LM", "RM":
		return "WM"
	case "LW", "RW":
		return "W"
	}
	return role
}

// roleTilt: how a legend card's attributes lean toward the role he played, on top of his position and style
// (by line). A full-back is quicker and less of a stopper than a centre-back, a holding midfielder defends more
// than a playmaker, a winger is quicker than a striker. Central midfielders keep their style as it is.
var roleTilt = map[string]map[string]float64{
	"CB": {"defending": 2, "physical": 2, "pace": -2, "dribbling": -2},
	"FB": {"pace": 6, "dribbling": 3, "passing": 2, "defending": -3, "physical": -3},
	"DM": {"defending": 5, "physical": 2, "shooting": -4, "dribbling": -3},
	"AM": {"shooting": 4, "dribbling": 3, "defending": -5, "physical": -2},
	"WM": {"pace": 5, "dribbling": 3, "defending": -3, "physical": -2},
	"W":  {"pace": 4, "dribbling": 3, "shooting": -3, "physical": -2},
	"ST": {"shooting": 3, "physical": 2, "pace": -2, "dribbling": -2},
}

// linedRole: a role whose line attrRole reads from clear numbers — full-back or centre-back (pace against
// defending), winger or striker (pace and dribbling against shooting) — so a legend card's attributes are made
// to read as it. A midfielder's kind is only leaned toward (roleTilt): attrRole's midfield rules would turn a
// crossing right midfielder into a sprinter, or a deep playmaker into a stopper.
func linedRole(role string) bool {
	switch roleLine(role) {
	case "FB", "CB", "W", "ST":
		return true
	}
	return false
}

// fitsLine: his attributes read as role's line (attrRole, the side aside); true for a role that is not lined.
func fitsLine(p *Player, role string) bool {
	return !linedRole(role) || roleLine(attrRole(p)) == roleLine(role)
}

// lineMargin: how many points past attrRole's thresholds a legend card's line is made plain by.
const lineMargin = 2.0

// fixLine moves the fewest points that make his attributes read as role's line (attrRole) by lineMargin; it
// reports whether anything moved. Attributes stay whole numbers within 15–98.
func fixLine(p *Player, role string) bool {
	const m = lineMargin
	switch roleLine(role) {
	case "FB": // attrRole: pace above 70 and at least defending − 4
		want := math.Max(p.Defending-4, 71) + m
		if p.Pace >= want {
			return false
		}
		p.Pace = math.Min(98, want)
		p.Defending = math.Min(p.Defending, p.Pace+4-m) // at the cap: a little less of a stopper instead
	case "CB": // the opposite: pace 70 or below, or below defending − 4
		if p.Pace <= 70-m || p.Pace <= p.Defending-5-m {
			return false
		}
		p.Pace = math.Max(70-m, p.Defending-5-m)
	case "W": // attrRole: pace at least shooting, dribbling at least shooting − 4
		if p.Pace >= p.Shooting+m && p.Dribbling >= p.Shooting-4+m {
			return false
		}
		p.Pace = math.Max(p.Pace, math.Min(98, p.Shooting+m))
		p.Dribbling = math.Max(p.Dribbling, math.Min(98, p.Shooting-4+m))
		p.Shooting = math.Min(p.Shooting, math.Min(p.Pace-m, p.Dribbling+4-m)) // at the cap: a little less of a finisher
	case "ST": // the opposite: pace below shooting, or dribbling below shooting − 4
		dp, dd := p.Pace-(p.Shooting-1-m), p.Dribbling-(p.Shooting-5-m) // how far each is from making him a striker
		if dp <= 0 || dd <= 0 {
			return false
		}
		if dp <= dd {
			p.Pace -= dp // a striker a step slower than a winger…
		} else {
			p.Dribbling -= dd // …or less of a dribbler, whichever changes him less
		}
	default:
		return false
	}
	return true
}

// shapeToRole builds a legend card for the role he played: his attributes lean toward it (roleTilt) with his
// overall kept at target, and for a lined role (linedRole) the numbers that decide the line are made plain
// (fixLine): a full-back is no centre-back by his numbers, a winger no striker.
func shapeToRole(p *Player, role string, target float64) {
	for a, d := range roleTilt[roleLine(role)] {
		v := p.Attr(a)
		*v = math.Round(clamp(*v+d, 15, 98))
	}
	pullOverall(p, target)
	for i := 0; i < 4 && fixLine(p, role); i++ {
		pullOverall(p, target)
	}
	fixLine(p, role) // (at the 98 cap the pull can blur the line again: the line wins over a fraction of overall)
}

// legendStar: one version of a legend as a player (no id yet), built like any star from his position, style and
// level (MakeStar), then for the role he played (shapeToRole). He is tagged a legend card, so he also shows and
// plays that role (legendRole).
func legendStar(r *rand.Rand, lv LegendVersion, pot int) *Player {
	p := MakeStar(r, StarDef{Name: lv.Name, Nation: lv.Nation, Age: lv.Age, Pos: lv.Pos, Ovr: lv.Ovr, Pot: pot, Style: lv.Style})
	p.Tag = "legend"
	if roleInPosition(lv.Role, lv.Pos) {
		shapeToRole(p, lv.Role, lv.Ovr)
		p.Potential = int(math.Max(float64(pot), math.Round(OverallAs(p, p.Position))))
	}
	p.Fill()
	return p
}

func GenPlayer(r *rand.Rand, pool []string, pos string, target float64, minAge, maxAge int) *Player {
	p := &Player{Position: pos, Fitness: 100, Morale: 65 + float64(r.Intn(20)), Focus: "balanced"}
	p.Name, p.Nation = RandName(r, pool)
	p.Age = minAge + r.Intn(maxAge-minAge+1)
	genAttrs(r, p, target, "")
	p.Traits = assignTraits(r, p)
	ovr := OverallAs(p, pos)
	pot := ovr + float64(r.Intn(3))
	if p.Age < 24 {
		pot += float64((24-p.Age)*2+r.Intn(10)) + 2
	}
	p.Potential = int(math.Round(math.Min(pot, 95)))
	p.Fill()
	return p
}

func MakeStar(r *rand.Rand, d StarDef) *Player {
	pos, _ := d.posRole() // "FW/RW": his role is the data's label (starRole), not a build
	p := &Player{Name: d.Name, Nation: d.Nation, Age: d.Age, Position: pos, Fitness: 100, Morale: 80, Focus: "balanced"}
	genAttrs(r, p, d.Ovr, d.Style)
	if ts := styleTraits[d.Style]; len(ts) > 0 {
		p.Traits = append([]string{}, ts[:min(2, len(ts))]...)
	} else {
		p.Traits = assignTraits(r, p)
	}
	p.Potential = int(math.Max(float64(d.Pot), math.Round(OverallAs(p, pos))))
	p.Fill()
	return p
}

func GenCoach(r *rand.Rand, pool []string, role string, skill int) *Coach {
	c := &Coach{Role: role, Skill: skill}
	if role == "head" {
		c.Style = StyleNames[r.Intn(len(StyleNames))]
	}
	c.Name, c.Nation = RandName(r, pool)
	c.Fill()
	return c
}

// SquadShape: 25 players — 3 GK, 8 DF, 8 MF, 6 FW.
var SquadShape = map[string]int{"GK": 3, "DF": 8, "MF": 8, "FW": 6}

// GenSquad builds a 25-man squad around the club's stars: regulars near the club's level,
// rotation players a little below, and a few academy kids.
func GenSquad(r *rand.Rand, pool []string, base float64, stars []StarDef) []*Player {
	need := map[string]int{}
	for k, v := range SquadShape {
		need[k] = v
	}
	out := []*Player{}
	for _, s := range stars {
		out = append(out, MakeStar(r, s))
		pos, _ := s.posRole()
		need[pos]--
	}
	for _, pos := range []string{"GK", "DF", "MF", "FW"} {
		for n := 0; n < need[pos]; n++ {
			t := base + r.NormFloat64()*3
			minAge, maxAge := 19, 33
			switch {
			case n == need[pos]-1 && pos != "GK":
				t, minAge, maxAge = base-9, 17, 19 // academy prospect
			case n%2 == 1:
				t -= 4
			}
			out = append(out, GenPlayer(r, pool, pos, t, minAge, maxAge))
		}
	}
	for i, p := range out {
		p.Shirt = i + 1
	}
	return out
}

// RoundRobin returns weeks of (home, away) index pairs, double round.
func RoundRobin(n int) [][][2]int {
	idx := make([]int, n)
	for i := range idx {
		idx[i] = i
	}
	var first [][][2]int
	for round := 0; round < n-1; round++ {
		var w [][2]int
		for i := 0; i < n/2; i++ {
			a, b := idx[i], idx[n-1-i]
			// circle method with balanced venues: the fixed team alternates every round; every
			// other pair is oriented by its slot, and since teams move one slot per round, each
			// team alternates home and away (at most one repeat as it passes the fixed team)
			home := i%2 == 0
			if i == 0 {
				home = round%2 == 0
			}
			if home {
				w = append(w, [2]int{a, b})
			} else {
				w = append(w, [2]int{b, a})
			}
		}
		first = append(first, w)
		last := idx[n-1]
		copy(idx[2:], idx[1:n-1])
		idx[1] = last
	}
	all := append([][][2]int{}, first...)
	for _, w := range first {
		var rw [][2]int
		for _, m := range w {
			rw = append(rw, [2]int{m[1], m[0]})
		}
		all = append(all, rw)
	}
	return all
}
