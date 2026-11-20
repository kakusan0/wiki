// オンライン対戦の結合テスト。wrangler dev でサーバーを立ち上げ、WebSocket の 2 人で最後まで遊び、ブラウザ 2 つでも遊ぶ
// 使い方：npm run test:online
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
let failed = 0;
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
async function step(name, fn) {
  try { await fn(); results.push(`✓ ${name}`); } catch (e) { failed++; results.push(`✗ ${name}\n    ${e?.message ?? e}`); }
}

const state = mkdtempSync(join(tmpdir(), 'hana-'));
const server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* もう止まっている */ } };
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 150; i++) {
  try { if ((await fetch(`${BASE}/rules.html`)).ok) break; } catch { /* 起動中 */ }
  await new Promise((r) => setTimeout(r, 300));
}

// 1 人ぶん。自分の番が来たら選べる手の 1 つ目を送る（play=false なら何もしない）
function client(code, name, { token = null, play = true } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/rooms/${code}/ws`);
  const c = { ws, room: null, token: null, errors: [], closed: false, emotes: [], play, sent: -1 };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, token }));
  ws.onclose = () => { c.closed = true; };
  ws.onerror = () => { c.closed = true; };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') c.token = m.token;
    if (m.t === 'error') c.errors.push(m.error);
    if (m.t === 'emote') c.emotes.push(m);
    if (m.t !== 'state') return;
    c.room = m;
    const v = m.view;
    if (!c.play || !v || !v.legal.length || c.sent === v.seq || v.phase === 'over') return;
    c.sent = v.seq;
    const a = v.phase === 'koikoi' ? { type: 'stop' } : v.legal[0];
    setTimeout(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'act', action: a })); }, 120);
  };
  c.send = (m) => ws.send(JSON.stringify(m));
  return c;
}
const until = async (fn, what, ms = 30000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`待ちきれない：${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
const createRoom = async (months = 3) => {
  const r = await fetch(`${BASE}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ months }) });
  const b = await r.json();
  assert(r.ok && /^[A-Z0-9]{6}$/.test(b.code), `部屋を作れない ${JSON.stringify(b)}`);
  return b.code;
};

await step('部屋を作る・正しくない設定は断る', async () => {
  await createRoom();
  const r = await fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ months: 7 }) });
  assert(r.status === 400, `400 のはず：${r.status}`);
});

await step('2 人で 3 か月を最後まで・相手の手札は届かない・満員・切れて戻る・スタンプ・もう一局', async () => {
  const code = await createRoom();
  const a = client(code, 'あ', { play: false });
  await until(() => a.room?.waiting, 'a が待つ');
  const b = client(code, 'い', { play: false });
  await until(() => a.room?.view && b.room?.view, '始まる');
  assert(a.room.you !== b.room.you, '0 と 1 に分かれる');
  for (const c of [a, b]) {
    const v = c.room.view;
    assert(typeof v.oppHand === 'number' && typeof v.deck === 'number' && v.hand.length === 8, '見えるのは自分の手札だけ');
  }
  const x = client(code, 'う', { play: false });
  await until(() => x.closed && x.errors[0]?.includes('満員'), '3 人目は満員');
  // 手番でない人の操作は断る
  const [turn, wait] = a.room.view.turn === a.room.you ? [a, b] : [b, a];
  wait.send({ t: 'act', action: wait.room.view.legal[0] ?? { type: 'play', card: wait.room.view.hand[0] } });
  await until(() => wait.errors.length === 1, '手番違いを断る');
  // スタンプ
  turn.send({ t: 'emote', id: 1 });
  await until(() => wait.emotes.length === 1, 'スタンプが届く');
  // 後手が切れて戻る
  const bt = b.token;
  b.ws.close();
  await until(() => a.room.connected[b.room.you] === false, '切断が見える');
  const b2 = client(code, 'い', { token: bt, play: true });
  await until(() => b2.room?.view && b2.room.you === b.room.you && a.room.connected[b2.room.you], '同じ席に戻る');
  a.play = true;
  a.sent = -1;
  // a に今の状態をもう一度送らせる（ping では状態は来ないので、b2 の入室で来た状態を使う）
  if (a.room.view.legal.length) { a.sent = a.room.view.seq; a.send({ t: 'act', action: a.room.view.phase === 'koikoi' ? { type: 'stop' } : a.room.view.legal[0] }); }
  await until(() => a.room.view?.phase === 'over' && b2.room.view?.phase === 'over', '最後まで進む', 120000);
  const v = a.room.view;
  assert(v.results.length === 3, `3 か月 ${v.results.length}`);
  const sum = [0, 1].map((p) => v.results.filter((r) => r.winner === p).reduce((s, r) => s + r.points, 0));
  assert(sum[0] === v.scores[0] && sum[1] === v.scores[1], '点の合計');
  a.send({ t: 'rematch' });
  await until(() => b2.room.rematch[a.room.you], '再戦の希望が届く');
  b2.send({ t: 'rematch' });
  await until(() => a.room.view.round === 1 && a.room.view.results.length === 0, 'もう一局');
  a.ws.close(); b2.ws.close();
});

await step('ない部屋にはつながらない', async () => {
  const x = client('ZZZZZZ', 'x');
  await until(() => x.closed, '閉じる');
  assert(!x.room, '状態は来ない');
});

await step('ブラウザ 2 つで部屋を作って入り、1 か月遊ぶ', async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const pa = await (await browser.newContext({ viewport: { width: 1100, height: 760 } })).newPage();
    const pb = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    const errs = [];
    for (const p of [pa, pb]) { p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => d.accept()); }
    await pa.goto(`${BASE}/?fast`);
    await pa.evaluate(() => localStorage.setItem('hanafuda/settings-v1', JSON.stringify({ months: 3, render: '3d' })));
    await pb.goto(`${BASE}/?fast`);
    await pb.evaluate(() => localStorage.setItem('hanafuda/settings-v1', JSON.stringify({ months: 3, render: '2d' })));
    await pa.goto(`${BASE}/?fast`);
    await pa.click('#online');
    await pa.fill('#online-name', 'たろう');
    await pa.click('#create-room');
    const code = await pa.locator('.room-code').getAttribute('data-code', { timeout: 10000 });
    await pb.goto(`${BASE}/?fast&room=${code}`);
    for (const p of [pa, pb]) await p.waitForFunction(() => window.__hana?.view?.(), null, { timeout: 15000 });
    const tap = async (p, id) => {
      let pos = null;
      for (let n = 0; n < 30 && !pos; n++) { pos = await p.evaluate((i) => window.__hana.screenOf(i), id); if (!pos) await p.waitForTimeout(100); }
      if (!pos) throw new Error(`札 ${id} が見つからない`);
      const box = await p.locator('.stage, .table2d').first().boundingBox();
      await p.mouse.click(box.x + pos[0] * box.width, box.y + pos[1] * box.height);
    };
    // 1 か月が終わるまで、手番の側がタップで指す
    for (let i = 0; i < 200; i++) {
      const vs = await Promise.all([pa, pb].map((p) => p.evaluate(() => ({ v: window.__hana.view(), ready: window.__hana.ready() }))));
      if (vs.some(({ v }) => v.phase === 'roundEnd')) break;
      const k = vs.findIndex(({ v, ready }) => ready && v.legal.length && v.turn === v.me);
      if (k < 0) { await pa.waitForTimeout(100); continue; }
      const p = [pa, pb][k], v = vs[k].v;
      if (v.phase === 'koikoi') await p.click('#stop');
      else if (v.phase === 'drawChoose') await tap(p, v.legal[0].target);
      else {
        const a = v.legal[0];
        await tap(p, a.card);
        const m = v.field.filter((f) => f >> 2 === a.card >> 2);
        if (m.length === 0) await p.click('#discard'); else if (m.length === 2) await tap(p, a.target); else await tap(p, a.card);
      }
      try { await p.waitForFunction((s) => window.__hana.view().seq !== s, v.seq, { timeout: 10000 }); }
      catch { throw new Error(`進まない：${k} ${v.phase} ${JSON.stringify(v.legal[0])} field=${v.field} hand=${v.hand} msg=${await p.locator('.msg').innerText()} net=${await p.locator('.net').innerText()}`); }
    }
    for (const p of [pa, pb]) await p.locator('[data-modal^="end-"]').waitFor({ timeout: 15000 });
    await pa.click('#next');
    for (const p of [pa, pb]) await p.waitForFunction(() => window.__hana.view().round === 2, null, { timeout: 15000 });
    assert(!errs.length, `画面のエラー：${errs.join(' / ')}`);
  } finally { await browser.close(); }
});

stop();
console.log(results.join('\n'));
if (failed) console.log('\n--- wrangler ---\n' + log.slice(-3000));
console.log(failed ? `\n${failed} 件失敗` : `\nすべて成功（${results.length} 件）`);
process.exit(failed ? 1 : 0);
