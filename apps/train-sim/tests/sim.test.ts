import { describe, it, expect } from 'vitest';
import { at, nearest, STATIONS, LENGTH, fmtTime } from '../src/route';
import { createSim, step, setNotch, toggleDoor, totalScore, rank, nextSignal, aspectOf, legTotal } from '../src/sim';

import { autopilot } from '../src/ai';

describe('路線', () => {
  it('中心線はなめらかにつながり、近い点の逆算ができる', () => {
    let prev = at(0);
    for (let s = 1; s < LENGTH; s += 1) {
      const f = at(s);
      expect(Math.hypot(f.x - prev.x, f.z - prev.z)).toBeCloseTo(1, 2);
      prev = f;
    }
    const f = at(2345.5, 12);
    const n = nearest(f.x, f.z);
    expect(n.s).toBeGreaterThan(2344); expect(n.s).toBeLessThan(2347);
    expect(n.d).toBeCloseTo(12, 0);
  });
  it('時刻の表示', () => { expect(fmtTime(7 * 3600 + 65)).toBe('07:01:05'); });
});

describe('運転', () => {
  it('はじめは潮見台に停車中で、ドアが開いている', () => {
    const sim = createSim();
    expect(sim.at).toBe(0); expect(sim.door).toBe('open');
    setNotch(sim, 5); step(sim, 1);
    expect(sim.v).toBe(0); // ドアが開いていると動かない
  });
  it('出発信号は発車 10 秒前まで赤', () => {
    const sim = createSim();
    const ns = nextSignal(sim)!;
    expect(aspectOf(ns.sig, sim)).toBe('R');
    sim.t = STATIONS[0].dep - 9;
    expect(aspectOf(ns.sig, sim)).toBe('G');
  });
  it('自動運転で終点まで、ATS を作動させずに定刻近くで走りきれる', () => {
    const sim = createSim();
    for (let i = 0; i < 20 * 60 * 20 && !sim.finished; i++) { autopilot(sim); step(sim, 0.05); }
    expect(sim.finished).toBe(true);
    expect(sim.legs.length).toBe(STATIONS.length - 1);
    for (const l of sim.legs) {
      expect(l.notes.filter((n) => n.includes('ATS') || n.includes('赤信号'))).toEqual([]);
      expect(Math.abs(l.posErr!)).toBeLessThan(3);
      expect(Math.abs(l.arrErr!)).toBeLessThan(40);
      expect(legTotal(l)).toBeGreaterThan(50);
    }
    expect(totalScore(sim)).toBeGreaterThan(180);
    expect(['S', 'A', 'B']).toContain(rank(sim));
  });
  it('制限を大きく超えると ATS が働く', () => {
    const sim = createSim();
    sim.t = STATIONS[0].dep; toggleDoor(sim);
    for (let i = 0; i < 80; i++) step(sim, 0.05);
    setNotch(sim, 5);
    let fired = false;
    for (let i = 0; i < 2000 && !fired; i++) { step(sim, 0.05); fired = sim.ats === 'brake'; }
    expect(fired).toBe(true);
  });
});
