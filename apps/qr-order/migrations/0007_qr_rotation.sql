-- QR コードの定期更新。0 = 更新しない。qr_secret は QR と入店確認の署名用（店舗ごとの乱数）
ALTER TABLE stores ADD COLUMN qr_rotate_minutes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stores ADD COLUMN qr_secret TEXT;
