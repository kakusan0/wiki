// オンライン対局の結合テスト。wrangler dev でサーバーを立ち上げ、WebSocket の利用者 2 人と、ブラウザ 2 つで指す
// 使い方：npm run test:online
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 8792;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
let failed = 0;
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
async function step(name, fn) {
  try { await fn(); results.push(`✓ ${name}`); } catch (e) { failed++; results.push(`✗ ${name}\n    ${e?.message ?? e}`); }
}

const state = mkdtempSync(join(tmpdir(), 'shogi-'));
const server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* もう止まっている */ } };
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 150; i++) {
  try { if ((await fetch(`${BASE}/rules.html`)).ok) break; } catch { /* 起動中 */ }
  await new Promise((r) => setTimeout(r, 300));
}

// 指し手の数（from | to << 7）。マスは (段-1)*9 + (9-筋)
const sq = (file, rank) => (rank - 1) * 9 + (9 - file);
const mv = (f1, r1, f2, r2) => sq(f1, r1) | (sq(f2, r2) << 7);

function client(code, name, token = null) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/rooms/${code}/ws`);
  const c = { ws, view: null, token: null, errors: [], closed: false };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, token }));
  ws.onclose = () => { c.closed = true; };
  ws.onerror = () => { c.closed = true; };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') c.token = m.token;
    if (m.t === 'error') c.errors.push(m.error);
    if (m.t === 'state') c.view = m;
  };
  c.send = (m) => ws.send(JSON.stringify(m));
  return c;
}
const until = async (fn, what, ms = 15000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`待ちきれない：${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
const createRoom = async (rules = 'standard', time = 'm10b30') => {
  const r = await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules, time }) });
  const b = await r.json();
  assert(r.ok && /^[A-Z0-9]{6}$/.test(b.code), `部屋を作れない ${JSON.stringify(b)}`);
  return b.code;
};

await step('部屋を作る・正しくない設定は断る', async () => {
  await createRoom();
  const r = await fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ rules: 'chess', time: 'm5' }) });
  assert(r.status === 400, `400 のはず：${r.status}`);
});

await step('2 人で指す・合法手だけ・満員・切れて戻る・投了・もう一局', async () => {
  const code = await createRoom();
  const a = client(code, 'あ');
  await until(() => a.view?.waiting, 'a が待つ');
  const b = client(code, 'い');
  await until(() => a.view && !a.view.waiting && b.view && !b.view.waiting, '始まる');
  const [s, g] = a.view.you === 0 ? [a, b] : [b, a];
  assert(s.view.you === 0 && g.view.you === 1, '先手・後手が分かれる');
  g.send({ t: 'move', move: mv(3, 3, 3, 4) });
  await until(() => g.errors.length === 1, '後手の手番違いを断る');
  s.send({ t: 'move', move: mv(7, 7, 7, 3) });
  await until(() => s.errors.length === 1, '指せない手を断る');
  s.send({ t: 'move', move: mv(7, 7, 7, 6) });
  await until(() => g.view.moves.length === 1, '1 手目が届く');
  g.send({ t: 'move', move: mv(3, 3, 3, 4) });
  await until(() => s.view.moves.length === 2, '2 手目が届く');
  assert(s.view.remain[0] <= 600_000 && s.view.remain[0] > 590_000, `持ち時間が減る ${s.view.remain[0]}`);

  const c = client(code, 'う');
  await until(() => c.closed && c.errors[0]?.includes('満員'), '3 人目は満員');

  const gToken = g.token;
  g.ws.close();
  await until(() => s.view.connected[1] === false, '後手の切断が見える');
  const g2 = client(code, 'い', gToken);
  await until(() => g2.view && g2.view.you === 1 && g2.view.moves.length === 2 && s.view.connected[1], '同じ席に戻る');

  s.send({ t: 'resign' });
  await until(() => g2.view.result?.kind === 'resign' && g2.view.result.winner === 1, '投了で後手の勝ち');
  s.send({ t: 'rematch' });
  await until(() => g2.view.rematch[0], '先手が再戦を希望');
  g2.send({ t: 'rematch' });
  await until(() => !s.view.result && s.view.moves.length === 0 && s.view.you === 1 && g2.view.you === 0, 'もう一局で先後が入れ替わる');
  s.ws.close(); g2.ws.close();
});

await step('ない部屋にはつながらない', async () => {
  const x = client('ZZZZZZ', 'x');
  await until(() => x.closed, '閉じる');
  assert(!x.view, '状態は来ない');
});

await step('ブラウザ 2 つで部屋を作って入り、指す', async () => {
  const browser = await chromium.launch();
  try {
    const pa = await (await browser.newContext()).newPage();
    const pb = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    const errs = [];
    for (const p of [pa, pb]) p.on('pageerror', (e) => errs.push(e.message));
    await pa.goto(`${BASE}/`);
    await pa.getByRole('button', { name: 'オンラインで対戦（合言葉）' }).click();
    await pa.fill('#online-name', 'たろう');
    await pa.click('#create-room');
    const code = await pa.locator('.room-code').getAttribute('data-code', { timeout: 10000 });
    assert(/^[A-Z0-9]{6}$/.test(code ?? ''), `合言葉 ${code}`);
    // 招待 URL から入る
    await pb.goto(`${BASE}/?room=${code}`);
    await pa.waitForSelector('.grid', { timeout: 10000 });
    await pb.waitForSelector('.grid', { timeout: 10000 });
    // 7 七の歩が触れるほうが先手
    const aSente = await pa.locator('[data-sq="56"]').isEnabled();
    const [ps, pg] = aSente ? [pa, pb] : [pb, pa];
    await ps.click('[data-sq="56"]');
    await ps.click('[data-sq="47"]');
    await pg.getByText('▲7六歩').first().waitFor({ timeout: 10000 });
    await pg.click('[data-sq="24"]');
    await pg.click('[data-sq="33"]');
    await ps.getByText('△3四歩').first().waitFor({ timeout: 10000 });
    assert(await ps.locator('[data-clock="0"]').count() === 1, '時計が出る');
    assert(!errs.length, `画面のエラー：${errs.join(' / ')}`);
  } finally { await browser.close(); }
});

stop();
console.log(results.join('\n'));
if (failed) console.log('\n--- wrangler ---\n' + log.slice(-3000));
console.log(failed ? `\n${failed} 件失敗` : `\nすべて成功（${results.length} 件）`);
process.exit(failed ? 1 : 0);
