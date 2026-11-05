package game

import (
	"math"
	"math/rand"
	"strings"
	"testing"
)

// legendCards: every version of a legend, built as a career builds its cards (legendStar), with a few seeds.
func legendCards(t *testing.T, name string, seeds int) []*Player {
	t.Helper()
	var out []*Player
	for _, lv := range LegendVersions {
		if lv.Name != name {
			continue
		}
		for s := 0; s < seeds; s++ {
			out = append(out, legendStar(rand.New(rand.NewSource(int64(s)*7919+1)), lv, lv.Pot))
		}
	}
	if len(out) == 0 {
		t.Fatalf("no legend called %q", name)
	}
	return out
}

// The report that started it: Trent plays on the right flank, he is no centre-back. Legends whose role everyone
// knows, on generated cards: the role they show and play whatever their id (which picks the side for anyone
// else), also once a card turns up on the market (a template becoming a player), with numbers that read as
// that line.
func TestLegendRolesKnown(t *testing.T) {
	want := map[string]string{
		"Trent Alexander-Arnald": "RB",
		"Cafú Evangelista":       "RB",
		"Roberto Carloss":        "LB",
		"Paolo Maldinni":         "LB",
		"Franco Baresy":          "CB",
		"Virgil van Dyck":        "CB",
		"Claude Makelelé":        "DM",
		"Zinedine Zidann":        "AM",
		"David Beckhem":          "RM",
		"Arjen Robbin":           "RW",
		"Vini Juniór":            "LW",
		"Gerd Müllar":            "ST",
		"Thierry Henri":          "ST",
	}
	for name, role := range want {
		for _, p := range legendCards(t, name, 25) {
			for _, id := range []int{1, 2} { // odd ids are right-sided, even ones left-sided for anyone else
				p.ID = id
				p.Fill()
				if p.Role != role || NaturalRole(p) != role {
					t.Fatalf("%s (age %d, id %d): role %s, want %s", name, p.Age, id, p.Role, role)
				}
			}
			if !fitsLine(p, role) {
				t.Fatalf("%s (age %d): his numbers read as %s, not %s (pace %v shooting %v dribbling %v defending %v)",
					name, p.Age, attrRole(p), role, p.Pace, p.Shooting, p.Dribbling, p.Defending)
			}
			tp := &Template{ID: 7, Kind: "legend", Name: p.Name, Nation: p.Nation, Age: p.Age, Position: p.Position, Pace: p.Pace,
				Shooting: p.Shooting, Passing: p.Passing, Dribbling: p.Dribbling, Defending: p.Defending, Physical: p.Physical,
				Goalkeeping: p.Goalkeeping, Potential: p.Potential, Version: "Icon"}
			if got := tp.toPlayer().Role; got != role {
				t.Fatalf("%s on the market: role %s, want %s", name, got, role)
			}
		}
	}
	// Trent's numbers say full-back too: quick for his defending (pace above 70, at least defending − 4)
	for _, p := range legendCards(t, "Trent Alexander-Arnald", 50) {
		if p.Pace <= 70 || p.Pace < p.Defending-4+lineMargin {
			t.Fatalf("Trent (age %d): pace %v against defending %v reads as a centre-back", p.Age, p.Pace, p.Defending)
		}
	}
}

// Every legend line: an outfielder names his role (position/role), one that NaturalRole gives, in his position's
// group; a keeper needs none. Every card of every legend is built for it: he shows that role, his numbers read as
// that line where attrRole tells lines apart (full-back or centre-back, winger or striker), his level is still the
// card's, and his potential the data's (a young version keeps his peak).
func TestLegendRolesMatchData(t *testing.T) {
	raw := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(legendData), "\n") {
		f := strings.Split(line, "|")
		if len(f) != 8 {
			t.Fatalf("bad legend line: %q", line)
		}
		pos, role, _ := strings.Cut(f[2], "/")
		switch {
		case pos == "GK" && role != "" && role != "GK":
			t.Errorf("%s: a keeper with the role %s", f[0], role)
		case pos != "GK" && !roleInPosition(role, pos):
			t.Errorf("%s: %q is not a %s role (DF: CB/LB/RB, MF: DM/CM/AM/LM/RM, FW: LW/RW/ST)", f[0], role, pos)
		}
		raw[f[0]] = role
	}
	if len(raw) < 250 {
		t.Fatalf("only %d legends read", len(raw))
	}
	for _, lv := range LegendVersions {
		if lv.Role != raw[lv.Name] || strings.Contains(lv.Pos, "/") {
			t.Fatalf("%s: parsed as %s/%s, data says %s", lv.Name, lv.Pos, lv.Role, raw[lv.Name])
		}
		for s := int64(0); s < 8; s++ {
			p := legendStar(rand.New(rand.NewSource(s*104729+int64(lv.Age))), lv, lv.Pot)
			want := lv.Role
			if want == "" {
				want = "GK"
			}
			if p.Role != want {
				t.Fatalf("%s %s %s: role %s, want %s", lv.Name, lv.Club, lv.Label, p.Role, want)
			}
			if !fitsLine(p, lv.Role) {
				t.Fatalf("%s %s %s (%s): his numbers read as %s", lv.Name, lv.Club, lv.Label, lv.Role, attrRole(p))
			}
			if d := OverallAs(p, p.Position) - lv.Ovr; math.Abs(d) > 1.5 {
				t.Fatalf("%s %s %s: overall %.1f for a %.1f card", lv.Name, lv.Club, lv.Label, OverallAs(p, p.Position), lv.Ovr)
			}
			if p.Potential < lv.Pot {
				t.Fatalf("%s %s %s: potential %d below the data's %d", lv.Name, lv.Club, lv.Label, p.Potential, lv.Pot)
			}
		}
	}
}

// The data's role belongs to the legend cards. Today's player of the same name, a custom design, a legend the data
// does not know or one whose position no longer fits the role keep the role their attributes give (attrRole), and
// so does everyone else: the side from the id, as before.
func TestLegendRoleOnlyForCards(t *testing.T) {
	stopper := func(id int, name, tag, pos string) *Player { // a centre-back's numbers
		p := &Player{ID: id, Name: name, Tag: tag, Position: pos, Pace: 72, Shooting: 50, Passing: 70, Dribbling: 60,
			Defending: 88, Physical: 85, Goalkeeping: 20}
		p.Fill()
		return p
	}
	for _, id := range []int{3, 4} {
		if p := stopper(id, "Trent Alexander-Arnald", "legend", "DF"); p.Role != "RB" {
			t.Errorf("Trent's card (id %d): %s, want RB", id, p.Role)
		}
	}
	if p := stopper(3, "  trent ALEXANDER-ARNALD ", "legend", "DF"); p.Role != "RB" {
		t.Errorf("his name, case and spacing aside: %s, want RB", p.Role)
	}
	for _, c := range []struct{ name, tag, pos string }{
		{"Trent Alexander-Arnald", "", "DF"},       // a modern namesake
		{"Trent Alexander-Arnald", "custom", "DF"}, // a custom design
		{"Somebody Unknown", "legend", "DF"},       // not in the data
	} {
		if p := stopper(3, c.name, c.tag, c.pos); p.Role != "CB" {
			t.Errorf("%s (%q): %s, want CB from his numbers", c.name, c.tag, p.Role)
		}
	}
	if p := stopper(3, "Trent Alexander-Arnald", "legend", "MF"); RoleCat(p.Role) != "MF" {
		t.Errorf("a midfielder can't play right-back: %s", p.Role)
	}
	fb := &Player{ID: 5, Position: "DF", Pace: 86, Shooting: 50, Passing: 75, Dribbling: 72, Defending: 80, Physical: 75}
	if NaturalRole(fb) != "RB" {
		t.Errorf("an odd id is a right-back: %s", NaturalRole(fb))
	}
	if fb.ID = 6; NaturalRole(fb) != "LB" {
		t.Errorf("an even id is a left-back: %s", NaturalRole(fb))
	}
}

// Old saves (FixLegendRoles): an unsigned card built before the data had roles, for another line, is found and
// built again for his role; a card that fits, a midfielder (whose kind is only leaned toward), a version or a name
// the data does not know and a custom design are left alone. A card built again fits, so the fix runs once.
func TestLegendMisbuiltCards(t *testing.T) {
	card := func(name, version, pos string, pace, shooting, dribbling, defending float64) *Template {
		return &Template{ID: 1, Kind: "legend", Name: name, Version: version, Position: pos, Pace: pace, Shooting: shooting,
			Passing: 85, Dribbling: dribbling, Defending: defending, Physical: 84, Goalkeeping: 20, Potential: 90}
	}
	old := card("Trent Alexander-Arnald", "Icon", "DF", 81, 66, 83, 91) // the report: a centre-back's numbers
	lv, bad := legendMisbuilt(old)
	if !bad || lv.Role != "RB" || lv.Label != "Icon" {
		t.Fatalf("Trent's old card: misbuilt %v, role %q", bad, lv.Role)
	}
	for s := int64(0); s < 30; s++ {
		p := legendStar(rand.New(rand.NewSource(s)), lv, max(old.Potential, lv.Pot))
		again := card(p.Name, "Icon", p.Position, p.Pace, p.Shooting, p.Dribbling, p.Defending)
		again.Passing, again.Physical, again.Goalkeeping = p.Passing, p.Physical, p.Goalkeeping
		if _, bad := legendMisbuilt(again); bad {
			t.Fatalf("a card built again is still misbuilt (pace %v, defending %v): the fix would run every start", p.Pace, p.Defending)
		}
		if p.Potential < old.Potential || p.Role != "RB" {
			t.Fatalf("built again: potential %d (was %d), role %s", p.Potential, old.Potential, p.Role)
		}
	}
	for _, c := range []struct {
		t   *Template
		bad bool
	}{
		{card("Gerd Müllar", "FC Bavaria '74", "FW", 95, 90, 92, 30), true},             // a striker built as a winger
		{card("Arjen Robbin", "FC Bavaria '13", "FW", 84, 92, 90, 30), true},            // a winger built as a striker
		{card("Franco Baresy", "Icon", "DF", 95, 60, 80, 92), true},                     // a centre-back built as a full-back
		{card("Roberto Carloss", "Real Madrix '02", "DF", 97, 70, 86, 92), false},       // already a full-back
		{card("Claude Makelelé", "Icon", "MF", 80, 70, 85, 85), false},                  // a midfielder
		{card("Trent Alexander-Arnald", "Mersey Red '99", "DF", 81, 66, 83, 91), false}, // no such version
		{card("Somebody Unknown", "Icon", "DF", 81, 66, 83, 91), false},
	} {
		if _, bad := legendMisbuilt(c.t); bad != c.bad {
			t.Errorf("%s %s: misbuilt %v, want %v", c.t.Name, c.t.Version, bad, c.bad)
		}
	}
	custom := card("Trent Alexander-Arnald", "Icon", "DF", 81, 66, 83, 91)
	custom.Kind = "custom"
	if _, bad := legendMisbuilt(custom); bad {
		t.Error("a custom design was taken for a legend card")
	}
}

// The startup log names the signed cards whose label the data changed, per name, with the move.
func TestLegendRoleChanges(t *testing.T) {
	card := func(id int, name, pos string, pace, defending, shooting float64) *Player {
		return &Player{ID: id, Name: name, Tag: "legend", Position: pos, Pace: pace, Shooting: shooting, Passing: 80,
			Dribbling: 85, Defending: defending, Physical: 80}
	}
	ps := []*Player{
		card(3, "Trent Alexander-Arnald", "DF", 81, 91, 60), // CB by his numbers
		card(4, "Trent Alexander-Arnald", "DF", 80, 90, 60),
		card(5, "Roberto Carloss", "DF", 97, 92, 70), // a full-back on the right by his odd id
		card(6, "Roberto Carloss", "DF", 97, 92, 70), // already on the left
		card(7, "Gerd Müllar", "FW", 80, 30, 95),     // a striker already
	}
	if got, want := roleChanges(ps), "Roberto Carloss ×1 (RB→LB), Trent Alexander-Arnald ×2 (CB→RB)"; got != want {
		t.Errorf("summary %q, want %q", got, want)
	}
	if got := roleChanges(ps[3:]); got != "none" {
		t.Errorf("nothing changed: %q", got)
	}
}

// Quick play's Legends XIs are legend cards too: the Mersey Red legends play their roles (Trent at right-back).
func TestLegendsXIRoles(t *testing.T) {
	var lc *legendClub
	for _, c := range legendClubs() {
		if c.def.Name == "Mersey Red" {
			lc = &c
		}
	}
	if lc == nil {
		t.Fatal("no Mersey Red Legends XI")
	}
	q := buildLegendSquad(lc.code, lc.idx)
	trent := false
	for _, p := range q.squad {
		want := legendRoles()[foldName(p.Name)]
		if want == "" {
			want = "GK"
		}
		if p.Role != want || NaturalRole(p) != want {
			t.Errorf("%s: role %s, want %s", p.Name, p.Role, want)
		}
		trent = trent || (p.Name == "Trent Alexander-Arnald" && p.Role == "RB")
	}
	if !trent {
		t.Error("Trent is not in the Mersey Red Legends XI at right-back")
	}
}
