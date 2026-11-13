package game

import (
	"math"
	"sort"
)

// ---------------------------------------------------------------- locked starters
//
// The manager can lock starters into their slots (Care.Locked: player id → slot), e.g. to grind one player's
// ratings or goals. The assistant's eleven (AutoXI) is picked around them, the fitness and development rotations
// never rest them, and the automatic substitutions never take them off (in a live match only an injury does). A
// locked player who is injured is covered for as long as he is out and is back in his slot once he can play.

// heldSlots: the locked starters by slot (slot → player id) for a formation of n slots.
func heldSlots(c *Career, n int) map[int]int {
	if len(c.Care.Locked) == 0 {
		return nil
	}
	held := map[int]int{}
	for id, s := range c.Care.Locked {
		if s < 0 || s >= n {
			continue
		}
		if cur, ok := held[s]; !ok || id < cur { // two locks on one slot (never saved so): the lower id, so it is stable
			held[s] = id
		}
	}
	return held
}

// heldPlayers: the locked starters who can play, in their slots (nil elsewhere), and everyone who must stay out of
// the rest of the eleven: those players and the other versions of a locked legend.
func heldPlayers(players []*Player, n int, held map[int]int) (fixed []*Player, out map[int]bool) {
	fixed = make([]*Player, n)
	if len(held) == 0 {
		return fixed, nil
	}
	byID := make(map[int]*Player, len(players))
	for _, p := range players {
		byID[p.ID] = p
	}
	out = map[int]bool{}
	people := map[string]bool{}
	for s := 0; s < n; s++ {
		id, ok := held[s]
		p := byID[id]
		if !ok || p == nil || !available(p) || out[id] {
			continue
		}
		k := personKey(p)
		if k != "" && people[k] {
			continue // two locked versions of one legend: the first slot keeps him
		}
		fixed[s], out[id] = p, true
		if k != "" {
			people[k] = true
		}
	}
	for _, p := range players {
		if k := personKey(p); k != "" && people[k] {
			out[p.ID] = true
		}
	}
	return fixed, out
}

// placeHeld puts the locked starters who can play back into their slots in a saved eleven (after an injury
// someone else filled in): whoever stands there moves to the slot the locked man left, or out, and another
// version of a locked legend makes way. resolveLineup fills any gap left.
func placeHeld(lineup []int, n int, held map[int]int, squad []*Player) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = -1
		if i < len(lineup) {
			out[i] = lineup[i]
		}
	}
	fixed, _ := heldPlayers(squad, n, held)
	byID := make(map[int]*Player, len(squad))
	for _, p := range squad {
		byID[p.ID] = p
	}
	for s, p := range fixed {
		if p == nil || out[s] == p.ID {
			continue
		}
		at := -1
		for i, id := range out {
			if id == p.ID {
				at = i
			}
		}
		if at >= 0 {
			out[at] = out[s]
		}
		out[s] = p.ID
	}
	for s, p := range fixed {
		if p == nil {
			continue
		}
		for i, id := range out {
			if i != s && samePerson(byID[id], p) {
				out[i] = -1
			}
		}
	}
	return out
}

// lockSlots: the locks of a saved eleven (player id → slot). A locked starter's slot is where he now stands. A
// locked player who is out injured keeps his lock on the slot he will come back to (in a new shape the first slot
// of the same role), unless a starter is now locked there; anyone else not in the eleven loses his lock (the
// manager took him out of the side).
func lockSlots(ids, lineup []int, prev map[int]int, oldRoles, newRoles []string, own map[int]*Player) map[int]int {
	at := map[int]int{}
	for s, id := range lineup {
		if id > 0 {
			at[id] = s
		}
	}
	locks, taken := map[int]int{}, map[int]bool{}
	for _, id := range ids {
		if s, ok := at[id]; ok {
			locks[id], taken[s] = s, true
		}
	}
	same := len(oldRoles) == len(newRoles)
	for i := range oldRoles {
		same = same && i < len(newRoles) && oldRoles[i] == newRoles[i]
	}
	for _, id := range ids {
		p, old := own[id], -1
		if s, ok := prev[id]; ok {
			old = s
		}
		if _, starts := at[id]; starts || p == nil || available(p) || old < 0 || old >= len(oldRoles) {
			continue
		}
		slot := -1
		if same {
			slot = old
		} else {
			for s, role := range newRoles {
				if role == oldRoles[old] && !taken[s] {
					slot = s
					break
				}
			}
		}
		if slot >= 0 && !taken[slot] {
			locks[id], taken[slot] = slot, true
		}
	}
	if len(locks) == 0 {
		return nil
	}
	return locks
}

// lockedIDs: the locked players, in a stable order.
func lockedIDs(c *Career) []int {
	ids := make([]int, 0, len(c.Care.Locked))
	for id := range c.Care.Locked {
		ids = append(ids, id)
	}
	sort.Ints(ids)
	return ids
}

// ---------------------------------------------------------------- the assistant's advice on locked starters

// RestFitness: a locked starter below this fitness gets the assistant's advice to rest (the fitness rotation's
// threshold when that is on).
const RestFitness = 60

// lockAlerts: the assistant's word on each locked starter who would be better off sitting the next match out:
// playing through a knock, tired, or low on morale (lock_knock, lock_tired, lock_morale; you answer rest or keep
// him on), and the ones you rested (lock_resting). An injured one needs no answer: he is covered and back in his
// slot once fit. The ids it speaks about come back in tipped, so the morale alerts don't say it twice.
func (w *world) lockAlerts() (out []Alert, tipped map[int]bool) {
	c := w.career
	if len(c.Care.Locked) == 0 || c.Day > len(Calendar) {
		return nil, nil
	}
	tired := float64(RestFitness)
	if c.Care.Rotate > 0 {
		tired = float64(c.Care.Rotate)
	}
	tipped = map[int]bool{}
	for _, p := range w.players[c.UserClubID] {
		if _, ok := c.Care.Locked[p.ID]; !ok || c.Care.Keep[p.ID] {
			continue
		}
		a := Alert{Kind: "player", ID: p.ID, Name: p.Name, Action: "rest"}
		switch {
		case p.Resting:
			a.Key, a.Level, a.Action = "lock_resting", "info", "unrest"
		case p.Injury > 0 && !p.Rushed:
			continue
		case p.Rushed:
			a.Key, a.Level = "lock_knock", "bad"
		case p.Fitness < tired:
			a.Key, a.Level, a.N = "lock_tired", "warn", int(math.Round(p.Fitness))
			if p.Fitness < 50 {
				a.Level = "bad"
			}
		case p.Morale < AlertPlayerMorale:
			a.Key, a.Level, a.N = "lock_morale", "warn", int(math.Round(p.Morale))
		default:
			continue
		}
		tipped[p.ID] = true
		out = append(out, a)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, tipped
}
