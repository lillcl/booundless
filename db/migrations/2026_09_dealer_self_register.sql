-- Dealer self-registration refactor (Phase 7).
-- Idempotent. Runs after schema.sql. Safe on cold start (schema.sql's
-- CREATE TABLE IF NOT EXISTS for dealer_invites is followed by this DROP,
-- leaving no table behind).

-- 1. Persist the terms_version that POST /api/auth/register accepts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version TEXT;

-- 2. Drop the now-obsolete invite-token table. All invite flow code paths
-- (admin/dealers/:id/invites, dealer/invites/accept, dealer/invites/register)
-- are removed in the same Phase 7 backend refactor.
DROP TABLE IF EXISTS dealer_invites CASCADE;