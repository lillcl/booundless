-- Cross-border permit details belong to the vehicle passport, not the trip log.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cross_border_permit TEXT;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS cross_border_renewal_date DATE;

ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_cross_border_permit_check;
ALTER TABLE vehicles ADD CONSTRAINT vehicles_cross_border_permit_check
  CHECK (cross_border_permit IS NULL OR cross_border_permit IN ('澳車北上','橫琴單牌車','兩者皆有','沒有'));
