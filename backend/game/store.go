package game

import (
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

// schemaVersion: NEVER change it. A different value makes Migrate drop every game table and
// so delete every player's careers. New columns and tables go in the additive list in Migrate.
const schemaVersion = "4"

type DBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type Store struct{ DB *pgxpool.Pool }

func NewStore(db *pgxpool.Pool) *Store { return &Store{DB: db} }

// Migrate recreates the schema when the stored version differs (dev game: old saves are dropped).
func (s *Store) Migrate(ctx context.Context) error {
	// one process migrates at a time (two API processes starting together would deadlock on ALTERs)
	lock, err := s.DB.Acquire(ctx)
	if err != nil {
		return err
	}
	defer lock.Release()
	if _, err := lock.Exec(ctx, `SELECT pg_advisory_lock(7342001)`); err != nil {
		return err
	}
	defer func() { _, _ = lock.Exec(context.Background(), `SELECT pg_advisory_unlock(7342001)`) }()
	if _, err := s.DB.Exec(ctx, `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`); err != nil {
		return err
	}
	var v string
	_ = s.DB.QueryRow(ctx, `SELECT v FROM meta WHERE k='schema'`).Scan(&v)
	if v != schemaVersion {
		// game data is rebuilt; accounts (users, sessions) are kept
		if _, err := s.DB.Exec(ctx, `DROP TABLE IF EXISTS season_history, deal_attempts, quests, finances, player_stats, fixtures, coaches,
			players, templates, clubs, careers CASCADE`); err != nil {
			return err
		}
		// stage stream: news and award/tournament history belong to careers too (new careers reuse ids)
		if _, err := s.DB.Exec(ctx, `DROP TABLE IF EXISTS news, stage_history, play_rewards, staff_life, club_kits, medical`); err != nil {
			return err
		}
	}
	// additive migrations keep existing careers
	migrations := []string{
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS tag TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE templates ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE templates ADD COLUMN IF NOT EXISTS club_id INT`,
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS unrest INT NOT NULL DEFAULT 0`,
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS ended TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS care JSONB NOT NULL DEFAULT '{}'`,
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS contracts JSONB NOT NULL DEFAULT '{}'`,
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS icon_pick JSONB`,
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS commercial JSONB NOT NULL DEFAULT '{}'`,
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '{}'`,
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS explore JSONB NOT NULL DEFAULT '{}'`,
		`CREATE INDEX IF NOT EXISTS players_template ON players(template_id) WHERE template_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS templates_career ON templates(career_id, kind)`,
		`CREATE TABLE IF NOT EXISTS news (id BIGSERIAL PRIMARY KEY, career_id INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
			season INT NOT NULL, day INT NOT NULL, kind TEXT NOT NULL, data JSONB NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS news_career ON news(career_id, id DESC)`,
		`ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS extra_time BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS pens_h INT`,
		`ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS pens_a INT`,
		`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS medical INT NOT NULL DEFAULT 1`,
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS tp INT NOT NULL DEFAULT 10`,
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS ticket TEXT NOT NULL DEFAULT 'normal'`,
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS loan JSONB`,
		`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS stadium INT NOT NULL DEFAULT 1`,
		`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS train_lvl INT NOT NULL DEFAULT 1`,
		`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS academy INT NOT NULL DEFAULT 1`,
		`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS deals INT NOT NULL DEFAULT 0`,
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS traits JSONB`,
		`ALTER TABLE players ADD COLUMN IF NOT EXISTS traits_known BOOLEAN NOT NULL DEFAULT false`,
		`ALTER TABLE coaches ADD COLUMN IF NOT EXISTS style TEXT NOT NULL DEFAULT ''`,
		// stage stream (stage.go): its own career state and the award / tournament history
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS stage JSONB NOT NULL DEFAULT '{}'`,
		`CREATE TABLE IF NOT EXISTS stage_history (career_id INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
			season INT NOT NULL, kind TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (career_id, season, kind))`,
		// club stream (club_state.go): fans, pre-season tour, Deadline Day, Legends wall
		`ALTER TABLE careers ADD COLUMN IF NOT EXISTS club_life JSONB NOT NULL DEFAULT '{}'`,
		// foreign keys that cascade when a career (or an account) is deleted: without these, every
		// deleted club scans the whole players/coaches/fixtures tables and deleting a save takes minutes
		`CREATE INDEX IF NOT EXISTS players_club ON players(club_id)`,
		`CREATE INDEX IF NOT EXISTS coaches_club ON coaches(club_id)`,
		`CREATE INDEX IF NOT EXISTS fixtures_home ON fixtures(home_id)`,
		`CREATE INDEX IF NOT EXISTS fixtures_away ON fixtures(away_id)`,
		`CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,
		// modes stream (play_reward.go): one training-ground bonus per career and matchday
		`CREATE TABLE IF NOT EXISTS play_rewards (career_id INT PRIMARY KEY REFERENCES careers(id) ON DELETE CASCADE,
			season INT NOT NULL, day INT NOT NULL, drill TEXT NOT NULL DEFAULT '', claimed_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
		// staff stream (staff_life.go): the coaching staff's life, one JSONB document per career
		`CREATE TABLE IF NOT EXISTS staff_life (career_id INT PRIMARY KEY REFERENCES careers(id) ON DELETE CASCADE,
			data JSONB NOT NULL DEFAULT '{}')`,
	}
	migrations = append(migrations, KitMigrations()...)                                                                   // kits.go: the kits table and real club colours
	migrations = append(migrations, `ALTER TABLE templates ADD COLUMN IF NOT EXISTS market_until INT NOT NULL DEFAULT 0`) // market.go: legends stay a few days
	// medical stream (medical.go): the medical file of every career (injuries, wear, cases, decisions)
	migrations = append(migrations, `CREATE TABLE IF NOT EXISTS medical (career_id INT PRIMARY KEY REFERENCES careers(id) ON DELETE CASCADE,
		data JSONB NOT NULL DEFAULT '{}', updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
	// speed: seasonApps (growth.go) counts a club's games this season without scanning every career's stats.
	// The tables rewritten every matchday keep room on each page, so an update stays on its page (no new
	// index entries) and dead rows are cleared sooner: the tables stay small and quick to read.
	migrations = append(migrations,
		`CREATE INDEX IF NOT EXISTS stats_club ON player_stats(club_id, season)`,
		`ALTER TABLE players SET (fillfactor = 80, autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05)`,
		`ALTER TABLE player_stats SET (fillfactor = 85, autovacuum_vacuum_scale_factor = 0.05)`,
		`ALTER TABLE clubs SET (fillfactor = 70, autovacuum_vacuum_scale_factor = 0.05)`,
		`ALTER TABLE fixtures SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.05)`,
	)
	// clubs that shared a short name with a neighbour (data_divisions.go uniqueShorts) get their new one
	for _, f := range ShortFixes() {
		q := func(v string) string { return "'" + strings.ReplaceAll(v, "'", "''") + "'" }
		migrations = append(migrations, `UPDATE clubs SET short=`+q(f[2])+` WHERE league=`+q(f[0])+` AND name=`+q(f[1])+` AND short=`+q(shortOf(f[1])))
	}
	// Every statement is idempotent, but ALTER TABLE takes an exclusive lock even when there is
	// nothing to do, which stalls (or deadlocks) a running API. Skip the lot when this exact
	// schema and list were applied before.
	sum := fmt.Sprintf("%x", sha256.Sum256([]byte(schemaSQL+"\n"+strings.Join(migrations, ";\n"))))
	var applied string
	_ = s.DB.QueryRow(ctx, `SELECT v FROM meta WHERE k='migrations'`).Scan(&applied)
	if applied != sum || v != schemaVersion {
		if _, err := s.DB.Exec(ctx, schemaSQL); err != nil {
			return err
		}
		for _, stmt := range migrations {
			if _, err := s.DB.Exec(ctx, stmt); err != nil {
				return err
			}
		}
		if _, err := s.DB.Exec(ctx, `INSERT INTO meta (k, v) VALUES ('migrations', $1) ON CONFLICT (k) DO UPDATE SET v=$1`, sum); err != nil {
			return err
		}
	}
	_, err = s.DB.Exec(ctx, `INSERT INTO meta (k, v) VALUES ('schema', $1) ON CONFLICT (k) DO UPDATE SET v=$1`, schemaVersion)
	return err
}

func (s *Store) tx(ctx context.Context, fn func(q pgx.Tx) error) error {
	t, err := s.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer t.Rollback(ctx)
	if err := fn(t); err != nil {
		return err
	}
	return t.Commit(ctx)
}

func notFound(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

// ---- careers ----

func getCareer(ctx context.Context, q DBTX, id int) (*Career, error) {
	c := &Career{}
	sql := `SELECT id, user_id, COALESCE(user_club_id,0), league, season, day, training, sponsor, streak, tp, ticket, loan, ended, care, contracts, icon_pick, commercial, events, explore FROM careers WHERE id=$1`
	// Inside a transaction, hold the career row until commit. Two requests on one career (a double
	// click, a setting changed while a matchday runs) then run one after the other, instead of the
	// later one saving a stale copy of the career over the first one's changes.
	if _, ok := q.(pgx.Tx); ok {
		sql += ` FOR UPDATE`
	}
	err := q.QueryRow(ctx, sql, id).
		Scan(&c.ID, &c.UserID, &c.UserClubID, &c.League, &c.Season, &c.Day, &c.Training, &c.Sponsor, &c.Streak, &c.TP, &c.Ticket, &c.Loan, &c.Ended, &c.Care, &c.Contracts, &c.IconPick, &c.Commercial, &c.Events, &c.Explore)
	if err == nil {
		migrateCommercial(c)
	}
	return c, notFound(err)
}

func saveCareer(ctx context.Context, q DBTX, c *Career) error {
	_, err := q.Exec(ctx, `UPDATE careers SET user_club_id=$2, season=$3, day=$4, training=$5, sponsor=$6, streak=$7, tp=$8, ticket=$9, loan=$10, ended=$11, care=$12, contracts=$13, icon_pick=$14, commercial=$15, events=$16, explore=$17, updated_at=now() WHERE id=$1`,
		c.ID, c.UserClubID, c.Season, c.Day, c.Training, c.Sponsor, c.Streak, c.TP, c.Ticket, c.Loan, c.Ended, c.Care, c.Contracts, c.IconPick, c.Commercial, c.Events, c.Explore)
	return err
}

// ---- clubs ----

const clubCols = `id, career_id, league, name, short, color, color2, is_user, budget, reputation, formation, tactic, lineup, form_weeks, division, stadium, train_lvl, academy, deals, medical`

func scanClub(row pgx.Row) (*Club, error) {
	c := &Club{}
	err := row.Scan(&c.ID, &c.CareerID, &c.League, &c.Name, &c.Short, &c.Color, &c.Color2, &c.IsUser, &c.Budget,
		&c.Reputation, &c.Formation, &c.Tactic, &c.Lineup, &c.FormWeeks, &c.Division, &c.Stadium, &c.TrainLvl, &c.Academy, &c.Deals, &c.Medical)
	if err != nil {
		return nil, notFound(err)
	}
	c.Tactic.Normalize()
	if _, ok := Formations[c.Formation]; !ok {
		c.Formation = "4-4-2"
	}
	noteClub(c) // legend_versions.go: which club a legend card's era belongs to
	return c, nil
}

func getClub(ctx context.Context, q DBTX, id int) (*Club, error) {
	return scanClub(q.QueryRow(ctx, `SELECT `+clubCols+` FROM clubs WHERE id=$1`, id))
}

func listClubs(ctx context.Context, q DBTX, careerID int) ([]*Club, error) {
	rows, err := q.Query(ctx, `SELECT `+clubCols+` FROM clubs WHERE career_id=$1 ORDER BY id`, careerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Club
	for rows.Next() {
		c, err := scanClub(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func insertClub(ctx context.Context, q DBTX, c *Club) error {
	if c.Lineup == nil {
		c.Lineup = []int{}
	}
	return q.QueryRow(ctx, `INSERT INTO clubs (career_id, league, name, short, color, color2, is_user, budget, reputation, formation, tactic, lineup, form_weeks, division)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
		c.CareerID, c.League, c.Name, c.Short, c.Color, c.Color2, c.IsUser, c.Budget, c.Reputation, c.Formation, c.Tactic, c.Lineup, c.FormWeeks, c.Division).Scan(&c.ID)
}

func saveClub(ctx context.Context, q DBTX, c *Club) error {
	if c.Lineup == nil {
		c.Lineup = []int{}
	}
	_, err := q.Exec(ctx, `UPDATE clubs SET budget=$2, reputation=$3, formation=$4, tactic=$5, lineup=$6, form_weeks=$7, division=$8, stadium=$9, train_lvl=$10, academy=$11, deals=$12, medical=$13 WHERE id=$1`,
		c.ID, c.Budget, c.Reputation, c.Formation, c.Tactic, c.Lineup, c.FormWeeks, c.Division, max(1, c.Stadium), max(1, c.TrainLvl), max(1, c.Academy), c.Deals, max(1, c.Medical))
	return err
}

// ---- players ----

const playerCols = `id, club_id, template_id, name, nation, age, position, pace, shooting, passing, dribbling, defending, physical,
	goalkeeping, potential, fitness, morale, focus, injury, tenure, history, shirt, retired, tag, version, unrest, traits, traits_known`

func scanPlayer(row pgx.Row) (*Player, error) {
	p := &Player{}
	err := row.Scan(&p.ID, &p.ClubID, &p.TemplateID, &p.Name, &p.Nation, &p.Age, &p.Position, &p.Pace, &p.Shooting, &p.Passing,
		&p.Dribbling, &p.Defending, &p.Physical, &p.Goalkeeping, &p.Potential, &p.Fitness, &p.Morale, &p.Focus,
		&p.Injury, &p.Tenure, &p.History, &p.Shirt, &p.Retired, &p.Tag, &p.Version, &p.Unrest, &p.Traits, &p.TraitsKnown)
	if err != nil {
		return nil, notFound(err)
	}
	ensureTraits(p)
	if p.History == nil {
		p.History = []int{}
	}
	p.Fill()
	return p, nil
}

// playerColsP is playerCols prefixed with the "p." alias for joins.
var playerColsP = func() string {
	parts := strings.Split(playerCols, ",")
	for i, c := range parts {
		parts[i] = "p." + strings.TrimSpace(c)
	}
	return strings.Join(parts, ", ")
}()

// competitionPlayers loads every player at a club that plays in the competitions.
func competitionPlayers(ctx context.Context, q DBTX, careerID int) ([]*Player, error) {
	return scanPlayers(q.Query(ctx, `SELECT `+playerColsP+` FROM players p JOIN clubs k ON k.id = p.club_id
		WHERE p.career_id=$1 AND k.career_id=$1 AND k.division > 0 ORDER BY p.shirt, p.id`, careerID))
}

func scanPlayers(rows pgx.Rows, err error) ([]*Player, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Player
	for rows.Next() {
		p, err := scanPlayer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Analyze refreshes planner statistics after bulk inserts (stale stats make joins crawl).
func Analyze(ctx context.Context, q DBTX) {
	_, _ = q.Exec(ctx, `ANALYZE players; ANALYZE clubs; ANALYZE fixtures; ANALYZE coaches`)
}

func queryPlayers(ctx context.Context, q DBTX, where string, args ...any) ([]*Player, error) {
	rows, err := q.Query(ctx, `SELECT `+playerCols+` FROM players WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Player
	for rows.Next() {
		p, err := scanPlayer(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func getPlayer(ctx context.Context, q DBTX, careerID, id int) (*Player, error) {
	return scanPlayer(q.QueryRow(ctx, `SELECT `+playerCols+` FROM players WHERE career_id=$1 AND id=$2`, careerID, id))
}

const insertPlayerSQL = `INSERT INTO players (career_id, club_id, template_id, name, nation, age, position, pace, shooting, passing,
		dribbling, defending, physical, goalkeeping, potential, fitness, morale, focus, injury, tenure, history, shirt, tag, version, traits)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`

func insertPlayerArgs(careerID int, p *Player) []any {
	if p.History == nil {
		p.History = []int{}
	}
	return []any{careerID, p.ClubID, p.TemplateID, p.Name, p.Nation, p.Age, p.Position, p.Pace, p.Shooting, p.Passing, p.Dribbling,
		p.Defending, p.Physical, p.Goalkeeping, p.Potential, p.Fitness, p.Morale, p.Focus, p.Injury, p.Tenure, p.History, p.Shirt, p.Tag, p.Version, traitsOf(p)}
}

func insertPlayer(ctx context.Context, q DBTX, careerID int, p *Player) error {
	return q.QueryRow(ctx, insertPlayerSQL, insertPlayerArgs(careerID, p)...).Scan(&p.ID)
}

// insertPlayers inserts many players in one round trip when the connection can batch (a
// transaction or the pool can), and fills in their ids.
func insertPlayers(ctx context.Context, q DBTX, careerID int, ps []*Player) error {
	bq, ok := q.(interface {
		SendBatch(ctx context.Context, b *pgx.Batch) pgx.BatchResults
	})
	if !ok || len(ps) < 2 {
		for _, p := range ps {
			if err := insertPlayer(ctx, q, careerID, p); err != nil {
				return err
			}
		}
		return nil
	}
	b := &pgx.Batch{}
	for _, p := range ps {
		b.Queue(insertPlayerSQL, insertPlayerArgs(careerID, p)...)
	}
	br := bq.SendBatch(ctx, b)
	for _, p := range ps {
		if err := br.QueryRow().Scan(&p.ID); err != nil {
			_ = br.Close()
			return err
		}
	}
	return br.Close()
}

func savePlayer(ctx context.Context, q DBTX, p *Player) error {
	if p.History == nil {
		p.History = []int{}
	}
	_, err := q.Exec(ctx, `UPDATE players SET club_id=$2, age=$3, pace=$4, shooting=$5, passing=$6, dribbling=$7,
		defending=$8, physical=$9, goalkeeping=$10, potential=$11, fitness=$12, morale=$13, focus=$14, injury=$15,
		tenure=$16, history=$17, shirt=$18, retired=$19, unrest=$20, traits=$21, traits_known=$22 WHERE id=$1`,
		p.ID, p.ClubID, p.Age, p.Pace, p.Shooting, p.Passing, p.Dribbling, p.Defending, p.Physical, p.Goalkeeping,
		p.Potential, p.Fitness, p.Morale, p.Focus, p.Injury, p.Tenure, p.History, p.Shirt, p.Retired, p.Unrest, traitsOf(p), p.TraitsKnown)
	return err
}

// insertClubs inserts many clubs in one round trip and fills in their ids.
func insertClubs(ctx context.Context, tx pgx.Tx, cs []*Club) error {
	b := &pgx.Batch{}
	for _, c := range cs {
		if c.Lineup == nil {
			c.Lineup = []int{}
		}
		c := c
		b.Queue(`INSERT INTO clubs (career_id, league, name, short, color, color2, is_user, budget, reputation, formation, tactic, lineup, form_weeks, division)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
			c.CareerID, c.League, c.Name, c.Short, c.Color, c.Color2, c.IsUser, c.Budget, c.Reputation, c.Formation, c.Tactic, c.Lineup, c.FormWeeks, c.Division).
			QueryRow(func(row pgx.Row) error { return row.Scan(&c.ID) })
	}
	return tx.SendBatch(ctx, b).Close()
}

// copyFixtures bulk-inserts fixtures (a season has ~4,700).
func copyFixtures(ctx context.Context, q DBTX, careerID int, fs []*Fixture) error {
	tx, ok := q.(pgx.Tx)
	if !ok {
		for _, f := range fs {
			if err := insertFixture(ctx, q, careerID, f); err != nil {
				return err
			}
		}
		return nil
	}
	rows := make([][]any, 0, len(fs))
	for _, f := range fs {
		rows = append(rows, []any{careerID, f.Season, f.Day, f.Comp, f.League, f.Stage, f.HomeID, f.AwayID})
	}
	_, err := tx.CopyFrom(ctx, pgx.Identifier{"fixtures"}, []string{"career_id", "season", "day", "comp", "league", "stage", "home_id", "away_id"}, pgx.CopyFromRows(rows))
	return err
}

// copyCoaches bulk-inserts coaches.
func copyCoaches(ctx context.Context, tx pgx.Tx, careerID int, cs []*Coach) error {
	rows := make([][]any, 0, len(cs))
	for _, c := range cs {
		rows = append(rows, []any{careerID, c.ClubID, c.Name, c.Nation, c.Role, c.Skill, c.Style})
	}
	_, err := tx.CopyFrom(ctx, pgx.Identifier{"coaches"}, []string{"career_id", "club_id", "name", "nation", "role", "skill", "style"}, pgx.CopyFromRows(rows))
	return err
}

// copyPlayers bulk-inserts players (used for the ~4,000-strong world pool).
func copyPlayers(ctx context.Context, tx pgx.Tx, careerID int, ps []*Player) error {
	rows := make([][]any, 0, len(ps))
	for _, p := range ps {
		if p.History == nil {
			p.History = []int{}
		}
		rows = append(rows, []any{careerID, p.ClubID, p.Name, p.Nation, p.Age, p.Position, p.Pace, p.Shooting, p.Passing, p.Dribbling,
			p.Defending, p.Physical, p.Goalkeeping, p.Potential, p.Fitness, p.Morale, p.Focus, p.Tenure, p.History, p.Shirt, traitsOf(p)})
	}
	_, err := tx.CopyFrom(ctx, pgx.Identifier{"players"}, []string{"career_id", "club_id", "name", "nation", "age", "position", "pace",
		"shooting", "passing", "dribbling", "defending", "physical", "goalkeeping", "potential", "fitness", "morale", "focus", "tenure",
		"history", "shirt", "traits"}, pgx.CopyFromRows(rows))
	return err
}

// savePlayers writes many players with one UPDATE … FROM unnest(arrays) statement.
func savePlayers(ctx context.Context, q DBTX, ps []*Player) error {
	if len(ps) == 0 {
		return nil
	}
	n := len(ps)
	ids, ages, pots, injuries, tenures, shirts := make([]int32, n), make([]int32, n), make([]int32, n), make([]int32, n), make([]int32, n), make([]int32, n)
	clubs := make([]*int32, n)
	attrs := make([][]float32, 7)
	for i := range attrs {
		attrs[i] = make([]float32, n)
	}
	fit, mor := make([]float32, n), make([]float32, n)
	focus, hist := make([]string, n), make([]string, n)
	retired := make([]bool, n)
	unrest := make([]int32, n)
	traits := make([]string, n)
	known := make([]bool, n)
	for i, p := range ps {
		ids[i], ages[i], pots[i], injuries[i], tenures[i], shirts[i] = int32(p.ID), int32(p.Age), int32(p.Potential), int32(p.Injury), int32(p.Tenure), int32(p.Shirt)
		if p.ClubID != nil {
			v := int32(*p.ClubID)
			clubs[i] = &v
		}
		for j, a := range AttrNames {
			attrs[j][i] = float32(*p.Attr(a))
		}
		fit[i], mor[i] = float32(p.Fitness), float32(p.Morale)
		focus[i] = p.Focus
		if p.History == nil {
			p.History = []int{}
		}
		b, _ := json.Marshal(p.History)
		hist[i] = string(b)
		retired[i] = p.Retired
		unrest[i] = int32(p.Unrest)
		tb, _ := json.Marshal(traitsOf(p))
		traits[i] = string(tb)
		known[i] = p.TraitsKnown
	}
	_, err := q.Exec(ctx, `UPDATE players p SET club_id=u.club_id, age=u.age, pace=u.pace, shooting=u.shooting, passing=u.passing,
		dribbling=u.dribbling, defending=u.defending, physical=u.physical, goalkeeping=u.goalkeeping, potential=u.potential,
		fitness=u.fitness, morale=u.morale, focus=u.focus, injury=u.injury, tenure=u.tenure, history=u.history::jsonb,
		shirt=u.shirt, retired=u.retired, unrest=u.unrest, traits=u.traits::jsonb, traits_known=u.known
		FROM unnest($1::int[], $2::int[], $3::int[], $4::real[], $5::real[], $6::real[], $7::real[], $8::real[], $9::real[], $10::real[],
			$11::int[], $12::real[], $13::real[], $14::text[], $15::int[], $16::int[], $17::text[], $18::int[], $19::bool[], $20::int[], $21::text[], $22::bool[])
		AS u(id, club_id, age, pace, shooting, passing, dribbling, defending, physical, goalkeeping, potential, fitness, morale,
			focus, injury, tenure, history, shirt, retired, unrest, traits, known)
		WHERE p.id = u.id`,
		ids, clubs, ages, attrs[0], attrs[1], attrs[2], attrs[3], attrs[4], attrs[5], attrs[6], pots, fit, mor, focus, injuries, tenures, hist, shirts, retired, unrest, traits, known)
	return err
}

// moveTo transfers a player to a club (nil = free agent), tracking club history and resetting tenure.
func moveTo(p *Player, clubID *int, shirt int) {
	p.ClubID = clubID
	p.Unrest = 0
	p.Tenure = 0
	p.Shirt = shirt
	if clubID != nil {
		for _, h := range p.History {
			if h == *clubID {
				return
			}
		}
		p.History = append(p.History, *clubID)
	}
}

// ---- coaches ----

func queryCoaches(ctx context.Context, q DBTX, where string, args ...any) ([]*Coach, error) {
	rows, err := q.Query(ctx, `SELECT id, club_id, name, nation, role, skill, style FROM coaches WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Coach
	for rows.Next() {
		c := &Coach{}
		if err := rows.Scan(&c.ID, &c.ClubID, &c.Name, &c.Nation, &c.Role, &c.Skill, &c.Style); err != nil {
			return nil, err
		}
		c.Fill()
		if c.Role == "head" {
			c.Style = styleFor(c)
		}
		c.Perks = perksFor(c)
		out = append(out, c)
	}
	return out, rows.Err()
}

func insertCoach(ctx context.Context, q DBTX, careerID int, c *Coach) error {
	err := q.QueryRow(ctx, `INSERT INTO coaches (career_id, club_id, name, nation, role, skill, style) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
		careerID, c.ClubID, c.Name, c.Nation, c.Role, c.Skill, c.Style).Scan(&c.ID)
	c.Perks = perksFor(c)
	return err
}

// ---- fixtures ----

const fixtureCols = `id, season, day, comp, league, stage, home_id, away_id, home_goals, away_goals, pens_home, extra_time, pens_h, pens_a, played, report`

func queryFixtures(ctx context.Context, q DBTX, where string, args ...any) ([]*Fixture, error) {
	rows, err := q.Query(ctx, `SELECT `+fixtureCols+` FROM fixtures WHERE `+where+` ORDER BY day, id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Fixture
	for rows.Next() {
		f := &Fixture{}
		var rep []byte
		if err := rows.Scan(&f.ID, &f.Season, &f.Day, &f.Comp, &f.League, &f.Stage, &f.HomeID, &f.AwayID,
			&f.HomeGoals, &f.AwayGoals, &f.PensHome, &f.ExtraTime, &f.PensH, &f.PensA, &f.Played, &rep); err != nil {
			return nil, err
		}
		if len(rep) > 0 {
			f.Report = rep
		}
		out = append(out, f)
	}
	return out, rows.Err()
}

func insertFixture(ctx context.Context, q DBTX, careerID int, f *Fixture) error {
	return q.QueryRow(ctx, `INSERT INTO fixtures (career_id, season, day, comp, league, stage, home_id, away_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
		careerID, f.Season, f.Day, f.Comp, f.League, f.Stage, f.HomeID, f.AwayID).Scan(&f.ID)
}

func saveFixtureResult(ctx context.Context, q DBTX, f *Fixture, report any) error {
	_, err := q.Exec(ctx, `UPDATE fixtures SET home_goals=$2, away_goals=$3, pens_home=$4, played=true, report=$5, extra_time=$6, pens_h=$7, pens_a=$8 WHERE id=$1`,
		f.ID, f.HomeGoals, f.AwayGoals, f.PensHome, report, f.ExtraTime, f.PensH, f.PensA)
	return err
}

// ---- finances ----

func addFinance(ctx context.Context, q DBTX, c *Career, kind string, amount int64, note string) error {
	if amount == 0 {
		return nil
	}
	_, err := q.Exec(ctx, `INSERT INTO finances (career_id, season, day, kind, amount, note) VALUES ($1,$2,$3,$4,$5,$6)`,
		c.ID, c.Season, c.Day, kind, amount, note)
	return err
}

func traitsOf(p *Player) []string {
	ensureTraits(p)
	return p.Traits
}
