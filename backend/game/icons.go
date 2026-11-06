package game

import (
	"context"
	"fmt"
	"log"
	"math"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- icon players (legends and custom players)

// IconMax: icons can be pushed past the usual 99, up to this, for attributes and potential.
const IconMax = 110

func attrCap(p *Player) float64 {
	if isLegend(p) {
		return IconMax
	}
	return 99
}

func potentialCap(p *Player) int {
	if isLegend(p) {
		return IconMax
	}
	return 99
}

// isHomeCard: the exact club version of a legend (e.g. "Mersey Red '05") playing for that club.
// The generic "Icon" card belongs to no club, so it never counts, even though signing it adds the
// buyer to his history.
func isHomeCard(p *Player, clubID int) bool {
	return (p.Tag == "legend" || p.Tag == "custom") && p.Version != "Icon" && p.Version != "" && len(p.History) > 0 && p.History[0] == clubID
}

// homecoming: the right club version of a legend arrives with +2–3 on every attribute.
func homecoming(r *rand.Rand, p *Player, clubID int) bool {
	if !isHomeCard(p, clubID) {
		return false
	}
	for _, a := range AttrNames {
		v := p.Attr(a)
		*v = math.Min(IconMax, *v+2+float64(r.Intn(2)))
	}
	p.Fill()
	p.Potential = min(IconMax, max(p.Potential+2, p.Overall))
	return true
}

// ---------------------------------------------------------------- the icon pick

// IconPick: at most once a season (half the seasons, none in the other half) the shop offers a choice
// of three icons, at a premium, for a few matchdays.
type IconPick struct {
	Season  int          `json:"season"`
	Day     int          `json:"day"` // matchday it opens; 0 = not this season
	Until   int          `json:"until"`
	Done    bool         `json:"done"`
	Options []IconOption `json:"options"`
}

type IconOption struct {
	TemplateID int    `json:"templateId"`
	Name       string `json:"name"`
	Position   string `json:"position"`
	Overall    int    `json:"overall"`
	Version    string `json:"version"`
	Price      int64  `json:"price"`
	Home       bool   `json:"home"` // from your club's history: +2–3 on every attribute
}

// IconPriceFactor: an icon costs 1.5× a normal player of the same level.
const IconPriceFactor = 1.5

// IconPickPremium: on top of that, the rare icon pick asks a little more.
const IconPickPremium = 1.2

// Open: the pick is on offer right now.
func (ip *IconPick) Open(c *Career) bool {
	return ip != nil && ip.Season == c.Season && !ip.Done && len(ip.Options) > 0 && c.Day >= ip.Day && c.Day <= ip.Until
}

// iconPickTick plans this season's pick and opens it on its day.
func (w *world) iconPickTick(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	c := w.career
	if c.IconPick == nil || c.IconPick.Season != c.Season {
		day := 0
		if r.Float64() < 0.5 {
			day = 6 + r.Intn(36)
		}
		c.IconPick = &IconPick{Season: c.Season, Day: day}
	}
	ip := c.IconPick
	if ip.Day == 0 || c.Day != ip.Day || ip.Done || len(ip.Options) > 0 {
		return nil
	}
	tps, err := listTemplates(ctx, q, c.ID, `AND NOT signed AND kind='legend'`)
	if err != nil {
		return err
	}
	if err := floorTemplates(ctx, q, c.ID, tps); err != nil { // legend_versions.go: never below his modern self
		return err
	}
	var home, top []*Template
	for _, t := range tps {
		if t.OnMarket {
			continue
		}
		if t.ClubID != nil && *t.ClubID == c.UserClubID {
			home = append(home, t)
		} else if t.Overall >= 85 {
			top = append(top, t)
		}
	}
	r.Shuffle(len(home), func(i, j int) { home[i], home[j] = home[j], home[i] })
	r.Shuffle(len(top), func(i, j int) { top[i], top[j] = top[j], top[i] })
	var pick []*Template
	if len(home) > 0 {
		pick = append(pick, home[0]) // one from your own history when there is one
	}
	for _, t := range top {
		if len(pick) >= 3 {
			break
		}
		pick = append(pick, t)
	}
	if len(pick) == 0 {
		ip.Done = true
		return nil
	}
	sort.Slice(pick, func(i, j int) bool { return pick[i].Overall > pick[j].Overall })
	for _, t := range pick {
		ip.Options = append(ip.Options, IconOption{TemplateID: t.ID, Name: t.Name, Position: t.Position, Overall: t.Overall,
			Version: t.Version, Price: int64(float64(t.Value)*IconPickPremium/100_000) * 100_000, Home: t.ClubID != nil && *t.ClubID == c.UserClubID})
	}
	ip.Until = c.Day + 5
	rep.IconPick = true
	return nil
}

// PickIcon signs one of the offered icons (templateID 0 passes on the offer).
func (s *Store) PickIcon(ctx context.Context, careerID, templateID int) (*IconSigned, error) {
	var out *IconSigned
	err := s.tx(ctx, func(q pgx.Tx) error {
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		if !c.IconPick.Open(c) {
			return userErr("no_icon_pick", "There is no icon on offer")
		}
		if templateID == 0 {
			c.IconPick.Done = true
			return saveCareer(ctx, q, c)
		}
		var opt *IconOption
		for i := range c.IconPick.Options {
			if c.IconPick.Options[i].TemplateID == templateID {
				opt = &c.IconPick.Options[i]
			}
		}
		if opt == nil {
			return userErr("not_on_market", "This player is not on offer")
		}
		club, err := getClub(ctx, q, c.UserClubID)
		if err != nil {
			return err
		}
		n, shirt, err := nextShirt(ctx, q, club.ID)
		if err != nil {
			return err
		}
		if n >= MaxSquad {
			return userErr("squad_full", "Your squad is full")
		}
		if club.Budget < opt.Price {
			return userErr("no_budget", "Not enough budget")
		}
		tps, err := listTemplates(ctx, q, careerID, `AND id=`+strconv.Itoa(templateID)+` AND NOT signed`)
		if err != nil {
			return err
		}
		if len(tps) == 0 {
			return userErr("not_on_market", "This player is not on offer")
		}
		p := tps[0].toPlayer()
		if err := floorCards(ctx, q, careerID, p); err != nil { // legend_versions.go: never below his modern self
			return err
		}
		moveTo(p, &club.ID, shirt)
		homecoming(newRand(), p, club.ID)
		if err := insertPlayer(ctx, q, careerID, p); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `UPDATE templates SET signed=true WHERE id=$1`, templateID); err != nil {
			return err
		}
		club.Budget -= opt.Price
		if err := addFinance(ctx, q, c, "transfer_in", -opt.Price, p.Name); err != nil {
			return err
		}
		c.IconPick.Done = true
		out = &IconSigned{Player: p}
		// legend_versions.go: he merges with his modern self if that player is at the club
		if out.Merged, err = signingMerge(ctx, q, c, club, p); err != nil {
			return err
		}
		if err := saveClub(ctx, q, club); err != nil {
			return err
		}
		return saveCareer(ctx, q, c)
	})
	return out, err
}

// ---------------------------------------------------------------- new legend data for old saves

// SyncLegendCards adds legend cards that were added to the game after a career was created.
// LiftYoungLegends: a legend version younger than his peak age has his peak as potential (he can grow into
// it). Saves from before that rule get it for their cards and for the versions already signed; nothing is
// lowered, so a ceiling raised since (a season at the club, a merge, a limit break) stays.
func (s *Store) LiftYoungLegends(ctx context.Context) error {
	var names, versions []string
	var pots []int32
	for _, lv := range LegendVersions {
		if lv.Club == "" || lv.Pot <= int(lv.Ovr) {
			continue // the Icon card, or not a young version
		}
		names, versions, pots = append(names, lv.Name), append(versions, lv.Club+" "+lv.Label), append(pots, int32(lv.Pot))
	}
	if len(names) == 0 {
		return nil
	}
	if _, err := s.DB.Exec(ctx, `UPDATE templates t SET potential = u.pot FROM unnest($1::text[], $2::text[], $3::int[]) AS u(name, version, pot)
		WHERE t.kind='legend' AND t.name=u.name AND t.version=u.version AND t.potential < u.pot`, names, versions, pots); err != nil {
		return err
	}
	_, err := s.DB.Exec(ctx, `UPDATE players p SET potential = u.pot FROM unnest($1::text[], $2::text[], $3::int[]) AS u(name, version, pot)
		WHERE p.tag='legend' AND p.name=u.name AND p.version=u.version AND p.potential < u.pot`, names, versions, pots)
	return err
}

func (s *Store) SyncLegendCards(ctx context.Context) error {
	rows, err := s.DB.Query(ctx, `SELECT id FROM careers`)
	if err != nil {
		return err
	}
	var ids []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		if err := s.tx(ctx, func(q pgx.Tx) error {
			have := map[string]bool{}
			rs, err := q.Query(ctx, `SELECT DISTINCT name FROM templates WHERE career_id=$1 AND kind='legend'`, id)
			if err != nil {
				return err
			}
			for rs.Next() {
				var n string
				if err := rs.Scan(&n); err != nil {
					rs.Close()
					return err
				}
				have[n] = true
			}
			rs.Close()
			var missing []LegendVersion
			for _, lv := range LegendVersions {
				if !have[lv.Name] {
					missing = append(missing, lv)
				}
			}
			if len(missing) == 0 {
				return nil
			}
			clubs, err := listClubs(ctx, q, id)
			if err != nil {
				return err
			}
			return insertLegendCards(ctx, q, newRand(), id, clubs, missing)
		}); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------- legend roles for old saves

// legendVersionIndex: the data's legend versions by (name, version label as stored: "Real Madrix '14", "Icon").
var legendVersionIndex = sync.OnceValue(func() map[[2]string]LegendVersion {
	m := map[[2]string]LegendVersion{}
	for _, lv := range LegendVersions {
		m[[2]string{lv.Name, lv.VersionLabel()}] = lv
	}
	return m
})

// legendMisbuilt: a stored legend card whose numbers read as another line than the role his real-life self
// played (fitsLine: a full-back built as a centre-back, a winger as a striker, or the other way round) — cards
// made before the data had roles. It returns the data's version of him to build the card again from.
func legendMisbuilt(t *Template) (LegendVersion, bool) {
	lv, ok := legendVersionIndex()[[2]string{t.Name, t.Version}]
	if !ok || t.Kind != "legend" || !linedRole(lv.Role) || !roleInPosition(lv.Role, t.Position) {
		return lv, false
	}
	return lv, !fitsLine(t.toPlayer(), lv.Role)
}

// FixLegendRoles: a legend card plays the role his real-life self played (the data's position/role, legendRole)
// and is built for it (legendStar). Saves from before the data had roles hold cards built for another line, so
// every unsigned card (a template not signed yet) that legendMisbuilt finds is built again for his role, his
// listing too if he is on the market now; his potential is never lowered. Signed cards keep every number (they
// may carry upgrades) and only their role label follows the data: the log counts the ones in squads whose label
// changed, per name, when a career is fixed. Idempotent: a card built again fits his line, so a second run finds
// nothing.
func (s *Store) FixLegendRoles(ctx context.Context) error {
	rows, err := s.DB.Query(ctx, `SELECT career_id, id, kind, name, version, position, pace, shooting, passing, dribbling,
		defending, physical, goalkeeping, potential FROM templates WHERE kind='legend' AND NOT signed ORDER BY career_id, id`)
	if err != nil {
		return err
	}
	todo := map[int][]*Template{}
	var careers []int
	for rows.Next() {
		var cid int
		t := &Template{}
		if err := rows.Scan(&cid, &t.ID, &t.Kind, &t.Name, &t.Version, &t.Position, &t.Pace, &t.Shooting, &t.Passing,
			&t.Dribbling, &t.Defending, &t.Physical, &t.Goalkeeping, &t.Potential); err != nil {
			rows.Close()
			return err
		}
		if _, bad := legendMisbuilt(t); bad {
			if todo[cid] == nil {
				careers = append(careers, cid)
			}
			todo[cid] = append(todo[cid], t)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(careers) == 0 {
		return err
	}
	r := newRand()
	for _, cid := range careers {
		if err := s.tx(ctx, func(q pgx.Tx) error {
			listed := 0
			for _, t := range todo[cid] {
				lv, _ := legendMisbuilt(t)
				p := legendStar(r, lv, max(t.Potential, lv.Pot))
				args := []any{t.ID, p.Pace, p.Shooting, p.Passing, p.Dribbling, p.Defending, p.Physical, p.Goalkeeping, p.Potential}
				if _, err := q.Exec(ctx, `UPDATE templates SET pace=$2, shooting=$3, passing=$4, dribbling=$5, defending=$6,
					physical=$7, goalkeeping=$8, potential=$9 WHERE id=$1`, args...); err != nil {
					return err
				}
				// on the market now: the listing shows (and sells) the new numbers; the floor of rule 7
				// (legend_versions.go) is applied again wherever the card is shown or signed
				tag, err := q.Exec(ctx, `UPDATE players SET pace=$2, shooting=$3, passing=$4, dribbling=$5, defending=$6,
					physical=$7, goalkeeping=$8, potential=$9 WHERE template_id=$1 AND club_id IS NULL AND NOT retired`, args...)
				if err != nil {
					return err
				}
				listed += int(tag.RowsAffected())
			}
			signed, err := signedRoleChanges(ctx, q, cid)
			if err != nil {
				return err
			}
			var user string
			_ = q.QueryRow(ctx, `SELECT COALESCE((SELECT username FROM users u WHERE u.id=c.user_id), '') FROM careers c WHERE c.id=$1`, cid).Scan(&user)
			log.Printf("legend roles: career %d (%s): %d unsigned card(s) rebuilt for their role (%d on the market); "+
				"signed cards in squads keep their numbers, their role now from the data: %s", cid, user, len(todo[cid]), listed, signed)
			return nil
		}); err != nil {
			return err
		}
	}
	return nil
}

// signedRoleChanges: roleChanges of the career's legend cards in a squad.
func signedRoleChanges(ctx context.Context, q DBTX, careerID int) (string, error) {
	ps, err := queryPlayers(ctx, q, `career_id=$1 AND tag='legend' AND club_id IS NOT NULL AND NOT retired`, careerID)
	if err != nil {
		return "", err
	}
	return roleChanges(ps), nil
}

// roleChanges: the legend cards whose role label the data changed (their old label is what their attributes
// and id gave, attrRole), per name: "Trent Alexander-Arnald ×1 (CB→RB), …", or "none".
func roleChanges(ps []*Player) string {
	count := map[string]int{}
	moves := map[string]map[string]bool{}
	for _, p := range ps {
		now := legendRole(p)
		if was := attrRole(p); now != "" && was != now {
			if moves[p.Name] == nil {
				moves[p.Name] = map[string]bool{}
			}
			count[p.Name]++
			moves[p.Name][was+"→"+now] = true
		}
	}
	if len(count) == 0 {
		return "none"
	}
	names := make([]string, 0, len(count))
	for n := range count {
		names = append(names, n)
	}
	sort.Strings(names)
	parts := make([]string, 0, len(names))
	for _, n := range names {
		ms := make([]string, 0, len(moves[n]))
		for m := range moves[n] {
			ms = append(ms, m)
		}
		sort.Strings(ms)
		parts = append(parts, fmt.Sprintf("%s ×%d (%s)", n, count[n], strings.Join(ms, ", ")))
	}
	return strings.Join(parts, ", ")
}

// Legends the data once listed under made-up names (a club's name glued on, two people fused into one).
// legendRenames: the same person under his own parody name now; his cards keep every number. (Thiago Silvá
// could also be a generated regen's name, Thiago Silva, who then counted as the legend's modern self.)
var legendRenames = map[string]string{
	"Thiago Silvá":         "Thiago Silvaa",
	"Xabi Prieto-Real":     "Xabi Prietto",
	"Moussa Dembelé-Spurs": "Mousa Dembelé",
	"Eden Dzeko-Viola":     "Edin Džekko",
}

// legendGone: made-up people replaced by real players (a second Bale by David Ginolá, a second Rodri by
// Fernandinho Rozza, a made-up Fiorentina stopper by Rui Costta, a fusion of Agüerro and Torress by Diego Costta).
var legendGone = []string{"Gareth Bailey-Spurs", "Sergio Busquette-Rodri", "Alessandro Del Fiorenzo", "Kun Torres-Atleti"}

// RenameLegends brings saves in line with those names; it runs before SyncLegendCards, which then adds the real
// players who replaced the made-up ones. A renamed person's cards, and the players made from them, take his new
// name. A made-up person's cards that were never signed leave the catalogue, with any market listing of them; a
// card on offer in an icon pick still open stays until the pick is over (a later start removes it), and a signed
// card stays as it is. Idempotent.
func (s *Store) RenameLegends(ctx context.Context) error {
	return s.tx(ctx, func(q pgx.Tx) error {
		for old, name := range legendRenames {
			cards, err := q.Exec(ctx, `UPDATE templates SET name=$2 WHERE kind='legend' AND name=$1`, old, name)
			if err != nil {
				return err
			}
			players, err := q.Exec(ctx, `UPDATE players SET name=$2 WHERE tag='legend' AND name=$1`, old, name)
			if err != nil {
				return err
			}
			if cards.RowsAffected()+players.RowsAffected() > 0 {
				log.Printf("legend names: %s is now %s (%d card(s), %d player(s))", old, name, cards.RowsAffected(), players.RowsAffected())
			}
		}
		listed, err := q.Exec(ctx, `DELETE FROM players p USING templates t WHERE p.template_id=t.id AND t.kind='legend'
			AND t.name = ANY($1) AND NOT t.signed AND p.club_id IS NULL AND NOT p.retired`, legendGone)
		if err != nil {
			return err
		}
		cards, err := q.Exec(ctx, `DELETE FROM templates t WHERE t.kind='legend' AND t.name = ANY($1) AND NOT t.signed
			AND NOT EXISTS (SELECT 1 FROM players p WHERE p.template_id=t.id)
			AND NOT EXISTS (SELECT 1 FROM careers c WHERE jsonb_path_exists(c.icon_pick, '$.options[*] ? (@.templateId == $id)',
				jsonb_build_object('id', t.id)) AND NOT COALESCE((c.icon_pick->>'done')::boolean, false)
				AND (c.icon_pick->>'season')::int = c.season AND c.day <= (c.icon_pick->>'until')::int)`, legendGone)
		if err != nil {
			return err
		}
		if cards.RowsAffected()+listed.RowsAffected() > 0 {
			log.Printf("legend names: %d card(s) of made-up legends left the catalogue (%d market listing(s))",
				cards.RowsAffected(), listed.RowsAffected())
		}
		return nil
	})
}
