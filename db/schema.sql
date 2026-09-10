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
  title        TEXT NOT NULL,
  notes        TEXT,
  cost         TEXT,
  mileage_km   INTEGER
);

ALTER TABLE service_history
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cost  TEXT;

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

-- ── Auth (Phase 1) ──

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  display_name  TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email   TEXT NOT NULL,
  action        TEXT NOT NULL,
  target_type   TEXT,
  target_id     TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_actor   ON audit_log(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_target  ON audit_log(target_type, target_id);

-- Optional: track which user created each row (nullable; legacy data keeps NULL)
ALTER TABLE vehicles        ADD COLUMN IF NOT EXISTS created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE vehicles        ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reminders       ADD COLUMN IF NOT EXISTS created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE service_history ADD COLUMN IF NOT EXISTS created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

-- ── Product capabilities ──

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS make TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS year INTEGER;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS fuel_type TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vin TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE trips ADD COLUMN IF NOT EXISTS vehicle_id TEXT REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS stops JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'planned';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS user_notification_preferences (
  user_id               TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  maintenance_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  trip_updates           BOOLEAN NOT NULL DEFAULT TRUE,
  ai_suggestions         BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teams (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member', 'viewer')),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS support_tickets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  subject    TEXT NOT NULL,
  message    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS videos (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL,
  description      TEXT,
  url              TEXT NOT NULL,
  thumbnail_url    TEXT,
  category         TEXT,
  related_kind     TEXT,
  duration_seconds INTEGER,
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO videos (id, title, description, url, category, related_kind, duration_seconds)
VALUES
  ('v-oil', '機油保養：何時需要更換？', '用三分鐘看懂里程、時間與機油狀態。', '#/service', '保養知識', 'oil', 180),
  ('v-brake', '煞車系統檢查重點', '煞車油、煞車皮與異常聲音的基本判斷。', '#/service', '安全檢查', 'brake', 240),
  ('v-trip', '長途出發前五項檢查', '輪胎、冷卻液、電瓶、燈號與隨車用品。', '#/qinao', '出發準備', 'trip', 210)
ON CONFLICT (id) DO NOTHING;
