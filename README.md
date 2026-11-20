# 作品 wiki

kakusan0 の作品（ゲームと道具）を 1 つにまとめたリポジトリです。1 つのサイトで、作品ごとにパスを分けて公開します。

| パス | 作品 | コード |
|---|---|---|
| `/wiki/` | 作品の一覧と、作品ごとのページ | `site/` |
| `/train-sim/` | ひかり野線 運転士 | `apps/train-sim/` |
| `/truck/` | 潮見港コンテナ便 | `apps/truck/` |
| `/shogi/` | まちかど将棋 | `apps/shogi/` |
| `/hanafuda/` | 電光花札 こいこい | `apps/hanafuda/` |
| `/machikado-board/` | まちかど商店街ボード | `apps/machikado-board/` |
| `/medal-pusher/` | 星海の宝船 | `apps/medal-pusher/` |
| `/netspeed/` | 回線速度の記録 | `apps/netspeed/` |
| `/qr-order/` | QR オーダー | `apps/qr-order/` |

`/` を開くと `/wiki/` へ移ります。作品の履歴は、それぞれの元のリポジトリに残っています。

## しくみ

- **入口の Worker**（`worker/index.ts`）：パスの頭（`/<作品>`）を見て、作品の Worker に渡します。
  - 作品の Worker には、頭の `/<作品>` を外したリクエストを渡します。作品のサーバーのコードは、元の形のまま使います。
  - 返ってきた転送先（`Location`）・Cookie の `Path`・HTML の中のパスは、`/<作品>/…` に直します（`worker/prefix.ts`）。
  - 作品が使う名前（`DB`・`ROOM` など）に付け替えた env を渡します。ファイルも作品のフォルダーだけを見せます。
- **Durable Objects**：3 作品とも `RoomDO` という名前なので、入口で `ShogiRoom`・`HanafudaRoom`・`BoardRoom`・`BoardMatchmaker` という別名にしています。
- **画面**：Vite の `base` を `/<作品>/` にしてビルドし、`dist/<作品>/` に出します（`scripts/build.mjs`）。
- **cron**：時刻の書き方で、どの作品の仕事かを決めます。`17 18 * * *` は netspeed、`23 * * * *` は QR オーダーです。

## 開発

ルートで 1 回入れると、全作品の分が入ります（npm workspaces）。

```bash
npm ci
```

全作品の型の検査です。

```bash
npm run typecheck
```

全作品のテストです。QR オーダーの画面テストには、Playwright の Chromium が要ります。

```bash
npm test
```

サイト全体を `dist/` にビルドします。

```bash
npm run build
```

1 つの作品だけを動かすときは、その作品のフォルダーで `npm run dev` を使います。

```bash
npm run dev -w apps/truck
```

## 作品を足す・直す

1. `apps/<作品>/` に置き、`scripts/apps.mjs` に足します。
2. サーバーがあるなら、`worker/index.ts` の `APPS` と `wrangler.jsonc` に足します。
3. wiki のページは `site/works.mjs` に書きます。見た目は `site/style.css` です。

## 公開

Cloudflare Workers の `wiki` という Worker 1 つで公開します（`wrangler.jsonc`）。ビルドは `npm run build` が自動で走ります。

### シークレット（Cloudflare の wiki の Worker に入れる）

値はチャットやコードに書かず、Cloudflare のダッシュボード（Worker → 設定 → 変数とシークレット）で入れてください。

| 作品 | 名前 | 中身 |
|---|---|---|
| netspeed | `NETSPEED_INGEST_TOKEN` | PC から記録を送るときの合言葉 |
| netspeed | `NETSPEED_VIEW_PASSWORD` | 記録を見るときのパスワード |
| netspeed | `NETSPEED_SESSION_SECRET` | ログインの署名の鍵（長い乱数） |
| QR オーダー | `STRIPE_SECRET_KEY`・`STRIPE_PUBLISHABLE_KEY`・`STRIPE_WEBHOOK_SECRET` | Stripe の鍵 |
| QR オーダー | `RESEND_API_KEY`・`MAIL_FROM`・`OWNER_EMAIL` | メールの送信 |
| QR オーダー（使うときだけ） | `TURNSTILE_*`・`YAHOO_CLIENT_ID`・`LINE_CHANNEL_SECRET`・`ANDROID_*` | 各サービスの設定 |

netspeed のシークレットは、元の名前に `NETSPEED_` を付けています（ほかの作品とぶつからないように）。入口で元の名前に戻して渡します。

### D1

- `NETSPEED_DB`・`QR_DB`：元の Worker と同じデータベースです。記録はそのまま残ります。
- `TRUCK_DB`：truck と train-sim の荷物の記録です。D1 を作ったら `wrangler.jsonc` に足します。ない間は、端末の中だけの「仮のコンテナ」で動きます。

### CI

`.github/workflows/check.yml` が、全作品の型の検査・テスト・ビルドを回します。結果は、シークレット `DISCORD_WEBHOOK_URL` があれば Discord に届きます（なければ飛ばします）。

ほかに、変更があったときだけ動くものが 2 つあります。

- `qr-order-android.yml`：QR オーダーの Android アプリのビルド。
- `netspeed-windows.yml`：netspeed の PC 用スクリプトの確認。
