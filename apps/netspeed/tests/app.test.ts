import { describe, it, expect } from 'vitest';
import { memoryD1 } from './d1';
import { handle, ingest, summary, cleanup, ensureSchema, Env } from '../src/worker/app';
import { DatabaseSync } from 'node:sqlite';
import { local, median, byPlace } from '../src/shared/stats';

const NOW = Date.UTC(2026, 10, 18, 12, 0, 0) / 1000; // 2026-11-18 21:00 日本時間（水曜）
const env = (): Env => ({ DB: memoryD1(), INGEST_TOKEN: 'tok-123', VIEW_PASSWORD: 'pass-xyz', SESSION_SECRET: 'sec', TZ_OFFSET_MIN: '540' });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://x.test${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });

/** 2 週間ぶんの測定：深夜〜早朝は速く、夜 21〜23 時は遅い */
function fakeDays(days: number, now: number) {
  const out = [];
  for (let t = now - days * 86400; t < now; t += 300) {
    const { hour } = local(t, 540);
    const down = hour >= 21 ? 40 : hour < 6 ? 420 : 200;
    out.push({ ts: t, kind: 'quick', down: down + (t % 7), up: down / 2, ping: hour >= 21 ? 35 : 9, jitter: 1, loss: 0, colo: 'NRT' });
  }
  return out;
}

describe('集計', () => {
  it('日本時間の曜日と時刻', () => {
    expect(local(NOW, 540)).toEqual({ wd: 2, hour: 21, date: '2026-11-18' });
    expect(median([5, 1, 3, 2])).toBe(2.5);
  });
  it('どの時間帯が速いかが出る（ベスト 3 は早朝、ワースト 3 は夜）', async () => {
    const db = memoryD1();
    const data = fakeDays(14, NOW);
    for (let i = 0; i < data.length; i += 400) await ingest(db, data.slice(i, i + 400), NOW);
    const s = await summary(db, NOW, 540, 14);
    expect(s.best.every((b) => b.hour < 6)).toBe(true);
    expect(s.worst.every((b) => b.hour >= 21)).toBe(true);
    expect(s.heat.down[2][3]).toBeGreaterThan(400);
    expect(s.heat.down[2][22]).toBeLessThan(50);
    expect(s.byHour.ping[22]).toBe(35);
    expect(s.daily.length).toBe(7);
    expect(s.latest?.ts).toBe(data[data.length - 1].ts);
    expect(s.totals.samples).toBe(data.length);
  });
  it('同じ時刻の測定を 2 回送っても 1 回だけ数える。おかしな値ははじく', async () => {
    const db = memoryD1();
    const one = { ts: NOW - 60, kind: 'quick', down: 100, up: 50, ping: 10, jitter: 1, loss: 0 };
    await ingest(db, [one, one], NOW);
    const r = await ingest(db, [one, { ...one, ts: NOW + 9999 }, { ...one, kind: 'x' }, { ...one, ts: NOW - 120, down: -5 }], NOW);
    expect(r.accepted).toBe(2); // 重複（無視される）と、下りが負の値（その値だけ空になる）
    const h = db.raw.prepare('SELECT * FROM hourly').all() as { n: number; down_n: number; fail: number }[];
    expect(h.reduce((a, x) => a + x.n, 0)).toBe(2);
    expect(h.reduce((a, x) => a + x.fail, 0)).toBe(1);
  });
  it('古い記録を消す', async () => {
    const db = memoryD1();
    await ingest(db, [{ ts: NOW - 29 * 86400, kind: 'quick', down: 1 }, { ts: NOW - 60, kind: 'quick', down: 2 }], NOW);
    await cleanup(db, NOW, 7);
    expect((db.raw.prepare('SELECT COUNT(*) AS c FROM samples').get() as { c: number }).c).toBe(1);
  });
});

describe('受け口と合言葉', () => {
  it('鍵がないと記録できない', async () => {
    const e = env();
    expect((await handle(post('/api/ingest', { samples: [] }), e, NOW)).status).toBe(401);
    expect((await handle(post('/api/ingest', { samples: [] }, { authorization: 'Bearer nope' }), e, NOW)).status).toBe(401);
    const ok = await handle(post('/api/ingest', { samples: [{ ts: NOW - 5, kind: 'quick', down: 300 }] }, { authorization: 'Bearer tok-123' }), e, NOW);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ accepted: 1, rejected: 0 });
  });
  it('合言葉で入ると集計が見られる。入る前は見られない', async () => {
    const e = env();
    expect((await handle(new Request('https://x.test/api/summary'), e, NOW)).status).toBe(401);
    const bad = await handle(post('/api/login', { password: 'wrong' }), e, NOW);
    expect(bad.status).toBe(401);
    const good = await handle(post('/api/login', { password: 'pass-xyz' }), e, NOW);
    expect(good.status).toBe(200);
    const cookie = good.headers.get('set-cookie')!.split(';')[0];
    expect(good.headers.get('set-cookie')).toContain('HttpOnly');
    const s = await handle(new Request('https://x.test/api/summary?days=7', { headers: { cookie } }), e, NOW);
    expect(s.status).toBe(200);
    expect((await s.json()).days).toBe(7);
    // 31 日後には切れている
    expect((await handle(new Request('https://x.test/api/summary', { headers: { cookie } }), e, NOW + 31 * 86400)).status).toBe(401);
    // 書きかえた合言葉の印は通らない
    const forged = cookie.replace(/\.(.)/, (_m, c) => '.' + (c === 'A' ? 'B' : 'A'));
    expect((await handle(new Request('https://x.test/api/summary', { headers: { cookie: forged } }), e, NOW)).status).toBe(401);
  });
  it('5 回まちがえると 15 分入れない', async () => {
    const e = env();
    const h = { 'cf-connecting-ip': '203.0.113.5' };
    for (let i = 0; i < 4; i++) expect((await handle(post('/api/login', { password: 'x' }, h), e, NOW)).status).toBe(401);
    expect((await handle(post('/api/login', { password: 'x' }, h), e, NOW)).status).toBe(429);
    expect((await handle(post('/api/login', { password: 'pass-xyz' }, h), e, NOW + 60)).status).toBe(429); // 正しくても今は入れない
    expect((await handle(post('/api/login', { password: 'pass-xyz' }, h), e, NOW + 901)).status).toBe(200);
  });
  it('シークレットが未設定なら、わかるように止まる', async () => {
    const r = await handle(post('/api/login', {}), { DB: memoryD1() }, NOW);
    expect(r.status).toBe(503);
  });
});

describe('スマホでボタンを押して測った記録', () => {
  it('ログインしていれば記録でき、同じころの PC（有線）の値と並ぶ', async () => {
    const e = env();
    const good = await handle(post('/api/login', { password: 'pass-xyz' }), e, NOW);
    const cookie = good.headers.get('set-cookie')!.split(';')[0];
    // ログインなしでは記録できない
    expect((await handle(post('/api/spot', { down: 100 }), e, NOW)).status).toBe(401);
    await ingest(e.DB, [{ ts: NOW - 60, kind: 'quick', down: 400, up: 200, ping: 8 }], NOW);
    const r = await handle(post('/api/spot', { device: 'phone', place: '寝室<b>', net: 'wifi', down: 120, up: 60, ping: 15, jitter: 3 }, { cookie }), e, NOW);
    expect(r.status).toBe(200);
    const saved = await r.json();
    expect(saved.place).toBe('寝室b'); // 記号は取りのぞく
    await handle(post('/api/spot', { place: 'リビング', net: 'wifi', down: 300 }, { cookie }), e, NOW); // 同じ秒：1 秒ずらして残る
    expect((await handle(post('/api/spot', { place: 'x' }, { cookie }), e, NOW)).status).toBe(400); // 下りがない
    const s = await (await handle(new Request('https://x.test/api/summary', { headers: { cookie } }), e, NOW + 5)).json();
    expect(s.spots.length).toBe(2);
    expect(s.spots.find((x: { place: string }) => x.place === '寝室b').pcDown).toBe(400);
    const places = byPlace(s.spots);
    expect(places[0].place).toBe('リビング');
    expect(places[1].ratio).toBeCloseTo(0.3, 2);
  });
});

describe('表の用意', () => {
  it('空の D1 でも、最初のリクエストで表を作って動く（デプロイのコマンドに頼らない）', async () => {
    const db = memoryD1();
    for (const t of ['samples', 'hourly', 'throttle', 'spots']) db.raw.exec(`DROP TABLE ${t}`);
    const e: Env = { DB: db, INGEST_TOKEN: 'tok-123', VIEW_PASSWORD: 'pass-xyz', SESSION_SECRET: 'sec' };
    const r = await handle(post('/api/ingest', { samples: [{ ts: NOW - 5, kind: 'quick', down: 10 }] }, { authorization: 'Bearer tok-123' }), e, NOW);
    expect(r.status).toBe(200);
    await ensureSchema(db); // 2 回目は何もしない
    void DatabaseSync;
  });
});
