package game

import (
	"context"
	"encoding/json"
	"errors"
	"math/rand"
	"sort"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- the world stage
//
// Owned by the "stage" work stream: the big moments around the user's club.
//
//   stage.go          state (careers.stage), the matchday tick, pending pop-ups and their acknowledgement
//   stage_awards.go   Golden Ball night: the world's awards at the end of every season
//   stage_intl.go     the summer international tournament (every second summer)
//   stage_draw.go     cup draw ceremonies: a pending draw is noted where the pairs are drawn
//   stage_stories.go  storylines for the hub ticker and the news feed (news kind "story")
//
// The state column is read and written only by this stream (never by saveCareer), so it is loaded
// and saved on its own. History (award nights, tournaments) lives in stage_history.

// StageState is stored on the career (careers.stage, JSONB).
type StageState struct {
	Ceremony     int            `json:"ceremony"`     // season whose Golden Ball night waits to be shown (0 = none)
	Tournament   int            `json:"tournament"`   // season (just ended) whose tournament pop-up waits (0 = none)
	Draws        []PendingDraw  `json:"draws"`        // cup draws waiting for their reveal, oldest first
	Expect       map[int]int    `json:"expect"`       // pre-season expected league position per club
	ExpectSeason int            `json:"expectSeason"` // the season those expectations belong to
	Cool         map[string]int `json:"cool"`         // storyline key → when it was last told (season*100 + day)
	RecordFee    int64          `json:"recordFee"`    // the biggest transfer fee seen in this world
	R1Noted      int            `json:"r1Noted"`      // season whose first-round cup draw was noted
	CaughtUp     int            `json:"caughtUp"`     // season whose missing awards night was made up for (stageCatchUp)
	NewsSeen     int64          `json:"newsSeen"`     // the last transfer news checked for record fees (-1: none yet)
}

func (s *StageState) ensure() {
	if s.Expect == nil {
		s.Expect = map[int]int{}
	}
	if s.Cool == nil {
		s.Cool = map[string]int{}
	}
	if s.Draws == nil {
		s.Draws = []PendingDraw{} // stored as [] (stageNoteDrawn appends to it in SQL)
	}
}

func loadStage(ctx context.Context, q DBTX, careerID int) (*StageState, error) {
	st := &StageState{}
	if err := q.QueryRow(ctx, `SELECT stage FROM careers WHERE id=$1`, careerID).Scan(st); err != nil {
		return nil, notFound(err)
	}
	st.ensure()
	return st, nil
}

func saveStage(ctx context.Context, q DBTX, careerID int, st *StageState) error {
	st.ensure()
	_, err := q.Exec(ctx, `UPDATE careers SET stage=$2 WHERE id=$1`, careerID, st)
	return err
}

// saveHistory stores one award night or tournament (one row per season and kind).
func saveHistory(ctx context.Context, q DBTX, careerID, season int, kind string, data any) error {
	_, err := q.Exec(ctx, `INSERT INTO stage_history (career_id, season, kind, data) VALUES ($1,$2,$3,$4)
		ON CONFLICT (career_id, season, kind) DO UPDATE SET data=EXCLUDED.data`, careerID, season, kind, data)
	return err
}

// loadHistory reads one history row into out; found is false when there is none.
func loadHistory(ctx context.Context, q DBTX, careerID, season int, kind string, out any) (bool, error) {
	err := q.QueryRow(ctx, `SELECT data FROM stage_history WHERE career_id=$1 AND season=$2 AND kind=$3`, careerID, season, kind).Scan(out)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// stageTick runs once per matchday, at the end of worldTick (world_ai.go).
func (w *world) stageTick(ctx context.Context, q DBTX, r *rand.Rand, rep *DayReport) error {
	c := w.career
	// knockout rounds are drawn as soon as the round before is complete; that writes the pending
	// draw straight into careers.stage, so it comes before the state is loaded
	if err := w.preDraw(ctx, q, r); err != nil {
		return err
	}
	st, err := loadStage(ctx, q, c.ID)
	if err != nil {
		return err
	}
	if st.ExpectSeason != c.Season || len(st.Expect) == 0 {
		st.Expect = w.expectations()
		st.ExpectSeason = c.Season
	}
	w.noteFirstRound(st)
	w.pruneDraws(st)
	if err := w.storylines(ctx, q, st, rep); err != nil {
		return err
	}
	// the awards night comes last, so its headline tops the feed once the ceremony has been shown
	if rep != nil && rep.SeasonEnd != nil {
		if err := w.goldenBall(ctx, q, r, st, rep); err != nil {
			return err
		}
	}
	return saveStage(ctx, q, c.ID, st)
}

// expectations: where every competition club is expected to finish, by reputation (the board's
// view before a ball is kicked; reputations only move at the end of a season).
func (w *world) expectations() map[int]int {
	out := map[int]int{}
	for _, l := range Leagues {
		for d := 1; d <= Divisions; d++ {
			var cs []*Club
			for _, cl := range w.clubs {
				if cl.League == l.Code && cl.Division == d {
					cs = append(cs, cl)
				}
			}
			sort.SliceStable(cs, func(i, j int) bool {
				if cs[i].Reputation != cs[j].Reputation {
					return cs[i].Reputation > cs[j].Reputation
				}
				return cs[i].ID < cs[j].ID
			})
			for i, cl := range cs {
				out[cl.ID] = i + 1
			}
		}
	}
	return out
}

// ---------------------------------------------------------------- pending pop-ups

// StagePending: what the stage pop-up host (frontend StageHost) should show next.
type StagePending struct {
	Ceremony   *AwardNight `json:"ceremony"`
	Tournament *Tournament `json:"tournament"`
	Draw       *DrawView   `json:"draw"`
}

func (s *Store) StagePending(ctx context.Context, careerID int) (*StagePending, error) {
	out := &StagePending{}
	if err := s.stageCatchUp(ctx, careerID); err != nil {
		return nil, err
	}
	st, err := loadStage(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	if st.Ceremony > 0 {
		n := &AwardNight{}
		if ok, err := loadHistory(ctx, s.DB, careerID, st.Ceremony, "awards", n); err != nil {
			return nil, err
		} else if ok {
			out.Ceremony = n
		}
	}
	if st.Tournament > 0 {
		t := &Tournament{}
		if ok, err := loadHistory(ctx, s.DB, careerID, st.Tournament, "intl", t); err != nil {
			return nil, err
		} else if ok {
			out.Tournament = t
		}
	}
	for _, d := range st.Draws {
		v, err := s.drawView(ctx, careerID, d)
		if err != nil {
			return nil, err
		}
		if v != nil {
			out.Draw = v
			break
		}
	}
	return out, nil
}

// stageCatchUp: a season that ended before the stage existed (an older save in its off-season) still
// gets its awards night, once.
func (s *Store) stageCatchUp(ctx context.Context, careerID int) error {
	var season, day int
	var ended string
	if err := s.DB.QueryRow(ctx, `SELECT season, day, ended FROM careers WHERE id=$1`, careerID).Scan(&season, &day, &ended); err != nil {
		return notFound(err)
	}
	if day <= len(Calendar) || ended != "" {
		return nil
	}
	var done bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM stage_history WHERE career_id=$1 AND season=$2 AND kind='awards')
		OR COALESCE((SELECT (stage->>'caughtUp')::int FROM careers WHERE id=$1), 0) >= $2`, careerID, season).Scan(&done); err != nil || done {
		return err
	}
	return s.tx(ctx, func(q pgx.Tx) error {
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		st, err := loadStage(ctx, q, careerID)
		if err != nil || st.CaughtUp >= season {
			return err
		}
		var has bool
		if err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM stage_history WHERE career_id=$1 AND season=$2 AND kind='awards')`, careerID, season).Scan(&has); err != nil {
			return err
		}
		st.CaughtUp = season
		if !has {
			r := newRand()
			w, err := loadWorld(ctx, q, r, careerID)
			if err != nil {
				return err
			}
			if err := w.goldenBall(ctx, q, r, st, nil); err != nil {
				return err
			}
			if user := w.byID[w.career.UserClubID]; user != nil {
				if err := saveClub(ctx, q, user); err != nil {
					return err
				}
			}
		}
		return saveStage(ctx, q, careerID, st)
	})
}

// StageAck marks a pop-up as seen: kind ceremony | tournament | draw (id: season, or the draw id).
func (s *Store) StageAck(ctx context.Context, careerID int, kind string, id int) error {
	return s.tx(ctx, func(q pgx.Tx) error {
		// queue behind a matchday being played (it holds the same row lock)
		if _, err := q.Exec(ctx, `SELECT 1 FROM careers WHERE id=$1 FOR UPDATE`, careerID); err != nil {
			return err
		}
		st, err := loadStage(ctx, q, careerID)
		if err != nil {
			return err
		}
		switch kind {
		case "ceremony":
			if id == 0 || st.Ceremony == id {
				st.Ceremony = 0
			}
		case "tournament":
			if id == 0 || st.Tournament == id {
				st.Tournament = 0
			}
		case "draw":
			keep := []PendingDraw{}
			for _, d := range st.Draws {
				if d.ID != id {
					keep = append(keep, d)
				}
			}
			st.Draws = keep
		default:
			return userErr("bad_request", "Unknown pop-up")
		}
		return saveStage(ctx, q, careerID, st)
	})
}

// ---------------------------------------------------------------- history views

// AwardsView: every Golden Ball night of the career, newest first, plus what comes next.
type AwardsView struct {
	Nights []*AwardNight `json:"nights"`
	Next   IntlNext      `json:"next"`
	Cups   []IntlBrief   `json:"cups"` // past international tournaments, newest first
}

// IntlNext: the next international tournament (shown on the stage pages).
type IntlNext struct {
	Kind   string `json:"kind"`   // world | euro
	Season int    `json:"season"` // played in the summer after this season
}

type IntlBrief struct {
	Season   int    `json:"season"`
	Kind     string `json:"kind"`
	Edition  int    `json:"edition"`
	Champion string `json:"champion"`
	RunnerUp string `json:"runnerUp"`
	Score    string `json:"score"`
	Scorer   string `json:"scorer"`
	Goals    int    `json:"goals"`
	Mine     int    `json:"mine"` // the user's players who went
}

func nextIntl(season int) IntlNext {
	for s := season; s < season+4; s++ {
		if k := intlKind(s); k != "" {
			return IntlNext{Kind: k, Season: s}
		}
	}
	return IntlNext{}
}

func (s *Store) StageAwards(ctx context.Context, careerID int) (*AwardsView, error) {
	c, err := getCareer(ctx, s.DB, careerID)
	if err != nil {
		return nil, err
	}
	v := &AwardsView{Nights: []*AwardNight{}, Cups: []IntlBrief{}, Next: nextIntl(c.Season)}
	if c.Day > len(Calendar) && intlKind(c.Season) != "" {
		v.Next = IntlNext{Kind: intlKind(c.Season), Season: c.Season}
	}
	rows, err := s.DB.Query(ctx, `SELECT kind, data FROM stage_history WHERE career_id=$1 ORDER BY season DESC`, careerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var kind string
		var raw []byte
		if err := rows.Scan(&kind, &raw); err != nil {
			return nil, err
		}
		switch kind {
		case "awards":
			n := &AwardNight{}
			if err := json.Unmarshal(raw, n); err == nil {
				v.Nights = append(v.Nights, n)
			}
		case "intl":
			t := &Tournament{}
			if err := json.Unmarshal(raw, t); err == nil {
				v.Cups = append(v.Cups, t.brief())
			}
		}
	}
	return v, rows.Err()
}

func (s *Store) StageAwardNight(ctx context.Context, careerID, season int) (*AwardNight, error) {
	n := &AwardNight{}
	ok, err := loadHistory(ctx, s.DB, careerID, season, "awards", n)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	return n, nil
}

// StageTournament: one tournament (season 0 = the latest one).
func (s *Store) StageTournament(ctx context.Context, careerID, season int) (*Tournament, error) {
	if season <= 0 {
		if err := s.DB.QueryRow(ctx, `SELECT COALESCE(max(season),0) FROM stage_history WHERE career_id=$1 AND kind='intl'`, careerID).Scan(&season); err != nil {
			return nil, err
		}
		if season == 0 {
			return nil, ErrNotFound
		}
	}
	t := &Tournament{}
	ok, err := loadHistory(ctx, s.DB, careerID, season, "intl", t)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNotFound
	}
	return t, nil
}
