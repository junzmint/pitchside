package game

import (
	"context"
	"errors"
	"sync"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------- training ground reward (modes stream)
//
// A gold medal in a training-ground challenge gives the career a small bonus, +1 TP, at most once
// every DrillRewardEvery matchdays. The last claim per career lives in its own table, play_rewards,
// created on first use (no ALTER on shared tables), so nothing else in the career changes shape.
// The thresholds mirror frontend/src/match/drills.ts (DRILLS[].medals[2]).

const (
	DrillRewardTP    = 1
	DrillRewardEvery = 3 // matchdays between two bonuses
)

var drillGold = map[string]int{"slalom": 28, "targets": 18, "freekick": 3, "penalty": 5, "cross": 9}

type DrillReward struct {
	Available bool `json:"available"` // the bonus can still be earned today
	Season    int  `json:"season"`
	Day       int  `json:"day"`
	TP        int  `json:"tp"`     // the career's TP now
	Reward    int  `json:"reward"` // TP a gold medal earns
	Granted   bool `json:"granted"`
	NextIn    int  `json:"nextIn"` // matchdays until the next bonus (0: available now)
}

var playTables = struct {
	sync.Mutex
	ok bool
}{}

func (s *Store) ensurePlayTables(ctx context.Context) error {
	playTables.Lock()
	defer playTables.Unlock()
	if playTables.ok {
		return nil
	}
	_, err := s.DB.Exec(ctx, `CREATE TABLE IF NOT EXISTS play_rewards (
		career_id  INT PRIMARY KEY REFERENCES careers(id) ON DELETE CASCADE,
		season     INT NOT NULL,
		day        INT NOT NULL,
		drill      TEXT NOT NULL DEFAULT '',
		claimed_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
	playTables.ok = err == nil
	return err
}

func drillRewardState(ctx context.Context, q DBTX, careerID int, lock bool) (DrillReward, error) {
	sql := `SELECT season, day, tp, ended FROM careers WHERE id=$1`
	if lock {
		sql += ` FOR UPDATE`
	}
	var r DrillReward
	var ended string
	if err := q.QueryRow(ctx, sql, careerID).Scan(&r.Season, &r.Day, &r.TP, &ended); err != nil {
		return r, notFound(err)
	}
	r.Reward = DrillRewardTP
	var cs, cd int
	err := q.QueryRow(ctx, `SELECT season, day FROM play_rewards WHERE career_id=$1`, careerID).Scan(&cs, &cd)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return r, err
	}
	if err == nil && cs == r.Season && r.Day-cd < DrillRewardEvery {
		r.NextIn = DrillRewardEvery - (r.Day - cd)
	}
	r.Available = ended == "" && r.NextIn == 0
	return r, nil
}

// DrillRewardInfo: can this career still earn today's training bonus?
func (s *Store) DrillRewardInfo(ctx context.Context, careerID int) (*DrillReward, error) {
	if err := s.ensurePlayTables(ctx); err != nil {
		return nil, err
	}
	r, err := drillRewardState(ctx, s.DB, careerID, false)
	return &r, err
}

// ClaimDrillReward: a gold medal was won; grant the bonus unless this matchday's is already taken.
func (s *Store) ClaimDrillReward(ctx context.Context, careerID int, drill string, score int) (*DrillReward, error) {
	gold, ok := drillGold[drill]
	if !ok {
		return nil, userErr("bad_drill", "Unknown challenge")
	}
	if score < gold {
		return nil, userErr("no_gold", "Only a gold medal earns the bonus")
	}
	if err := s.ensurePlayTables(ctx); err != nil {
		return nil, err
	}
	var out DrillReward
	err := s.tx(ctx, func(q pgx.Tx) error {
		r, err := drillRewardState(ctx, q, careerID, true)
		if err != nil {
			return err
		}
		out = r
		if !r.Available {
			return nil
		}
		if _, err := q.Exec(ctx, `INSERT INTO play_rewards (career_id, season, day, drill) VALUES ($1, $2, $3, $4)
			ON CONFLICT (career_id) DO UPDATE SET season=$2, day=$3, drill=$4, claimed_at=now()`, careerID, r.Season, r.Day, drill); err != nil {
			return err
		}
		if err := q.QueryRow(ctx, `UPDATE careers SET tp = tp + $2, updated_at = now() WHERE id=$1 RETURNING tp`, careerID, DrillRewardTP).Scan(&out.TP); err != nil {
			return err
		}
		out.Available = false
		out.Granted = true
		out.NextIn = DrillRewardEvery
		return nil
	})
	return &out, err
}
