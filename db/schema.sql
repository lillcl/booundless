-- 康程 CarAI — Postgres schema.
-- Applied automatically by api/_lib/db.js on first connection, and
-- can be run manually with:
--   psql "$KC_DATABASE_URL" < db/schema.sql

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
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vehicles_team ON vehicles(team);

CREATE TABLE IF NOT EXISTS reminders (
  id          TEXT PRIMARY KEY,
  vehicle_id  TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  due_in      TEXT NOT NULL,
  icon        TEXT NOT NULL DEFAULT 'oil',
  status      TEXT NOT NULL DEFAULT 'upcoming',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_history (
  id           TEXT PRIMARY KEY,
  vehicle_id   TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  performed_at TIMESTAMPTZ NOT NULL,
  kind         TEXT NOT NULL,
  notes        TEXT,
  mileage_km   INTEGER
);

CREATE TABLE IF NOT EXISTS vehicle_status (
  id              SERIAL PRIMARY KEY,
  vehicle_id      TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  item            TEXT NOT NULL,
  interval_km     INTEGER,
  interval_months INTEGER,
  last_done_km    INTEGER,
  last_done_at    TIMESTAMPTZ,
  wear            INTEGER NOT NULL DEFAULT 0,
  display_order   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_status_vehicle ON vehicle_status(vehicle_id);
