package game

import (
	"math/rand"
	"testing"
)

// Renovation: 40% of what the level cost to build, and the level then holds for three seasons.
func TestFacilityRenovation(t *testing.T) {
	want := map[string]int64{"stadium": 22 * M, "training": 16 * M, "academy": 12_800_000, "medical": 15_200_000}
	for k, v := range want {
		if got := RenovateCost(k, MaxFacility); got != v {
			t.Errorf("%s at the top: %d, want %d", k, got, v)
		}
		if RenovateCost(k, 1) != 0 {
			t.Errorf("%s at level 1 should not need renovating", k)
		}
	}
	uid := 7
	club := &Club{ID: uid, Stadium: MaxFacility, TrainLvl: 2, Academy: 1, Medical: 3}
	c := &Career{UserClubID: uid}
	c.Commercial.Wear = map[string]int{"stadium": RenovateSeasons, "training": 1, "medical": 2}
	w := &world{career: c, byID: map[int]*Club{uid: club}}
	r := rand.New(rand.NewSource(1))
	for season := 1; season < RenovateSeasons; season++ {
		w.facilityWear(r, &DayReport{})
		if club.Stadium != MaxFacility {
			t.Fatalf("a renovated stadium slipped after %d season(s)", season)
		}
	}
	w.facilityWear(r, &DayReport{})
	if club.Stadium != MaxFacility-1 {
		t.Fatalf("after %d seasons without care the stadium should slip: level %d", RenovateSeasons, club.Stadium)
	}
}

// An upgrade (or a renovation) holds its level this season and the next two: upgraded in season 2, it holds
// until the end of season 4. A facility without a clock (a new career's own) gets a full one first.
func TestFacilityClock(t *testing.T) {
	if got := facilityUntil(2, 10, RenovateSeasons); got != 4 {
		t.Fatalf("upgraded in season 2: holds until %d, want 4", got)
	}
	if got := facilityUntil(2, len(Calendar)+1, RenovateSeasons); got != 5 {
		t.Fatalf("upgraded in the summer after season 2: holds until %d, want 5", got)
	}
	if got := facilityUntil(2, 10, 1); got != 2 {
		t.Fatalf("one season left in season 2: holds until %d, want 2", got)
	}
	if got := facilityUntil(1, 1, 0); got != 4 {
		t.Fatalf("no clock yet in season 1: holds until %d, want 4", got)
	}
	// the clock as it runs: a facility without one starts a full clock, a slip gives the level below a full one
	uid := 9
	club := &Club{ID: uid, Stadium: 3, TrainLvl: 2, Academy: 1, Medical: 1}
	c := &Career{UserClubID: uid}
	c.Commercial.Wear = map[string]int{"training": 1}
	w := &world{career: c, byID: map[int]*Club{uid: club}}
	r := rand.New(rand.NewSource(2))
	w.facilityWear(r, &DayReport{})
	if club.Stadium != 3 || c.Commercial.Wear["stadium"] != RenovateSeasons {
		t.Fatalf("a stadium without a clock: level %d, clock %d", club.Stadium, c.Commercial.Wear["stadium"])
	}
	if club.TrainLvl != 1 {
		t.Fatalf("training with one season left should slip: level %d", club.TrainLvl)
	}
	club.Medical = 3
	c.Commercial.Wear["medical"] = 1
	w.facilityWear(r, &DayReport{})
	if club.Medical != 2 || c.Commercial.Wear["medical"] != RenovateSeasons {
		t.Fatalf("after a slip the level below gets a full clock: level %d, clock %d", club.Medical, c.Commercial.Wear["medical"])
	}
}
