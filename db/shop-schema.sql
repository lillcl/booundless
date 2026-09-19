-- BOOUNDLESS shop: catalogue, carts, orders, inventory and status history.
-- The browser never connects to these tables directly; authenticated server
-- handlers enforce ownership and admin access. RLS + revoked client grants are
-- retained as defense in depth for Supabase's exposed public schema.

CREATE TABLE IF NOT EXISTS shop_products (
  id                    TEXT PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  short_description     TEXT NOT NULL DEFAULT '',
  description           TEXT NOT NULL DEFAULT '',
  category              TEXT NOT NULL,
  service_item_type_key TEXT REFERENCES service_item_types(key),
  primary_image_url     TEXT NOT NULL,
  primary_image_alt     TEXT NOT NULL DEFAULT '',
  image_position        TEXT NOT NULL DEFAULT '0% 0%',
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured           BOOLEAN NOT NULL DEFAULT FALSE,
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  vehicle_types         TEXT[] NOT NULL DEFAULT '{}',
  powertrains           TEXT[] NOT NULL DEFAULT '{}',
  compatible_makes      TEXT[] NOT NULL DEFAULT '{}',
  compatible_models     TEXT[] NOT NULL DEFAULT '{}',
  compatible_years      INTEGER[] NOT NULL DEFAULT '{}',
  specifications        TEXT[] NOT NULL DEFAULT '{}',
  use_cases             TEXT[] NOT NULL DEFAULT '{}',
  version               INTEGER NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS vehicle_types TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS powertrains TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS compatible_makes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS compatible_models TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS compatible_years INTEGER[] NOT NULL DEFAULT '{}';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS specifications TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS use_cases TEXT[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS shop_product_variants (
  id                  TEXT PRIMARY KEY,
  product_id          TEXT NOT NULL REFERENCES shop_products(id) ON DELETE CASCADE,
  sku                 TEXT NOT NULL UNIQUE,
  variant_name        TEXT NOT NULL,
  attributes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  price_minor         INTEGER NOT NULL CHECK (price_minor >= 0),
  currency            TEXT NOT NULL DEFAULT 'MOP',
  stock_quantity      INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_threshold INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_threshold >= 0),
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  version             INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_products_active_category ON shop_products(is_active, category);
CREATE INDEX IF NOT EXISTS idx_shop_products_tags_gin ON shop_products USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_shop_products_powertrains_gin ON shop_products USING GIN(powertrains);
CREATE INDEX IF NOT EXISTS idx_shop_products_specs_gin ON shop_products USING GIN(specifications);
CREATE INDEX IF NOT EXISTS idx_shop_variants_product_active ON shop_product_variants(product_id, is_active);
CREATE INDEX IF NOT EXISTS idx_shop_variants_low_stock ON shop_product_variants(stock_quantity, low_stock_threshold);

CREATE TABLE IF NOT EXISTS shop_carts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'converted', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_one_active_cart ON shop_carts(user_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS shop_cart_items (
  cart_id    UUID NOT NULL REFERENCES shop_carts(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES shop_product_variants(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (cart_id, variant_id)
);

CREATE TABLE IF NOT EXISTS shop_orders (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number       TEXT NOT NULL UNIQUE,
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','packing','ready','completed','cancelled')),
  fulfillment_method TEXT NOT NULL CHECK (fulfillment_method IN ('pickup','delivery')),
  customer_name      TEXT NOT NULL,
  phone              TEXT NOT NULL,
  delivery_address   TEXT,
  notes              TEXT,
  currency           TEXT NOT NULL DEFAULT 'MOP',
  subtotal_minor     INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  delivery_minor     INTEGER NOT NULL DEFAULT 0 CHECK (delivery_minor >= 0),
  total_minor        INTEGER NOT NULL CHECK (total_minor >= 0),
  idempotency_key    TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_shop_orders_user_created ON shop_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_orders_status_created ON shop_orders(status, created_at DESC);

CREATE TABLE IF NOT EXISTS shop_order_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id              UUID NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  product_id            TEXT REFERENCES shop_products(id) ON DELETE SET NULL,
  variant_id            TEXT REFERENCES shop_product_variants(id) ON DELETE SET NULL,
  product_name          TEXT NOT NULL,
  variant_name          TEXT NOT NULL,
  sku                   TEXT NOT NULL,
  image_url             TEXT,
  image_alt             TEXT,
  image_position        TEXT NOT NULL DEFAULT '0% 0%',
  service_item_type_key TEXT,
  unit_price_minor      INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  quantity              INTEGER NOT NULL CHECK (quantity > 0),
  line_total_minor      INTEGER NOT NULL CHECK (line_total_minor >= 0)
);
CREATE INDEX IF NOT EXISTS idx_shop_order_items_order ON shop_order_items(order_id);

CREATE TABLE IF NOT EXISTS shop_order_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_order_events_order ON shop_order_events(order_id, created_at);

CREATE TABLE IF NOT EXISTS shop_inventory_movements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    TEXT NOT NULL REFERENCES shop_product_variants(id) ON DELETE RESTRICT,
  order_id      UUID REFERENCES shop_orders(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  quantity_delta INTEGER NOT NULL CHECK (quantity_delta <> 0),
  reason        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shop_inventory_variant_created ON shop_inventory_movements(variant_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'shop_products','shop_product_variants','shop_carts','shop_cart_items',
    'shop_orders','shop_order_items','shop_order_events','shop_inventory_movements'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', t);
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;

INSERT INTO shop_products
  (id,slug,name,short_description,description,category,service_item_type_key,primary_image_url,primary_image_alt,image_position,is_featured)
VALUES
  ('prod-oil-0w20','synthetic-oil-0w20','0W-20 全合成混能車機油','低黏度配方，適合多款日系混能及新世代引擎。','著重冷車流動性與日常走走停停的保護表現。購買前請以車主手冊指定黏度及認證為準。','機油','engine_oil','/assets/shop-product-collection-v1.png','深藍色機油容器','0% 0%',TRUE),
  ('prod-oil-5w30','synthetic-oil-5w30','5W-30 全合成機油','均衡耐熱與清潔表現，適合廣泛日常用車。','適合需要 5W-30 黏度的汽油引擎。不同年份與引擎要求不同，請先核對車主手冊。','機油','engine_oil','/assets/shop-product-collection-v1.png','深藍色機油容器','0% 0%',FALSE),
  ('prod-filter','premium-oil-filter','高效機油隔','穩定過濾引擎油路雜質，保持機油循環潔淨。','規格需按車款及引擎配對。下單後可在備註填寫車款年份，方便確認。','濾芯','oil_filter','/assets/shop-product-collection-v1.png','白色圓筒機油隔','100% 0%',TRUE),
  ('prod-coolant','long-life-coolant','長效冷卻液','預混長效配方，協助維持引擎正常工作溫度。','請勿混合不相容規格。更換或補充前，應先確認原車冷卻液類型。','油液','coolant','/assets/shop-product-collection-v1.png','透明瓶裝青綠色冷卻液','0% 100%',FALSE),
  ('prod-care','car-care-kit','車身清潔護理套裝','日常清潔所需的噴霧、海綿與超細纖維布。','適合車身與內飾日常清潔。先在不顯眼位置測試，再按表面材質使用。','護理',NULL,'/assets/shop-product-collection-v1.png','清潔噴霧、海綿與超細纖維布套裝','100% 100%',TRUE)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO shop_product_variants
  (id,product_id,sku,variant_name,attributes,price_minor,stock_quantity,low_stock_threshold)
VALUES
  ('var-oil-0w20-4l','prod-oil-0w20','OIL-0W20-4L','4L','{"viscosity":"0W-20","volume":"4L"}',39800,18,5),
  ('var-oil-5w30-4l','prod-oil-5w30','OIL-5W30-4L','4L','{"viscosity":"5W-30","volume":"4L"}',36800,15,5),
  ('var-filter-standard','prod-filter','FILTER-STANDARD','標準款','{"type":"spin-on"}',8800,28,8),
  ('var-coolant-4l','prod-coolant','COOLANT-4L','4L','{"volume":"4L","type":"pre-mixed"}',16800,12,4),
  ('var-care-kit','prod-care','CARE-KIT-01','完整套裝','{"pieces":3}',22800,10,3)
ON CONFLICT (sku) DO NOTHING;
