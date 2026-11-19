# 作品 wiki

kakusan0 の作品（ゲームと道具）の一覧と、作品ごとの遊び方・仕組みのページです。

- `/wiki/`：作品の一覧
- `/wiki/<作品>/`：作品ごとのページ（例 `/wiki/truck/`）

## 作品を足す・直す

`works.mjs` に作品を書き足すと、ページができます。見た目は `style.css` で変えられます。

「遊ぶ」のリンクは、Cloudflare の workers.dev のサブドメインから作ります（`site.mjs`、またはビルドのときの環境変数 `WORKERS_SUBDOMAIN`）。空の間は「公開先は準備中」と表示します。

## 開発

```bash
npm run build
```

```bash
npm test
```

依存するパッケージはありません（node だけで動きます）。

## 公開

Cloudflare Workers で `dist` を配信します（`wrangler.jsonc`）。デプロイの前に `npm run build` が自動で走ります。

CI の結果は、シークレット `DISCORD_WEBHOOK_URL` があれば Discord に届きます（truck と同じ仕組み）。
