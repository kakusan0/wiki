# Cloudflare・Stripe・Resend の設定手順（決済・購入完了メール）

QR オーダーのお客様画面は、作品 wiki の Worker（**`wiki`**、`https://wiki.infoapp.org/qr-order/...`）で動かします。
決済フォームの表示・Stripe からの決済完了通知・購入完了メールの送信を有効にするため、以下の 3 つを設定します。

> **注意**：API キー・シークレット・パスワード・メールアドレスなどの秘密の値は、Git やコードには書かず、必ず Cloudflare のダッシュボードに直接入力してください。

---

## 1. Cloudflare Access の例外設定（Stripe Webhook 用）

`wiki.infoapp.org` 全体に Cloudflare Access がかかっているため、Stripe からの決済完了通知（Webhook）がログイン画面で止まらないよう、Webhook の URL だけを例外（Bypass）にします。

1. **Cloudflare Zero Trust ダッシュボード**（`one.dash.cloudflare.com`）を開く
2. 左メニューの **Access コントロール → アプリケーション** を開く
3. 右上の **`+ 新規アプリケーションを作成`** → **`セルフホスト型`** を選択する
4. **アプリケーションの詳細** を設定する
   - **アプリケーション名**：`wiki qr-order stripe webhook`（わかりやすい任意の名前）
   - **宛先**：**`+ パブリック ホスト名を追加`** をクリックし、以下を入力する（使わない `Workers` の枠が表示されている場合は右端のゴミ箱アイコンで削除する）
     - **サブドメイン**：`wiki`
     - **ドメイン**：`infoapp.org`
     - **パス**：`qr-order/api/stripe/webhook`
5. **Access ポリシー** で新しいポリシーを作成する
   - **ポリシー名**：`wiki qr-order stripe webhook`（任意）
   - **アクション**：**`バイパス（Bypass）`**
   - **ポリシールール（含める）**：セレクターで **`Everyone`** を選択する
   - **`ポリシーを保存`** をクリックする
6. 画面下の **保存** をクリックしてアプリケーションを作成する
   - 一覧に宛先 **`wiki.infoapp.org/qr-order/api/stripe/webhook`**（タイプ：`セルフホスト型`）が追加されていれば完了です

※ Bypass にしても、サーバー側の `verifyStripeSignature` が `STRIPE_WEBHOOK_SECRET` で署名を検証するため、Stripe 以外からの不正なリクエストは拒否されます。
※ LINE 問い合わせの Webhook（`qr-order/api/line/webhook`）や電子棚札の基地局（`qr-order/esl/*`）からも接続する場合は、同じ手順でそれぞれパブリックホスト名の Bypass アプリを追加します。

---

## 2. Stripe ダッシュボードの Webhook 設定

1. Stripe ダッシュボード → **開発者 → Webhook** を開く
2. エンドポイントを追加する
   - **エンドポイント URL**：`https://wiki.infoapp.org/qr-order/api/stripe/webhook`
   - **リッスンするイベント**：`payment_intent.succeeded`
3. 作成後に表示される **署名シークレット**（`whsec_...`）を控える
4. Apple Pay を使用する場合は、**設定 → 支払い方法のドメイン** に `wiki.infoapp.org` を登録する

---

## 3. Cloudflare Worker（`wiki`）の変数とシークレット設定

`qr-order` 単体の Worker ではなく、**`wiki` Worker** に設定します。

1. 通常の **Cloudflare ダッシュボード**（`dash.cloudflare.com`）を開く
2. 左メニューの **コンピューティング (Workers) → Workers & Pages** → **`wiki`** を開く
3. 上部タブの **設定（Settings）** → **変数とシークレット（Variables and Secrets）** を開く
4. **`+ 追加`** から以下の 5 つを登録して **保存 / デプロイ** する

| 変数名 | タイプ | 入れる値（取得先） |
| --- | --- | --- |
| `STRIPE_PUBLISHABLE_KEY` | シークレット | Stripe ダッシュボード → 開発者 → API キーの「公開可能キー（`pk_...`）」 |
| `STRIPE_SECRET_KEY` | シークレット | Stripe ダッシュボード → 開発者 → API キーの「シークレットキー（`sk_...`）」 |
| `STRIPE_WEBHOOK_SECRET` | シークレット | 手順 2 で作成した Webhook の「署名シークレット（`whsec_...`）」 |
| `RESEND_API_KEY` | シークレット | Resend ダッシュボード → API Keys のキー（`re_...`） |
| `MAIL_FROM` | テキスト（またはシークレット） | Resend でドメイン認証済みの差出人アドレス（例：`QRオーダー <noreply@認証済みドメイン>`） |

※ `wrangler.jsonc` に `"keep_vars": true` が設定されているため、ダッシュボードで登録した値は今後のデプロイでも消えません。

---

## 4. 動作確認

1. ブラウザで `https://wiki.infoapp.org/qr-order/api/config` を開く
   - `"publishableKey"` に公開可能キーの値が入っていることを確認する（空のままだと「現在お支払いを受け付けられません。」と表示されます）
2. カート画面（`https://wiki.infoapp.org/qr-order/s/<店舗ID>`）を再読み込みし、商品を追加して決済フォームが表示されることを確認する
3. テスト決済を行い、注文画面が「お支払い完了」になり、入力した宛先へ購入完了メールが届くことを確認する
