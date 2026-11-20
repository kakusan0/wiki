-- 1 回ごとの測定（ts は UNIX 秒、速さは Mbps、遅延は ms、取りこぼしは 0〜1）
CREATE TABLE IF NOT EXISTS samples (
  ts INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,          -- quick（毎分）/ full（確かめ用）
  down REAL, up REAL, ping REAL, jitter REAL, loss REAL,
  colo TEXT
);
-- 1 時間ごとのまとめ（hour は UNIX 時 = floor(ts / 3600)）。画面はこれだけを読む
CREATE TABLE IF NOT EXISTS hourly (
  hour INTEGER PRIMARY KEY,
  n INTEGER NOT NULL DEFAULT 0,
  fail INTEGER NOT NULL DEFAULT 0,
  down_sum REAL NOT NULL DEFAULT 0, down_n INTEGER NOT NULL DEFAULT 0,
  up_sum REAL NOT NULL DEFAULT 0, up_n INTEGER NOT NULL DEFAULT 0,
  ping_sum REAL NOT NULL DEFAULT 0, ping_n INTEGER NOT NULL DEFAULT 0,
  loss_sum REAL NOT NULL DEFAULT 0, loss_n INTEGER NOT NULL DEFAULT 0,
  down_min REAL, down_max REAL
);
-- 合言葉の打ち間違いの回数（IP ごと）
CREATE TABLE IF NOT EXISTS throttle (
  ip TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  until INTEGER NOT NULL DEFAULT 0
);
