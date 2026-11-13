package game

import (
	"context"
	"strconv"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- celebrations
//
// When the user's club wins something (a cup final, the continental final, the league, promotion,
// a double/treble/invincible/perfect season or a platinum achievement) a congratulations pop-up waits in
// ExploreState.Celebrate until the user acknowledges it. Titles also go into ExploreState.Trophies,
// with the story of the day, for the trophy room.

type Celebration struct {
	ID        int      `json:"id"`
	Kind      string   `json:"kind"` // cup | cl | league | promotion | feat | ach
	Key       string   `json:"key"`  // feat: double | treble | invincible | perfect · ach: achievement key
	Season    int      `json:"season"`
	Day       int      `json:"day"`
	Club      string   `json:"club"`
	Short     string   `json:"short"`
	Color     string   `json:"color"`
	Color2    string   `json:"color2"`
	League    string   `json:"league"`   // country code of the competition
	Division  int      `json:"division"` // league: the division won · promotion: the division reached
	CompName  string   `json:"compName"` // league: e.g. "Premier Division"
	FixtureID int      `json:"fixtureId,omitempty"`
	Opp       string   `json:"opp,omitempty"`
	Score     string   `json:"score,omitempty"` // your goals first
	Pens      bool     `json:"pens,omitempty"`
	Scorers   []string `json:"scorers,omitempty"`
	Points    int      `json:"points,omitempty"`
	Promoted  bool     `json:"promoted,omitempty"`
	Wins      int      `json:"wins,omitempty"`    // perfect: the league games won (all of them)
	AllWins   int      `json:"allWins,omitempty"` // perfect: every competitive game was won too, this many
}

// MaxPendingCelebrations keeps a long absence from piling up pop-ups.
const MaxPendingCelebrations = 6

// platinum achievements that already come with their own celebration
var celebratedElsewhere = map[string]bool{"top_title": true, "euro_win": true, "double": true, "treble": true, "invincible": true, "perfect": true}

func isTrophyKind(k string) bool { return k == "cup" || k == "cl" || k == "league" || k == "promotion" }

// celebrate queues a pop-up (and files a title in the trophy room).
func (w *world) celebrate(cb Celebration) {
	c := w.career
	x := &c.Explore
	user := w.byID[c.UserClubID]
	x.CelebID++
	cb.ID = x.CelebID
	if cb.Season == 0 {
		cb.Season = c.Season
	}
	if cb.Day == 0 {
		cb.Day = min(c.Day, len(Calendar))
	}
	if cb.Club == "" && user != nil {
		cb.Club, cb.Short, cb.Color, cb.Color2 = user.Name, user.Short, user.Color, user.Color2
		if cb.League == "" {
			cb.League = user.League
		}
	}
	if isTrophyKind(cb.Kind) {
		x.Trophies = append(x.Trophies, cb)
		if st := w.currentStint(); st != nil {
			st.Trophies++
		}
	}
	x.Celebrate = append(x.Celebrate, cb)
	if len(x.Celebrate) > MaxPendingCelebrations {
		x.Celebrate = x.Celebrate[len(x.Celebrate)-MaxPendingCelebrations:]
	}
}

// celebrateFinals: the user's club won a cup final today.
func (w *world) celebrateFinals(rep *DayReport) {
	if rep == nil {
		return
	}
	c := w.career
	x := &c.Explore
	uid := c.UserClubID
	done := map[int]bool{}
	for _, t := range x.Trophies {
		if t.FixtureID != 0 {
			done[t.FixtureID] = true
		}
	}
	for _, f := range w.fixtures {
		if (f.Comp != "cup" && f.Comp != "cl") || f.Stage != "F" || !f.Played || f.Season != c.Season || f.Day != rep.Day ||
			(f.HomeID != uid && f.AwayID != uid) || f.WinnerID() != uid || done[f.ID] || f.HomeGoals == nil || f.AwayGoals == nil {
			continue
		}
		gf, ga := *f.HomeGoals, *f.AwayGoals
		oppID := f.AwayID
		if f.AwayID == uid {
			gf, ga, oppID = ga, gf, f.HomeID
		}
		cb := Celebration{Kind: f.Comp, FixtureID: f.ID, Score: strconv.Itoa(gf) + "-" + strconv.Itoa(ga), Pens: f.PensHome != nil, Day: f.Day}
		if f.Comp == "cup" {
			cb.League = f.League
		}
		if o := w.byID[oppID]; o != nil {
			cb.Opp = o.Name
		}
		// the scorers of the final (from today's report)
		if rep.Fixture != nil && rep.Fixture.ID == f.ID {
			n := map[string]int{}
			var order []string
			for _, e := range rep.Events {
				if e.ClubID == uid {
					if n[e.Name] == 0 {
						order = append(order, e.Name)
					}
					n[e.Name]++
				}
			}
			for _, name := range order {
				if n[name] > 1 {
					name += " ×" + strconv.Itoa(n[name])
				}
				cb.Scorers = append(cb.Scorers, name)
			}
		}
		w.celebrate(cb)
	}
}

// seasonRec: the user's season: league games played, won and lost, and every competitive game (league,
// cup, continental) played and won. A shoot-out is no win: the game itself was drawn.
type seasonRec struct{ played, won, lost, allPlayed, allWon int }

// unbeaten: a whole league season (30 games or more) without a defeat.
func (r seasonRec) unbeaten() bool { return r.played >= 30 && r.lost == 0 }

// perfect: a whole league season (30 games or more) won game by game.
func (r seasonRec) perfect() bool { return r.played >= 30 && r.won == r.played }

func (w *world) seasonRecord() (r seasonRec) {
	uid := w.career.UserClubID
	for _, f := range w.fixtures {
		if f.Comp == "friendly" || !f.Played || (f.HomeID != uid && f.AwayID != uid) || f.HomeGoals == nil || f.AwayGoals == nil {
			continue
		}
		gf, ga := *f.HomeGoals, *f.AwayGoals
		if f.AwayID == uid {
			gf, ga = ga, gf
		}
		r.allPlayed++
		if gf > ga {
			r.allWon++
		}
		if f.Comp == "league" {
			r.played++
			if gf > ga {
				r.won++
			} else if gf < ga {
				r.lost++
			}
		}
	}
	return
}

// celebrateSeason: league titles, promotion and the great seasons.
func (w *world) celebrateSeason(se *SeasonEnd) {
	user := w.byID[w.career.UserClubID]
	pts := 0
	for _, row := range divisionTable(w.clubs, w.fixtures, user.League, se.Division) {
		if row.ClubID == user.ID {
			pts = row.Pts
		}
	}
	champion := se.Position == 1
	switch {
	case champion:
		w.celebrate(Celebration{Kind: "league", Division: se.Division, CompName: divisionName(user.League, se.Division), Points: pts, Promoted: se.Move == "up"})
	case se.Move == "up":
		w.celebrate(Celebration{Kind: "promotion", Division: max(1, se.Division-1), CompName: divisionName(user.League, max(1, se.Division-1)), Points: pts})
	}
	if champion && se.Cup == "W" {
		if se.Division == 1 && se.CL == "W" {
			w.celebrate(Celebration{Kind: "feat", Key: "treble"})
		} else {
			w.celebrate(Celebration{Kind: "feat", Key: "double"})
		}
	}
	// a perfect season (every league game won) has its own pop-up instead of the unbeaten one
	switch rec := w.seasonRecord(); {
	case rec.perfect():
		cb := Celebration{Kind: "feat", Key: "perfect", Points: pts, Wins: rec.won}
		if rec.allWon == rec.allPlayed && rec.allPlayed > rec.played {
			cb.AllWins = rec.allWon // and every cup and continental game too
		}
		w.celebrate(cb)
	case rec.unbeaten():
		w.celebrate(Celebration{Kind: "feat", Key: "invincible", Points: pts})
	}
}

// AckCelebration dismisses one pop-up (id 0: all of them).
func (s *Store) AckCelebration(ctx context.Context, careerID, id int) error {
	return s.tx(ctx, func(q pgx.Tx) error {
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		c, err := getCareer(ctx, q, careerID)
		if err != nil {
			return err
		}
		x := &c.Explore
		keep := []Celebration{}
		for _, cb := range x.Celebrate {
			if id != 0 && cb.ID != id {
				keep = append(keep, cb)
			}
		}
		x.Celebrate = keep
		_, err = q.Exec(ctx, `UPDATE careers SET explore=$2 WHERE id=$1`, careerID, c.Explore)
		return err
	})
}
