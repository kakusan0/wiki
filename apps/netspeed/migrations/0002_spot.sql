-- スマホなどの端末で、ボタンを押して測った記録（場所つき）
CREATE TABLE IF NOT EXISTS spots (
  ts INTEGER PRIMARY KEY,
  device TEXT NOT NULL,        -- phone など
  place TEXT,                  -- 部屋の名前（リビング・寝室など）
  net TEXT,                    -- wifi / cellular / 不明
  down REAL, up REAL, ping REAL, jitter REAL
);
