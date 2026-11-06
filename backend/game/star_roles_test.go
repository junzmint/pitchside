package game

import (
	"math/rand"
	"testing"
)

// allStars: every modern star in the club data.
func allStars() []StarDef {
	var out []StarDef
	for _, l := range Leagues {
		for _, def := range CountryClubDefs(l.Code) {
			out = append(out, def.Stars...)
		}
	}
	return out
}

// Famous modern players play where their real-life selves do, whatever their numbers and their id (which picks
// the side for anyone else): every star but a keeper has a role in the data, in his own position group, and a
// generated star shows it.
func TestStarRoles(t *testing.T) {
	stars := allStars()
	if len(stars) < 100 {
		t.Fatalf("only %d stars in the data", len(stars))
	}
	for _, s := range stars {
		pos, role := s.posRole()
		if pos == "GK" {
			if role != "" {
				t.Errorf("%s: a keeper with the role %q", s.Name, role)
			}
			continue
		}
		if !roleInPosition(role, pos) {
			t.Errorf("%s: %q is no role for a %s", s.Name, role, pos)
			continue
		}
		for seed := int64(1); seed <= 5; seed++ {
			p := MakeStar(rand.New(rand.NewSource(seed)), s)
			if p.Position != pos {
				t.Fatalf("%s: position %q, want %s", s.Name, p.Position, pos)
			}
			for _, id := range []int{1, 2} { // odd ids are right-sided, even ones left-sided for anyone else
				p.ID = id
				p.Fill()
				if p.Role != role {
					t.Fatalf("%s (seed %d, id %d): %s, want %s", s.Name, seed, id, p.Role, role)
				}
			}
		}
	}
	want := map[string]string{
		"Mohamed Salha": "RW", "Bukayo Saká": "RW", "Lamine Yamall": "RW", "Michael Olisé": "RW",
		"Vini Juniór": "LW", "Khvicha Kvaratskhelya": "LW", "Rafael Leau": "LW", "Son Heung-mín": "LW",
		"Erling Halland": "ST", "Harry Kain": "ST", "Kylian Mbapé": "ST",
		"Reece Jamés": "RB", "Theo Hernandes": "LB", "Alphonso Davis": "LB", "Virgil van Dyck": "CB",
		"Rodrí Hernandes": "DM", "Kevin De Bruyna": "AM", "Jude Bellinghum": "AM", "Pedrí González": "CM",
	}
	for name, role := range want {
		if got := starRoles()[name]; got != role {
			t.Errorf("%s: %q, want %s", name, got, role)
		}
	}
}

// An old save's stars were made before the data had roles and keep every number: their label follows the data
// all the same. A legend card of the same person plays his own role (the legend data's), and a custom design of
// the same name, a star now in another position group or anyone the data does not know go by their numbers.
func TestStarRoleLabelOnly(t *testing.T) {
	stopper := func(name, tag, pos string) *Player { // a centre-back's numbers
		p := &Player{ID: 3, Name: name, Tag: tag, Position: pos, Pace: 70, Shooting: 50, Passing: 70, Dribbling: 60,
			Defending: 86, Physical: 84, Goalkeeping: 20}
		p.Fill()
		return p
	}
	if p := stopper("Reece Jamés", "", "DF"); p.Role != "RB" {
		t.Errorf("Reece Jamés with a stopper's numbers: %s, want RB", p.Role)
	}
	flyer := &Player{ID: 4, Name: "Kylian Mbapé", Position: "FW", Pace: 97, Shooting: 89, Passing: 80, Dribbling: 92,
		Defending: 36, Physical: 76}
	if attrRole(flyer) == "ST" {
		t.Fatalf("the test wants winger's numbers")
	}
	if flyer.Fill(); flyer.Role != "ST" {
		t.Errorf("Mbapé with a winger's numbers: %s, want ST", flyer.Role)
	}
	navas := &Player{ID: 5, Name: "Jesús Navaz", Position: "FW", Tag: "legend", Pace: 88, Shooting: 70, Passing: 80,
		Dribbling: 84, Defending: 40, Physical: 70}
	if navas.Fill(); navas.Role != "RW" {
		t.Errorf("Navaz's legend card: %s, want RW (the legend data)", navas.Role)
	}
	if p := stopper("Jesús Navaz", "", "DF"); p.Role != "RB" {
		t.Errorf("today's Navaz: %s, want RB (the club data)", p.Role)
	}
	for _, c := range []struct{ name, tag, pos string }{
		{"Reece Jamés", "custom", "DF"}, // a custom design
		{"Somebody Unknown", "", "DF"},  // not in the data
		{"Theo Hernandes", "", "DF"},    // LB: the data's role, as a check of the stopper
	} {
		p := stopper(c.name, c.tag, c.pos)
		want := "CB"
		if c.name == "Theo Hernandes" {
			want = "LB"
		}
		if p.Role != want {
			t.Errorf("%s (%q): %s, want %s", c.name, c.tag, p.Role, want)
		}
	}
	if p := stopper("Reece Jamés", "", "MF"); RoleCat(p.Role) != "MF" {
		t.Errorf("a star moved into midfield can't play right-back: %s", p.Role)
	}
}

// A club's stars count toward the squad's shape by their position group ("FW/RW" is a forward).
func TestStarSquadShape(t *testing.T) {
	ld := LeagueByCode("EN")
	def := CountryClubDefs("EN")[0]
	if len(def.Stars) == 0 {
		t.Fatalf("%s has no stars", def.Name)
	}
	got := map[string]int{}
	for _, p := range GenSquad(rand.New(rand.NewSource(1)), ld.Nations, def.Base, def.Stars) {
		got[p.Position]++
	}
	for pos, n := range SquadShape {
		if got[pos] != n {
			t.Errorf("%s: %d %s, want %d (%v)", def.Name, got[pos], pos, n, got)
		}
	}
}
