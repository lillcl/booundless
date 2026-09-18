-- Additive migration: tag every vehicle_status row with the source that
-- inserted it (template seed vs AI suggestion). Existing rows backfill to
-- 'template' so reads of legacy data are not ambiguous.
ALTER TABLE vehicle_status
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'template'
    CHECK (source IN ('template', 'ai'));
CREATE INDEX IF NOT EXISTS idx_vehicle_status_source ON vehicle_status(source);
