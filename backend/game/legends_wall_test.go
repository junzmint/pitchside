package game

import "testing"

// The Legends wall rules: only a legend who stayed (still playing here, or retired here) can have his
// number retired; one who was sold keeps his place on the wall but no number decision waits for him.
func TestLegendsWallHonour(t *testing.T) {
	great := func(le LegendEntry) LegendEntry { le.Apps, le.From, le.To = 300, 1, 7; return le } // a record that counts
	life := &ClubLife{Legends: []LegendEntry{
		great(LegendEntry{PlayerID: 1, Name: "Sold Star", Shirt: 7, Reason: "sold"}),              // saved before the rule: still waiting
		great(LegendEntry{PlayerID: 2, Name: "Active Icon", Shirt: 10, Reason: "active"}),         // still playing for the club
		great(LegendEntry{PlayerID: 3, Name: "Retired Here", Shirt: 4, Reason: "retired"}),        // retired at the club
		great(LegendEntry{PlayerID: 4, Name: "Let Go", Shirt: 5, Reason: "left", Honour: "kept"}), // a decision already taken stays
	}}
	life.tidyLegends()
	if life.Legends[0].Honour != "none" {
		t.Fatalf("a sold legend still waits for a number decision: %q", life.Legends[0].Honour)
	}
	if life.Legends[1].Honour != "" || life.Legends[2].Honour != "" || life.Legends[3].Honour != "kept" {
		t.Fatalf("tidy changed the others: %+v", life.Legends)
	}
	w := &world{career: &Career{UserClubID: 9}}
	if _, _, err := w.honourLegend(life, nil, 1, "retire"); err == nil {
		t.Fatal("a sold legend's number was retired")
	}
	uid := 9
	icon := &Player{ID: 2, Name: "Active Icon", Shirt: 10, ClubID: &uid}
	other := &Player{ID: 8, Name: "Newcomer", Shirt: 4, ClubID: &uid}
	if _, le, err := w.honourLegend(life, []*Player{icon, other}, 2, "retire"); err != nil || le.Honour != "retired" {
		t.Fatalf("active legend: %v %+v", err, le)
	}
	changed, _, err := w.honourLegend(life, []*Player{icon, other}, 3, "retire")
	if err != nil || life.Legends[2].Honour != "retired" {
		t.Fatalf("retired legend: %v %+v", err, life.Legends[2])
	}
	if icon.Shirt != 10 || other.Shirt == 4 || len(changed) != 1 {
		t.Fatalf("shirts after retiring 4 and 10: icon %d, newcomer %d, changed %d", icon.Shirt, other.Shirt, len(changed))
	}
	if len(life.Retired) != 2 {
		t.Fatalf("retired numbers: %v", life.Retired)
	}
	// selling the icon gives number 10 back (unretire), number 4 stays retired
	life.Legends[1].Honour = "none"
	life.unretire(10)
	if len(life.Retired) != 1 || life.Retired[0] != 4 {
		t.Fatalf("after the sale: %v", life.Retired)
	}
	if !legendWorthy(250, 1, 0) || !legendWorthy(150, 7, 0) || !legendWorthy(150, 1, 6) || legendWorthy(249, 6, 5) || legendWorthy(149, 9, 9) {
		t.Fatal("legendWorthy thresholds changed")
	}
	// a short record comes off the wall, unless his number was retired
	short := &ClubLife{Legends: []LegendEntry{
		{PlayerID: 1, Name: "Good Servant", Apps: 184, From: 1, To: 4, Trophies: 5, Reason: "active"},
		{PlayerID: 2, Name: "Honoured", Apps: 120, From: 1, To: 3, Trophies: 2, Reason: "retired", Honour: "retired"},
		{PlayerID: 3, Name: "Club Great", Apps: 260, From: 1, To: 6, Trophies: 2, Reason: "active"},
	}}
	short.tidyLegends()
	if len(short.Legends) != 2 || short.Legends[0].PlayerID != 2 || short.Legends[1].PlayerID != 3 {
		t.Fatalf("after the tidy: %+v", short.Legends)
	}
}
