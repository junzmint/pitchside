package game

import (
	"math/rand"
	"testing"
)

// scoutRegion: a home region like the game makes one: 60 clubs of Spain, squads from GenSquad.
func scoutRegion(seed int64) []*Player {
	r := rand.New(rand.NewSource(seed))
	ld := LeagueByCode("ES")
	var ps []*Player
	id := 1000
	for i, d := range CountryClubDefs("ES") {
		club := i + 1
		for _, p := range GenSquad(r, ld.Nations, d.Base, nil) {
			id++
			p.ID, p.ClubID = id, &club
			p.Fill()
			ps = append(ps, p)
		}
	}
	return ps
}

// scoutTrips sends `trips` missions to one region, the scouts remembering their last 60 reports (as the game
// does), and counts the grades of what they bring back.
func scoutTrips(ps []*Player, trips, skill int, eye bool, focus string) map[string]int {
	r := rand.New(rand.NewSource(7))
	count := map[string]int{}
	var memory []int
	for i := 0; i < trips; i++ {
		known := map[int]bool{}
		for _, id := range memory {
			known[id] = true
		}
		picked, n := selectFinds(r, ps, known, 1, skill, eye, focus, missionClubs(skill, eye))
		for j, c := range picked {
			rar := c.rarity
			if j >= n && rarityRank[rar] < rarityRank["epic"] {
				rar = "epic" // the hidden gem (resolveMission)
			}
			count[rar]++
			count["all"]++
			memory = append(memory, c.p.ID)
		}
		if len(memory) > 60 {
			memory = memory[len(memory)-60:]
		}
	}
	return count
}

// However often a region is scouted, Diamond and Epic reports stay special and plenty of reports are Common
// (taking the region's best every time made nearly every report Rare or better, a third of them Epic).
func TestScoutingGrades(t *testing.T) {
	ps := scoutRegion(1)
	for _, sc := range []struct {
		skill int
		eye   bool
		focus string
	}{{SelfScoutSkill, false, "any"}, {16, false, "any"}, {16, false, "star"}, {16, false, "talent"}, {20, true, "star"}} {
		c := scoutTrips(ps, 150, sc.skill, sc.eye, sc.focus)
		share := func(ks ...string) float64 {
			n := 0
			for _, k := range ks {
				n += c[k]
			}
			return float64(n) / float64(max(1, c["all"]))
		}
		t.Logf("skill %2d eye %-5v %-6s  diamond %4.1f%%  epic %4.1f%%  rare %4.1f%%  common %4.1f%%  (%d reports)",
			sc.skill, sc.eye, sc.focus, 100*share("legendary"), 100*share("epic"), 100*share("rare"), 100*share("common"), c["all"])
		if d := share("legendary"); d > 0.09 {
			t.Errorf("skill %d %s: %.0f%% of reports are Diamond", sc.skill, sc.focus, 100*d)
		}
		if top := share("legendary", "epic"); top > 0.32 {
			t.Errorf("skill %d %s: %.0f%% of reports are Epic or Diamond", sc.skill, sc.focus, 100*top)
		}
		if com := share("common"); com < 0.2 {
			t.Errorf("skill %d %s: only %.0f%% of reports are Common", sc.skill, sc.focus, 100*com)
		}
	}
}
