package game

import (
	"strconv"
	"strings"
	"testing"
)

// A legend version younger than his peak age can still become the player he was at his peak: his potential
// is his peak. A version at or past his peak keeps his own level (a veteran is past it), the Icon his own.
func TestYoungLegendPotential(t *testing.T) {
	peaks := map[string]float64{}
	for _, line := range strings.Split(strings.TrimSpace(legendData), "\n") {
		if f := strings.Split(line, "|"); len(f) == 8 {
			peaks[f[0]], _ = strconv.ParseFloat(f[4], 64)
		}
	}
	peakAge := map[string]int{}
	for _, lv := range LegendVersions {
		if lv.Label == "Icon" {
			peakAge[lv.Name] = lv.Age
		}
	}
	for _, lv := range LegendVersions {
		want := int(lv.Ovr)
		if lv.Label != "Icon" && lv.Age < peakAge[lv.Name] {
			want = max(want, int(peaks[lv.Name]))
		}
		if lv.Pot != want {
			t.Fatalf("%s %s %s (age %d, ovr %.1f): potential %d, want %d", lv.Name, lv.Club, lv.Label, lv.Age, lv.Ovr, lv.Pot, want)
		}
		if lv.Pot < int(lv.Ovr) {
			t.Fatalf("%s %s: potential below his level", lv.Name, lv.Label)
		}
	}
	for _, lv := range LegendVersions {
		if lv.Name == "Steven Gerrardo" && lv.Label == "'01" && lv.Pot != 91 {
			t.Fatalf("Gerrardo at 21 should be able to reach his peak 91: %d", lv.Pot)
		}
	}
}
