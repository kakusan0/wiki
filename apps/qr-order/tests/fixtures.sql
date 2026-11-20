-- テスト用のデータ（テスト専用のデータベースに入れる。本番・開発用のデータには触れない）
INSERT INTO stores (id, name, invoice_number, qr_rotate_minutes, lat, lng, geofence_m)
VALUES ('shop-001', 'サンプル商店', 'T1234567890123', 0, 35.7101, 139.8106, 300);

INSERT INTO products (id, store_id, name, price, tax_rate, sort, available, age_restricted, barcode) VALUES
  ('p-001', 'shop-001', 'おにぎり（鮭）', 180,  8, 1, 1, 0, NULL),
  ('p-002', 'shop-001', 'サンドイッチ',   350,  8, 2, 1, 0, NULL),
  ('p-003', 'shop-001', '緑茶 500ml',     150,  8, 3, 1, 0, '4901234567894'),
  ('p-004', 'shop-001', 'エコバッグ',     300, 10, 4, 1, 0, NULL),
  ('p-005', 'shop-001', 'ビール 350ml',   300, 10, 5, 1, 1, NULL);

-- 管理者と一般スタッフ。ログイン済みの状態は、合言葉 testtoken / stafftoken の SHA-256 で用意する
INSERT INTO staff (id, email, role, active, setup_allowed, created_at) VALUES
  ('st-admin', 'owner@example.com', 'admin', 1, 0, datetime('now')),
  ('st-staff', 'staff@example.com', 'staff', 1, 0, datetime('now'));
-- 管理者は 1 時間前にパスキーで確認した状態（ページ一覧の再確認のテスト用）、スタッフは確認した直後の状態
INSERT INTO sessions (token_hash, username, role, expires_at) VALUES
  ('ada63e98fe50eccb55036d88eda4b2c3709f53c2b65bc0335797067e9a2a5d8b', 'owner@example.com', 'admin', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+11 hours')),
  ('420f73541e787c23f7ff73bf041905bdf7ae16e083839d441388989e2883ee9d', 'staff@example.com', 'staff', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+12 hours'));

-- 画面テスト用：支払い済みで、購入完了メールを送った注文
INSERT INTO orders (id, store_id, total, created_at, status, paid_at, pickup_no, receipt_email, receipt_sent_at, mail_token, origin, payment_intent_id)
VALUES ('ui-order-1', 'shop-001', 180, datetime('now'), 'paid', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 77, 'ui@example.com', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'uitoken0001', 'http://localhost:8788', 'pi_ui');
INSERT INTO order_items (order_id, product_id, name, unit_price, tax_rate, qty, age_restricted)
VALUES ('ui-order-1', 'p-001', 'おにぎり（鮭）', 180, 8, 1, 0);
