package game

import (
	"context"
	"math"
	"strings"
	"sync"
	"unicode"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- legend versions
//
// A legend card is one era ("version") of a real person, and some of today's players are the same person as
// a legend card: the same name once case, spacing and accents are ignored (personKey). Custom designs are
// nobody but themselves. The rules:
//
//  1. Merge with the contemporary: when the user's club signs a legend version while the modern player who
//     is the same person is in its squad (on its books: not out on loan, not borrowed), they merge and only
//     the legend stays. Every attribute becomes max(legend, modern)+1 (up to IconMax), his limit breaks (the
//     higher potential +2, +1 more for a modern player of 78+, +2 for 85+) and he takes the modern player's
//     shirt. The modern player leaves the game quietly (archived like a retired player, his records kept; no
//     fee, no fan reaction). The reverse too: a modern player who joins while the club owns a version of him
//     merges into the version that would play (rule 3). Computer clubs never merge.
//  2. A club may own several versions of one person.
//  3. One version per match: the starting XI and the bench hold at most one version of a person, the club
//     version (his card from an era at this club) when he is fit, otherwise the best-rated one. The user's own
//     XI may not name two (SetLineup: "legend_twice").
//  4. Legends break their limit more easily: at any level (no BreakGap), still once a season (club.go).
//  7. A card is never below the modern player who is the same person, adjusted along the career curve for the
//     card's age: applied when a card becomes a player (market arrival, the icon pick, a signing) and in the
//     views that show cards (the Legends catalogue, the icon pick's offers). Signed legends keep their numbers.

// accentFold: letters with accents (lower case) → plain letters.
var accentFold = func() map[rune]string {
	m := map[rune]string{'ß': "ss", 'æ': "ae", 'œ': "oe", 'þ': "th", 'ð': "d"}
	for _, x := range [][2]string{
		{"àáâãäåāăąạảấầẩẫậắằẳẵặ", "a"}, {"çćĉċč", "c"}, {"ďđ", "d"}, {"èéêëēĕėęěẹẻẽếềểễệ", "e"}, {"ĝğġģ", "g"},
		{"ĥħ", "h"}, {"ìíîïĩīĭįıỉị", "i"}, {"ĵ", "j"}, {"ķ", "k"}, {"ĺļľŀł", "l"}, {"ñńņňŉ", "n"},
		{"òóôõöøōŏőơọỏốồổỗộớờởỡợ", "o"}, {"ŕŗř", "r"}, {"śŝşšș", "s"}, {"ţťŧț", "t"},
		{"ùúûüũūŭůűųưụủứừửữự", "u"}, {"ŵ", "w"}, {"ýÿŷỳỵỷỹ", "y"}, {"źżž", "z"},
	} {
		for _, r := range x[0] {
			m[r] = x[1]
		}
	}
	return m
}()

// foldName: a name with case, spacing and accents ignored ("  Vini  Juniór " → "vini junior").
func foldName(s string) string {
	var b strings.Builder
	space := false
	for _, r := range strings.ToLower(s) {
		switch {
		case unicode.IsSpace(r):
			space = b.Len() > 0
			continue
		case unicode.Is(unicode.Mn, r): // a combining accent
			continue
		}
		if space {
			b.WriteByte(' ')
			space = false
		}
		if f, ok := accentFold[r]; ok {
			b.WriteString(f)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// legendPeaks: each legend's person → his age at his peak (the age of his Icon card).
var legendPeaks = sync.OnceValue(func() map[string]int {
	m := map[string]int{}
	for _, lv := range LegendVersions {
		if lv.Label == "Icon" {
			m[foldName(lv.Name)] = lv.Age
		}
	}
	return m
})

var personCache sync.Map // name → its legend person ("" when he is nobody's)

// legendPerson: the legend card person a name belongs to, "" when none (cached: line-ups ask for every player).
func legendPerson(name string) string {
	if v, ok := personCache.Load(name); ok {
		return v.(string)
	}
	k := foldName(name)
	if _, ok := legendPeaks()[k]; !ok {
		k = ""
	}
	personCache.Store(name, k)
	return k
}

// personKey: who a player is across versions: a legend card, or a modern player who is also a legend card's
// person, gets that person's key; everyone else (custom designs included) gets "" and is only himself.
func personKey(p *Player) string {
	if p == nil {
		return ""
	}
	switch p.Tag {
	case "legend":
		if k := legendPerson(p.Name); k != "" {
			return k
		}
		return foldName(p.Name)
	case "":
		return legendPerson(p.Name)
	}
	return ""
}

// samePerson: two different players who are versions of one person.
func samePerson(a, b *Player) bool {
	k := personKey(a)
	return k != "" && a.ID != b.ID && k == personKey(b)
}

// eraClubNames: the clubs legend cards come from ("Real Madrix" for "Real Madrix '24").
var eraClubNames = sync.OnceValue(func() map[string]bool {
	m := map[string]bool{}
	for _, lv := range LegendVersions {
		if lv.Club != "" {
			m[lv.Club] = true
		}
	}
	return m
})

var eraClubs sync.Map // club id → name, for the clubs read so far that carry a legend era's name

// noteClub: scanClub reports every club it reads (names never change), so the line-up code, which sees only
// players, can tell a club version.
func noteClub(c *Club) {
	switch {
	case c == nil:
	case eraClubNames()[c.Name]:
		eraClubs.Store(c.ID, c.Name)
	default:
		eraClubs.Delete(c.ID) // (an id reused after a database reset)
	}
}

// isClubVersion: a legend card from an era at the club he plays for, i.e. his card's club is that club (not the
// Icon card, and not a card whose era club is missing from this world: isHomeCard would take the first club
// that signed such a card for his home, so the card's label decides here).
func isClubVersion(p *Player) bool {
	if p == nil || p.Tag != "legend" || p.ClubID == nil || p.Version == "" || p.Version == "Icon" {
		return false
	}
	name, ok := eraClubs.Load(*p.ClubID)
	return ok && strings.HasPrefix(p.Version, name.(string)+" '")
}

// betterVersion: of two versions of one person, a is the one to play: one who can play (a fully fit one
// before one rushed back from injury), the club version, the best-rated one (then the lower id, so the
// choice is stable).
func betterVersion(a, b *Player) bool {
	if x, y := available(a), available(b); x != y {
		return x
	}
	if x, y := a.Injury == 0, b.Injury == 0; x != y {
		return x
	}
	if x, y := isClubVersion(a), isClubVersion(b); x != y {
		return x
	}
	if a.Overall != b.Overall {
		return a.Overall > b.Overall
	}
	return a.ID < b.ID
}

// onePerPerson keeps only the version that plays (betterVersion) of each person; everyone else stays, in order.
func onePerPerson(ps []*Player) []*Player {
	var best map[string]*Player
	dup := false
	for _, p := range ps {
		k := personKey(p)
		if k == "" {
			continue
		}
		if best == nil {
			best = map[string]*Player{}
		}
		if cur, ok := best[k]; !ok {
			best[k] = p
		} else {
			dup = true
			if betterVersion(p, cur) {
				best[k] = p
			}
		}
	}
	if !dup {
		return ps
	}
	out := make([]*Player, 0, len(ps))
	for _, p := range ps {
		if k := personKey(p); k == "" || best[k] == p {
			out = append(out, p)
		}
	}
	return out
}

// benchVersions: a match-day bench holds no other version of a starter, and one version of anyone else.
func benchVersions(starters, bench []*Player) []*Player {
	var playing map[string]bool
	for _, p := range starters {
		if k := personKey(p); k != "" {
			if playing == nil {
				playing = map[string]bool{}
			}
			playing[k] = true
		}
	}
	if playing != nil {
		keep := make([]*Player, 0, len(bench))
		for _, p := range bench {
			if k := personKey(p); k == "" || !playing[k] {
				keep = append(keep, p)
			}
		}
		bench = keep
	}
	return onePerPerson(bench)
}

// lineupKeep: of the people named twice in a saved line-up, the version that stays (old saves: resolveLineup).
func lineupKeep(ids []int, byID map[int]*Player) map[string]int {
	var keep map[string]int
	for _, id := range ids {
		p := byID[id]
		k := personKey(p)
		if k == "" || !available(p) {
			continue
		}
		if keep == nil {
			keep = map[string]int{}
		}
		if cur, ok := keep[k]; !ok || betterVersion(p, byID[cur]) {
			keep[k] = p.ID
		}
	}
	return keep
}

// twoVersions: a line-up that names two versions of one person (SetLineup refuses it).
func twoVersions(ids []int, byID map[int]*Player) bool {
	seen := map[string]int{}
	for _, id := range ids {
		if k := personKey(byID[id]); k != "" {
			if prev, ok := seen[k]; ok && prev != id {
				return true
			}
			seen[k] = id
		}
	}
	return false
}

// ---------------------------------------------------------------- rule 1: the merge

// LegendMerge: a legend version and his contemporary merged at the user's club (the answer to the signing).
type LegendMerge struct {
	Legend    *Player `json:"legend"`   // the version who stays, after the merge
	Name      string  `json:"name"`     // his label, e.g. "Vini Juniór (Real Madrix '24)"
	Absorbed  string  `json:"absorbed"` // the modern player who merged into him
	OvrBefore int     `json:"ovrBefore"`
	OvrAfter  int     `json:"ovrAfter"`
	PotBefore int     `json:"potBefore"`
	PotAfter  int     `json:"potAfter"`
	Signed    string  `json:"signed"` // legend: the card was signed · modern: the modern player was
}

// mergeBonus: the extra limit break a strong contemporary brings.
func mergeBonus(modernOvr int) int {
	switch {
	case modernOvr >= 85:
		return 2
	case modernOvr >= 78:
		return 1
	}
	return 0
}

// legendLabel: "Name (version)".
func legendLabel(p *Player) string {
	if p.Version != "" {
		return p.Name + " (" + p.Version + ")"
	}
	return p.Name
}

// mergeVersions folds the modern player into the legend version (no database). legendIsNew: the card is the
// signing, so he takes the modern player's shirt number; otherwise the legend keeps his own.
func mergeVersions(legend, modern *Player, legendIsNew bool) LegendMerge {
	m := LegendMerge{Name: legendLabel(legend), Absorbed: modern.Name, OvrBefore: legend.Overall, PotBefore: legend.Potential, Signed: "modern"}
	if legendIsNew {
		m.Signed = "legend"
	}
	for _, a := range AttrNames {
		v := legend.Attr(a)
		*v = math.Min(IconMax, math.Max(*v, *modern.Attr(a))+1)
	}
	pot := min(IconMax, max(legend.Potential, modern.Potential)+2+mergeBonus(modern.Overall))
	legend.Fill()
	legend.Potential = min(IconMax, max(pot, legend.Overall)) // never below his own level (as with a homecoming)
	if legendIsNew && modern.Shirt > 0 {
		legend.Shirt = modern.Shirt
	}
	legend.Tenure = max(legend.Tenure, modern.Tenure) // the same man: his games for the club still count
	// the modern player leaves the game the clean way: archived like a retired player, his records kept
	modern.ClubID = nil
	modern.Retired = true
	modern.Unrest = 0
	m.Legend, m.OvrAfter, m.PotAfter = legend, legend.Overall, legend.Potential
	return m
}

// mergePartner: whom a newcomer to a club merges with there, as (legend, modern); nil when nobody. A legend
// card absorbs the modern player who is the same person; a modern player is absorbed by the version of him
// that would play (betterVersion). borrowed: players on loan at the club (not on its books).
func mergePartner(p *Player, squad []*Player, borrowed map[int]bool) (legend, modern *Player) {
	k := personKey(p)
	if k == "" || p.Retired || p.ClubID == nil || borrowed[p.ID] {
		return nil, nil
	}
	mates := func(x *Player) bool {
		return x.ID != p.ID && !x.Retired && x.ClubID != nil && *x.ClubID == *p.ClubID && !borrowed[x.ID] && personKey(x) == k
	}
	switch p.Tag {
	case "legend":
		for _, x := range squad {
			if x.Tag == "" && mates(x) && (modern == nil || x.Overall > modern.Overall) {
				modern = x
			}
		}
		if modern != nil {
			legend = p
		}
	case "":
		for _, x := range squad {
			if x.Tag == "legend" && mates(x) && (legend == nil || betterVersion(x, legend)) {
				legend = x
			}
		}
		if legend != nil {
			modern = p
		}
	}
	return legend, modern
}

// borrowedSet: the players the user has on loan from other clubs.
func borrowedSet(c *Career) map[int]bool {
	out := map[int]bool{}
	for _, d := range c.Events.LoansIn {
		out[d.PlayerID] = true
	}
	return out
}

// tidyAfterMerge: the career's and the club's records of the modern player go (contract, demands, care) or
// pass to the legend he became (his place in the saved XI, the armband).
func tidyAfterMerge(c *Career, club *Club, legend, modern *Player) {
	delete(c.Contracts.Players, modern.ID)
	delete(c.Contracts.Years, modern.ID)
	delete(c.Contracts.Signed, modern.ID)
	keep := c.Contracts.Demands[:0]
	for _, d := range c.Contracts.Demands {
		if d.Kind != "player" || d.ID != modern.ID {
			keep = append(keep, d)
		}
	}
	c.Contracts.Demands = keep
	delete(c.Care.Load, modern.ID)
	delete(c.Care.Rush, modern.ID)
	delete(c.Care.Bring, modern.ID)
	delete(c.Care.Breaks, modern.ID)
	delete(c.Care.BreakN, modern.ID)
	if slot, ok := c.Care.Locked[modern.ID]; ok {
		delete(c.Care.Locked, modern.ID)
		if _, mine := c.Care.Locked[legend.ID]; !mine {
			c.Care.Locked[legend.ID] = slot // the legend takes his place, lock and all
		}
	}
	if c.Events.Captain == modern.ID {
		c.Events.Captain = legend.ID
	}
	if club == nil {
		return
	}
	has := false
	for _, id := range club.Lineup {
		has = has || id == legend.ID
	}
	for i, id := range club.Lineup {
		if id == modern.ID {
			if has {
				club.Lineup[i] = -1 // filled when the team is picked
			} else {
				club.Lineup[i], has = legend.ID, true
			}
		}
	}
}

// handOver: in the club-life records (club_state.go) the modern player is still the legend he merged into: no
// departure for the fans to mourn, and his place on the Legends wall, if he has one, passes on.
func handOver(life *ClubLife, modern, legend *Player) {
	if life == nil {
		return
	}
	keep := life.Roster[:0]
	for _, e := range life.Roster {
		if e.ID != modern.ID {
			keep = append(keep, e)
		}
	}
	life.Roster = keep
	if life.Fans.Fav == modern.ID {
		life.Fans.Fav = legend.ID
	}
	if life.legendIdx(legend.ID) < 0 {
		for i := range life.Legends {
			if le := &life.Legends[i]; le.PlayerID == modern.ID && le.Reason == "active" {
				le.PlayerID = legend.ID
			}
		}
	}
}

// signingMerge: rule 1 for a signing that does not load the world (Buy, the icon pick, deals). p has just
// joined the user's club and is saved; the caller saves c and club afterwards.
func signingMerge(ctx context.Context, q DBTX, c *Career, club *Club, p *Player) (*LegendMerge, error) {
	if personKey(p) == "" || p.ClubID == nil || *p.ClubID != c.UserClubID || club == nil || club.ID != c.UserClubID {
		return nil, nil
	}
	squad, err := queryPlayers(ctx, q, `career_id=$1 AND club_id=$2 AND NOT retired`, c.ID, club.ID)
	if err != nil {
		return nil, err
	}
	for i, x := range squad {
		if x.ID == p.ID {
			squad[i] = p // the caller's copy
		}
	}
	applyCare(c, squad) // who is cleared to play (rule 3's choice of version)
	borrowed := borrowedSet(c)
	var out *LegendMerge
	var life *ClubLife
	for i := 0; i < 3; i++ { // (a card meets at most one modern player of himself; the loop is only a guard)
		legend, modern := mergePartner(p, squad, borrowed)
		if legend == nil {
			break
		}
		m := mergeVersions(legend, modern, legend == p)
		if err := savePlayers(ctx, q, []*Player{legend, modern}); err != nil {
			return nil, err
		}
		tidyAfterMerge(c, club, legend, modern)
		if life == nil {
			if life, err = loadClubLife(ctx, q, c.ID); err != nil {
				return nil, err
			}
		}
		handOver(life, modern, legend)
		(&world{career: c}).logHappening(ComEvent{Key: "legend_merged", Name: m.Name})
		if out == nil {
			out = &m
		} else {
			out.OvrAfter, out.PotAfter = m.OvrAfter, m.PotAfter
		}
	}
	if life != nil && life.Init { // (before the club's first matchday there is nothing to hand over)
		if err := saveClubLife(ctx, q, c.ID, life); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// arrivalMerge: rule 1 for the paths that run on the loaded world (a Deadline Day bargain, a player back from
// a loan). The club, the career and the club life are saved by the caller.
func (w *world) arrivalMerge(ctx context.Context, q DBTX, rep *DayReport, p *Player) (*LegendMerge, error) {
	c := w.career
	user := w.byID[c.UserClubID]
	if user == nil || personKey(p) == "" {
		return nil, nil
	}
	legend, modern := mergePartner(p, w.userSquad(), borrowedSet(c))
	if legend == nil {
		return nil, nil
	}
	m := mergeVersions(legend, modern, legend == p)
	keep := make([]*Player, 0, len(w.players[user.ID]))
	for _, x := range w.players[user.ID] {
		if x.ID != modern.ID {
			keep = append(keep, x)
		}
	}
	w.players[user.ID] = keep // he can't be picked for a match any more
	if err := savePlayers(ctx, q, []*Player{legend, modern}); err != nil {
		return nil, err
	}
	tidyAfterMerge(c, user, legend, modern)
	handOver(w.clubLife(ctx, q), modern, legend)
	w.happen(rep, "legend_merged", m.Name, 0)
	return &m, nil
}

// MergeHeldVersions: rule 1 for a club that already holds a legend version and his modern self (a save from
// before the rule): each such modern player merges into the version of him that plays, as if he had just
// arrived, and the legend takes the shirt number the fans know. `pitchside merge-versions <career id>`.
func (s *Store) MergeHeldVersions(ctx context.Context, careerID int) ([]LegendMerge, error) {
	var out []LegendMerge
	err := s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		club, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		squad, err := queryPlayers(ctx, q, `career_id=$1 AND club_id=$2 AND NOT retired`, c.ID, club.ID)
		if err != nil {
			return err
		}
		applyCare(c, squad) // who is cleared to play (rule 3's choice of version)
		borrowed := borrowedSet(c)
		life, err := loadClubLife(ctx, q, c.ID)
		if err != nil {
			return err
		}
		w := &world{career: c}
		for _, p := range squad {
			if p.Tag != "" || p.Retired || p.ClubID == nil {
				continue // modern players only: each one meets the version that plays
			}
			legend, modern := mergePartner(p, squad, borrowed)
			if legend == nil {
				continue
			}
			shirt := modern.Shirt
			m := mergeVersions(legend, modern, false)
			if shirt > 0 {
				legend.Shirt = shirt
			}
			if err := savePlayers(ctx, q, []*Player{legend, modern}); err != nil {
				return err
			}
			tidyAfterMerge(c, club, legend, modern)
			handOver(life, modern, legend)
			w.logHappening(ComEvent{Key: "legend_merged", Name: m.Name})
			out = append(out, m)
		}
		if len(out) == 0 {
			return nil
		}
		if err := saveClub(ctx, q, club); err != nil {
			return err
		}
		if life.Init {
			if err := saveClubLife(ctx, q, c.ID, life); err != nil {
				return err
			}
		}
		return saveCareer(ctx, q, c)
	})
	return out, err
}

// SignResult: the answer to a purchase on the free-agent market.
type SignResult struct {
	Player *Player      `json:"player"`
	Merged *LegendMerge `json:"merged,omitempty"`
}

// IconSigned: the icon who was signed (his fields at the top level, as before) and the merge, if any.
type IconSigned struct {
	*Player
	Merged *LegendMerge `json:"merged,omitempty"`
}

// ---------------------------------------------------------------- rule 4: limit breaks

// breaksFreely: a legend card breaks his limit at any level (custom designs follow the normal rule).
func breaksFreely(p *Player) bool { return p.Tag == "legend" }

// breakCheck: why a player cannot break his limit now ("" = he can).
func breakCheck(c *Career, p *Player) string { return breakWhy(c, p, false) }

// breakWhy: breakCheck, or for an extra break bought with TP and money (club.go) once the season's own is used.
func breakWhy(c *Career, p *Player, extra bool) string {
	switch {
	case p.Age > 30 && !isLegend(p):
		return "too_old"
	case p.Potential >= potentialCap(p):
		return "max_potential"
	case !extra && c.Care.Breaks[p.ID] == c.Season:
		return "break_done"
	case extra && c.Care.Breaks[p.ID] != c.Season:
		return "break_first"
	case !breaksFreely(p) && OverallAs(p, p.Position) < float64(p.Potential-BreakGap)-0.5:
		return "not_at_limit"
	}
	return ""
}

// ---------------------------------------------------------------- rule 7: a card is never below his modern self

// careerCurve: how far below his peak a player is at an age (the curve of buildLegendVersions).
func careerCurve(age, peak int) float64 {
	return -0.9*math.Max(0, float64(peak-age)) - 0.75*math.Max(0, float64(age-peak))
}

// cardFloor lifts a legend card to the modern player who is the same person, moved along the career curve from
// the modern player's age to the card's: every attribute and the potential are at least the modern value plus
// curve(card age) − curve(modern age), up to IconMax. Age, traits and style stay. Reports a change.
func cardFloor(card, modern *Player) bool {
	if card == nil || modern == nil || card.Tag != "legend" || modern.Tag != "" || modern.Retired {
		return false
	}
	k := personKey(card)
	peak, ok := legendPeaks()[k]
	if !ok || k != personKey(modern) {
		return false
	}
	delta := careerCurve(card.Age, peak) - careerCurve(modern.Age, peak)
	changed := false
	for _, a := range AttrNames {
		v := card.Attr(a)
		if f := math.Min(IconMax, *modern.Attr(a)+delta); f > *v {
			*v, changed = f, true
		}
	}
	if f := min(IconMax, int(math.Round(float64(modern.Potential)+delta))); f > card.Potential {
		card.Potential, changed = f, true
	}
	if changed {
		card.Fill()
		card.Potential = min(IconMax, max(card.Potential, card.Overall))
	}
	return changed
}

// legendModerns: the career's modern players (any club, not retired) who are also a legend card's person.
func legendModerns(ctx context.Context, q DBTX, careerID int) (map[string]*Player, error) {
	ps, err := queryPlayers(ctx, q, `career_id=$1 AND NOT retired AND tag='' AND name = ANY($2)`, careerID, modernNames())
	if err != nil {
		return nil, err
	}
	out := map[string]*Player{}
	for _, p := range ps {
		if k := personKey(p); k != "" && (out[k] == nil || p.Overall > out[k].Overall) {
			out[k] = p
		}
	}
	return out, nil
}

// modernNames: the names a modern player who is also a legend can have: the legends' own spellings and every
// star of the club data whose name is a legend's (the query in legendModerns looks only at these).
var modernNames = sync.OnceValue(func() []string {
	seen := map[string]bool{}
	var out []string
	add := func(n string) {
		if !seen[n] && legendPerson(n) != "" {
			seen[n] = true
			out = append(out, n)
		}
	}
	for _, lv := range LegendVersions {
		add(lv.Name)
	}
	for _, l := range Leagues {
		for _, def := range CountryClubDefs(l.Code) {
			for _, s := range def.Stars {
				add(s.Name)
			}
		}
	}
	return out
})

// unsignedCards: of these legend cards (players not at a club), the ones whose card has never been signed
// (a legend released after signing keeps his numbers).
func unsignedCards(ctx context.Context, q DBTX, careerID int, ps []*Player) ([]*Player, error) {
	var ids []int
	for _, p := range ps {
		if p != nil && p.Tag == "legend" && p.ClubID == nil && p.TemplateID != nil && personKey(p) != "" {
			ids = append(ids, *p.TemplateID)
		}
	}
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := q.Query(ctx, `SELECT id FROM templates WHERE career_id=$1 AND id = ANY($2) AND NOT signed`, careerID, ids)
	if err != nil {
		return nil, err
	}
	open := map[int]bool{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		open[id] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var out []*Player
	for _, p := range ps {
		if p != nil && p.Tag == "legend" && p.ClubID == nil && p.TemplateID != nil && open[*p.TemplateID] {
			out = append(out, p)
		}
	}
	return out, nil
}

// floorCards applies rule 7 to legend cards that are becoming players or are on show (free agents, a card
// about to be signed). Players at a club and cards signed before are left alone.
func floorCards(ctx context.Context, q DBTX, careerID int, ps ...*Player) error {
	cards, err := unsignedCards(ctx, q, careerID, ps)
	if err != nil || len(cards) == 0 {
		return err
	}
	mods, err := legendModerns(ctx, q, careerID)
	if err != nil {
		return err
	}
	for _, p := range cards {
		cardFloor(p, mods[personKey(p)])
	}
	return nil
}

// floorCard is floorCards for a card turning up on the market (refreshMarketNews). On a database error the
// card stays as it is: the transaction has failed, and the next statement reports it.
func floorCard(ctx context.Context, q DBTX, careerID int, p *Player) *Player {
	_ = floorCards(ctx, q, careerID, p)
	return p
}

// floorTemplates: rule 7 for the cards on show (the Legends catalogue, the icon pick's offers). Signed cards
// keep the numbers they were signed with.
func floorTemplates(ctx context.Context, q DBTX, careerID int, ts []*Template) error {
	var open []*Template
	for _, t := range ts {
		if t.Kind == "legend" && !t.Signed && legendPerson(t.Name) != "" {
			open = append(open, t)
		}
	}
	if len(open) == 0 {
		return nil
	}
	mods, err := legendModerns(ctx, q, careerID)
	if err != nil || len(mods) == 0 {
		return err
	}
	for _, t := range open {
		p := t.toPlayer()
		if !cardFloor(p, mods[personKey(p)]) {
			continue
		}
		t.Pace, t.Shooting, t.Passing, t.Dribbling, t.Defending, t.Physical, t.Goalkeeping = p.Pace, p.Shooting, p.Passing, p.Dribbling, p.Defending, p.Physical, p.Goalkeeping
		t.Potential, t.Overall, t.Value = p.Potential, p.Overall, p.Value
	}
	return nil
}
