package game

import (
	"strings"
	"sync"
)

// Modern stars' roles. A star's Pos in the data (data.go) carries the role his real-life self plays today, as the
// legend data does: "FW/RW" is a forward on the right wing, "DF/LB" a left-back, "MF/DM" a holding midfielder; a
// keeper is just "GK". The role is a label, not a build: his attributes still come from his position and style
// (so an old save's stars keep every number), and the role is where he shows and where a team picks him
// (NaturalRole), whatever his numbers and his id (which picks the side for anyone else). Mbapé leads the line
// however quick he is; Salha plays on the right, Vini on the left.

// posRole splits a star's Pos into his position group and his role ("" when the data gives none).
func (d StarDef) posRole() (pos, role string) {
	pos, role, _ = strings.Cut(d.Pos, "/")
	return pos, role
}

// starRoles: each modern star's name → the role the data gives him.
var starRoles = sync.OnceValue(func() map[string]string {
	m := map[string]string{}
	for _, l := range Leagues {
		for _, def := range CountryClubDefs(l.Code) {
			for _, s := range def.Stars {
				if pos, role := s.posRole(); roleInPosition(role, pos) {
					m[s.Name] = role
				}
			}
		}
	}
	return m
})

// starRole: where a modern star plays, from the data. "" for everyone else, for legend cards and custom designs
// (a legend card has his own role, legendRole), and for a star no longer in the data's position group.
func starRole(p *Player) string {
	if p.Tag == "legend" || p.Tag == "custom" {
		return ""
	}
	if r := starRoles()[p.Name]; roleInPosition(r, p.Position) {
		return r
	}
	return ""
}
