-- メールのリンクに付ける合言葉。返品・交換を受け付けると新しくし、それより前に送ったメールのリンクを無効にする
ALTER TABLE orders ADD COLUMN mail_token TEXT;
