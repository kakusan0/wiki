# テスト

QR オーダーの自動テストです。実際の決済・メール・LINE には一切つながず、テスト専用のデータベースで動かします（開発用・本番のデータには触れません）。

## 実行

```bash
npm install
npx playwright install chromium
npm test
```

- `npm test`：機能テストと画面テストの両方（数分かかります）
- `npm run test:api`：機能テストだけ
- `npm run test:ui`：画面テストだけ
- `npm run report`：直前の結果から、テスト結果報告書（`docs/test-report.md`）を作り直す

1 件でも不合格があると、終了コードが 1 になります。結果の詳細は `tests/.state/results.json`、アプリと代わりのサーバーのログは `tests/.state/*.log` にあります（git には入れません）。

## ファイル

| ファイル | 内容 |
| --- | --- |
| `run.mjs` | 実行の手順。テスト用データベースを作り直し、外部サービスの代わりとアプリ（`wrangler dev`、ポート 8788）を起動して、テストを順に実行する |
| `fixtures.sql` | テスト用のデータ（店舗、商品 5 件、管理者と一般スタッフ、ログイン済みの状態、購入完了メールを送った注文） |
| `fake-services.mjs` | Stripe・Resend（メール）・LINE などの代わりのサーバー（ポート 4010）。受け取ったメールなどを記録する |
| `api.test.mjs` | 機能テスト（分野 B・A・M・R・C・S） |
| `ui.test.mjs` | 画面テスト（分野 U・K・Q）。Playwright でブラウザを自動操作する |
| `report.mjs` | テスト結果報告書を作る |
| `photo.jpg` | 返品の申し込みに添える写真（テスト用） |

ポートが使われている場合は、`TEST_APP_PORT` と `TEST_FAKE_PORT` で変えられます。
