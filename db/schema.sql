/* 康程 CarAI — SQLite schema.
   This is applied automatically by api/_lib/db.js on first connection, and
   can also be run manually with: sqlite3 db/dev.db < db/schema.sql */

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vehicles (
  id            TEXT PRIMARY KEY,
  model         TEXT NOT NULL,
  plate         TEXT,
  mileage_km    INTEGER NOT NULL DEFAULT 0,
  mileage_label TEXT NOT NULL DEFAULT '',
  image         TEXT,
  owner         TEXT NOT NULL DEFAULT 'Isaac',
  team          TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicles_team ON vehicles(team);

CREATE TABLE IF NOT EXISTS reminders (
  id          TEXT PRIMARY KEY,
  vehicle_id  TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,                  -- oil | brake | tire | filter | coolant | etc.
  title       TEXT NOT NULL,
  due_in      TEXT NOT NULL,                   -- "約 1,320 km 後" / "約 1 個月內"
  icon        TEXT NOT NULL DEFAULT 'oil',
  status      TEXT NOT NULL DEFAULT 'upcoming', -- upcoming | overdue | done
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_vehicle ON reminders(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);

CREATE TABLE IF NOT EXISTS trips (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  origin       TEXT NOT NULL,
  destination  TEXT NOT NULL,
  distance_km  REAL NOT NULL,
  duration_min INTEGER NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS service_history (
  id          TEXT PRIMARY KEY,
  vehicle_id  TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  performed_at TEXT NOT NULL,
  kind        TEXT NOT NULL,
  notes       TEXT,
  mileage_km  INTEGER
);