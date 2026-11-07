package game

import (
	"context"
	"log"
)

// ---------------------------------------------------------------- old fixtures
//
// A season plays about 4,900 fixtures across the four leagues, their cups and Europe, and they were most
// of what a save grew by each season. Once a season is over only the user's club's own matches are
// read again: the history book and records (stats.go), achievements (explore_ach.go), trophy
// celebrations, press conferences and cup draws. Past tables, awards and tournaments live in
// season_history and stage_history, and nothing points at a fixture by key. So when a new season
// starts, the seasons gone by keep only the user's matches. The user's club never changes within a
// career, so "the user's matches" is well defined.

// pruneFixtures: seasons before the current one keep only the user's matches.
func pruneFixtures(ctx context.Context, q DBTX, c *Career) (int64, error) {
	tag, err := q.Exec(ctx, `DELETE FROM fixtures WHERE career_id=$1 AND season<$2 AND home_id<>$3 AND away_id<>$3`,
		c.ID, c.Season, c.UserClubID)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// PruneOldFixtures runs once (meta key "fixtures_pruned") for the saves made before pruning existed, and
// rewrites the table so the space goes back to the disk. Later seasons reuse the space they free.
func (s *Store) PruneOldFixtures(ctx context.Context) error {
	var done string
	_ = s.DB.QueryRow(ctx, `SELECT v FROM meta WHERE k='fixtures_pruned'`).Scan(&done)
	if done == "1" {
		return nil
	}
	tag, err := s.DB.Exec(ctx, `DELETE FROM fixtures f USING careers c
		WHERE f.career_id=c.id AND f.season<c.season AND f.home_id<>c.user_club_id AND f.away_id<>c.user_club_id`)
	if err != nil {
		return err
	}
	if n := tag.RowsAffected(); n > 0 {
		// (VACUUM cannot run inside a transaction: straight on the pool, before the server takes requests)
		if _, err := s.DB.Exec(ctx, `VACUUM (FULL, ANALYZE) fixtures`); err != nil {
			return err
		}
		log.Printf("old fixtures pruned: %d other clubs' matches from past seasons", n)
	}
	_, err = s.DB.Exec(ctx, `INSERT INTO meta (k, v) VALUES ('fixtures_pruned', '1') ON CONFLICT (k) DO UPDATE SET v='1'`)
	return err
}
