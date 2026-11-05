CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  pass_hash  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS careers (
  id           SERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_club_id INT,
  league       TEXT NOT NULL,
  season       INT NOT NULL DEFAULT 1,
  day          INT NOT NULL DEFAULT 1,
  training     JSONB NOT NULL DEFAULT '{"intensity":"normal"}',
  sponsor      JSONB,
  streak       INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS careers_user ON careers(user_id);

CREATE TABLE IF NOT EXISTS clubs (
  id         SERIAL PRIMARY KEY,
  career_id  INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  league     TEXT NOT NULL,
  name       TEXT NOT NULL,
  short      TEXT NOT NULL,
  color      TEXT NOT NULL,
  color2     TEXT NOT NULL,
  is_user    BOOLEAN NOT NULL DEFAULT false,
  budget     BIGINT NOT NULL DEFAULT 0,
  reputation INT NOT NULL DEFAULT 50,
  formation  TEXT NOT NULL DEFAULT '4-4-2',
  tactic     JSONB NOT NULL DEFAULT '{}',
  lineup     JSONB NOT NULL DEFAULT '[]',
  form_weeks INT NOT NULL DEFAULT 6,
  division   INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS clubs_career ON clubs(career_id);

CREATE TABLE IF NOT EXISTS templates (
  id          SERIAL PRIMARY KEY,
  career_id   INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  name        TEXT NOT NULL,
  nation      TEXT NOT NULL,
  age         INT NOT NULL,
  position    TEXT NOT NULL,
  pace        REAL NOT NULL,
  shooting    REAL NOT NULL,
  passing     REAL NOT NULL,
  dribbling   REAL NOT NULL,
  defending   REAL NOT NULL,
  physical    REAL NOT NULL,
  goalkeeping REAL NOT NULL,
  potential   INT NOT NULL,
  signed      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS players (
  id          SERIAL PRIMARY KEY,
  career_id   INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  club_id     INT REFERENCES clubs(id) ON DELETE SET NULL,
  template_id INT REFERENCES templates(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  nation      TEXT NOT NULL,
  age         INT NOT NULL,
  position    TEXT NOT NULL,
  pace        REAL NOT NULL,
  shooting    REAL NOT NULL,
  passing     REAL NOT NULL,
  dribbling   REAL NOT NULL,
  defending   REAL NOT NULL,
  physical    REAL NOT NULL,
  goalkeeping REAL NOT NULL,
  potential   INT NOT NULL,
  fitness     REAL NOT NULL DEFAULT 100,
  morale      REAL NOT NULL DEFAULT 70,
  focus       TEXT NOT NULL DEFAULT 'balanced',
  injury      INT NOT NULL DEFAULT 0,
  unrest      INT NOT NULL DEFAULT 0,
  retired     BOOLEAN NOT NULL DEFAULT false,
  tenure      INT NOT NULL DEFAULT 10,
  history     JSONB NOT NULL DEFAULT '[]',
  shirt       INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS players_career_club ON players(career_id, club_id);

CREATE TABLE IF NOT EXISTS coaches (
  id        SERIAL PRIMARY KEY,
  career_id INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  club_id   INT REFERENCES clubs(id) ON DELETE SET NULL,
  name      TEXT NOT NULL,
  nation    TEXT NOT NULL,
  role      TEXT NOT NULL,
  skill     INT NOT NULL
);
CREATE INDEX IF NOT EXISTS coaches_career ON coaches(career_id);

CREATE TABLE IF NOT EXISTS fixtures (
  id         SERIAL PRIMARY KEY,
  career_id  INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  season     INT NOT NULL,
  day        INT NOT NULL,
  comp       TEXT NOT NULL,
  league     TEXT NOT NULL DEFAULT '',
  stage      TEXT NOT NULL,
  home_id    INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  away_id    INT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  home_goals INT,
  away_goals INT,
  pens_home  BOOLEAN,
  played     BOOLEAN NOT NULL DEFAULT false,
  report     JSONB
);
CREATE INDEX IF NOT EXISTS fixtures_career ON fixtures(career_id, season, day);

CREATE TABLE IF NOT EXISTS player_stats (
  career_id  INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  player_id  INT NOT NULL,
  season     INT NOT NULL,
  comp       TEXT NOT NULL,
  club_id    INT NOT NULL,
  apps       INT NOT NULL DEFAULT 0,
  goals      INT NOT NULL DEFAULT 0,
  assists    INT NOT NULL DEFAULT 0,
  rating_sum REAL NOT NULL DEFAULT 0,
  cs         INT NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, season, comp)
);
CREATE INDEX IF NOT EXISTS stats_career ON player_stats(career_id, season, comp);

CREATE TABLE IF NOT EXISTS finances (
  id        SERIAL PRIMARY KEY,
  career_id INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  season    INT NOT NULL,
  day       INT NOT NULL,
  kind      TEXT NOT NULL,
  amount    BIGINT NOT NULL,
  note      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS finances_career ON finances(career_id, season);

CREATE TABLE IF NOT EXISTS quests (
  id        SERIAL PRIMARY KEY,
  career_id INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,
  target    INT NOT NULL,
  progress  INT NOT NULL DEFAULT 0,
  reward    BIGINT NOT NULL,
  status    TEXT NOT NULL DEFAULT 'active'
);
CREATE INDEX IF NOT EXISTS quests_career ON quests(career_id);

CREATE TABLE IF NOT EXISTS deal_attempts (
  career_id INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  player_id INT NOT NULL,
  season    INT NOT NULL,
  day       INT NOT NULL,
  PRIMARY KEY (career_id, player_id, season, day)
);

CREATE TABLE IF NOT EXISTS season_history (
  career_id  INT NOT NULL REFERENCES careers(id) ON DELETE CASCADE,
  season     INT NOT NULL,
  club_id    INT NOT NULL,
  league_pos INT NOT NULL,
  points     INT NOT NULL,
  cup        TEXT NOT NULL DEFAULT '',
  cl         TEXT NOT NULL DEFAULT '',
  prize      BIGINT NOT NULL DEFAULT 0,
  summary    JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (career_id, season)
);
