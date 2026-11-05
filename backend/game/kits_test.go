package game

import (
	"strings"
	"testing"
)

// Every line of kit data parses, and every club in the four competitions and the world has one.
func TestKitData(t *testing.T) {
	for name, s := range kitData {
		for i, part := range strings.Split(s, "|") {
			if _, ok := parseKit(part); !ok {
				t.Errorf("%s: kit %d does not parse: %q", name, i, part)
			}
		}
	}
	for code, names := range countryClubs {
		for _, n := range names {
			if _, ok := kitEntry(n); !ok {
				t.Errorf("%s: no kit for %q", code, n)
			}
		}
	}
	for _, l := range Leagues {
		for _, d := range l.Clubs {
			if _, ok := kitEntry(d.Name); !ok {
				t.Errorf("%s: no kit for %q", l.Code, d.Name)
			}
		}
	}
	for _, wl := range WorldLeagues {
		for _, c := range wl.Cities {
			if _, ok := kitEntry(c); !ok {
				t.Errorf("%s: no kit for %q", wl.Code, c)
			}
			if _, ok := kitEntry(c + " United"); !ok {
				t.Errorf("%s: no kit for %q with a suffix", wl.Code, c)
			}
		}
	}
}

// Defaults always give three valid kits, with away and third standing apart from home.
func TestDefaultKits(t *testing.T) {
	for _, n := range []string{"Mersey Red", "Leicester Foxes", "Glasgow Hoops FC", "Some New Club"} {
		ks := DefaultKits(n, "#c8102e", "#ffffff")
		if !ks.valid() {
			t.Fatalf("%s: invalid kits %+v", n, ks)
		}
		if colourDist(ks.Home.Shirt, ks.Away.Shirt) < 150 {
			t.Errorf("%s: away %s too close to home %s", n, ks.Away.Shirt, ks.Home.Shirt)
		}
	}
	if len(KitMigrations()) != 3 {
		t.Errorf("expected the table and two colour updates")
	}
}
