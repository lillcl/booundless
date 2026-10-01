-- Server-only quota and idempotency state. Never exposed through the Data API.
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS app_private.agent_usage_days (
  usage_key TEXT NOT NULL,
  usage_day DATE NOT NULL,
  questions INTEGER NOT NULL DEFAULT 0 CHECK (questions >= 0),
  tokens_used BIGINT NOT NULL DEFAULT 0 CHECK (tokens_used >= 0),
  tokens_reserved BIGINT NOT NULL DEFAULT 0 CHECK (tokens_reserved >= 0),
  PRIMARY KEY (usage_key, usage_day)
);

CREATE TABLE IF NOT EXISTS app_private.agent_requests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('question', 'confirmation')),
  usage_day DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  reserved_tokens INTEGER NOT NULL DEFAULT 0,
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_requests_active
  ON app_private.agent_requests(lease_expires_at) WHERE status='processing';
ALTER TABLE app_private.agent_usage_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.agent_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON SCHEMA app_private FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON SCHEMA app_private FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA app_private FROM authenticated;
  END IF;
END $$;

ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS scope_decision JSONB;
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
