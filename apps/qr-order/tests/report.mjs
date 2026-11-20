// テスト結果報告書（docs/test-report.md）を、直前の npm test の結果から作る：npm run report
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const resultsFile = path.join(ROOT, 'tests', '.state', 'results.json');
if (!fs.existsSync(resultsFile)) { console.error('先に npm test を実行してください。'); process.exit(1); }
const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
const ranAt = fs.statSync(resultsFile).mtime;
const day = ranAt.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric' });
let commit = '';
try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { /* git がない */ }

const AREAS = [
  ['B', '購入と決済', 'api'], ['A', '年齢確認', 'api'], ['M', '返金と商品管理', 'api'], ['R', '返品・交換と受付メール', 'api'],
  ['C', '問い合わせ', 'api'], ['S', 'ログインとセキュリティ', 'api'], ['U', '画面の操作', 'ui'], ['K', 'お客様画面の URL（管理画面の「店舗 QR」）', 'ui'],
  ['E', '電子棚札（ST-GR29000）', 'mixed'],
  ['Q', '削除した機能の確認', 'ui'],
];
const cell = (s) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const by = (a) => results.filter((r) => r.area === a);
const pass = results.filter((r) => r.result === '合格').length;
const failed = results.filter((r) => r.result !== '合格');
const apiCount = Number(process.env.API_COUNT) || results.filter((r) => r.kind === 'api').length;

const lines = [];
lines.push('# QR オーダー テスト結果報告書', '');
lines.push(`実施日：${day}${commit ? `　対象のプログラム：コミット \`${commit}\`` : ''}`, '');
lines.push('## 1. 概要', '');
lines.push(failed.length
  ? `**結論：テストを実施した ${results.length} 件のうち、${pass} 件が合格、${failed.length} 件が不合格でした。** 不合格の内容は「6. 見つかった不具合と対応」をご覧ください。`
  : `**結論：テストを実施した ${results.length} 件は、すべて合格しました。**`, '');
lines.push('- **対象システム**：QR オーダー（店頭のセルフ決済サービス）。お客様がスマートフォンで商品を読み取り、その場で支払う Web サービスと、店舗スタッフ向けの管理画面');
lines.push('- **目的**：購入、年齢確認、返金、返品・交換、問い合わせ、管理画面、セキュリティの各機能が、仕様どおりに動くことを確認する');
lines.push('- **本番の公開先**：https://qr-order.gmakihiro.workers.dev/', '');

lines.push('## 2. テスト環境', '');
lines.push('本番と同じプログラムを、本番と切り離したテスト環境で動かして確認しました。実際のお金やメールは動かしていません。', '');
lines.push('| 項目 | 内容 |', '| --- | --- |');
lines.push('| 実行環境 | Cloudflare Workers の開発用実行環境（wrangler dev）と、テスト専用のデータベース（本番と同じ構造。毎回作り直す） |');
lines.push('| ブラウザ | Chromium（Playwright による自動操作）。スマートフォンは Pixel 7 の画面サイズを模擬、PC は幅 1280px |');
lines.push('| 位置情報 | 店舗の位置（緯度 35.7101、経度 139.8106、範囲 300m）と、店内・店外（約 4km 離れた場所）を模擬 |');
lines.push('| 決済（Stripe） | 決済会社の代わりのテスト用サーバー。支払い完了の通知は、本番と同じ署名の仕組みで送信 |');
lines.push('| メール（Resend） | テスト用サーバーで送信内容（宛先・件名・本文）を記録 |');
lines.push('| 商品データ | サンプル商店の 5 商品（軽減税率 8% と標準税率 10%、年齢制限商品を含む） |');
lines.push('| ログイン | 管理者 1 名と一般スタッフ 1 名のテスト用アカウント |', '');

lines.push('## 3. テストの範囲と方法', '');
lines.push('2 種類の自動テストで確認しました。どちらも `npm test` で、同じ手順で何度でも繰り返せます（tests/README.md）。', '');
lines.push(`- **機能テスト（${apiCount} 件、tests/api.test.mjs）**：サーバーに正しい操作と誤った操作の両方を送り、受け付けるべきものだけを受け付けるかを確かめました。金額の計算や権限の確認など、画面を経由しない不正な操作への備えも含みます。`);
lines.push(`- **画面テスト（${results.length - apiCount} 件、tests/ui.test.mjs）**：ブラウザを自動で操作し、お客様とスタッフが実際に行う手順を画面上で確かめました。`, '');
lines.push('**対象外**：実際の決済、実際のメール配信、LINE との実際のやり取り、実機のカメラと GPS、パスキーによる実際のログイン操作。これらは「7. 未実施の項目」にまとめました。', '');

lines.push('## 4. テスト結果の集計', '');
lines.push('| 記号 | 分野 | 件数 | 合格 | 不合格 |', '| --- | --- | --- | --- | --- |');
for (const [a, name] of AREAS) {
  const rs = by(a); if (!rs.length) continue;
  const ok = rs.filter((r) => r.result === '合格').length;
  lines.push(`| ${a} | ${name} | ${rs.length} | ${ok} | ${rs.length - ok} |`);
}
lines.push(`| | **合計** | **${results.length}** | **${pass}** | **${failed.length}** |`, '');

lines.push('## 5. テストケースと結果', '');
lines.push('「期待する結果」「実際の結果」の数字と英字（例：400 location_required）は、システムが返す結果のコードです。200・201 は受付、400・403・409・429 は理由を示した拒否、401 は未ログイン、302 は別の画面への移動、410 は無効なリンクを表します。', '');
for (const [a, name] of AREAS) {
  const rs = by(a); if (!rs.length) continue;
  lines.push(`### ${a}：${name}`, '', '| ID | 確認内容 | 期待する結果 | 実際の結果 | 判定 |', '| --- | --- | --- | --- | --- |');
  for (const r of rs) lines.push(`| ${r.id} | ${cell(r.title)} | ${cell(r.expected)} | ${cell(r.actual).slice(0, 80)} | ${r.result} |`);
  lines.push('');
}

lines.push('## 6. 見つかった不具合と対応', '');
if (failed.length) {
  lines.push('今回の実行で不合格になった項目です。', '', '| ID | 確認内容 | 実際の結果 |', '| --- | --- | --- |');
  for (const f of failed) lines.push(`| ${f.id} | ${cell(f.title)} | ${cell(f.actual)} |`);
  lines.push('');
}
lines.push('これまでのテストで見つかり、修正済みの不具合です。', '');
lines.push('| 項目 | 内容 |', '| --- | --- |');
lines.push('| 番号 | M-04（2026 年 11 月 16 日に発見・修正） |');
lines.push('| 現象 | 同じ返金操作が 2 回届くと（通信の再送など）、決済会社の返金は 1 回なのに、管理画面の返金済みの金額が 2 回分記録される |');
lines.push('| 原因 | 決済会社への依頼は操作ごとの識別子で二重を防いでいたが、システム内の記録にはその識別子を使っていなかった |');
lines.push('| 対応 | 操作ごとの識別子を記録し、同じ識別子の操作には最初の結果を返すようにした。同時に 2 つ届いた場合も 1 回分だけ記録する（M-05 で確認） |');
lines.push('| 本番の記録 | 本番の返金記録 2 件（各 ¥160）を確認し、二重の記録がないことを確認済み |', '');

lines.push('## 7. 未実施の項目と本番前に必要な確認', '');
lines.push('| 項目 | 未実施の理由 | 本番前の確認方法 |', '| --- | --- | --- |');
lines.push('| 実際の決済（カード・Apple Pay・Google Pay・Link・PayPay） | 実際のお金を動かすため | Stripe のテストモードで各支払い方法を 1 回ずつ支払い、返金まで行う |');
lines.push('| 購入完了メール・返品受付メールの実際の配信 | 送信元がテスト用（onboarding@resend.dev）で、お客様に届かないため | 独自ドメインの送信元を設定し、自分宛てに購入して届くか確認する |');
lines.push('| LINE での通知と返信 | 本物の LINE 公式アカウントとのやり取りが必要なため | 管理画面で LINE と連携し、問い合わせと返信が往復するか確認する |');
lines.push('| 実機のカメラでの読み取り（QR・バーコード・番号） | テストでは画像を模擬したため | iPhone と Android で、実際の商品のバーコードを読み取る |');
lines.push('| 実機の GPS | テストでは位置を模擬したため | 店内と店の外の両方で、支払いと返品の申し込みを試す |');
lines.push('| 電子棚札（ST-GR29000）の実機での表示と読み取り | 棚札と基地局がまだ手元にないため | 棚札を OpenEPaperLink に書き換え、基地局で「7 - Image URL」を設定して、表示と、カメラで QR を読み取ってカートに入ることを確かめる（docs/esl-setup.md） |');
lines.push('| パスキーでのログイン操作 | 指紋・顔認証は自動操作できないため | スタッフ全員の端末でログインし、ページ一覧を開くと本人確認が求められるか確認する |', '');
lines.push('**公開前に必要な設定**', '');
lines.push('- [ ] 特定商取引法に基づく表記・利用規約・プライバシーポリシーの【】の箇所（事業者名、住所、連絡先など）を記入する');
lines.push('- [ ] 公式サイトの「導入のご相談」のお問い合わせ先を記入する');
lines.push('- [ ] メールの送信元（MAIL_FROM）を独自ドメインに変える');
lines.push('- [ ] Stripe が本番モードの鍵で動いていることと、決済通知先（/api/stripe/webhook）が登録されていることを確認する', '');

lines.push('## 8. テストの再実行', '');
lines.push('```bash', 'npm install', 'npx playwright install chromium', 'npm test', 'npm run report', '```', '');
lines.push('`npm test` がテスト専用のデータベースを作り直し、機能テストと画面テストを実行します。`npm run report` がこの報告書を作り直します。', '');
fs.writeFileSync(path.join(ROOT, 'docs', 'test-report.md'), lines.join('\n'));
console.log(`docs/test-report.md を作成しました（${pass} / ${results.length} 合格）`);
