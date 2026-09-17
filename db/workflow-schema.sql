-- Additive workflow migration, applied after merchant and marketing schemas.
ALTER TABLE dealer_service_items ADD COLUMN IF NOT EXISTS compatibility_mode TEXT NOT NULL DEFAULT 'unverified' CHECK(compatibility_mode IN ('unverified','restricted','universal'));
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_class TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS powertrain_type TEXT;
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_vehicle_class_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_vehicle_class_check CHECK(vehicle_class IS NULL OR vehicle_class IN ('light_passenger','light_goods','heavy_passenger','heavy_goods','light_motorcycle','heavy_motorcycle'));
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_powertrain_type_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_powertrain_type_check CHECK(powertrain_type IS NULL OR powertrain_type IN ('fuel','ev','hybrid'));
ALTER TABLE marketing_pages DROP CONSTRAINT IF EXISTS marketing_pages_path_check;
ALTER TABLE marketing_pages ADD CONSTRAINT marketing_pages_path_check CHECK(path IN ('/','/demo') OR path ~ '^/campaigns/[a-z0-9]+(-[a-z0-9]+)*$');
CREATE TABLE IF NOT EXISTS marketing_integrations (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id),
  config JSONB NOT NULL DEFAULT '{"enabled":false}',
  version INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO marketing_integrations(id) VALUES(TRUE) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS conversion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL CHECK(event_name IN ('vehicle_created','service_request_submitted','booking_confirmed')),
  business_id TEXT NOT NULL,
  campaign TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_name,business_id)
);
ALTER TABLE dealer_service_requests ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE dealer_service_requests ADD COLUMN IF NOT EXISTS completion_confirmed_at TIMESTAMPTZ;
ALTER TABLE dealer_service_requests ADD COLUMN IF NOT EXISTS request_key TEXT;
ALTER TABLE dealer_service_requests ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS dealer_request_idempotency ON dealer_service_requests(user_id,request_key) WHERE request_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS dealer_request_items (
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES dealer_service_items(id),
  service_key TEXT NOT NULL REFERENCES service_item_types(key),
  name TEXT NOT NULL,
  PRIMARY KEY(request_id,service_id)
);
CREATE TABLE IF NOT EXISTS vehicle_needs (
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  service_key TEXT NOT NULL REFERENCES service_item_types(key),
  state TEXT NOT NULL CHECK(state IN ('confirmed','dismissed','resolved')),
  urgency TEXT NOT NULL CHECK(urgency IN ('routine','soon','urgent')),
  source TEXT NOT NULL DEFAULT 'owner',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(vehicle_id,service_key)
);
ALTER TABLE dealer_service_requests DROP CONSTRAINT IF EXISTS dealer_service_requests_status_check;
ALTER TABLE dealer_service_requests ADD CONSTRAINT dealer_service_requests_status_check CHECK(status IN ('new','quoted','accepted','scheduled','completed','cancelled','declined'));
CREATE TABLE IF NOT EXISTS dealer_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id),
  version INTEGER NOT NULL,
  currency TEXT NOT NULL CHECK(currency IN ('MOP','HKD','CNY')),
  items JSONB NOT NULL,
  total_minor INTEGER NOT NULL CHECK(total_minor>=0),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(request_id,version)
);
CREATE TABLE IF NOT EXISTS dealer_request_events (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE dealer_invites ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'not_sent';
ALTER TABLE dealer_invites ADD COLUMN IF NOT EXISTS delivery_id TEXT;
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_integrations','conversion_events','dealer_quotes','dealer_request_events','dealer_request_items','vehicle_needs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
    IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',t); END IF;
    IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',t); END IF;
  END LOOP;
END $$;
