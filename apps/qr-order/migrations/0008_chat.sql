-- お客様と店舗のチャット（店舗側は LINE で受け答えする）
-- LINE の通知先（グループ ID / ユーザー ID）と、連携用の一時コード
ALTER TABLE stores ADD COLUMN line_target TEXT;
ALTER TABLE stores ADD COLUMN line_link_code TEXT;
ALTER TABLE stores ADD COLUMN line_link_expires TEXT;

CREATE TABLE chat_threads (
  id              TEXT PRIMARY KEY,
  store_id        TEXT NOT NULL REFERENCES stores(id),
  code            TEXT NOT NULL,          -- スタッフが見分けるための短い番号（例: K7QD）
  token_hash      TEXT NOT NULL,          -- お客様の端末だけが持つ合言葉のハッシュ
  order_id        TEXT,                   -- どの注文についての問い合わせか（任意）
  created_at      TEXT NOT NULL,
  last_message_at TEXT NOT NULL
);
CREATE INDEX idx_chat_threads_store ON chat_threads(store_id, last_message_at);
CREATE INDEX idx_chat_threads_code ON chat_threads(store_id, code);

CREATE TABLE chat_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id       TEXT NOT NULL REFERENCES chat_threads(id),
  sender          TEXT NOT NULL CHECK (sender IN ('customer', 'store')),
  body            TEXT NOT NULL,
  line_message_id TEXT,                   -- LINE に送ったメッセージの ID（リプライの宛先を特定する）
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_chat_messages_thread ON chat_messages(thread_id, id);
CREATE INDEX idx_chat_messages_line ON chat_messages(line_message_id);
