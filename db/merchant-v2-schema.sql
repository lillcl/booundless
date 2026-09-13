-- Explicit branch offerings: no automatic claim that every branch provides a service.
CREATE TABLE IF NOT EXISTS dealer_branch_services (
  branch_id TEXT NOT NULL REFERENCES dealer_branches(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES dealer_service_items(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(branch_id,service_id)
);
CREATE INDEX IF NOT EXISTS dealer_branch_services_service ON dealer_branch_services(service_id) WHERE is_active;
ALTER TABLE dealer_branch_services ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON dealer_branch_services FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON dealer_branch_services FROM anon; END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON dealer_branch_services FROM authenticated; END IF;
END $$;
