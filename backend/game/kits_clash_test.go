package game

import (
	"sort"
	"strings"
	"testing"
)

// Every club's away and third kits stand apart from its home kit (else they don't help in a clash),
// whether the data spells them out or the rules make them.
func TestKitsStandApart(t *testing.T) {
	var bad []string
	for name := range kitData {
		ks := DefaultKits(name, "#c8202f", "#ffffff")
		if d := kitLook(ks.Home, ks.Away); d < KitClash {
			bad = append(bad, name+" away")
		}
		if d := kitLook(ks.Home, ks.Third); d < KitClash {
			bad = append(bad, name+" third")
		}
	}
	sort.Strings(bad)
	if len(bad) > 0 {
		t.Errorf("%d change kits look like home:\n%s", len(bad), strings.Join(bad, "\n"))
	}
}

// A few pairs the measure must get right.
func TestKitLook(t *testing.T) {
	k := func(s string) Kit { x, _ := parseKit(s); return x }
	cases := []struct {
		a, b  string
		clash bool
	}{
		{"plain c8102e ffffff c8102e c8102e", "stripes eb172b ffffff 111111 eb172b", true},    // red v red-and-white stripes
		{"plain 034694 ffffff 034694 ffffff", "plain 1c2c5b 6cabdd 1c2c5b 1c2c5b", true},      // royal blue v navy
		{"plain 034694 ffffff 034694 ffffff", "plain 6cabdd 1c2c5b ffffff 6cabdd", false},     // royal blue v sky blue
		{"stripes 241f20 ffffff 241f20 241f20", "plain 1d6a5a ffffff 1d6a5a 1d6a5a", false},   // magpies v green
		{"chevron 1c5ba8 ffffff ffffff 1c5ba8", "chevron f4f4f4 1c5ba8 f4f4f4 f4f4f4", false}, // blue V v white V
		{"plain fde100 111111 111111 fde100", "plain f2a900 111111 111111 f2a900", true},      // yellow v amber
	}
	for _, c := range cases {
		if got := kitLook(k(c.a), k(c.b)) < KitClash; got != c.clash {
			t.Errorf("%s v %s: clash %v, want %v (look %.0f)", c.a, c.b, got, c.clash, kitLook(k(c.a), k(c.b)))
		}
	}
}
