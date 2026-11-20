-- 年齢確認が必要な商品
ALTER TABLE products ADD COLUMN age_restricted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_items ADD COLUMN age_restricted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN age_check_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN age_checked_at TEXT;
ALTER TABLE orders ADD COLUMN age_checked_by TEXT;

-- 誰が受け渡したか
ALTER TABLE orders ADD COLUMN handed_over_by TEXT;

-- 一部返金（返金済みの合計額）
ALTER TABLE orders ADD COLUMN refunded_amount INTEGER NOT NULL DEFAULT 0;
UPDATE orders SET refunded_amount = total WHERE status = 'refunded';

CREATE TABLE refunds (
  id         TEXT PRIMARY KEY,
  order_id   TEXT NOT NULL REFERENCES orders(id),
  amount     INTEGER NOT NULL CHECK (amount > 0),
  staff      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_refunds_order ON refunds(order_id);

-- 受取番号を日付（日本時間）ごとに 1 から振り直す
ALTER TABLE stores ADD COLUMN pickup_date TEXT;

-- スタッフの個人別アカウント（パスワードは PBKDF2 のハッシュのみ保存）
CREATE TABLE staff (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- ログイン中のセッション（トークンはハッシュのみ保存）
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  username   TEXT NOT NULL,
  role       TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- 回数制限（注文作成・ログイン試行）
CREATE TABLE rate_limits (
  key        TEXT PRIMARY KEY,
  count      INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
