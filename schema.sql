-- Arnav Movies data (Cloudflare D1, free tier). Apply: npx wrangler d1 execute arnav-movies-db --remote --file schema.sql
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  item TEXT NOT NULL,
  file TEXT,
  ev TEXT NOT NULL,
  code INTEGER,
  country TEXT
);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS events_item ON events (item);

CREATE TABLE IF NOT EXISTS file_health (
  item TEXT NOT NULL,
  file TEXT NOT NULL,
  ok INTEGER NOT NULL,
  status INTEGER,
  ms INTEGER,
  checked_at INTEGER NOT NULL,
  fails INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (item, file)
);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

-- Subtitle downloads and AI translations, kept so quotas are spent once per line.
CREATE TABLE IF NOT EXISTS subs (
  k TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  ts INTEGER NOT NULL
);

-- Viewers' skips: where opening titles end and credits begin, aggregated to a median.
CREATE TABLE IF NOT EXISTS marks (
  id INTEGER PRIMARY KEY,
  item TEXT NOT NULL,
  kind TEXT NOT NULL,
  t INTEGER NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS marks_item ON marks (item);
