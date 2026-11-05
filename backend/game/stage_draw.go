package game

import (
	"context"
	"errors"
	"math"
	"math/rand"
	"sort"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- cup draw ceremonies
//
// When a knockout round of the user's domestic cup or continental cup is drawn and the user's club
// is in it, the draw is noted in careers.stage (stageNoteDrawn, called from ensureDay in career.go
// where the pairs are drawn). The frontend shows a short draw animation that reveals the opponent.
// Rounds are drawn as soon as the round before them is complete (preDraw), so the draw comes a few
// matchdays before the tie, like a real cup. The first round, drawn with the fixtures, is noted
// after the season's first matchday.

// PendingDraw: a draw the user hasn't watched yet.
type PendingDraw struct {
	ID        int    `json:"id"` // season*100 + day of the tie
	Season    int    `json:"season"`
	Day       int    `json:"day"`
	Comp      string `json:"comp"` // cup | cl
	Stage     string `json:"stage"`
	League    string `json:"league"`
	FixtureID int    `json:"fixtureId"`
}

// stageNoteDrawn is called right after a knockout round's ties have been drawn for (season, day):
// when the user's club is in one of them, its reveal waits in careers.stage.
func stageNoteDrawn(ctx context.Context, q DBTX, careerID, season, day int) error {
	var d PendingDraw
	err := q.QueryRow(ctx, `SELECT f.id, f.comp, f.stage, f.league FROM fixtures f JOIN careers c ON c.id=f.career_id
		WHERE f.career_id=$1 AND f.season=$2 AND f.day=$3 AND f.comp IN ('cup','cl') AND NOT f.played
		AND (f.home_id=c.user_club_id OR f.away_id=c.user_club_id) LIMIT 1`, careerID, season, day).Scan(&d.FixtureID, &d.Comp, &d.Stage, &d.League)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	d.ID, d.Season, d.Day = season*100+day, season, day
	_, err = q.Exec(ctx, `UPDATE careers SET stage = jsonb_set(COALESCE(stage, '{}'::jsonb), '{draws}',
		CASE WHEN jsonb_typeof(stage->'draws') = 'array' THEN stage->'draws' ELSE '[]'::jsonb END || jsonb_build_array($2::jsonb)) WHERE id=$1`, careerID, d)
	return err
}

// preDraw draws the next knockout round of each cup as soon as the round before it is complete.
func (w *world) preDraw(ctx context.Context, q DBTX, r *rand.Rand) error {
	c := w.career
	if c.Day < 1 || c.Day > len(Calendar) {
		return nil
	}
	for _, comp := range []string{"cup", "cl"} {
		next, prev := 0, 0
		for d := c.Day; d <= len(Calendar); d++ {
			cd := Calendar[d-1]
			if cd.Comp == comp && cd.Stage != "G" && cd.Stage != "R1" {
				next = d
				break
			}
		}
		if next == 0 {
			continue
		}
		for d := next - 1; d >= 1; d-- {
			if Calendar[d-1].Comp == comp {
				prev = d
				break
			}
		}
		// the round before must be behind us (every tie of a matchday is played together)
		if prev == 0 || prev >= c.Day {
			continue
		}
		if err := ensureDay(ctx, q, r, c.ID, c.Season, next, w.clubs); err != nil {
			return err
		}
	}
	return nil
}

// noteFirstRound: the cup's first round is drawn with the season's fixtures; its reveal comes after
// the first matchday.
func (w *world) noteFirstRound(st *StageState) {
	c := w.career
	if st.R1Noted == c.Season || c.Day < 2 || c.Day > len(Calendar) {
		return
	}
	st.R1Noted = c.Season
	for _, f := range w.fixtures {
		if f.Comp == "cup" && f.Stage == "R1" && !f.Played && f.Day >= c.Day && (f.HomeID == c.UserClubID || f.AwayID == c.UserClubID) {
			id := c.Season*100 + f.Day
			for _, d := range st.Draws {
				if d.ID == id {
					return
				}
			}
			st.Draws = append(st.Draws, PendingDraw{ID: id, Season: c.Season, Day: f.Day, Comp: "cup", Stage: "R1", League: f.League, FixtureID: f.ID})
			return
		}
	}
}

// pruneDraws drops draws whose tie has been played (or that belong to another season) and duplicates.
func (w *world) pruneDraws(st *StageState) {
	c := w.career
	seen := map[int]bool{}
	keep := []PendingDraw{}
	for _, d := range st.Draws {
		if d.Season != c.Season || d.Day < c.Day || seen[d.ID] {
			continue
		}
		seen[d.ID] = true
		keep = append(keep, d)
	}
	st.Draws = keep
}

// DrawClub: a club in the draw.
type DrawClub struct {
	ID       int    `json:"id"`
	Name     string `json:"name"`
	Short    string `json:"short"`
	Color    string `json:"color"`
	Color2   string `json:"color2"`
	League   string `json:"league"`
	Division int    `json:"division"`
	Strength int    `json:"strength,omitempty"` // average of the strongest eleven (shown for the two sides)
	Mine     bool   `json:"mine,omitempty"`
}

type DrawTie struct {
	Home DrawClub `json:"home"`
	Away DrawClub `json:"away"`
}

// DrawView: everything the draw animation needs.
type DrawView struct {
	ID     int        `json:"id"`
	Season int        `json:"season"`
	Day    int        `json:"day"` // the matchday of the tie
	Comp   string     `json:"comp"`
	Stage  string     `json:"stage"`
	League string     `json:"league"`
	Home   bool       `json:"home"` // the user's club plays at home
	Me     DrawClub   `json:"me"`
	Opp    DrawClub   `json:"opp"`
	Pot    []DrawClub `json:"pot"`  // the crests in the hat (the opponent among them)
	Ties   []DrawTie  `json:"ties"` // the whole round, the user's tie first
}

func (s *Store) drawView(ctx context.Context, careerID int, d PendingDraw) (*DrawView, error) {
	fx, err := queryFixtures(ctx, s.DB, `career_id=$1 AND season=$2 AND day=$3 AND comp=$4`, careerID, d.Season, d.Day, d.Comp)
	if err != nil {
		return nil, err
	}
	var userClub int
	if err := s.DB.QueryRow(ctx, `SELECT COALESCE(user_club_id,0) FROM careers WHERE id=$1`, careerID).Scan(&userClub); err != nil {
		return nil, err
	}
	var mine *Fixture
	var round []*Fixture
	for _, f := range fx {
		if d.Comp == "cup" && f.League != d.League {
			continue
		}
		round = append(round, f)
		if f.HomeID == userClub || f.AwayID == userClub {
			mine = f
		}
	}
	if mine == nil || mine.Played {
		return nil, nil
	}
	ids := map[int]bool{}
	for _, f := range round {
		ids[f.HomeID], ids[f.AwayID] = true, true
	}
	var list []int
	for id := range ids {
		list = append(list, id)
	}
	clubs := map[int]*Club{}
	rows, err := s.DB.Query(ctx, `SELECT `+clubCols+` FROM clubs WHERE id = ANY($1)`, list)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		cl, err := scanClub(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		clubs[cl.ID] = cl
	}
	rows.Close()
	brief := func(id int) DrawClub {
		cl := clubs[id]
		if cl == nil {
			return DrawClub{ID: id}
		}
		return DrawClub{ID: id, Name: cl.Name, Short: cl.Short, Color: cl.Color, Color2: cl.Color2, League: cl.League, Division: cl.Division, Mine: cl.IsUser}
	}
	oppID := mine.AwayID
	if mine.AwayID == userClub {
		oppID = mine.HomeID
	}
	v := &DrawView{ID: d.ID, Season: d.Season, Day: d.Day, Comp: d.Comp, Stage: mine.Stage, League: mine.League,
		Home: mine.HomeID == userClub, Me: brief(userClub), Opp: brief(oppID)}
	// both sides' strength: the average of their strongest eleven
	ps, err := queryPlayers(ctx, s.DB, `career_id=$1 AND club_id = ANY($2) AND NOT retired`, careerID, []int{userClub, oppID})
	if err != nil {
		return nil, err
	}
	squads := map[int][]*Player{}
	for _, p := range ps {
		squads[*p.ClubID] = append(squads[*p.ClubID], p)
	}
	v.Me.Strength = squadStrength(squads[userClub], clubs[userClub])
	v.Opp.Strength = squadStrength(squads[oppID], clubs[oppID])
	v.Ties = append(v.Ties, DrawTie{Home: brief(mine.HomeID), Away: brief(mine.AwayID)})
	for _, f := range round {
		if f != mine {
			v.Ties = append(v.Ties, DrawTie{Home: brief(f.HomeID), Away: brief(f.AwayID)})
		}
	}
	// the hat: the opponent and up to 15 others (strongest first, so famous crests show)
	var pot []DrawClub
	for id := range ids {
		if id != userClub && id != oppID {
			pot = append(pot, brief(id))
		}
	}
	sort.Slice(pot, func(i, j int) bool {
		a, b := clubs[pot[i].ID], clubs[pot[j].ID]
		if a == nil || b == nil {
			return pot[i].ID < pot[j].ID
		}
		if a.Division != b.Division {
			return a.Division < b.Division
		}
		return a.Reputation > b.Reputation
	})
	if len(pot) > 15 {
		pot = pot[:15]
	}
	v.Pot = append(pot, v.Opp)
	rand.New(rand.NewSource(int64(d.ID))).Shuffle(len(v.Pot), func(i, j int) { v.Pot[i], v.Pot[j] = v.Pot[j], v.Pot[i] })
	return v, nil
}

// squadStrength: the average overall of a club's strongest available eleven.
func squadStrength(squad []*Player, cl *Club) int {
	if len(squad) == 0 || cl == nil {
		return 0
	}
	roles := Formations[cl.Formation]
	byID := map[int]*Player{}
	for _, p := range squad {
		byID[p.ID] = p
	}
	sum, n := 0.0, 0
	for i, id := range BestLineup(squad, cl.Formation) {
		if p := byID[id]; p != nil && i < len(roles) {
			sum += OverallAs(p, RoleCat(roles[i])) * fitFactor(p, roles[i])
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return int(math.Round(sum / float64(n)))
}
