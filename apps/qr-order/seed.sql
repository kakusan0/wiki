-- サンプルデータ。実際の店舗・商品に置き換えてください
INSERT OR IGNORE INTO stores (id, name, invoice_number) VALUES
  ('shop-001', 'サンプル店', NULL);

INSERT OR IGNORE INTO products (id, store_id, name, price, tax_rate, sort) VALUES
  ('p-001', 'shop-001', 'おにぎり（鮭）',   180,  8, 1),
  ('p-002', 'shop-001', 'サンドイッチ',     350,  8, 2),
  ('p-003', 'shop-001', 'お茶 500ml',       150,  8, 3),
  ('p-004', 'shop-001', 'エコバッグ',       300, 10, 4);
