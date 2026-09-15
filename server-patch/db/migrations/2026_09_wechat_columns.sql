-- 2026_09_wechat_columns.sql
-- Additive migration for WeChat Mini Program (小程序) login.
-- Run on your Postgres database after this commit is deployed.

ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_openid text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_unionid text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS wechat_appid text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;

-- Partial unique index for wechat_openid (skip if exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_users_wechat_openid_unique'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX idx_users_wechat_openid_unique ON users (wechat_openid) WHERE wechat_openid IS NOT NULL';
  END IF;
END
$$;

-- Look-up index for unionid (multiple apps may share a union id)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_users_wechat_unionid'
  ) THEN
    EXECUTE 'CREATE INDEX idx_users_wechat_unionid ON users (wechat_unionid) WHERE wechat_unionid IS NOT NULL';
  END IF;
END
$$;