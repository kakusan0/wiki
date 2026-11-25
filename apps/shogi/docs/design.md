# まちかど将棋 設計書

ブラウザで遊ぶ将棋です。この文書は、作りを直す人・足す人のための設計のまとめです。遊び方は [README](../README.md) と `rules.html` にあります。

## 1. 目的と範囲

- PC とスマホのブラウザで、登録なしに将棋を遊べるようにする。
- モード：コンピューター対戦・二人対戦（この端末／オンライン）・詰将棋・駒の動かし方・Lishogi の強い人の対局の観戦。
- 盤：本将棋（9×9）・5五将棋（5×5）・ミニ将棋（3×4、本作独自）。
- どのモードでも、棋譜の再生・解析・KIF のコピー・動画で保存が使える。
- 範囲の外：会員登録、レーティング、対局の記録をサーバーに残すこと。

## 2. 全体の作り

```
ブラウザ（画面・ルール・コンピューター）
  ├─ Web Worker：コンピューターの思考（engine/worker.ts）、一局の解析（engine/analysis-worker.ts）
  ├─ localStorage：続きの対局・設定・解いた詰将棋・オンラインの席
  ├─ Lishogi（lishogi.org）：観戦の対局を直接読む（CORS で許されている）
  └─ このアプリの Worker（/shogi/api/*）
        ├─ /api/rooms … オンライン対戦の部屋（Durable Object：RoomDO）
        └─ /api/lishogi/top … Lishogi の強い人の一覧（10 分覚える）
```

- 公開は Cloudflare Workers。作品 wiki の入口の Worker（`worker/index.ts`）が `/shogi/*` をこのアプリへ渡す。Durable Object は入口で `ShogiRoom` という名前になる。
- 画面は Vite でビルドし、`base` を `/shogi/` にする。

## 3. ファイルと役割

| 場所 | 役割 |
|---|---|
| `src/engine/rules.ts` | 盤の種類（`RULESETS`）、駒の種類と動き（`MOVES`）、駒落ちの初期局面（`HANDICAPS`） |
| `src/engine/position.ts` | 局面（盤・持ち駒・手番・ハッシュ）。手の生成・合法手・`make`/`unmake`、SFEN の読み書き。手は 1 つの整数（`mkMove`） |
| `src/engine/game.ts` | 対局（棋譜・終局の判定：詰み・投了・時間切れ・千日手・連続王手の千日手・入玉宣言 24 点法）、待った、KIF |
| `src/engine/notation.ts` | 棋譜の表記（▲7六歩、同　銀、打・成・不成） |
| `src/engine/ai.ts` | コンピューター：反復深化のアルファベータ・静止探索・置換表・キラー手。レベルごとの深さ・時間・ゆらぎ。定跡（序盤の数手） |
| `src/engine/tsume.ts` | 詰将棋を解く（王手の連続で詰む手順） |
| `src/engine/analysis.ts` | 解析：局面ごとの評価値と最善手、指した手の損と印（最善手・疑問手・悪手・大悪手） |
| `src/engine/usi.ts` | USI 形式の手（`7g7f`・`P*5e`・`8h2b+`）との行き来（Lishogi 用） |
| `src/engine/worker.ts`・`analysis-worker.ts` | 思考と解析を別の処理（Web Worker）で動かす |
| `src/data/tsume.ts` | 詰将棋の問題（1・3・5 手詰め、独自に作った問題） |
| `src/ui/board.ts` | 盤と駒台の表示、タップで選んで指す |
| `src/ui/online.ts` | オンライン対戦の入口と WebSocket |
| `src/ui/lishogi.ts` | Lishogi の API（強い人・対局中か・その人の対局・1 局の今の手） |
| `src/ui/ai-client.ts`・`analysis-client.ts` | Web Worker とのやりとり |
| `src/ui/video-*.ts` | 対局を動画（WebM か MP4）にする |
| `src/main.ts` | 画面の切り替え・各モードの進行・再生・解析・観戦 |
| `src/worker/index.ts` | Worker の入口（`/api/*`） |
| `src/worker/logic.ts`・`room.ts` | オンラインの部屋の中身（Cloudflare に依存しない）と、Durable Object |
| `src/worker/lishogi-top.ts` | Lishogi の強い人の一覧を読んで覚える |

## 4. データ

### 4.1 局面と手
- 局面は SFEN で読み書きする（例 `lnsgkgsnl/1r5b1/... b - 1`）。手番の数がない形（Lishogi の形）も読める。
- 手は整数：`from | to << 7 | 成り << 14 | 打つ駒 << 15`。`from` が `DROP` なら打つ手。
- 棋譜は `Game.record`（手・表記・KIF・王手か・局面の印）。千日手は局面の印（ハッシュ）が 4 回そろったかで見る。

### 4.2 端末に覚えるもの（localStorage）
| キー | 中身 |
|---|---|
| `shogi/save-v1` | 続きの対局（CPU 戦・この端末の二人対戦）：盤の種類・開始局面・手の一覧・先後・強さ。終局したら消す |
| `shogi/settings-v1` | 盤の種類・手合い・強さ・先後・盤を回すか |
| `shogi/solved-v1` | 解いた詰将棋の ID |
| `shogi/online-v1` | オンラインの部屋の合言葉と席のトークン（入り直すため） |

保存できない端末（プライベートモードなど）でも遊べるよう、読み書きはすべて失敗しても続ける。

## 5. 主な仕組み

### 5.1 コンピューター
- 評価：駒の価値＋持ち駒は 1.15 倍＋玉の近くの駒（守り +40・攻め +30）。手番の側から見た点数。
- 探索：反復深化、アルファベータ、静止探索（取る手だけ）、置換表、キラー手。打ち歩詰めと自玉への王手は除く。
- レベル：入門（深さ 1・ゆらぎ大）・初級（深さ 2）・中級（深さ 3）・上級（深さ 8・2.5 秒）。ゆらぎは手の選び方だけに使い、詰み筋は揺らさない。
- ヒントは上級の探索を 1.5 秒。

### 5.2 解析
- 一局の局面（はじめ＋手数ぶん）を 1 つずつ探索（本将棋 0.4 秒・小さい盤 0.2 秒）。
- 指した手の損 ＝ 指す前の最善の点 − 指したあとの点（指した側から見て）。150 以上で疑問手、400 以上で悪手、1000 以上で大悪手。最善手と同じなら損 0。
- 途中から続けられる（`from`）。観戦中は、手が増えるたびに増えたぶんだけ読む。
- 評価値のグラフは ±2000 で切る。詰みは端に描く。

### 5.3 再生
- `goto(局面)` で見る局面を変える。再生はタイマーで 1 手ずつ `goto` する（2・1・0.5 秒）。
- 手で局面を動かす・指す・待った・もどる・対局を始めると再生は止まる。
- キー：← → で 1 手ずつ、スペースで再生・停止（入力欄と小窓では効かない）。

### 5.4 Lishogi の観戦
- 強い人：Lishogi のリアルタイム戦の上位 100 人。Lishogi のこの一覧は CORS がないので、Worker の `/api/lishogi/top` が読んで 10 分覚える。読めないときは前の一覧を使う。
- 対局中か：`/api/users/status`。その人の対局：`/api/user/<id>/current-game`。一度に読むのは対局中の 12 人まで。
- 1 局の今の手：`/game/export/<id>` を 4 秒ごと。`/api/game` と `/api/tv` は少し前の様子のままなので使わない。
- 429 のときは 1 分待つ。タブを見ていない間は読まない。終局したら読むのをやめる。
- 対局が続いている間は最善手を出さない（対局している人の助けにならないように）。

## 6. サーバー（Worker）

| 道 | 働き |
|---|---|
| `POST /api/rooms` | 合言葉（6 文字）の部屋を作る。盤の種類と持ち時間を受け取る。同じ IP から 1 分に 20 回まで |
| `GET /api/rooms/<合言葉>/ws` | 部屋に入る（WebSocket） |
| `GET /api/lishogi/top` | Lishogi の強い人の一覧（`Cache-Control: max-age=600`） |

- よそのサイトからの呼び出しは断る（`Origin` が同じサイトのときだけ）。
- 部屋（`RoomDO`）：盤・時計・席はここが正。各端末には見えるぶんだけ送る。WebSocket の休止（hibernation）を使う。
- 送る：`hello`（名前・トークン）→ `welcome`。そのあと `move`・`resign`・`declare`・`rematch`・`leave`・`ping`。受け取る：`state`・`error`・`pong`。
- 持ち時間：秒読み 30 秒・10 分＋秒読み 30 秒・切れ負け 5 分。時間切れは alarm で判定する。
- だれもいなくなって 15 分たつと、部屋を片付ける。

## 7. 画面と使いやすさ

- 1 つの HTML で、`main.ts` が画面を作り直す（`render`）。棋譜の一覧のスクロール位置は描き直しても保つ。
- PC は盤と横の枠、スマホは縦に並べる。横にはみ出さないことを画面テストで確かめる。
- 色はライトとダークの両方に合わせる。動きを減らす設定では、点滅を止める。

## 8. テスト

| テスト | 中身 |
|---|---|
| `tests/rules.test.ts`・`perft.test.ts` | 合法手・特別な決まり（二歩・打ち歩詰め・行き所のない駒）・手の数（perft） |
| `tests/ai.test.ts` | 1 手詰めを見つける・ただの駒を取る・強いほうが勝ち越す |
| `tests/tsume.test.ts` | 詰将棋の問題がすべて詰む |
| `tests/analysis.test.ts` | 解析の点・印・詰み |
| `tests/lishogi.test.ts`・`lishogi-top.test.ts` | USI・Lishogi の形・強い人の一覧と対局の集め方 |
| `tests/online.test.ts` | 部屋の中身（席・手番・時間切れ） |
| `tests/video.test.ts` | 動画の時間割（コマ数・何手目のどの途中か）と駒の動き |
| `tests/e2e.mjs`（`npm run e2e`） | 画面テスト（PC・スマホ）。Lishogi とサーバーの答えは決めたものを返す |
| `tests/online.mjs`（`npm run test:online`） | 2 つの画面でオンライン対戦 |

## 9. 決まりごと

- 絵柄・名前・詰将棋の問題は独自のもの。
- Lishogi のデータは、画面に「対局のデータ：Lishogi（lishogi.org）」と出し、Lishogi で開くリンクを付ける。
- 新しい保存の形にするときは、キーの末尾の版（`-v1`）を上げ、前の形を読み違えないようにする。
