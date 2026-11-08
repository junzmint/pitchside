package game

import (
	"math/rand"
	"testing"
)

// Icons don't count towards the 50-player cap: a regular can't join a full squad, an icon always can.
func TestSquadCapIgnoresIcons(t *testing.T) {
	var squad []*Player
	for i := 0; i < MaxSquad; i++ {
		squad = append(squad, &Player{ID: i + 1})
	}
	for i := 0; i < 30; i++ {
		squad = append(squad, &Player{ID: 100 + i, Tag: "legend"})
	}
	if n := regulars(squad); n != MaxSquad {
		t.Fatalf("%d regulars, want %d", n, MaxSquad)
	}
	icon, custom, kid := &Player{Tag: "legend"}, &Player{Tag: "custom"}, &Player{}
	if squadFull(regulars(squad), icon) || squadFull(regulars(squad), custom) {
		t.Error("an icon was turned away from a squad full of regulars")
	}
	if !squadFull(regulars(squad), kid) || !squadFull(regulars(squad), nil) {
		t.Error("a regular got into a full squad")
	}
	if squadFull(regulars(squad[:MaxSquad-1]), kid) {
		t.Error("a squad with room turned a regular away")
	}
}

// More than 99 players (a big icon collection): every player still gets his own number, going on from 100,
// and the daily tidy leaves them be.
func TestShirtsPast99(t *testing.T) {
	r := rand.New(rand.NewSource(4))
	squad := GenSquad(r, []string{"EN"}, 74, nil)
	for len(squad) < 130 {
		p := GenPlayer(r, []string{"EN"}, []string{"GK", "DF", "MF", "FW"}[len(squad)%4], 88, 25, 33)
		p.Tag = "legend"
		squad = append(squad, p)
	}
	for i, p := range squad {
		p.ID = i + 1
		p.Shirt = 0
	}
	freshShirts(squad)
	seen := map[int]bool{}
	over := 0
	for _, p := range squad {
		if p.Shirt < 1 || seen[p.Shirt] {
			t.Fatalf("%s got %d (taken or none)", p.Name, p.Shirt)
		}
		seen[p.Shirt] = true
		if p.Shirt > 99 {
			over++
		}
	}
	if over != len(squad)-99 {
		t.Errorf("%d numbers past 99 for %d players", over, len(squad))
	}
	if again := tidyShirts(squad, nil, nil, false); len(again) != 0 {
		t.Errorf("the daily tidy moved %d players", len(again))
	}
}

// An icon on the bench never asks for games; a regular in the same spot does (now and then).
func TestIconNeverAsksForGames(t *testing.T) {
	talked := func(tag string) int {
		n := 0
		for seed := int64(1); seed <= 40; seed++ {
			r := rand.New(rand.NewSource(seed))
			squad := GenSquad(rand.New(rand.NewSource(7)), []string{"EN"}, 74, nil)
			uid := 1
			for i, p := range squad {
				p.ID = i + 1
				p.ClubID = &uid
			}
			club := &Club{ID: uid, IsUser: true, Formation: "4-4-2"}
			club.Lineup = BestLineup(squad, club.Formation)
			inXI := map[int]bool{}
			for _, id := range club.Lineup {
				inXI[id] = true
			}
			// a bench player as good as the starter in his position, out for six matches
			var star, b *Player
			for _, p := range squad {
				if inXI[p.ID] && p.Position == "MF" && star == nil {
					star = p
				}
			}
			for _, p := range squad {
				if !inXI[p.ID] && p.Position == "MF" && b == nil {
					b = p
				}
			}
			b.Pace, b.Shooting, b.Passing, b.Dribbling, b.Defending, b.Physical = star.Pace, star.Shooting, star.Passing, star.Dribbling, star.Defending, star.Physical
			b.Age, b.Tag = 25, tag
			b.Fill()
			c := &Career{UserClubID: uid, Season: 1, Day: 10}
			c.Events.TalkSeason = 1
			c.Events.Bench = map[int]int{b.ID: 6}
			w := &world{career: c, byID: map[int]*Club{uid: club}, players: map[int][]*Player{uid: squad}}
			w.newTalks(r, &DayReport{})
			for _, k := range c.Events.Talks {
				if k.PlayerID == b.ID {
					n++
				}
			}
		}
		return n
	}
	if n := talked(""); n == 0 {
		t.Fatal("a regular never asked for games: the test proves nothing")
	}
	if n := talked("legend"); n != 0 {
		t.Errorf("an icon asked for games %d times", n)
	}
	if wantsOutAllowed(&Player{Tag: "legend"}) || wantsOutAllowed(&Player{Tag: "custom"}) || !wantsOutAllowed(&Player{}) {
		t.Error("wantsOutAllowed: icons must never ask to leave, regulars may")
	}
}
