# 回線速度の記録（netspeed）

自宅の回線の速さを **毎分** 測って記録し、**どの時間帯が速いか** をスマホと PC で見るための仕組みです。

```
[自宅の Windows 11]                    [Cloudflare]                       [スマホ・PC]
 PowerShell（毎分）── 測定結果 ──→ Workers の受け口 ──→ D1（記録）
   ↑ speed.cloudflare.com で測る          └─ 結果のページ（合言葉でロック）←── ブラウザで開く
```

- **毎分**：遅延（5 回）・下り 2 MB・上り 1 MB を測ります。
- **2 時間ごと**：確かめ用に、下り 25 MB・上り 10 MB で測ります。
  - 共用回線（集合住宅の回線）に負担をかけないよう、控えめにしています。
  - 1 日あわせて 5 GB 前後です。
- **結果のページ**：
  - 曜日 × 時刻のヒートマップ
  - 速い時間帯ベスト 3／遅い時間帯ワースト 3
  - 時刻ごとの速さ（期間の中央値と今日）
  - 直近 1 時間のグラフ
- **費用**：Cloudflare の無料プランの範囲で動きます（1 日のリクエストも書き込みも上限の数 % 以下）。

## はじめの設定（1 回だけ）

### 1. Cloudflare：記録の置き場（D1）を作る
1. Cloudflare のダッシュボード →「ストレージとデータベース」→「D1」→「データベースを作成」。名前は `netspeed`。
2. 作成後に表示される **データベース ID** を、`wrangler.jsonc` の `database_id` に書きます（設定済み）。ID は秘密の情報ではありません。

### 2. Cloudflare：Workers にこのリポジトリをつなぐ
「Workers & Pages」→「作成」→「リポジトリをインポート」で `kakusan0/netspeed` を選び、次のように設定します。

- ビルドのコマンド：`npm run build`
- デプロイのコマンド：`npx wrangler deploy`（そのままで大丈夫です。D1 の表は Worker が最初のアクセスで自分で作ります）

### 3. Cloudflare：合言葉と鍵（シークレット）を入れる
Worker の「設定」→「変数とシークレット」に、種類「シークレット」で 3 つ追加します。**このリポジトリやチャットには書かないでください。**

| 名前 | 中身 |
|---|---|
| `INGEST_TOKEN` | 自宅の PC が送るときの鍵（ランダムな 32 文字以上） |
| `VIEW_PASSWORD` | 結果のページの合言葉（覚えられるもの） |
| `SESSION_SECRET` | ログイン状態を守るための秘密（ランダムな 32 文字以上） |

ランダムな文字列は、PowerShell で次のように作れます。

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
```

### 4. 自宅の PC：測定を始める
1. GitHub のこのページの「Code」→「Download ZIP」でダウンロードし、展開します。
2. スタートメニューで「PowerShell」を右クリック →「管理者として実行」。
3. 展開したフォルダの `windows` に移って、次を実行します。

   ```powershell
   cd "$env:USERPROFILE\Downloads\netspeed-main\windows"
   Unblock-File .\*.ps1
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```

4. 次の 2 つを聞かれるので入れます。
   - 送り先の URL：`https://wiki.infoapp.org/netspeed`（作品 wiki の中の netspeed。wiki は Cloudflare Access で守っていますが、記録の受け口 `/netspeed/api/ingest` だけは Access を通さず、鍵で守ります）
   - 送信用の鍵：wiki の Worker のシークレット `NETSPEED_INGEST_TOKEN`
   - 2 回目からは、前の設定（`%LOCALAPPDATA%\netspeed\config.json`）が残っていれば、どちらも Enter だけで今のまま使えます。
5. 試しに 1 回測って送り、タスク スケジューラに「毎分」で登録します。
   - ログインしていなくても、画面を出さずに動きます。
   - スリープしない設定にするかも聞かれます。

### 5. 結果を見る
スマホと PC のブラウザで Worker の URL を開き、合言葉を入れます（その端末では 30 日間入ったままになります）。スマホはホーム画面に追加しておくと便利です。

- **いつ判断できるか**：曜日ごとの傾向は、**1〜2 週間** 記録すると見えてきます。
- **見本**：URL の末尾に `?demo` を付けると、作り物のデータで画面の見本を見られます（ログイン不要）。

## スマホで測る（家の Wi-Fi）
1. 結果のページをスマホで開き、「この端末で測る」に部屋の名前（リビング・寝室など）を入れて「測る」を押します。
2. 遅延・下り・上りを測って記録します。
   - 下りは 1 MB → 5 MB → 25 MB と大きくし、1 回が 1.5 秒を超えたら止めます。
   - 1 回で 30 MB ほど使います。
3. 同じころの PC（有線）の値と並べて「この場所の Wi-Fi は有線の◯%」と出します。
4. 「場所ごとの速さ」で部屋どうしを比べられます。

モバイルデータで測ろうとすると、測る前に確かめます（Android の Chrome は回線の種類が分かります）。

## うまく動かないとき
- **ページに「記録が止まっています」と出る**
  - PC がスリープしていないか、確かめてください。
  - タスク スケジューラの「netspeed」が「準備完了」になっているか、確かめてください。
- **ログを見る**：`%LOCALAPPDATA%\netspeed\log.txt` に、測定と送信の結果が 1 分ごとに残ります。
- **「送信の鍵がちがいます」**：`%LOCALAPPDATA%\netspeed\config.json` の `token` と、Cloudflare の `INGEST_TOKEN` を同じにします。
- **送れなかった測定**：PC の `pending.jsonl` にたまり、次に送れたときにまとめて送ります。最大 2 週間ほどです。
- **やめるとき**：管理者の PowerShell で `windows\uninstall.ps1` を実行します。

## 中身
| 場所 | 役目 |
|---|---|
| `windows/collect.ps1` | 1 回測って送る（Windows PowerShell 5.1） |
| `windows/install.ps1` / `uninstall.ps1` | 毎分の登録・解除 |
| `src/worker/` | 受け口（`/api/ingest`）、スマホの記録（`/api/spot`）、合言葉（`/api/login`）、集計（`/api/summary`）、古い記録の削除（毎日） |
| `migrations/` | D1 の表 |
| `src/shared/stats.ts` | 集計。時間帯ごとの値は「日ごとの平均の中央値」 |
| `src/web/` | 結果のページ（`measure.ts` はスマホのブラウザで測る部分） |

記録の残し方は次のとおりです。

- 1 分ごとの記録：90 日残します。
- 1 時間ごとのまとめ：400 日残します。
- 時刻は日本時間です（`wrangler.jsonc` の `TZ_OFFSET_MIN`）。

## 開発
```
npm install
npm test
npm run build
npx wrangler d1 migrations apply netspeed --local
npx wrangler dev        # .dev.vars に 3 つのシークレットを書いておく
```
