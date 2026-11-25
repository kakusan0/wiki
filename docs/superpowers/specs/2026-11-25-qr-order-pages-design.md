# QR オーダーの画面の一覧を作品 wiki に移す設計

## 目的と背景
- 作品 wiki（`wiki.infoapp.org`）の全体を、Cloudflare Access で守る。許可するのは利用者本人のメールアドレスだけ（Zero Trust の無料プラン）。設定は kakusan0/korea-trip-app の移行の作業で、API から行う。
- QR オーダーで開ける画面（パス）の一覧は、これまで `/qr-order/wiki` にあった。開くたびにパスキーでの本人確認を求めていた。wiki 全体を Access で守るので、この確認は二重になる。
- 一覧を作品 wiki の「QR オーダー」のページに移し、ひと目で探せるようにする。

## 決定事項（利用者の選択）
| 項目 | 決定 |
|---|---|
| Access をかける範囲 | 独立した Worker「wiki」の全体（qr-order の中の `/wiki` ページではない） |
| ページ一覧のパスキー確認 | やめる（Access に任せる） |
| 店舗管理画面のパスキー | **残す**（ログイン・セットアップ・パスキーの管理はそのまま） |
| 作品 wiki に足すもの | パスの一覧だけ（画面の画像は載せない） |
| 一覧の見せ方 | グループごとのタブで切り替える（「見にくいので」） |
| workers.dev | 止める（Access がかからない抜け道になるため） |
| 本物の qr-order（`qr-order.infoapp.org`） | 何も変えない |

## 設計
### 作品 wiki のページ（`site/`）
- `site/works.mjs` の qr-order に、`pages`（グループの配列）と `pagesNote` を足す。
  - グループは `{ id, h, note?, rows: [{ path, href?, desc }] }` の形。
  - 開けるパスには `href` を付ける。`<店舗ID>` などの形のパスは文字で書き、例（`shop-001` など）をリンクにする。
  - グループ：公式サイト・案内／お客様の画面／店舗スタッフの画面／電子棚札（ST-GR29000）／外部サービスからの通知を受け取る URL。
- `site/build.mjs` は「画面の一覧」（`<section id="pages">`）を描く。
  - タブ：`role="tablist"`・`role="tab"`（`aria-selected`、`aria-controls`）・`role="tabpanel"`。最初のグループを選んだ状態にする。
  - タブの並びは `hidden` で出し、`site/tabs.js` が動いたときだけ見せる。スクリプトがなければ、全部のグループを縦に並べて見せる。
  - キーボード：← → で隣のタブ、Home・End で最初・最後のタブへ移る。
- 見た目（`site/style.css`）
  - タブは丸い札を横に並べ、入りきらなければ折り返す。選んだタブは作品の色で示す。
  - 表はスマホ幅（760px 以下）では、パスの下に内容を並べる。横スクロールは出さない。
- ページ上部のボタンは「画面の一覧」（`#pages` へ移る）。

### QR オーダー（`apps/qr-order/`）
- `/wiki` と `/wiki.html` は、`/wiki/qr-order/#pages` へ 301 で移す。
  - 入口の Worker がパスの頭 `/qr-order` を付けないよう、絶対 URL で返す。
- 消すもの：`src/wiki.html`、`public/wiki.css`、ページ一覧の再認証（`WIKI_REAUTH_MS`、ログイン画面の `reauth=1` の表示）、`Session.authAt`。
- 管理画面の上部「ページ一覧」は、`/wiki/qr-order/#pages` を開く。
- DB は変えない（本物の qr-order と共用しているため）。

### 公開（`wrangler.jsonc`）
- `"workers_dev": false`、`"preview_urls": false` にする。公開先は `wiki.infoapp.org` だけにする。

## やってはいけないこと
- 店舗管理画面のログイン（パスキー）を外すこと。
- 共用の D1 のテーブルを変えること（マイグレーションを足さない）。
- 本物の qr-order のリポジトリやデプロイに手を入れること。

## テストで確かめること
- 作品 wiki
  - qr-order のページに「画面の一覧」と 5 つのグループの表、各パスへのリンクがある。
  - タブが 5 つあり、最初だけが選ばれている。パネルは最初から全部描かれていて、`tabs.js` が読み込まれる。
  - `/qr-order/wiki` へのリンクと「開くたびにパスキー」の説明はない。
- QR オーダー：`/qr-order/wiki` は 301 で `/wiki/qr-order/#pages` へ移る。
- ブラウザで確かめること
  - タブを選ぶと、そのパネルだけが見える。← → と Home で移れる。
  - 1280px と 390px の幅で、横スクロールが出ない。

## このあとの作業（kakusan0/korea-trip-app の移行の Task 7）
- この PR をマージしてデプロイしたら、`wiki.gmakihiro.workers.dev` が開けないことを確かめる。
- そのあと、`wiki.infoapp.org` に Access のアプリを作る。
