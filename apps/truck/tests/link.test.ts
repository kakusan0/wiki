import { describe, expect, it } from 'vitest';
import { memoryD1 } from './d1';
import { handle, MOUNTAIN, CODE_RE, TOWN_DESTS } from '../src/worker/link';

const NOW = 1_800_000_000;
function api(db = memoryD1()) {
  const env = { DB: db };
  const call = async (method: string, path: string, body?: unknown, now = NOW) => {
    const r = await handle(new Request(`https://truck.test${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, now);
    return { status: r.status, data: (await r.json()) as Record<string, unknown>, headers: r.headers };
  };
  return { db, call };
}

describe('荷物の記録置き場', () => {
  it('連携コードを作れて、ほかのページからも呼べる（CORS）', async () => {
    const { call } = api();
    const r = await call('POST', '/api/link');
    expect(r.status).toBe(200);
    expect(String(r.data.code)).toMatch(CODE_RE);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('知らないコードは断る', async () => {
    const { call } = api();
    expect((await call('GET', '/api/boxes?code=ABCDEFGH&at=station')).status).toBe(404);
    expect((await call('POST', '/api/train/run', { code: 'zzz' })).status).toBe(404);
  });

  it('ぐるっと回る：工場で積む → 駅に降ろす → 貨物列車で山ノ口へ → 帰りの分が駅に → トラックで町へ', async () => {
    const { call } = api();
    const code = String((await call('POST', '/api/link')).data.code);
    // 工場で 3 個積む
    const loaded = (await call('POST', '/api/factory/load', { code, n: 3 })).data.boxes as { id: number; dest: string; at: string }[];
    expect(loaded).toHaveLength(3);
    expect(loaded.every((b) => b.dest === MOUNTAIN && b.at === 'truck')).toBe(true);
    // 駅に降ろす
    expect((await call('POST', '/api/boxes/move', { code, ids: loaded.map((b) => b.id), from: 'truck', to: 'station' })).data.moved).toBe(3);
    const out = (await call('GET', `/api/boxes?code=${code}&at=station&dir=out`)).data.boxes as unknown[];
    expect(out).toHaveLength(3);
    // 貨物列車が着く
    const run = (await call('POST', '/api/train/run', { code })).data as { carried: unknown[]; arrived: { dest: string; at: string; id: number }[] };
    expect(run.carried).toHaveLength(3);
    expect(run.arrived.length).toBeGreaterThanOrEqual(3);
    expect(run.arrived.every((b) => TOWN_DESTS.includes(b.dest) && b.at === 'station')).toBe(true);
    expect((await call('GET', `/api/boxes?code=${code}&at=station&dir=out`)).data.boxes).toHaveLength(0);
    // 帰りの分をトラックで運ぶ
    const one = run.arrived[0].id;
    expect((await call('POST', '/api/boxes/move', { code, ids: [one], from: 'station', to: 'truck' })).data.moved).toBe(1);
    expect((await call('POST', '/api/boxes/move', { code, ids: [one], from: 'truck', to: 'delivered' })).data.moved).toBe(1);
    const c = (await call('GET', `/api/link?code=${code}`)).data.counts as Record<string, number>;
    expect(c.stationIn).toBe(run.arrived.length - 1);
  });

  it('いまの場所が合わないものは動かない（二重に動かさない）。決まった動きだけ', async () => {
    const { call } = api();
    const code = String((await call('POST', '/api/link')).data.code);
    const [b] = (await call('POST', '/api/factory/load', { code, n: 1 })).data.boxes as { id: number }[];
    expect((await call('POST', '/api/boxes/move', { code, ids: [b.id], from: 'truck', to: 'station' })).data.moved).toBe(1);
    expect((await call('POST', '/api/boxes/move', { code, ids: [b.id], from: 'truck', to: 'station' })).data.moved).toBe(0);
    expect((await call('POST', '/api/boxes/move', { code, ids: [b.id], from: 'station', to: 'delivered' })).status).toBe(400);
  });

  it('ほかのコードのコンテナは見えないし、動かせない', async () => {
    const { call } = api();
    const a = String((await call('POST', '/api/link')).data.code);
    const b = String((await call('POST', '/api/link')).data.code);
    const [x] = (await call('POST', '/api/factory/load', { code: a, n: 1 })).data.boxes as { id: number }[];
    expect((await call('POST', '/api/boxes/move', { code: b, ids: [x.id], from: 'truck', to: 'station' })).data.moved).toBe(0);
    expect((await call('GET', `/api/boxes?code=${b}&at=truck`)).data.boxes).toHaveLength(0);
  });

  it('おかしな値は断る', async () => {
    const { call } = api();
    const code = String((await call('POST', '/api/link')).data.code);
    expect((await call('POST', '/api/factory/load', { code, n: 50 })).status).toBe(400);
    expect((await call('GET', `/api/boxes?code=${code}&at=moon`)).status).toBe(400);
    expect((await call('POST', '/api/boxes/move', { code, ids: 'x', from: 'truck', to: 'station' })).status).toBe(400);
  });

  it('コードを作る回数には上限がある', async () => {
    const { call } = api();
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await call('POST', '/api/link')).status;
    expect(last).toBe(429);
  });

  it('記録置き場がまだないときは、わかる言葉で断る', async () => {
    const r = await handle(new Request('https://truck.test/api/link', { method: 'POST' }), {}, NOW);
    expect(r.status).toBe(503);
  });
});
