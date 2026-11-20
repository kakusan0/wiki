-- 位置情報（GPS）の確認。店舗の位置と、購入・返品の申し込みのときに店舗からどれだけ離れていたか（位置そのものは保存しない）
ALTER TABLE stores ADD COLUMN lat REAL;
ALTER TABLE stores ADD COLUMN lng REAL;
ALTER TABLE stores ADD COLUMN geofence_m INTEGER NOT NULL DEFAULT 200;
ALTER TABLE orders ADD COLUMN geo_distance_m INTEGER;
ALTER TABLE orders ADD COLUMN geo_accuracy_m INTEGER;
ALTER TABLE returns ADD COLUMN geo_distance_m INTEGER;
ALTER TABLE returns ADD COLUMN geo_accuracy_m INTEGER;
