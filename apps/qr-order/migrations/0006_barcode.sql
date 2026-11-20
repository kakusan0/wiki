-- 商品のバーコード（JAN / EAN / UPC）。同じ店舗内で重複させない
ALTER TABLE products ADD COLUMN barcode TEXT;
CREATE UNIQUE INDEX idx_products_barcode ON products(store_id, barcode) WHERE barcode IS NOT NULL;
