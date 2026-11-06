package game

import (
	"context"
	"encoding/json"
	"log"
	"math"
	"sort"

	"github.com/jackc/pgx/v5"
)

// Shirt numbers. Every signing used to get the squad's highest number plus one (and the computer's clubs a random
// 50 to 89), so a few windows of buying and selling put a squad into the 50s, 60s and beyond; the generated squads
// were numbered 1 to 25 by line, so keepers wore 2 and 3 and the strikers 20 and up.
//
// A newcomer gets a number that suits him (pickShirt):
//   - his own number if it is 30 or lower, suits his position and is free here (a classic one only if he will start);
//   - otherwise, if he is good enough to start, a free classic number of his role: 1 keeper, 2 and 3 full-backs,
//     4 and 5 centre-backs, 6 holding midfielder, 8 central midfielder, 10 playmaker, 7 and 11 wingers, 9 striker;
//   - otherwise a squad number his line usually wears (13 a keeper, 15 a defender, 16 a midfielder, 19 a forward…);
//   - otherwise the lowest free number from 12 up that suits him.
// A retired number (club_legends.go) is never handed out.
//
// tidyShirts puts a squad in order: a number someone else already wears, a retired one, one above 40 or one that
// doesn't suit the position (a keeper on 9, a striker on 4) moves to a better free one; at the start of a season a
// classic number left free goes to the best player of a role that wears it, if he wears a squad number now (the new
// number 9). Numbers you picked yourself (ClubLife.Shirts) and the numbers of the club's legends stay as they are.

// ShirtHigh: numbers above it move down to a free lower one when the squad is tidied.
const ShirtHigh = 40

// classicShirts: the classic numbers of each role, first choice first.
var classicShirts = map[string][]int{
	"GK": {1},
	"RB": {2}, "RWB": {2},
	"LB": {3}, "LWB": {3},
	"CB": {4, 5},
	"DM": {6, 4},
	"CM": {8, 6},
	"AM": {10, 8},
	"RM": {7, 11}, "LM": {11, 7},
	"RW": {7, 11}, "LW": {11, 7},
	"ST": {9, 10},
}

// squadShirts: what each line usually wears when the classic numbers are taken.
var squadShirts = map[string][]int{
	"GK": {13, 12, 25, 31, 30, 33, 40},
	"DF": {15, 14, 22, 24, 26, 23, 12, 16, 28, 32, 34, 35},
	"MF": {16, 18, 20, 14, 17, 21, 23, 24, 25, 26, 27, 28},
	"FW": {19, 17, 18, 21, 20, 14, 27, 29, 39},
}

// classicLines: the lines a classic number suits (1 is the keeper's alone).
var classicLines = map[int]string{2: "DF", 3: "DF", 4: "DFMF", 5: "DFMF", 6: "DFMF", 7: "MFFW", 8: "MF", 9: "FW", 10: "MFFW", 11: "MFFW"}

// startersPerLine and startersPerRole: how many of a line, or of a role, usually start (a classic number is for one
// of them: the best striker wears 9 even when both wingers are better players).
var startersPerLine = map[string]int{"GK": 1, "DF": 4, "MF": 4, "FW": 3}
var startersPerRole = map[string]int{"GK": 1, "CB": 2, "LB": 1, "RB": 1, "LWB": 1, "RWB": 1, "DM": 1, "CM": 2, "AM": 1,
	"LM": 1, "RM": 1, "LW": 1, "RW": 1, "ST": 2}

func shirtRole(p *Player) string {
	role := p.Role
	if role == "" {
		role = NaturalRole(p)
	}
	if _, ok := classicShirts[role]; ok && RoleCat(role) == p.Position {
		return role
	}
	switch p.Position {
	case "GK":
		return "GK"
	case "DF":
		return "CB"
	case "MF":
		return "CM"
	}
	return "ST"
}

// shirtFits: the number suits his position (nobody but a keeper wears 1; a keeper wears no outfield classic).
func shirtFits(p *Player, n int) bool {
	if n < 1 || n > 99 {
		return false
	}
	if p.Position == "" { // nothing known about him: any number will do
		return true
	}
	if n == 1 {
		return p.Position == "GK"
	}
	if n <= 11 {
		lines := classicLines[n]
		return p.Position != "GK" && len(lines) > 0 && (lines[:2] == p.Position || len(lines) == 4 && lines[2:] == p.Position)
	}
	return true
}

// startsFor: he would be one of the first choices of his line in this squad.
func startsFor(squad []*Player, p *Player) bool {
	ovr := p.Overall
	if ovr == 0 { // a card not rated yet
		ovr = int(math.Round(OverallAs(p, p.Position)))
	}
	role := shirtRole(p)
	line, inRole := 0, 0
	for _, x := range squad {
		if !samePlayer(x, p) && x.Position == p.Position && x.Overall > ovr {
			line++
			if shirtRole(x) == role {
				inRole++
			}
		}
	}
	// first choice of his line, or of his role while near the top of his line (the best striker behind two better
	// wingers; not the only left midfielder of a squad that plays without one)
	return line < startersPerLine[p.Position] || (inRole < startersPerRole[role] && line < startersPerLine[p.Position]+2)
}

// samePlayer: the same man (by id once he has one; a player just generated has none yet)
func samePlayer(a, b *Player) bool { return a == b || (a.ID != 0 && a.ID == b.ID) }

// shirtChoice: the best free number for p (see the top); taken: numbers others wear; retired: number → its legend.
func shirtChoice(p *Player, taken map[int]bool, retired map[int]int, starts bool) int {
	free := func(n int) bool {
		if n < 1 || n > 99 || taken[n] {
			return false
		}
		owner, ok := retired[n]
		return !ok || owner == p.ID
	}
	if n := p.Shirt; n >= 1 && n <= 30 && shirtFits(p, n) && free(n) && (n > 11 || starts) {
		return n
	}
	if starts {
		for _, n := range classicShirts[shirtRole(p)] {
			if free(n) {
				return n
			}
		}
	}
	for _, n := range squadShirts[p.Position] {
		if free(n) {
			return n
		}
	}
	for n := 12; n <= 99; n++ {
		if free(n) {
			return n
		}
	}
	for n := 1; n <= 11; n++ { // only classic numbers left: one that suits him, else any
		if free(n) && shirtFits(p, n) {
			return n
		}
	}
	for n := 1; n <= 99; n++ {
		if free(n) {
			return n
		}
	}
	return p.Shirt
}

// pickShirt: the number p gets joining squad (with or without him in it).
func pickShirt(squad []*Player, retired map[int]int, p *Player) int {
	taken := map[int]bool{}
	for _, x := range squad {
		if !samePlayer(x, p) {
			taken[x.Shirt] = true
		}
	}
	return shirtChoice(p, taken, retired, startsFor(squad, p))
}

// freshShirts: number a squad that has none yet (a new career, an exhibition XI): the best players choose first.
func freshShirts(squad []*Player) {
	order := append([]*Player(nil), squad...)
	sort.SliceStable(order, func(i, j int) bool { return order[i].Overall > order[j].Overall })
	taken := map[int]bool{}
	for _, p := range order {
		p.Shirt = 0
	}
	for _, p := range order {
		p.Shirt = shirtChoice(p, taken, nil, startsFor(squad, p))
		taken[p.Shirt] = true
	}
}

// tidyShirts: put a squad's numbers in order (see the top). keep: players whose number stays (picked by you, a
// legend's). season: the start of a season, when a free classic number goes to the best player of its role.
// It returns the players whose number changed.
func tidyShirts(squad []*Player, retired map[int]int, keep map[int]bool, season bool) []*Player {
	before := map[int]int{}
	for _, p := range squad {
		before[p.ID] = p.Shirt
	}
	order := append([]*Player(nil), squad...)
	sort.SliceStable(order, func(i, j int) bool {
		a, b := order[i], order[j]
		if keep[a.ID] != keep[b.ID] {
			return keep[a.ID]
		}
		if a.Overall != b.Overall {
			return a.Overall > b.Overall
		}
		if a.Tenure != b.Tenure {
			return a.Tenure > b.Tenure
		}
		return a.ID < b.ID
	})
	taken := map[int]bool{}
	pending := map[*Player]bool{} // his number has to go
	var redo []*Player
	for _, p := range order {
		n := p.Shirt
		owner, isRetired := retired[n]
		legend := isRetired && owner == p.ID // a legend on the number the club retired for him
		ok := n >= 1 && n <= 99 && !taken[n] && (!isRetired || legend)
		if ok && !keep[p.ID] && !legend && (!shirtFits(p, n) || n > ShirtHigh) {
			ok = false
		}
		if ok {
			taken[n] = true
		} else {
			pending[p] = true
			redo = append(redo, p)
		}
	}
	if season {
		// a classic number left free goes to the best player of a role that wears it (if he starts), before
		// anyone else is renumbered
		for _, n := range []int{9, 10, 7, 11, 1, 8, 6, 4, 5, 2, 3} {
			if _, isRetired := retired[n]; taken[n] || isRetired {
				continue
			}
			var best *Player
			for _, p := range squad {
				if keep[p.ID] || !wearsClassic(p, n) || !startsFor(squad, p) {
					continue
				}
				if !pending[p] {
					if p.Shirt <= 11 {
						continue // already on a classic number
					}
					if owner, own := retired[p.Shirt]; own && owner == p.ID {
						continue
					}
				}
				if best == nil || p.Overall > best.Overall {
					best = p
				}
			}
			if best != nil {
				if !pending[best] {
					delete(taken, best.Shirt)
				}
				delete(pending, best)
				best.Shirt = n
				taken[n] = true
			}
		}
	}
	for _, p := range redo {
		if pending[p] {
			p.Shirt = shirtChoice(p, taken, retired, startsFor(squad, p))
			taken[p.Shirt] = true
		}
	}
	var changed []*Player
	for _, p := range squad {
		if p.Shirt != before[p.ID] {
			changed = append(changed, p)
		}
	}
	return changed
}

func wearsClassic(p *Player, n int) bool {
	for _, x := range classicShirts[shirtRole(p)] {
		if x == n {
			return true
		}
	}
	return false
}

// keepShirts: the players of the user's squad whose number tidying leaves alone: the ones you numbered yourself and
// the club's legends still at the club.
func (life *ClubLife) keepShirts() map[int]bool {
	out := map[int]bool{}
	for _, id := range life.Shirts {
		out[id] = true
	}
	for _, le := range life.Legends {
		if le.Reason == "active" {
			out[le.PlayerID] = true
		}
	}
	return out
}

// shirtFor: the number p gets joining club clubID (its squad as the world has it; the user's club also skips the
// numbers it has retired).
func (w *world) shirtFor(ctx context.Context, q DBTX, clubID int, p *Player) int {
	return pickShirt(w.players[clubID], w.retiredOf(ctx, q, clubID), p)
}

// retiredOf: the numbers a club has retired (only the user's club retires any).
func (w *world) retiredOf(ctx context.Context, q DBTX, clubID int) map[int]int {
	if clubID != w.career.UserClubID {
		return nil
	}
	return w.clubLife(ctx, q).retiredSet()
}

// homeShirt: a player back from a loan gets his old number if nobody wears it now (and it is not retired), else
// one that suits him.
func (w *world) homeShirt(ctx context.Context, q DBTX, clubID int, p *Player, old int) int {
	if old >= 1 && old <= 99 {
		free := true
		for _, x := range w.players[clubID] {
			if x.ID != p.ID && x.Shirt == old {
				free = false
				break
			}
		}
		if clubID == w.career.UserClubID {
			if owner, ok := w.clubLife(ctx, q).retiredSet()[old]; ok && owner != p.ID {
				free = false
			}
		}
		if free {
			return old
		}
	}
	return w.shirtFor(ctx, q, clubID, p)
}

// dbShirt: the same from the database, for code that works outside the world (a signing straight from the market).
func dbShirt(ctx context.Context, q DBTX, clubID int, p *Player) (int, error) {
	squad, err := scanPlayers(q.Query(ctx, `SELECT `+playerColsP+` FROM players p WHERE p.club_id=$1`, clubID))
	if err != nil {
		return 0, err
	}
	var retired map[int]int
	var raw []byte
	if err := q.QueryRow(ctx, `SELECT club_life FROM careers WHERE user_club_id=$1 LIMIT 1`, clubID).Scan(&raw); err == nil && len(raw) > 0 {
		life := &ClubLife{}
		if json.Unmarshal(raw, life) == nil {
			retired = life.retiredSet()
		}
	}
	return pickShirt(squad, retired, p), nil
}

// pruneShirts: forget the numbers you picked for players who have left.
func (life *ClubLife) pruneShirts(squad []*Player) {
	here := map[int]bool{}
	for _, p := range squad {
		here[p.ID] = true
	}
	keep := life.Shirts[:0]
	for _, id := range life.Shirts {
		if here[id] {
			keep = append(keep, id)
		}
	}
	life.Shirts = keep
}

// seasonShirts: the start of a season puts every squad's numbers in order (StartNextSeason, club_state.go).
func seasonShirts(life *ClubLife, userClub int, squads map[int][]*Player) []*Player {
	var changed []*Player
	for id, sq := range squads {
		if id == userClub {
			life.pruneShirts(sq)
			changed = append(changed, tidyShirts(sq, life.retiredSet(), life.keepShirts(), true)...)
		} else {
			changed = append(changed, tidyShirts(sq, nil, nil, true)...)
		}
	}
	return changed
}

// setShirt: you give one of your players a number (1 to 99, not one the club has retired for someone else); whoever
// wore it takes his old one. Your pick stays through the tidying (ClubLife.Shirts). It returns the players changed.
func setShirt(life *ClubLife, squad []*Player, pid, n int) ([]*Player, error) {
	if n < 1 || n > 99 {
		return nil, userErr("bad_shirt", "Pick a number from 1 to 99")
	}
	var p, other *Player
	for _, x := range squad {
		if x.ID == pid {
			p = x
		}
	}
	if p == nil {
		return nil, userErr("not_at_club", "He is no longer at the club")
	}
	if owner, ok := life.retiredSet()[n]; ok && owner != p.ID {
		return nil, userErr("shirt_retired", "That number is retired")
	}
	if p.Shirt == n {
		return nil, nil
	}
	for _, x := range squad {
		if x.ID != p.ID && x.Shirt == n {
			other = x
		}
	}
	if other != nil {
		if owner, ok := life.retiredSet()[other.Shirt]; ok && owner == other.ID {
			return nil, userErr("shirt_retired", "That number is retired")
		}
	}
	old := p.Shirt
	p.Shirt = n
	changed := []*Player{p}
	if other != nil {
		other.Shirt = old
		changed = append(changed, other)
		// he didn't choose his new number: the tidy may still move him to one that suits him
		keep := life.Shirts[:0]
		for _, id := range life.Shirts {
			if id != other.ID {
				keep = append(keep, id)
			}
		}
		life.Shirts = keep
	}
	picked := false
	for _, id := range life.Shirts {
		picked = picked || id == p.ID
	}
	if !picked {
		life.Shirts = append(life.Shirts, p.ID)
	}
	// the one who gave up his number gets a fitting one if the swap left him on an odd one
	changed = append(changed, tidyShirts(squad, life.retiredSet(), life.keepShirts(), false)...)
	return uniquePlayers(changed), nil
}

// TidyShirts (once, on start): saves from before shirts.go get their numbers put in order, as a new season would,
// every club of the world included (version 2: the first run left out the clubs outside the leagues you play in).
func (s *Store) TidyShirts(ctx context.Context) error {
	var done string
	_ = s.DB.QueryRow(ctx, `SELECT v FROM meta WHERE k='shirts'`).Scan(&done)
	if done == "2" {
		return nil
	}
	rows, err := s.DB.Query(ctx, `SELECT id, user_club_id FROM careers ORDER BY id`)
	if err != nil {
		return err
	}
	type cr struct{ id, club int }
	var cs []cr
	for rows.Next() {
		var c cr
		if err := rows.Scan(&c.id, &c.club); err != nil {
			rows.Close()
			return err
		}
		cs = append(cs, c)
	}
	rows.Close()
	total := 0
	for _, c := range cs {
		err := s.tx(ctx, func(q pgx.Tx) error {
			ps, err := scanPlayers(q.Query(ctx, `SELECT `+playerColsP+` FROM players p JOIN clubs k ON k.id = p.club_id
				WHERE p.career_id=$1 AND k.career_id=$1`, c.id))
			if err != nil {
				return err
			}
			life, err := loadClubLife(ctx, q, c.id)
			if err != nil {
				return err
			}
			squads := map[int][]*Player{}
			for _, p := range ps {
				if p.ClubID != nil {
					squads[*p.ClubID] = append(squads[*p.ClubID], p)
				}
			}
			changed := seasonShirts(life, c.club, squads)
			total += len(changed)
			if err := savePlayers(ctx, q, uniquePlayers(changed)); err != nil {
				return err
			}
			return saveClubLife(ctx, q, c.id, life)
		})
		if err != nil {
			return err
		}
	}
	if _, err := s.DB.Exec(ctx, `INSERT INTO meta (k, v) VALUES ('shirts', '2') ON CONFLICT (k) DO UPDATE SET v='2'`); err != nil {
		return err
	}
	if total > 0 {
		log.Printf("shirt numbers put in order: %d players in %d careers", total, len(cs))
	}
	return nil
}
