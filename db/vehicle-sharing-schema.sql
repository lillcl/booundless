-- Vehicle-owner maintenance records and per-vehicle dealer access.

CREATE TABLE IF NOT EXISTS vehicle_dealer_grants (
  id                            TEXT PRIMARY KEY,
  vehicle_id                    TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  dealer_id                     TEXT NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  granted_by_user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_view_vehicle              BOOLEAN NOT NULL DEFAULT TRUE,
  can_manage_service_records    BOOLEAN NOT NULL DEFAULT TRUE,
  can_update_maintenance_status BOOLEAN NOT NULL DEFAULT TRUE,
  granted_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                    TIMESTAMPTZ,
  revoked_at                    TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vehicle_id, dealer_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_dealer_grants_dealer_active
  ON vehicle_dealer_grants(dealer_id, vehicle_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_dealer_grants_vehicle_active
  ON vehicle_dealer_grants(vehicle_id, dealer_id)
  WHERE revoked_at IS NULL;

ALTER TABLE service_history
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'owner_manual',
  ADD COLUMN IF NOT EXISTS dealer_id TEXT REFERENCES dealers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS branch_id TEXT REFERENCES dealer_branches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;

ALTER TABLE vehicle_status
  ADD COLUMN IF NOT EXISTS last_service_history_id TEXT REFERENCES service_history(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by_dealer_id TEXT REFERENCES dealers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_service_history_vehicle_active_date
  ON service_history(vehicle_id, performed_at DESC)
  WHERE voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_history_dealer
  ON service_history(dealer_id, vehicle_id)
  WHERE dealer_id IS NOT NULL AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_service_history_service_keys
  ON service_history USING GIN(service_keys);

-- These tables are accessed through server-side handlers using the database
-- connection. Do not expose them through Supabase's browser-facing Data API.
ALTER TABLE vehicle_dealer_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vehicle_dealer_grants FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON vehicle_dealer_grants FROM anon;
    REVOKE ALL ON service_history FROM anon;
  END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON vehicle_dealer_grants FROM authenticated;
    REVOKE ALL ON service_history FROM authenticated;
  END IF;
END $$;
