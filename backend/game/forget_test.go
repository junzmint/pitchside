package game

import "testing"

// A player who leaves (sold, swapped, released, loaned out) takes everything waiting about him with him
// as soon as the career is loaded again, not at the next matchday.
func TestForgetDeparted(t *testing.T) {
	uid := 10
	stays := &Player{ID: 1, Name: "Stays", ClubID: &uid}
	c := &Career{UserClubID: uid}
	c.Events.Talks = []Talk{{ID: 1, PlayerID: 1}, {ID: 2, PlayerID: 2}}
	c.Events.Promises = []Promise{{PlayerID: 1}, {PlayerID: 2}}
	c.Events.Bids = []Bid{{PlayerID: 2}}
	c.Events.Captain = 2
	w := &world{career: c, players: map[int][]*Player{uid: {stays}}, crew: &StaffState{
		Decisions: []StaffDecision{{Kind: "prospect", PlayerID: 2}, {Kind: "camp"}, {Kind: "prospect", PlayerID: 1}},
		Promises:  []StaffPromise{{Kind: "minutes", PlayerID: 2}, {Kind: "signing"}},
		Mentees:   map[int]int{1: 5, 2: 5},
	}}
	w.forgetDeparted()
	es := &c.Events
	if len(es.Talks) != 1 || es.Talks[0].PlayerID != 1 {
		t.Errorf("talks: %+v", es.Talks)
	}
	if len(es.Promises) != 1 || es.Promises[0].PlayerID != 1 {
		t.Errorf("promises: %+v", es.Promises)
	}
	if len(es.Bids) != 0 || es.Captain != 0 {
		t.Errorf("bids %+v, captain %d", es.Bids, es.Captain)
	}
	st := w.crew
	if len(st.Decisions) != 2 || st.Decisions[0].Kind != "camp" || st.Decisions[1].PlayerID != 1 {
		t.Errorf("staff cards: %+v", st.Decisions)
	}
	if len(st.Promises) != 1 || st.Promises[0].Kind != "signing" {
		t.Errorf("staff promises: %+v", st.Promises)
	}
	if _, ok := st.Mentees[2]; ok || st.Mentees[1] != 5 {
		t.Errorf("mentees: %+v", st.Mentees)
	}
	w.crew = nil
	w.forgetDeparted() // a career without a staff room yet
}
