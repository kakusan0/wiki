-- 店舗
CREATE TABLE stores (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  -- 適格請求書発行事業者の登録番号（T + 13桁）。未登録なら NULL
  invoice_number  TEXT,
  last_pickup_no  INTEGER NOT NULL DEFAULT 0
);

-- 商品（price は税込・円）
CREATE TABLE products (
  id        TEXT PRIMARY KEY,
  store_id  TEXT NOT NULL REFERENCES stores(id),
  name      TEXT NOT NULL,
  price     INTEGER NOT NULL CHECK (price > 0),
  tax_rate  INTEGER NOT NULL CHECK (tax_rate IN (8, 10)),
  available INTEGER NOT NULL DEFAULT 1,
  sort      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_products_store ON products(store_id, sort);

-- 注文。氏名・連絡先・カード情報は保持しない
CREATE TABLE orders (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL REFERENCES stores(id),
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'handed_over', 'refunded')),
  total             INTEGER NOT NULL,
  payment_intent_id TEXT,
  pickup_no         INTEGER,
  created_at        TEXT NOT NULL,
  paid_at           TEXT,
  handed_over_at    TEXT,
  refunded_at       TEXT
);
CREATE INDEX idx_orders_store_status ON orders(store_id, status, paid_at);

-- 注文明細（注文時点の商品名・価格・税率を記録）
CREATE TABLE order_items (
  order_id   TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  tax_rate   INTEGER NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
