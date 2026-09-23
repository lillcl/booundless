-- Additive first slice of the service-order workflow. Keep legacy requests readable.
ALTER TABLE dealer_service_requests
  ADD COLUMN IF NOT EXISTS workflow_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS accepted_quote_id UUID REFERENCES dealer_quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_service_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS completion_mileage_km INTEGER,
  ADD COLUMN IF NOT EXISTS completion_total_minor INTEGER,
  ADD COLUMN IF NOT EXISTS completion_performed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completion_notes TEXT,
  ADD COLUMN IF NOT EXISTS completed_by_user_id TEXT REFERENCES users(id);

ALTER TABLE service_history
  ADD COLUMN IF NOT EXISTS request_id TEXT REFERENCES dealer_service_requests(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_history_request_unique
  ON service_history(request_id) WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS service_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  quote_id UUID REFERENCES dealer_quotes(id) ON DELETE SET NULL,
  quote_line_index INTEGER NOT NULL CHECK (quote_line_index >= 0),
  description TEXT NOT NULL,
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  service_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(request_id,quote_line_index)
);
CREATE INDEX IF NOT EXISTS idx_service_order_lines_request ON service_order_lines(request_id);

CREATE TABLE IF NOT EXISTS service_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  items JSONB NOT NULL,
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by TEXT REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  decision_note TEXT,
  CHECK (jsonb_typeof(items) = 'array'),
  CHECK ((status = 'proposed' AND decided_at IS NULL AND decided_by IS NULL)
    OR (status <> 'proposed' AND decided_at IS NOT NULL AND decided_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_service_changes_request_status ON service_changes(request_id,status);
ALTER TABLE service_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON service_changes FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON service_changes FROM anon; END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON service_changes FROM authenticated; END IF;
END $$;

ALTER TABLE service_order_lines
  ALTER COLUMN quote_line_index DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS change_id UUID REFERENCES service_changes(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS change_line_index INTEGER CHECK (change_line_index >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_order_lines_change_line
  ON service_order_lines(change_id,change_line_index) WHERE change_id IS NOT NULL;
DO $$ BEGIN
  ALTER TABLE service_order_lines DROP CONSTRAINT IF EXISTS service_order_lines_origin_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE service_order_lines
  ADD CONSTRAINT service_order_lines_origin_check CHECK (
    (change_id IS NULL AND quote_id IS NOT NULL AND quote_line_index IS NOT NULL AND change_line_index IS NULL)
    OR (change_id IS NOT NULL AND quote_id IS NULL AND quote_line_index IS NULL AND change_line_index IS NOT NULL)
  );
ALTER TABLE service_order_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON service_order_lines FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON service_order_lines FROM anon; END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON service_order_lines FROM authenticated; END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trips_owner_date
  ON trips(created_by_user_id, start_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_history_owner_recent
  ON service_history(vehicle_id, performed_at DESC)
  WHERE voided_at IS NULL;

-- ── Slice 2: T1 full schema (service_mvp_v2) ─────────────────────────────────
-- Adds: order_number sequence, service_offers, booking_slots/bookings,
-- inspection_reports/results, service_changes (extended), service_attachments,
-- service_completions/lines, service_cases, notifications,
-- dealer_commercial_terms, commission_entries, service_payment_events,
-- request_actions (idempotency), extensions to service_order_lines / reminders.
-- All tables RLS-enabled + revoked from anon/authenticated (server-only).
-- Idempotent: each statement uses IF NOT EXISTS / DO blocks so reruns are safe.

CREATE SEQUENCE IF NOT EXISTS service_order_number_seq;

-- service_changes extensions (status includes withdrawn, more fields)
ALTER TABLE service_changes
  ADD COLUMN IF NOT EXISTS quote_lines JSONB,
  ADD COLUMN IF NOT EXISTS proposed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
DO $$ BEGIN
  ALTER TABLE service_changes DROP CONSTRAINT IF EXISTS service_changes_status_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE service_changes
  ADD CONSTRAINT service_changes_status_check
  CHECK (status IN ('draft','proposed','approved','rejected','withdrawn'));
ALTER TABLE service_changes
  ALTER COLUMN quote_lines DROP NOT NULL;

-- service_order_lines extensions (v2 quote_line schema)
ALTER TABLE service_order_lines
  ADD COLUMN IF NOT EXISTS quote_line_id UUID,
  ADD COLUMN IF NOT EXISTS work_type TEXT,
  ADD COLUMN IF NOT EXISTS quantity INTEGER,
  ADD COLUMN IF NOT EXISTS parts_brand TEXT,
  ADD COLUMN IF NOT EXISTS parts_spec TEXT,
  ADD COLUMN IF NOT EXISTS part_number TEXT,
  ADD COLUMN IF NOT EXISTS parts_unit_minor INTEGER,
  ADD COLUMN IF NOT EXISTS labour_minor INTEGER,
  ADD COLUMN IF NOT EXISTS warranty_text TEXT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS execution_state TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS not_performed_reason TEXT;
DO $$ BEGIN
  ALTER TABLE service_order_lines DROP CONSTRAINT IF EXISTS service_order_lines_work_type_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE service_order_lines
  ADD CONSTRAINT service_order_lines_work_type_check
  CHECK (work_type IS NULL OR work_type IN ('inspect','replace','repair','service'));
DO $$ BEGIN
  ALTER TABLE service_order_lines DROP CONSTRAINT IF EXISTS service_order_lines_execution_state_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE service_order_lines
  ADD CONSTRAINT service_order_lines_execution_state_check
  CHECK (execution_state IN ('pending','completed','not_performed'));
DO $$ BEGIN
  ALTER TABLE service_order_lines DROP CONSTRAINT IF EXISTS service_order_lines_money_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE service_order_lines
  ADD CONSTRAINT service_order_lines_money_check
  CHECK (amount_minor >= 0 AND COALESCE(parts_unit_minor,0) >= 0 AND COALESCE(labour_minor,0) >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_order_lines_request_quote_line
  ON service_order_lines(request_id, quote_id, quote_line_id)
  WHERE quote_line_id IS NOT NULL;

-- service_history extensions
ALTER TABLE service_history
  ADD COLUMN IF NOT EXISTS completion_id TEXT,
  ADD COLUMN IF NOT EXISTS record_type TEXT NOT NULL DEFAULT 'maintenance',
  ADD COLUMN IF NOT EXISTS structured_total_minor INTEGER,
  ADD COLUMN IF NOT EXISTS currency TEXT;
DO $$ BEGIN
  ALTER TABLE service_history DROP CONSTRAINT IF EXISTS service_history_record_type_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE service_history
  ADD CONSTRAINT service_history_record_type_check
  CHECK (record_type IN ('maintenance','inspection'));
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_history_completion_unique
  ON service_history(completion_id) WHERE completion_id IS NOT NULL;

-- reminders extensions
ALTER TABLE reminders
  ADD COLUMN IF NOT EXISTS service_key TEXT,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS due_mileage_km INTEGER,
  ADD COLUMN IF NOT EXISTS source_completion_id TEXT,
  ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_dedup
  ON reminders(vehicle_id, COALESCE(service_key,''), COALESCE(source_completion_id,''))
  WHERE service_key IS NOT NULL;

-- dealers / dealer_branches extensions (pilot + timezone)
ALTER TABLE dealers
  ADD COLUMN IF NOT EXISTS pilot_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dealer_branches
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Macau';

-- service_offers
CREATE TABLE IF NOT EXISTS service_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id TEXT NOT NULL REFERENCES dealers(id) ON DELETE RESTRICT,
  branch_id TEXT REFERENCES dealer_branches(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('baseline','maintenance','second_opinion')),
  name VARCHAR(120) NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK (length(description) <= 2000),
  currency VARCHAR(8) NOT NULL DEFAULT 'MOP',
  price_minor BIGINT CHECK (price_minor IS NULL OR price_minor >= 0),
  pricing_mode TEXT NOT NULL CHECK (pricing_mode IN ('fixed','quote_required')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes BETWEEN 15 AND 480),
  checklist_version TEXT,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kind <> 'baseline' OR checklist_version IS NOT NULL),
  CHECK (kind <> 'second_opinion' OR checklist_version IS NOT NULL),
  CHECK (pricing_mode <> 'fixed' OR price_minor IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_service_offers_active ON service_offers(dealer_id, kind, active);

-- service_offer_items (link to dealer_service_items / branch services / fitments)
CREATE TABLE IF NOT EXISTS service_offer_items (
  offer_id UUID NOT NULL REFERENCES service_offers(id) ON DELETE CASCADE,
  dealer_service_item_id TEXT NOT NULL,
  PRIMARY KEY (offer_id, dealer_service_item_id)
);

-- booking_slots
CREATE TABLE IF NOT EXISTS booking_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id TEXT NOT NULL REFERENCES dealer_branches(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity BETWEEN 1 AND 20),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_booking_slots_branch_starts ON booking_slots(branch_id, starts_at);

-- service_bookings
CREATE TABLE IF NOT EXISTS service_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES booking_slots(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled')),
  booked_by TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ
);
-- Per spec: at most one confirmed booking per request (partial unique)
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_bookings_one_confirmed
  ON service_bookings(request_id) WHERE status = 'confirmed';

-- inspection_reports
CREATE TABLE IF NOT EXISTS inspection_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL,
  template_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','published')),
  revision INTEGER NOT NULL DEFAULT 1,
  vehicle_snapshot JSONB,
  mileage_km INTEGER CHECK (mileage_km IS NULL OR mileage_km BETWEEN 0 AND 10000000),
  inspected_by TEXT NOT NULL REFERENCES users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  summary TEXT CHECK (summary IS NULL OR length(summary) <= 3000),
  customer_question TEXT CHECK (customer_question IS NULL OR length(customer_question) <= 2000),
  previous_quote_attachment_id UUID,
  published_at TIMESTAMPTZ,
  supersedes_report_id UUID REFERENCES inspection_reports(id) ON DELETE SET NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(request_id, revision)
);
CREATE INDEX IF NOT EXISTS idx_inspection_reports_request ON inspection_reports(request_id);

-- inspection_results
CREATE TABLE IF NOT EXISTS inspection_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES inspection_reports(id) ON DELETE CASCADE,
  check_key TEXT NOT NULL,
  service_keys TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  result TEXT NOT NULL CHECK (result IN ('unknown','normal','recommended','urgent','not_applicable')),
  measurement_value NUMERIC,
  measurement_unit TEXT CHECK (measurement_unit IS NULL OR measurement_unit IN ('mm','percent','other')),
  measurement_method TEXT,
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  recommended_action TEXT CHECK (recommended_action IS NULL OR length(recommended_action) <= 1000),
  next_due_km INTEGER CHECK (next_due_km IS NULL OR next_due_km >= 0),
  next_due_date DATE,
  UNIQUE(report_id, check_key)
);
CREATE INDEX IF NOT EXISTS idx_inspection_results_keys ON inspection_results USING GIN(service_keys);

-- service_completions
CREATE TABLE IF NOT EXISTS service_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('draft','submitted','confirmed','disputed')),
  mileage_km INTEGER NOT NULL CHECK (mileage_km BETWEEN 0 AND 10000000),
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER,
  technician_name TEXT NOT NULL CHECK (length(technician_name) BETWEEN 1 AND 200),
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 3000),
  final_total_minor BIGINT NOT NULL CHECK (final_total_minor >= 0),
  submitted_by TEXT NOT NULL REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  confirmed_by TEXT REFERENCES users(id),
  confirmed_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (finished_at >= started_at),
  UNIQUE(request_id, revision)
);
-- At most one active (non-cancelled) completion per request — enforced via app code
CREATE INDEX IF NOT EXISTS idx_service_completions_request ON service_completions(request_id);

-- service_completion_lines
CREATE TABLE IF NOT EXISTS service_completion_lines (
  completion_id UUID NOT NULL REFERENCES service_completions(id) ON DELETE CASCADE,
  order_line_id UUID NOT NULL REFERENCES service_order_lines(id) ON DELETE RESTRICT,
  outcome TEXT NOT NULL CHECK (outcome IN ('completed','not_performed')),
  actual_parts_brand TEXT,
  actual_parts_spec TEXT,
  actual_part_number TEXT,
  notes TEXT CHECK (notes IS NULL OR length(notes) <= 2000),
  next_due_km INTEGER CHECK (next_due_km IS NULL OR next_due_km >= 0),
  next_due_date DATE,
  not_performed_reason TEXT CHECK (not_performed_reason IS NULL OR length(not_performed_reason) <= 1000),
  PRIMARY KEY (completion_id, order_line_id)
);

-- service_attachments
CREATE TABLE IF NOT EXISTS service_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp')),
  size_bytes BIGINT NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256 TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('before','after','inspection','previous_quote','receipt')),
  inspection_result_id UUID REFERENCES inspection_results(id) ON DELETE SET NULL,
  order_line_id UUID REFERENCES service_order_lines(id) ON DELETE SET NULL,
  upload_state TEXT NOT NULL DEFAULT 'pending' CHECK (upload_state IN ('pending','ready','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_attachments_request ON service_attachments(request_id);

-- service_cases
CREATE TABLE IF NOT EXISTS service_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  opened_by TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('workmanship','warranty','billing','other')),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 3000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_review','resolved','closed')),
  assigned_dealer_id TEXT REFERENCES dealers(id),
  resolution TEXT,
  resolved_by TEXT REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_service_cases_request ON service_cases(request_id);

-- notifications
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, event_id, type)
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

-- dealer_commercial_terms
CREATE TABLE IF NOT EXISTS dealer_commercial_terms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dealer_id TEXT NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  commission_bps INTEGER NOT NULL DEFAULT 0 CHECK (commission_bps BETWEEN 0 AND 10000),
  free_completed_orders INTEGER NOT NULL DEFAULT 0 CHECK (free_completed_orders >= 0),
  accepted_by TEXT REFERENCES users(id),
  accepted_at TIMESTAMPTZ,
  created_by TEXT NOT NULL REFERENCES users(id),
  UNIQUE(dealer_id, version)
);

-- commission_entries
CREATE TABLE IF NOT EXISTS commission_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  completion_id UUID REFERENCES service_completions(id) ON DELETE SET NULL,
  dealer_id TEXT NOT NULL REFERENCES dealers(id) ON DELETE CASCADE,
  terms_id UUID REFERENCES dealer_commercial_terms(id) ON DELETE SET NULL,
  origin TEXT NOT NULL CHECK (origin IN ('platform_new','dealer_existing','unknown')),
  basis_minor BIGINT NOT NULL CHECK (basis_minor >= 0),
  rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  commission_minor BIGINT NOT NULL CHECK (commission_minor >= 0),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('accrual','reversal')),
  reverses_entry_id UUID REFERENCES commission_entries(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','settled','waived')),
  settled_at TIMESTAMPTZ,
  settlement_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Per spec: at most one accrual per completion
  CONSTRAINT commission_entries_one_accrual_per_completion
    EXCLUDE (completion_id WITH =) WHERE (entry_type = 'accrual' AND completion_id IS NOT NULL)
);

-- service_payment_events (idempotent ledger)
CREATE TABLE IF NOT EXISTS service_payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('payment','refund')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency VARCHAR(8) NOT NULL DEFAULT 'MOP',
  reference TEXT,
  actor_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL UNIQUE
);

-- request_actions (idempotency log per spec §6)
CREATE TABLE IF NOT EXISTS request_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL REFERENCES dealer_service_requests(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response JSONB,
  status_code INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(actor_id, request_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_request_actions_request ON request_actions(request_id);

-- dealer_service_requests extra columns (contact / snapshots / payment state)
ALTER TABLE dealer_service_requests
  ADD COLUMN IF NOT EXISTS order_number TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS offer_id UUID REFERENCES service_offers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS service_kind TEXT,
  ADD COLUMN IF NOT EXISTS parent_request_id TEXT REFERENCES dealer_service_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS customer_note TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS offer_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS terms_version TEXT,
  ADD COLUMN IF NOT EXISTS consented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_origin TEXT,
  ADD COLUMN IF NOT EXISTS origin_evidence JSONB,
  ADD COLUMN IF NOT EXISTS origin_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS work_state TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS currency VARCHAR(8),
  ADD COLUMN IF NOT EXISTS approved_total_minor BIGINT,
  ADD COLUMN IF NOT EXISTS final_total_minor BIGINT,
  ADD COLUMN IF NOT EXISTS payment_state TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_recorded_by TEXT REFERENCES users(id);
DO $$ BEGIN
  ALTER TABLE dealer_service_requests DROP CONSTRAINT IF EXISTS dealer_service_requests_work_state_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE dealer_service_requests
  ADD CONSTRAINT dealer_service_requests_work_state_check
  CHECK (work_state IS NULL OR work_state IN ('not_started','in_progress','awaiting_approval','completion_submitted'));
DO $$ BEGIN
  ALTER TABLE dealer_service_requests DROP CONSTRAINT IF EXISTS dealer_service_requests_payment_state_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE dealer_service_requests
  ADD CONSTRAINT dealer_service_requests_payment_state_check
  CHECK (payment_state IN ('unpaid','paid','partially_refunded','refunded'));
DO $$ BEGIN
  ALTER TABLE dealer_service_requests DROP CONSTRAINT IF EXISTS dealer_service_requests_service_kind_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE dealer_service_requests
  ADD CONSTRAINT dealer_service_requests_service_kind_check
  CHECK (service_kind IS NULL OR service_kind IN ('baseline','maintenance','second_opinion'));
DO $$ BEGIN
  ALTER TABLE dealer_service_requests DROP CONSTRAINT IF EXISTS dealer_service_requests_customer_origin_check;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
ALTER TABLE dealer_service_requests
  ADD CONSTRAINT dealer_service_requests_customer_origin_check
  CHECK (customer_origin IS NULL OR customer_origin IN ('platform_new','dealer_existing','unknown'));
CREATE INDEX IF NOT EXISTS idx_service_requests_order_number ON dealer_service_requests(order_number);

-- RLS + revoke for all v2 tables (server-only access)
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'service_offers','service_offer_items',
    'booking_slots','service_bookings',
    'inspection_reports','inspection_results',
    'service_completions','service_completion_lines',
    'service_attachments','service_cases',
    'notifications','dealer_commercial_terms',
    'commission_entries','service_payment_events',
    'request_actions'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon', t); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated', t); END IF;
  END LOOP;
END $$;
