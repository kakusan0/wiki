// オンライン対戦の結合テスト。wrangler dev でサーバーを立ち上げ、WebSocket の利用者を何人かつないで 1 ゲーム遊ぶ
// 使い方：npm run test:online（FAST=1 で演出の待ち時間をなくし、MAX_ROUNDS で短いゲームにする）
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
let failed = 0;
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
async function step(name, fn) {
  try { await fn(); results.push(`✓ ${name}`); } catch (e) { failed++; results.push(`✗ ${name}\n    ${e?.message ?? e}`); }
}

const state = mkdtempSync(join(tmpdir(), 'mb-'));
const server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state,
  '--var', 'FAST:1', '--var', 'MAX_ROUNDS:4'], { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
// npx の子（wrangler・workerd）までまとめて止める
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* もう止まっている */ } };
let log = '';
server.stdout.on('data', (d) => { log += d; });
server.stderr.on('data', (d) => { log += d; });
for (let i = 0; i < 150; i++) {
  try { if ((await fetch(`${BASE}/rules.html`)).ok) break; } catch { /* 起動中 */ }
  await new Promise((r) => setTimeout(r, 300));
}

// 1 人ぶんの利用者。自分の番が来たら、選べる操作のうち簡単なものを送る
function client(code, name, { play = true, token = null } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/rooms/${code}/ws`);
  const c = { play, ws, view: null, token: null, seat: null, errors: [], emotes: [], closed: false, views: 0 };
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, token }));
  ws.onclose = (e) => { c.closed = true; c.closeReason = e.reason; };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'welcome') { c.token = m.token; c.seat = m.seat; }
    if (m.t === 'error') c.errors.push(m.error);
    if (m.t === 'emote') c.emotes.push(m);
    if (m.t !== 'room') return;
    c.view = m;
    c.views++;
    const g = m.game;
    if (!c.play || !g || g.phase === 'over' || g.turn !== m.you || c.acted === m.moves) return;
    c.acted = m.moves; // 同じ局面には 1 回だけ送る
    let a;
    if (g.phase === 'roll') a = { type: 'roll' };
    else if (g.phase === 'decide') a = g.pending?.kind === 'direction' ? { type: 'move', to: g.pending.options[0] } : { type: 'skip' };
    else if (g.phase === 'stock') a = { type: 'endTurn' };
    // 人が押す速さに近づける（送りすぎの制限に当たらないように）
    if (a) setTimeout(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'act', action: a })); }, 150);
  };
  c.send = (m) => ws.send(JSON.stringify(m));
  return c;
}
const until = async (fn, ms = 20000, what = '') => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error(`待ちきれない：${typeof what === 'function' ? what() : what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
const post = async (path, body, headers = {}) => {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

await step('合言葉の部屋：2 人で入り、作った人が始めると CPU 2 人が入って最後まで遊べる', async () => {
  const { body } = await post('/api/rooms', { mapId: 'corner', mode: 'normal' });
  assert(/^[A-Z2-9]{6}$/.test(body.code), `合言葉が返らない：${JSON.stringify(body)}`);
  const a = client(body.code, 'あい', { play: false });
  await until(() => a.view, 10000, 'a の入室');
  const b = client(body.code, 'しね', { play: false }); // NG ワード → プレイヤー2
  await until(() => a.view?.seats.length === 2, 10000, 'b の入室');
  assert(a.view.host && !b.view?.host, '作った人だけが host になっていない');
  assert(a.view.seats[1].name === 'プレイヤー2', `名前が置き換わっていない：${a.view.seats[1].name}`);
  b.send({ t: 'start' });
  await until(() => b.errors.length, 5000, '作った人でない人の開始が弾かれる');
  a.send({ t: 'start' });
  await until(() => a.view?.game, 10000, '開始');
  assert(a.view.seats.filter((s) => s.cpu).length === 2, 'CPU が 2 人入っていない');
  assert(a.view.game.rng === 0 && a.view.game.deck.length === 0, '乱数・山札が送られている');
  // 手番でない人の操作は弾く
  const other = a.view.game.turn === a.seat ? b : a;
  other.send({ t: 'act', action: { type: 'roll' } });
  await until(() => other.errors.some((e) => e.includes('あなたの番')), 5000, '手番でない操作のエラー');
  // 定型メッセージ
  a.send({ t: 'emote', id: 0 });
  await until(() => b.emotes.length === 1, 5000, '定型メッセージ');
  // ここから自動で遊ぶ
  a.play = true; b.play = true;
  a.send({ t: 'ping' }); b.send({ t: 'ping' });
  const g0 = a.view.game;
  if (g0.turn === a.seat) a.send({ t: 'act', action: { type: 'roll' } });
  if (g0.turn === b.seat) b.send({ t: 'act', action: { type: 'roll' } });
  // 途中で b が切断 → 再接続しても同じ席に戻る
  const token = b.token, seat = b.seat;
  b.ws.close();
  await until(() => a.view?.seats[seat].connected === false, 10000, '切断が伝わる');
  const b2 = client(body.code, 'しね', { token });
  await until(() => b2.seat === seat && a.view?.seats[seat].connected, 10000, () => `再接続（b2.seat=${b2.seat} 期待=${seat} errors=${b2.errors} closed=${b2.closed}(${b2.closeReason}) views=${b2.views} a側=${JSON.stringify(a.view?.seats)}）`);
  await until(() => a.view?.game?.phase === 'over', 120000, 'ゲーム終了');
  assert(a.view.game.winner != null, '勝者がいない');
  a.ws.close(); b2.ws.close();
});

await step('相手探し：同じマップ・モードの 2 人が同じ部屋に入り、4 人目まで集まる', async () => {
  const r1 = await post('/api/match', { mapId: 'harbor', mode: 'normal' });
  const a = client(r1.body.code, 'たろう', { play: false });
  await until(() => a.view, 10000, 'a');
  const r2 = await post('/api/match', { mapId: 'harbor', mode: 'normal' });
  assert(r2.body.code === r1.body.code, '別の部屋に案内された');
  const r3 = await post('/api/match', { mapId: 'corner', mode: 'normal' });
  assert(r3.body.code !== r1.body.code, 'マップが違うのに同じ部屋');
  const cs = [a];
  for (const n of ['じろう', 'さぶろう', 'しろう']) {
    const { body } = await post('/api/match', { mapId: 'harbor', mode: 'normal' });
    assert(body.code === r1.body.code, `${n} が別の部屋`);
    cs.push(client(body.code, n, { play: false }));
    await until(() => cs.at(-1).view, 10000, n);
  }
  await until(() => a.view?.game, 10000, '4 人そろって自動で開始');
  assert(a.view.seats.every((s) => !s.cpu), 'CPU が入っている');
  const r5 = await post('/api/match', { mapId: 'harbor', mode: 'normal' });
  assert(r5.body.code !== r1.body.code, '始まった部屋に案内された');
  // だれも操作しなくても、時間切れ（FAST では演出なし。持ち時間は 30 秒）で進む…はテストでは待たない
  cs.forEach((c) => c.ws.close());
});

await step('送りすぎると切断される', async () => {
  const { body } = await post('/api/rooms', { mapId: 'corner', mode: 'easy' });
  const a = client(body.code, 'はやい', { play: false });
  await until(() => a.view, 10000, 'a');
  for (let i = 0; i < 20; i++) a.send({ t: 'ping' });
  await until(() => a.closed, 5000, '切断');
});

await step('入口：おかしな入力・よそのサイトからの呼び出しは弾く', async () => {
  assert((await post('/api/rooms', { mapId: 'nope', mode: 'normal' })).status === 400, 'マップの確認');
  assert((await post('/api/match', { mapId: 'corner', mode: 'hard' })).status === 400, 'モードの確認');
  assert((await post('/api/rooms', { mapId: 'corner', mode: 'normal' }, { Origin: 'https://evil.example' })).status === 403, 'Origin の確認');
  const r = await fetch(`${BASE}/api/rooms/ABCDEF/ws`);
  assert(r.status === 426, 'WebSocket 以外');
});

stop();
console.log(results.join('\n'));
if (failed) console.log('\n--- サーバーの記録（最後の部分） ---\n' + log.slice(-3000));
console.log(failed ? `\n${failed} 件失敗` : `\nすべて成功（${results.length} 件）`);
process.exit(failed ? 1 : 0);
