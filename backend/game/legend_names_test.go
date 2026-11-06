package game

import (
	"strings"
	"testing"
)

// The report that started it: a second Bale called Gareth Bailey-Spurs, a Rodri called Sergio Busquette-Rodri.
// Every legend is one real person under one parody name: no club glued on, no two lines for one person, and no
// name the generator could give a regen (he would count as that legend's modern self, personKey).
func TestLegendNamesArePeople(t *testing.T) {
	generated := map[string]string{}
	for nat, np := range nations {
		for _, f := range np.first {
			for _, l := range np.last {
				generated[foldName(f+" "+l)] = nat
			}
		}
	}
	seen := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(legendData), "\n") {
		f := strings.Split(line, "|")
		if len(f) != 8 {
			continue
		}
		name, k := f[0], foldName(f[0])
		if other, ok := seen[k]; ok {
			t.Errorf("%q and %q are one person", other, name)
		}
		seen[k] = name
		for _, glued := range []string{"-Spurs", "-Real", "-Viola", "-Atleti", "-Rodri"} {
			if strings.HasSuffix(name, glued) {
				t.Errorf("%q: a club glued to his name", name)
			}
		}
		if nat, ok := generated[k]; ok {
			t.Errorf("%q: a regen from %s could be called that", name, nat)
		}
	}
	for old, name := range legendRenames {
		if _, ok := seen[foldName(old)]; ok {
			t.Errorf("%q is still in the data", old)
		}
		if _, ok := seen[foldName(name)]; !ok {
			t.Errorf("%q (once %q) is not in the data", name, old)
		}
	}
	for _, old := range legendGone {
		if _, ok := seen[foldName(old)]; ok {
			t.Errorf("%q is still in the data", old)
		}
	}
	for _, name := range []string{"David Ginolá", "Fernandinho Rozza", "Rui Costta", "Diego Costta"} {
		if _, ok := seen[foldName(name)]; !ok {
			t.Errorf("%q is not in the data", name)
		}
	}
}
