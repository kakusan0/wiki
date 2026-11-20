-- スタッフはメールアドレスで識別し、ログインはパスキーのみ（パスワードは廃止）
DROP TABLE staff;
DELETE FROM sessions;

CREATE TABLE staff (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  active        INTEGER NOT NULL DEFAULT 1,
  -- 1 の間だけ、メールの確認コードでパスキーを登録できる（初回・再セットアップ）
  setup_allowed INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

-- 登録済みのパスキー（公開鍵のみ。秘密鍵は各自の端末から出ない）
CREATE TABLE passkeys (
  id           TEXT PRIMARY KEY,
  staff_id     TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  public_key   TEXT NOT NULL,
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,
  label        TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX idx_passkeys_staff ON passkeys(staff_id);

-- メールで送った確認コード（ハッシュのみ。10 分で失効、5 回間違えると無効）
CREATE TABLE email_codes (
  email      TEXT PRIMARY KEY,
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL
);

-- パスキーの登録・ログイン中の一時データ（5 分で失効、1 回限り）
CREATE TABLE webauthn_challenges (
  id         TEXT PRIMARY KEY,
  challenge  TEXT NOT NULL,
  kind       TEXT NOT NULL,
  staff_id   TEXT,
  expires_at TEXT NOT NULL
);
