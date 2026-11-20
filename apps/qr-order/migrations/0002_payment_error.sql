-- 決済代行会社への支払い作成が失敗したときの理由（HTTPステータス・エラー種別。秘密情報は含めない）
ALTER TABLE orders ADD COLUMN payment_error TEXT;
