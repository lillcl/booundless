-- Idempotent additive migration. Apply with the existing schema bootstrap.
CREATE TABLE IF NOT EXISTS marketing_pages (
  path TEXT PRIMARY KEY CHECK(path IN ('/', '/demo')),
  draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  published JSONB,
  version INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS marketing_revisions (
  id BIGSERIAL PRIMARY KEY,
  page_path TEXT NOT NULL REFERENCES marketing_pages(path),
  content JSONB NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS marketing_revision_page ON marketing_revisions(page_path,id DESC);
ALTER TABLE marketing_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON marketing_pages, marketing_revisions FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON marketing_pages,marketing_revisions FROM anon; END IF;
  IF EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON marketing_pages,marketing_revisions FROM authenticated; END IF;
END $$;
INSERT INTO marketing_pages(path) VALUES ('/'),('/demo') ON CONFLICT DO NOTHING;
