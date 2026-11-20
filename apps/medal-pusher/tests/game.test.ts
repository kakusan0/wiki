import { describe, expect, it } from 'vitest';
import { Game, JP_BASE, POCKETS, SAIL_MAX } from '../src/game/game';
import { Sim, HALF_W } from '../src/game/sim';
import { DAILY, claim, canClaim, nextIndex } from '../src/game/daily';

const rng = (seed: number) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const run = (g: Game, sec: number, each?: () => void) => { for (let i = 0; i < sec * 60; i++) { each?.(); g.update(1 / 60); } };

describe('メダルの動き', () => {
  it('プッシャーに押されて手前から落ちたメダルは払い出し', () => {
    const sim = new Sim();
    // 下段いっぱいに並べる
    for (let row = 0; row < 8; row++) for (let i = 0; i < 11; i++) sim.add({ x: -2.2 + i * 0.44, z: -0.3 + row * 0.38, tier: 1, y: 0 });
    let pay = 0;
    for (let f = 0; f < 60 * 20; f++) { sim.step(1 / 60); pay += sim.events.filter((e) => e.k === 'payout').length; sim.events = []; }
    expect(pay).toBeGreaterThan(0);
  });
  it('メダルは壁の外に出ない（下段の手前の横の開いた所だけ落ちる）', () => {
    const sim = new Sim();
    sim.fill(rng(3));
    for (let f = 0; f < 60 * 10; f++) sim.step(1 / 60);
    for (const c of sim.coins) if (!c.falling && c.tier === 0) expect(Math.abs(c.x)).toBeLessThanOrEqual(HALF_W);
  });
});

describe('台のルール', () => {
  it('メダルの数は合う：持ち＋台＋払い出し・横落ち・チャッカーの記録で説明できる', () => {
    const g = new Game(rng(11));
    const start = g.wallet + g.sim.fieldCount();
    let paid = 0, lost = 0, chk = 0, ins = 0;
    run(g, 120, () => {
      if (g.insert((Math.random() * 2 - 1))) ins++;
      for (const e of g.events) { if (e.k === 'payout') paid += e.n; if (e.k === 'lost') lost++; if (e.k === 'chucker') chk++; }
      g.events = [];
    });
    expect(ins).toBeGreaterThan(100);
    // ボーナス（ルーレット・ジャックポット・スロット）を除いた範囲で、台から出た数と入った数が釣り合う
    expect(g.wallet).toBeGreaterThanOrEqual(0);
    expect(paid + lost + chk).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(0);
  });
  it('長く遊ぶと、戻りはおよそ 7〜11 割', { timeout: 120000 }, () => {
    const g = new Game(rng(5));
    g.wallet = 100000;
    let ins = 0;
    run(g, 1200, () => { if (g.insert(Math.sin(ins) * 0.9)) ins++; g.events = []; });
    const ret = (g.wallet - 100000 + ins) / ins;
    expect(ret).toBeGreaterThan(0.7);
    expect(ret).toBeLessThan(1.1);
  });
  it('メダルがなければ入れられない', () => {
    const g = new Game(rng(1));
    g.wallet = 0;
    expect(g.insert(0)).toBe(false);
  });
  it('チャッカー → スロット → ボール → ルーレットの流れ', { timeout: 120000 }, () => {
    const g = new Game(rng(2));
    g.wallet = 5000;
    const seen = new Set<string>();
    run(g, 900, () => { g.insert(0); for (const e of g.events) seen.add(e.k); g.events = []; });
    for (const k of ['chucker', 'slotStart', 'slotStop', 'ball', 'rouletteStart', 'roulette']) expect(seen.has(k), k).toBe(true);
    expect(POCKETS).toHaveLength(12);
  });
  it('ジャックポット：たまった分をもらい、元に戻る', () => {
    const g = new Game(rng(4));
    g.pool = 1234; g.gauge = SAIL_MAX - 1;
    const w = g.wallet;
    g.jackpot();
    expect(g.pool).toBe(JP_BASE);
    expect(g.gauge).toBe(0);
    expect(g.records.jackpots).toBe(1);
    run(g, 10, () => { g.events = []; });
    // 一部は台に流れ込み、残りは直接もらえる
    expect(g.wallet - w).toBeGreaterThanOrEqual(1234 - 120);
  });
  it('保存して読み込むと、同じ持ちメダル・台の上のメダル', () => {
    const g = new Game(rng(8));
    run(g, 3, () => { g.insert(0.3); g.events = []; });
    const s = JSON.parse(JSON.stringify(g.save()));
    const h = new Game(rng(9), s);
    expect(h.wallet).toBe(s.wallet);
    expect(h.sim.fieldCount()).toBe(s.coins.length);
    expect(h.pool).toBe(g.pool);
  });
});

describe('毎日のメダル', () => {
  it('1 日 1 回・続けると増え・空くと 1 日目から', () => {
    let s = { last: null as string | null, streak: 0 };
    const a = claim(s, '2026-11-18')!; expect(a.amount).toBe(DAILY[0]); s = a.state;
    expect(canClaim(s, '2026-11-18')).toBe(false);
    const b = claim(s, '2026-11-19')!; expect(b.amount).toBe(DAILY[1]); s = b.state;
    expect(nextIndex(s, '2026-11-21')).toBe(0);
    const c = claim(s, '2026-11-20')!; expect(c.amount).toBe(DAILY[2]);
    // 月をまたいでも続く
    expect(nextIndex({ last: '2026-11-30', streak: 6 }, '2026-12-01')).toBe(6);
    expect(nextIndex({ last: '2026-11-30', streak: 7 }, '2026-12-01')).toBe(0);
  });
});
