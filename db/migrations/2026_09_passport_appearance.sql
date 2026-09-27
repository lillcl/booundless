ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS passport_name VARCHAR(80);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS passport_color TEXT CHECK (passport_color IN ('blue', 'green', 'burgundy', 'purple'));
