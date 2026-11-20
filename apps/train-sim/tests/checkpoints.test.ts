import { describe, it, expect } from 'vitest';
import { HIKARI } from '../src/route';
import { AOBA } from '../src/net/network';
import { createSim, step, pointCall, announce, horn, rank } from '../src/sim';
import { autopilot } from '../src/ai';
import { buildCheckpoints, judgeCheckpoints, nextCheckpoint } from '../src/checkpoints';

describe('出発駅と到着駅', () => {
  it('浜田から稲穂までだけを運転できる', () => {
    const sim = createSim('normal', HIKARI, 1, 2);
    expect(sim.s).toBe(HIKARI.stations[1].stop);
    expect(sim.at).toBe(1);
    for (let i = 0; i < 10 * 60 * 20 && !sim.finished; i++) { autopilot(sim); step(sim, 0.05); }
    expect(sim.finished).toBe(true);
    expect(sim.legs.map((l) => l.station)).toEqual([2]);
    expect(['S', 'A', 'B']).toContain(rank(sim));
  });
  it('到着駅は出発駅より先になる', () => {
    const sim = createSim('normal', HIKARI, 2, 1);
    expect(sim.end).toBe(3);
  });
});

describe('チェックポイント', () => {
  it('区間ごとに、発車・信号・制限・ブレーキ・停止位置が並ぶ', () => {
    const cps = buildCheckpoints(createSim('normal', HIKARI));
    const kinds = new Set(cps.map((c) => c.kind));
    for (const k of ['depart', 'call', 'limit', 'horn', 'announce', 'brake', 'stop']) expect(kinds.has(k as never), k).toBe(true);
    for (let i = 1; i < cps.length; i++) expect(cps[i].leg >= cps[i - 1].leg).toBe(true);
  });
  it('正しい操作をすれば合格、しなければ不合格', () => {
    for (const careful of [true, false]) {
      const sim = createSim('normal', AOBA);
      const cps = buildCheckpoints(sim);
      for (let i = 0; i < 15 * 60 * 20 && !sim.finished; i++) {
        autopilot(sim);
        if (careful) {
          const c = nextCheckpoint(cps, sim);
          if (c && c.kind === 'call' && c.s - sim.s < 250 && c.s > sim.s) pointCall(sim);
          if (c && c.kind === 'announce' && c.s - sim.s < 900 && c.s > sim.s) announce(sim);
          if (c && c.kind === 'horn' && c.s - sim.s < 200 && c.s > sim.s) horn(sim);
        }
        step(sim, 0.05);
        judgeCheckpoints(cps, sim);
      }
      expect(sim.finished).toBe(true);
      const calls = cps.filter((c) => c.kind === 'call');
      expect(calls.length).toBeGreaterThan(2);
      for (const c of calls) expect(c.result, c.title).toBe(careful ? 'ok' : 'ng');
      for (const c of cps.filter((x) => x.kind === 'stop' || x.kind === 'limit')) expect(c.result, c.title).toBe('ok');
      expect(cps.every((c) => c.result !== 'pending')).toBe(true);
    }
  });
});
