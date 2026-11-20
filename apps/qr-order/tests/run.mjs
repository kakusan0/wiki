// テストの実行：npm test
// 1) テスト専用のデータベースを作り直す（開発用・本番のデータには触れない）
// 2) 外部サービスの代わり（fake-services.mjs）と、アプリ（wrangler dev）を起動する
// 3) 機能テスト（api.test.mjs）と画面テスト（ui.test.mjs）を実行し、結果を表示する
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const STATE = path.join(ROOT, 'tests', '.state');
const APP_PORT = Number(process.env.TEST_APP_PORT || 8788);
const FAKE_PORT = Number(process.env.TEST_FAKE_PORT || 4010);
// サイトと同じく /qr-order/ の下で動かす（tests/entry.ts）
const BASE_URL = `http://localhost:${APP_PORT}/qr-order`;
const CFG = '-c tests/wrangler.test.jsonc';
const FAKE_URL = `http://localhost:${FAKE_PORT}`;
const WEBHOOK_SECRET = 'whsec_test';
const only = process.argv[2]; // "api" または "ui" で片方だけ

const sh = (cmd) => execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const children = [];
const start = (cmd, args, logName, env = {}) => {
  const out = fs.openSync(path.join(STATE, logName), 'w');
  const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', out, out], detached: true });
  children.push(child);
  return child;
};
const stopAll = () => { for (const c of children) { try { process.kill(-c.pid); } catch { /* 終了済み */ } } };
process.on('exit', stopAll);
process.on('SIGINT', () => process.exit(130));

async function waitFor(url, label) {
  for (let i = 0; i < 90; i++) {
    try { await fetch(url); return; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error(label + ' が起動しませんでした（tests/.state のログを確認してください）');
}

// 1) テスト専用のデータベース
fs.rmSync(STATE, { recursive: true, force: true });
fs.mkdirSync(STATE, { recursive: true });
console.log('テスト用データベースを準備しています…');
sh(`npx wrangler d1 migrations apply DB ${CFG} --local --persist-to "${STATE}"`);
sh(`npx wrangler d1 execute DB ${CFG} --local --persist-to "${STATE}" --file tests/fixtures.sql`);

// 2) 外部サービスの代わりとアプリ。秘密の値はすべてテスト用の仮の値
start('node', ['tests/fake-services.mjs'], 'fake-services.log', { FAKE_PORT: String(FAKE_PORT) });
const vars = {
  STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_PUBLISHABLE_KEY: 'pk_test_dummy', STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_API_BASE: FAKE_URL, MAIL_API_BASE: FAKE_URL, RESEND_API_KEY: 're_test_dummy', MAIL_FROM: 'test@example.com',
};
// --var は .dev.vars より優先される（手元の .dev.vars があっても、テスト用の値で動く）
start('npx', ['wrangler', 'dev', '-c', 'tests/wrangler.test.jsonc', '--port', String(APP_PORT), '--persist-to', STATE, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], 'app.log');
await waitFor(FAKE_URL + '/__log', '外部サービスの代わり');
await waitFor(BASE_URL + '/', 'アプリ');

// 3) テスト
const env = { BASE_URL, FAKE_URL, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, PERSIST_DIR: STATE };
const run = (file, results) => new Promise((resolve) => {
  const child = spawn('node', [path.join('tests', file)], { cwd: ROOT, env: { ...process.env, ...env, RESULTS_FILE: results }, stdio: 'inherit' });
  child.on('exit', resolve);
});
const all = [];
for (const [kind, file] of [['api', 'api.test.mjs'], ['ui', 'ui.test.mjs']]) {
  if (only && only !== kind) continue;
  console.log(`\n=== ${kind === 'api' ? '機能テスト' : '画面テスト'} ===`);
  const results = path.join(STATE, `results-${kind}.json`);
  await run(file, results);
  if (fs.existsSync(results)) all.push(...JSON.parse(fs.readFileSync(results, 'utf8')).map((r) => ({ ...r, kind })));
  else all.push({ id: kind, area: '-', title: file + ' が最後まで実行できる', result: '不合格', actual: '結果なし' });
}
fs.writeFileSync(path.join(STATE, 'results.json'), JSON.stringify(all, null, 1));

// 分野ごとの集計
const areas = {};
for (const r of all) { const a = (areas[r.area] ||= { total: 0, pass: 0 }); a.total++; if (r.result === '合格') a.pass++; }
console.log('\n=== 結果 ===');
for (const [a, v] of Object.entries(areas)) console.log(`${a}: ${v.pass} / ${v.total} 合格`);
const failed = all.filter((r) => r.result !== '合格');
console.log(`合計: ${all.length - failed.length} / ${all.length} 合格（詳細: tests/.state/results.json）`);
for (const f of failed) console.log(`  不合格 ${f.id} ${f.title} :: ${f.actual}`);
stopAll();
process.exit(failed.length ? 1 : 0);
