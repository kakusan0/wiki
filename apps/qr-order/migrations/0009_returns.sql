-- 返品・交換の申請（商品の不良・誤りなど）。写真は端末で縮小した JPEG を base64 で保存する
CREATE TABLE returns (
  id                TEXT PRIMARY KEY,
  order_id          TEXT NOT NULL REFERENCES orders(id),
  store_id          TEXT NOT NULL,
  code              TEXT NOT NULL,                 -- スタッフと話すときの短い番号（例: R7KQ）
  reason            TEXT NOT NULL CHECK (reason IN ('defect', 'wrong_item', 'expired', 'other')),
  detail            TEXT NOT NULL,                 -- お客様の説明
  wanted            TEXT NOT NULL CHECK (wanted IN ('refund', 'exchange')),
  status            TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'completed', 'rejected')),
  resolution        TEXT CHECK (resolution IN ('refund', 'exchange')),  -- 店舗が決めた対応
  refund_amount     INTEGER NOT NULL DEFAULT 0,
  staff_note        TEXT,                          -- お客様の画面に表示するメッセージ
  decided_by        TEXT,
  decided_at        TEXT,
  completed_at      TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX idx_returns_order ON returns(order_id);
CREATE INDEX idx_returns_store ON returns(store_id, status, created_at);

CREATE TABLE return_items (
  return_id  TEXT NOT NULL REFERENCES returns(id),
  product_id TEXT NOT NULL,
  name       TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  qty        INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX idx_return_items_return ON return_items(return_id);

CREATE TABLE return_photos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id  TEXT NOT NULL REFERENCES returns(id),
  kind       TEXT NOT NULL CHECK (kind IN ('whole', 'defect', 'label', 'other')),
  data       TEXT NOT NULL,                        -- base64 の JPEG
  created_at TEXT NOT NULL
);
CREATE INDEX idx_return_photos_return ON return_photos(return_id);
