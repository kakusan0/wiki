import { describe, it, expect, beforeEach } from 'vitest';
import { MAIN, HIKARI, TRAIN_LEN } from '../src/route';
import { AOBA, SAZANAMI, AOBA_TRACK, AOBA_OWN, MERGE_S, SAZA_TRACK, SAZA_CROSS, DIAMOND, ROUTES } from '../src/net/network';
import { ILK, wireSignals, simRef } from '../src/net/interlock';
import { createSim, step, Sim } from '../src/sim';
import { autopilot } from '../src/ai';

describe('路線網の形', () => {
  it('あおば線は合流点でひかり野線にぴったりつながる', () => {
    const a = AOBA_TRACK.at(AOBA_OWN), m = MAIN.at(MERGE_S);
    expect(Math.hypot(a.x - m.x, a.z - m.z)).toBeLessThan(0.05);
    expect(Math.abs(a.th - m.th)).toBeLessThan(0.01);
    // 運転経路の中心線は 1 m ごとに途切れない
    for (const r of ROUTES) for (let s = 1; s < r.path.length; s++) {
      const p = r.path.at(s - 1), q = r.path.at(s);
      expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeLessThan(1.05);
    }
  });
  it('曲線の半径は 180 m 以上', () => {
    for (const p of [AOBA_TRACK, SAZA_TRACK]) for (let s = 0; s < p.length; s++) expect(Math.abs(p.curvatureAt(s))).toBeLessThan(1 / 180);
  });
  it('平面交差：あおば線はひかり野線の 2 本の線路と同じ高さで交わる', () => {
    expect(DIAMOND.angle).toBeGreaterThan(0.3);
    const a = AOBA_TRACK.at(DIAMOND.aoba[0]), m = MAIN.at(DIAMOND.main0);
    expect(Math.abs(a.y - m.y)).toBeLessThan(0.2);
  });
  it('立体交差：さざなみ線は浜田の真上で 6 m 以上高い', () => {
    const c = SAZA_TRACK.at(SAZA_CROSS), m = MAIN.at(2110);
    expect(Math.hypot(c.x - m.x, c.z - m.z)).toBeLessThan(0.5);
    expect(c.y - m.y).toBeGreaterThan(6);
  });
});

function run(sims: Sim[], sec: number, onStep?: () => void) {
  for (let i = 0; i < sec * 20; i++) {
    ILK.update();
    for (const s of sims) { autopilot(s); step(s, 0.05); }
    onStep?.();
    if (sims.every((s) => s.finished)) break;
  }
}

describe('連動と自動運転', () => {
  beforeEach(() => { ILK.clear(); wireSignals(); });
  it('3 路線とも、ほかの列車と一緒に終点まで ATS なしで走りきる', () => {
    const sims = ROUTES.map((r) => createSim('normal', r));
    sims.forEach((s, i) => ILK.add(simRef('t' + i, s)));
    let minGap = Infinity;
    run(sims, 20 * 60, () => {
      // 合流の先の同じ線路で、2 本の列車が重ならない
      const h = sims[0], a = sims[1];
      const am = a.s >= AOBA_OWN ? MERGE_S + (a.s - AOBA_OWN) : null;
      if (am !== null && h.s > MERGE_S - 50 && !(a.finished && a.t - a.finishedAt > 25)) minGap = Math.min(minGap, Math.abs(h.s - am) - TRAIN_LEN);
    });
    for (const s of sims) {
      expect(s.finished, s.route.name).toBe(true);
      for (const l of s.legs) {
        expect(l.notes.filter((n) => n.includes('ATS') || n.includes('赤信号')), s.route.name).toEqual([]);
        expect(Math.abs(l.posErr!), `${s.route.name} ${l.station}`).toBeLessThan(3);
      }
    }
    expect(minGap).toBeGreaterThan(20);
  });
  it('平面交差：先に近づいた列車が通るまで、もう片方は赤信号の手前で止まる', () => {
    // 2 本が同じころに交差へ着くよう、途中から走らせる
    const h = createSim('normal', HIKARI), a = createSim('normal', AOBA);
    h.at = -1; h.served = false; h.door = 'closed'; h.next = 1; h.s = DIAMOND.main0 - 650; h.v = 15; h.passedSig = HIKARI.signals.filter((x) => x.s <= h.s).length;
    a.at = -1; a.served = false; a.door = 'closed'; a.next = 1; a.s = DIAMOND.aoba[0] - 440; a.v = 12; a.passedSig = AOBA.signals.filter((x) => x.s <= a.s).length;
    ILK.add(simRef('h', h)); ILK.add(simRef('a', a));
    let both = false;
    run([h, a], 200, () => {
      const hin = h.s > DIAMOND.main0 - 12 && h.s - TRAIN_LEN < DIAMOND.main0 + 12;
      const ain = a.s > DIAMOND.aoba[0] - 12 && a.s - TRAIN_LEN < DIAMOND.aoba[1] + 12;
      if (hin && ain) both = true;
    });
    expect(both).toBe(false);
    expect(h.s).toBeGreaterThan(DIAMOND.main0 + 100);
    expect(a.s).toBeGreaterThan(DIAMOND.aoba[1] + 100);
    for (const s of [h, a]) expect(s.leg.notes.filter((n) => n.includes('ATS') || n.includes('赤信号'))).toEqual([]);
  });
  it('さざなみ線は単独で走りきる', () => {
    const s = createSim('normal', SAZANAMI);
    run([s], 10 * 60);
    expect(s.finished).toBe(true);
  });
});

describe('貨物列車（トラックのゲームとつながる）', () => {
  beforeEach(() => { ILK.clear(); wireSignals(); });
  it('途中の駅は通過しても減点されず、山ノ口で止まって終わる', async () => {
    const { FREIGHT } = await import('../src/route');
    const f = createSim('normal', FREIGHT);
    ILK.add(simRef('freight', f));
    run([f], 15 * 60);
    expect(f.finished).toBe(true);
    expect(f.legs.map((l) => FREIGHT.stations[l.station].name)).toEqual(['山ノ口']);
    const notes = f.legs.flatMap((l) => l.notes);
    expect(notes.filter((n) => n.includes('通過') || n.includes('ATS') || n.includes('赤信号'))).toEqual([]);
    expect(Math.abs(f.legs[0].posErr!)).toBeLessThan(3);
  });
  it('あおば線・さざなみ線と一緒に走っても、ATS にかからず走りきる（ひかり野線の線路を使う）', async () => {
    const { FREIGHT } = await import('../src/route');
    expect(FREIGHT.track).toBe('hikari');
    const sims = [createSim('normal', FREIGHT), ...ROUTES.filter((r) => r.id !== 'hikari').map((r) => createSim('normal', r))];
    sims.forEach((s, i) => ILK.add(simRef('t' + i, s)));
    run(sims, 20 * 60);
    for (const s of sims) {
      expect(s.finished, s.route.name).toBe(true);
      expect(s.legs.flatMap((l) => l.notes).filter((n) => n.includes('ATS') || n.includes('赤信号')), s.route.name).toEqual([]);
    }
  });
});
