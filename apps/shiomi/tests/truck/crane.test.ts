import { describe, expect, it } from 'vitest';
import { Crane, CRANE_TOL, type CraneInput } from '../../src/truck/sim/crane';

const none: CraneInput = { along: 0, lateral: 0, hoist: 0, skew: 0 };
const run = (c: Crane, inp: Partial<CraneInput>, sec: number, chassis = { along: 0, lateral: 0, yaw: 0 }) => {
  for (let t = 0; t < sec; t += 1 / 60) c.step({ ...none, ...inp }, chassis, 1 / 60);
};

describe('クレーンの吊り具', () => {
  it('急に動かすと揺れ、止めておくと揺れが収まる', () => {
    const c = new Crane();
    run(c, { along: 1 }, 2);
    run(c, {}, 1.5);
    const big = c.swing;
    expect(big).toBeGreaterThan(0.05);
    run(c, {}, 60);
    expect(c.swing).toBeLessThan(big * 0.2);
  });

  it('真上でゆっくり下ろすと着地し、ロックできる', () => {
    const c = new Crane(0, 0, 2);
    expect(c.lock()).toBe(false);
    run(c, { hoist: -0.3 }, 14);
    expect(c.landed).toBe(true);
    expect(c.bumps).toBe(0);
    expect(c.lock()).toBe(true);
  });

  it('ずれたまま下ろすと、荷台の端に乗って着地しない', () => {
    const c = new Crane(CRANE_TOL.along + 0.05, 0, 2);
    run(c, { hoist: -0.3 }, 14);
    expect(c.landed).toBe(false);
    expect(c.blocked).toBe(true);
    expect(c.lock()).toBe(false);
  });

  it('許す範囲ちょうどなら着地する（シャーシのずれに合わせる）', () => {
    const chassis = { along: 0.25, lateral: -0.12, yaw: 0.02 };
    const c = new Crane(0.25 + CRANE_TOL.along - 0.01, -0.12, 2);
    c.skew = 0.02;
    run(c, { hoist: -0.3 }, 14, chassis);
    expect(c.landed).toBe(true);
  });

  it('速く下ろすと、ぶつけた回数が 1 回だけ増える', () => {
    const c = new Crane(0, 0, 1);
    run(c, { hoist: -1 }, 5);
    expect(c.bumps).toBe(1);
  });

  it('着地したら、上げるまで横には動かない', () => {
    const c = new Crane(0, 0, 0.5);
    run(c, { hoist: -0.3 }, 4);
    expect(c.landed).toBe(true);
    run(c, { along: 1, lateral: 1 }, 2);
    expect(Math.abs(c.along)).toBeLessThan(0.01);
    run(c, { hoist: 1 }, 1);
    expect(c.landed).toBe(false);
    expect(c.h).toBeGreaterThan(0.3);
  });
});
