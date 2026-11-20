-- 購入完了メール。送付先は送信後に消去する（送信できないまま 24 時間たった場合も消去）
ALTER TABLE orders ADD COLUMN receipt_email TEXT;
ALTER TABLE orders ADD COLUMN receipt_sent_at TEXT;
-- メール本文に載せる注文状況ページの URL を作るため、注文を受けたサイトのオリジンを残す
ALTER TABLE orders ADD COLUMN origin TEXT;
