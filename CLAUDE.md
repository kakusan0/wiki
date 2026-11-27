# 作品 wiki（kakusan0/wiki）— 次のセッションへの引き継ぎ

このファイルは、あとで別のセッション（Claude）が読んで、すぐに作業を続けられるようにするための仕様のまとめです。
細かいことは各作品の `README.md` と `docs/design.md` にあります。仕様を変えたら、ここと設計書の両方を直してください。

## 利用者との約束（必ず守る）
- やり取りは日本語。わかりやすい言葉で書く。
- **無料のプラン・無料の API だけ** を使う（上限を超えると課金されるものは使わない）。
- **キー・トークン・パスワードは、チャット・コード・ログ・URL・Git に書かない。** 入れる場所は Cloudflare のダッシュボード（シークレット）か、手元の `.dev.vars` だけ。利用者がチャットに貼ってしまったら、使わずに作り直し（ロール）を頼む。
- 利用者のメールアドレスは個人情報。Cloudflare Access のポリシー以外には書かない（このリポジトリは **公開** なので特に注意）。
- 「おすすめで進めて」と言われたら、おすすめの案で進めてよい。
- **マージは、利用者がその PR について「マージして」と言ったときだけ。** PR は下書き（draft）で作る。

## 全体の形
1 つの Worker「`wiki`」で、`https://wiki.infoapp.org` に全作品をパスで分けて公開する。

| パス | 作品 | 種類 | コード | サーバーの部品 |
|---|---|---|---|---|
| `/wiki/` | 作品の一覧と作品ごとのページ | サイト | `site/` | なし（ビルド時に HTML を作る） |
| `/shiomi/` | 潮見とひかり野線（電車とトラック、3D） | ゲーム | `apps/shiomi/` | Worker（`/api/*` 荷物の記録。D1 `TRUCK_DB` は未作成） |
| `/shogi/` | まちかど将棋 | ゲーム | `apps/shogi/` | Worker＋Durable Object `ShogiRoom`、レート制限 |
| `/hanafuda/` | 電光花札 こいこい | ゲーム | `apps/hanafuda/` | Worker＋Durable Object `HanafudaRoom`、レート制限 |
| `/machikado-board/` | まちかど商店街ボード | ゲーム | `apps/machikado-board/` | Worker＋DO `BoardRoom`・`BoardMatchmaker` |
| `/medal-pusher/` | 星海の宝船（メダルプッシャー） | ゲーム | `apps/medal-pusher/` | なし（画面だけ） |
| `/netspeed/` | 回線速度の記録 | 道具 | `apps/netspeed/` | Worker＋D1 `NETSPEED_DB`、cron |
| `/qr-order/` | QR オーダー（店頭 QR 注文・Stripe 決済） | 道具 | `apps/qr-order/` | Worker＋D1 `QR_DB`、cron |

- `/` は `/wiki/` へ。前のパス `/train-sim/`・`/truck/` は `/shiomi/` へ 301（`worker/moved.ts`）。
- 各作品の元のリポジトリ（`kakusan0/qr-order` など）は **公開していない・使っていない**。直すのはこのリポジトリだけ。
  - 作品の README に「main に push すると Workers Builds で公開」とあるのは、元のリポジトリだったころの説明。いまは wiki の Worker 1 つで公開する。

## しくみ（入口の Worker）
- `worker/index.ts`：パスの頭 `/<作品>` を見て、`APPS` の作品の Worker に渡す。
  - 作品には頭を外したリクエストを渡す（`strip`）。作品のサーバーのコードは元の形のまま。
  - 応答の `Location`・Cookie の `Path`・HTML の `href` などを `/<作品>/…` に直す（`worker/prefix.ts` の `fixResponse`、HTMLRewriter）。WebSocket（101）はそのまま。
  - env は作品が使う名前に付け替える（例：`NETSPEED_DB` → `DB`、`SHOGI_ROOM` → `ROOM`）。ASSETS は作品のフォルダーだけを見せる（`scopedAssets`。SPA の作品は見つからない画面を `index.html` に）。
  - QR オーダーだけ `assetsFirst`（先にファイル、なければ Worker）。env は全部渡して `DB: QR_DB`、`BASE_PATH: '/qr-order'`。
- cron は書き方で作品を分ける：`17 18 * * *` → netspeed（古い記録の掃除、日本時間 3:17）、`23 * * * *` → QR オーダー（毎時の整理）。`wrangler.jsonc` の `triggers` と `worker/index.ts` の `scheduled` を必ず合わせる。
- ビルド：`scripts/build.mjs` が `dist/<作品>/` に各作品（Vite は `--base /<作品>/`、QR オーダーは `public/` をコピー）、`dist/wiki/` に作品 wiki を作る。QR オーダーの `_headers` は `/qr-order/*` にだけ付ける。
- 作品の一覧は `scripts/apps.mjs`（ビルドとテスト）、`worker/index.ts` の `APPS`（配信）、`site/works.mjs`（wiki のページの中身）の 3 か所。作品を足すときは 3 つとも。

## 作品 wiki のページ（`site/`）
- `site/works.mjs` の `WORKS` から `site/build.mjs` が HTML を作る。見た目は `site/style.css`。
- QR オーダーのページ（`/wiki/qr-order/#pages`）に「画面の一覧」をタブで載せる（`pages`：info・customer・esl・webhook。Web の店舗管理画面は削除し、専用 Android アプリ側 `kakusan0/qr-order` に分離）。
  - タブは `site/tabs.js`（ARIA のタブ、← → Home End）。JS が動くまでタブの列は隠し、パネルは全部見える。
  - 前のページ一覧 `/qr-order/wiki`・`/qr-order/wiki.html` は、ここへ 301（`apps/qr-order/src/index.ts`）。ページ一覧のパスキーの確認はなくした。
  - 設計：`docs/superpowers/specs/2026-11-25-qr-order-pages-design.md`。

## ログイン・守り方
- **サイト全体に Cloudflare Access**（Zero Trust の無料プラン、メールのワンタイム PIN、許可したメールアドレスだけ）。チームのドメインは `prodserver.cloudflareaccess.com`。ログインは 30 日有効。
  - Access のかからない入口を作らないため、`workers_dev: false`・`preview_urls: false`。独自ドメイン `wiki.infoapp.org` だけ。
  - **例外（Bypass のアプリ）**：
    - `wiki.infoapp.org/netspeed/api/ingest`：自宅の PC が毎分送る受け口。`NETSPEED_INGEST_TOKEN` の鍵で守る。
    - `wiki.infoapp.org/qr-order/api/stripe/webhook`：Stripe からの決済完了通知の受け口。`STRIPE_WEBHOOK_SECRET` の署名検証で守る（設定手順：`apps/qr-order/docs/cloudflare-setup.md`）。
- 作品ごとのログインは Access とは別に残している（利用者の決定）：
  - QR オーダーの店舗管理画面（`/qr-order/staff`）：Web 版の画面は削除し、専用 Android アプリ（`kakusan0/qr-order`）に分離。`wiki` にはお客様画面のみを残す。
  - netspeed の結果のページ：合言葉（`NETSPEED_VIEW_PASSWORD`）。
- 作品のページを開いたときに出るログインは、Access ではなく作品のログイン。シークレットウィンドウで開くと Access の画面が出ることを確かめてある（2026-11-26）。

## データとシークレット
- D1：`NETSPEED_DB`（netspeed）、`QR_DB`（qr-order）。元の Worker と同じデータベースを付け直したので記録はそのまま。`TRUCK_DB` はまだ作っていない（ない間、shiomi は端末の中だけで動く）。
- シークレットの名前（値はダッシュボードだけ）：
  - netspeed：`NETSPEED_INGEST_TOKEN`・`NETSPEED_VIEW_PASSWORD`・`NETSPEED_SESSION_SECRET`（入口で `NETSPEED_` を外して作品に渡す）。
  - QR オーダー：`STRIPE_SECRET_KEY`・`STRIPE_PUBLISHABLE_KEY`・`STRIPE_WEBHOOK_SECRET`・`RESEND_API_KEY`・`MAIL_FROM`・`OWNER_EMAIL`。使うときだけ `TURNSTILE_*`・`YAHOO_CLIENT_ID`・`LINE_CHANNEL_*`・`ANDROID_*`。
- `keep_vars: true`：ダッシュボードで入れた変数をデプロイで消さない。
- netspeed の変数（`NETSPEED_*` の 3 つ）は、いまは平文（plain_text）で入っているかもしれない。シークレットに変えるのは利用者の任意の作業。

## 作品ごとの仕様の要点
詳しくは各作品の `README.md`・`docs/design.md`。

- **shiomi**：架空の港町と「ひかり野線」。`?mode=train` / `?mode=truck`。three.js。段階 1・2 は済み、3（貨物駅を本線につなぐ）・4（山ノ口まで道路）が残り。トラック↔電車は 8 文字の連携コードで `/api/*` に記録。
- **shogi**：コンピューター対戦（4 段階）・オンライン（合言葉の部屋、DO）・詰将棋・小さい盤・Lishogi 観戦（`/api/lishogi/top` が上位 100 人を 10 分キャッシュ）・解析。
- **hanafuda**：こいこい。コンピューター対戦・オンライン（1 手 30 秒）。WebGL 3D と 2D。絵柄はすべて独自。
- **machikado-board**：2〜4 人のボードゲーム（お店と株）。オンラインは相手探し（`MatchmakerDO`）と部屋（`RoomDO`）。ルールは `docs/rules.md`。
- **medal-pusher**：3D のメダルプッシャー。画面だけ。メダルはゲーム内だけ（お金や景品に換えない）。
- **netspeed**：自宅の Windows（`apps/netspeed/windows/*.ps1`、PowerShell 5.1）が毎分 speed.cloudflare.com で測り、`/netspeed/api/ingest` に送る。D1 に 1 分ごと 90 日・1 時間まとめ 400 日。日本時間で集計。
  - `install.ps1` は送り先と鍵を `%LOCALAPPDATA%\netspeed\config.json` に保存し、2 回目からは Enter で前の値を使う。送り先は `https://wiki.infoapp.org/netspeed`。
- **qr-order**：店頭の QR → カート → Stripe（カード・Apple Pay・Google Pay・Link・PayPay）。支払済は Webhook とサーバーでの金額確認のときだけ。スタッフはパスキー（初回はメールの 6 桁コード）。返品・交換、LINE の問い合わせ、電子棚札（`/esl/`・`/p/`）、GPS での範囲チェック、毎時の整理。`apps/qr-order/README.md` が詳しい。

## 開発・テスト・公開
```bash
npm ci
```
```bash
npm run typecheck
```
```bash
npm test
```
```bash
npm run build
```
- `npm test` は全作品のテスト（`scripts/each.mjs`、`SKIP_APPS=a,b` で飛ばせる）と `site/tests`・`worker/*.test.ts`。QR オーダーの画面テストに Playwright の Chromium が要る。
- 1 作品だけ：`npm run dev -w apps/<作品>`、`npm test -w apps/<作品>`。
- CI：`.github/workflows/check.yml`（型・テスト・ビルド、Discord 通知は `DISCORD_WEBHOOK_URL` があるときだけ）。`qr-order-android.yml`・`netspeed-windows.yml` は該当のフォルダーが変わったときだけ。
- 公開：Cloudflare の Workers Builds（Git 連携）で、main に入ると `npm run build` → デプロイ。
  - PR のブランチの Workers Builds は前から失敗している（main は成功）。PR の判断は GitHub Actions の Check で見る。

## このクラウドの作業環境で気をつけること
- `wiki.infoapp.org` など公開先には、作業環境から届かない（Access と通信の許可のため）。画面の確認は手元のビルド（`wrangler dev`）と Playwright で行う。
- Cloudflare の API（`api.cloudflare.com`）は、環境に入れたトークンでプロキシが認証する。トークンの値は扱わない。プロキシが Authorization を書き換えるため、作業環境からの `wrangler deploy` は失敗する。デプロイは main への反映で行う。
- GitHub は REST API（`gh api`）が使える。Actions のログのダウンロードは届かないことがある。
