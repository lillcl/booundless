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
ALTER TABLE trips ADD COLUMN IF NOT EXISTS created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL;

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

-- ── CarAI agent + research persistence ──

CREATE TABLE IF NOT EXISTS agent_threads (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'CarAI 對話',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_threads_user_updated ON agent_threads(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id  TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool', 'system')),
  parts      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread_created ON agent_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS agent_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id    TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('running', 'completed', 'awaiting_confirmation', 'failed')),
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  token_usage  JSONB,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_started ON agent_runs(thread_id, started_at DESC);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id               UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name            TEXT NOT NULL,
  input                JSONB NOT NULL DEFAULT '{}'::jsonb,
  output               JSONB,
  status               TEXT NOT NULL CHECK (status IN ('running', 'completed', 'awaiting_confirmation', 'failed')),
  requires_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  confirmed_at         TIMESTAMPTZ,
  error                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agent_tool_calls_run ON agent_tool_calls(run_id, created_at);

CREATE TABLE IF NOT EXISTS research_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query        TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS research_sources (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  research_run_id UUID NOT NULL REFERENCES research_runs(id) ON DELETE CASCADE,
  title          TEXT NOT NULL DEFAULT '',
  url            TEXT,
  source_name    TEXT,
  published_at   TIMESTAMPTZ,
  retrieved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_hash   TEXT,
  content        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_research_sources_run ON research_sources(research_run_id);

CREATE TABLE IF NOT EXISTS vehicle_specs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  make        TEXT,
  model       TEXT,
  year        INTEGER,
  variant     TEXT,
  specs       JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence  NUMERIC(5,4),
  source_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_names JSONB NOT NULL DEFAULT '[]'::jsonb,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vehicle_specs_vehicle ON vehicle_specs(vehicle_id, fetched_at DESC);

-- Custom JWT sessions mean API ownership checks remain mandatory. RLS is still
-- enabled as a second boundary for direct database access.
ALTER TABLE agent_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_specs ENABLE ROW LEVEL SECURITY;

-- ── Dealer portal / multi-tenant service catalog ──

CREATE TABLE IF NOT EXISTS dealers (
  id                  TEXT PRIMARY KEY,
  legal_name          TEXT,
  display_name        TEXT NOT NULL,
  registration_number TEXT,
  phone               TEXT,
  email               TEXT,
  website             TEXT,
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'suspended')),
  created_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dealers_status ON dealers(status);

CREATE TABLE IF NOT EXISTS dealer_branches (
  id           TEXT PRIMARY KEY,
  dealer_id    TEXT NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  address      TEXT,
  district     TEXT,
  latitude     NUMERIC(9,6),
  longitude    NUMERIC(9,6),
  phone        TEXT,
  opening_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dealer_branches_dealer ON dealer_branches(dealer_id);

CREATE TABLE IF NOT EXISTS dealer_members (
  dealer_id  TEXT NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'staff', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dealer_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_dealer_members_user ON dealer_members(user_id);

CREATE TABLE IF NOT EXISTS dealer_invites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id           TEXT NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  role                TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'staff', 'viewer')),
  token_hash          TEXT NOT NULL UNIQUE,
  expires_at          TIMESTAMPTZ NOT NULL,
  accepted_at         TIMESTAMPTZ,
  created_by_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dealer_invites_email ON dealer_invites(email);

CREATE TABLE IF NOT EXISTS service_item_types (
  key          TEXT PRIMARY KEY,
  category     TEXT NOT NULL DEFAULT 'maintenance',
  display_names JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO service_item_types (key, category, display_names) VALUES
  ('engine_oil', 'fluid', '{"zh-Hant":"機油"}'),
  ('oil_filter', 'filter', '{"zh-Hant":"機油隔"}'),
  ('transmission_fluid', 'fluid', '{"zh-Hant":"波箱油"}'),
  ('brake_pads', 'brake', '{"zh-Hant":"煞車皮"}'),
  ('brake_fluid', 'brake', '{"zh-Hant":"煞車油"}'),
  ('coolant', 'fluid', '{"zh-Hant":"冷卻液"}'),
  ('spark_plugs', 'ignition', '{"zh-Hant":"火花塞"}'),
  ('air_filter', 'filter', '{"zh-Hant":"空氣濾芯"}'),
  ('cabin_filter', 'filter', '{"zh-Hant":"冷氣濾芯"}'),
  ('battery_12v', 'electrical', '{"zh-Hant":"12V 電瓶"}'),
  ('tire', 'tire', '{"zh-Hant":"輪胎"}'),
  ('brake_caliper', 'brake', '{"zh-Hant":"煞車卡鉗保養"}'),
  ('body_chassis_inspection', 'inspection', '{"zh-Hant":"車身及底盤檢查"}')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE vehicle_status
  ADD COLUMN IF NOT EXISTS service_item_type_key TEXT REFERENCES service_item_types(key);
CREATE INDEX IF NOT EXISTS idx_vehicle_status_service_key ON vehicle_status(service_item_type_key);

CREATE TABLE IF NOT EXISTS dealer_service_items (
  id                    TEXT PRIMARY KEY,
  dealer_id             TEXT NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  service_item_type_key TEXT NOT NULL REFERENCES service_item_types(key),
  name                  TEXT NOT NULL,
  description           TEXT,
  interval_km           INTEGER,
  interval_months       INTEGER,
  price_min             NUMERIC(12,2),
  price_max             NUMERIC(12,2),
  currency              TEXT NOT NULL DEFAULT 'MOP',
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dealer_service_items_dealer ON dealer_service_items(dealer_id, is_active);
CREATE INDEX IF NOT EXISTS idx_dealer_service_items_key ON dealer_service_items(service_item_type_key);

CREATE TABLE IF NOT EXISTS dealer_item_fitments (
  id                    TEXT PRIMARY KEY,
  dealer_service_item_id TEXT NOT NULL REFERENCES dealer_service_items(id) ON DELETE CASCADE,
  market                TEXT,
  make_norm             TEXT,
  model_norm            TEXT,
  year_from             INTEGER,
  year_to               INTEGER,
  variant_norm          TEXT,
  fuel_type_norm        TEXT,
  engine_code           TEXT,
  vin_prefix            TEXT,
  source_urls           JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dealer_fitments_item ON dealer_item_fitments(dealer_service_item_id);
CREATE INDEX IF NOT EXISTS idx_dealer_fitments_vehicle ON dealer_item_fitments(make_norm, model_norm, year_from, year_to);

CREATE TABLE IF NOT EXISTS dealer_service_packages (
  id          TEXT PRIMARY KEY,
  dealer_id   TEXT NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  price       NUMERIC(12,2),
  currency    TEXT NOT NULL DEFAULT 'MOP',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS dealer_package_items (
  package_id             TEXT NOT NULL REFERENCES dealer_service_packages(id) ON DELETE CASCADE,
  dealer_service_item_id TEXT NOT NULL REFERENCES dealer_service_items(id) ON DELETE CASCADE,
  PRIMARY KEY (package_id, dealer_service_item_id)
);

CREATE TABLE IF NOT EXISTS dealer_service_requests (
  id                    TEXT PRIMARY KEY,
  dealer_id             TEXT NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  branch_id             TEXT REFERENCES dealer_branches(id) ON DELETE SET NULL,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id            TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_item_type_key TEXT REFERENCES service_item_types(key),
  dealer_service_item_id TEXT REFERENCES dealer_service_items(id) ON DELETE SET NULL,
  package_id            TEXT REFERENCES dealer_service_packages(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'accepted', 'scheduled', 'completed', 'cancelled')),
  message               TEXT,
  scheduled_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dealer_requests_dealer_status ON dealer_service_requests(dealer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_requests_user ON dealer_service_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dealer_requests_vehicle ON dealer_service_requests(vehicle_id);

CREATE TABLE IF NOT EXISTS vehicle_item_matches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id            TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  dealer_id             TEXT NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  dealer_service_item_id TEXT NOT NULL REFERENCES dealer_service_items(id) ON DELETE CASCADE,
  match_score           INTEGER NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  match_level           TEXT NOT NULL CHECK (match_level IN ('exact', 'likely', 'review')),
  match_reason          JSONB NOT NULL DEFAULT '{}'::jsonb,
  algorithm_version     TEXT NOT NULL DEFAULT 'dealer-match-v1',
  calculated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vehicle_id, dealer_service_item_id)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_item_matches_vehicle ON vehicle_item_matches(vehicle_id, match_score DESC);
CREATE INDEX IF NOT EXISTS idx_vehicle_item_matches_dealer ON vehicle_item_matches(dealer_id, match_score DESC);

-- These tables are accessed through the authenticated server API. Keep RLS
-- enabled for direct Supabase access; the API additionally enforces custom JWT
-- ownership because this app does not use Supabase Auth JWTs.
ALTER TABLE dealers ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_item_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_service_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_item_fitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_service_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_package_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE dealer_service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_item_matches ENABLE ROW LEVEL SECURITY;

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
