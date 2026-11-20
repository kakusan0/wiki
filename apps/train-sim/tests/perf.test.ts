import { describe, it, expect } from 'vitest';
import { Governor, startLevel, LEVELS } from '../src/perf';

const run = (g: Governor, ms: number, sec: number) => {
  const changes: number[] = [];
  for (let t = 0; t < sec * 1000; t += ms) { const c = g.frame(ms); if (c !== null) changes.push(c); }
  return changes;
};

describe('自動調整', () => {
  it('はじめの段：スマホは 3、PC は 1', () => {
    expect(startLevel(true, 1200)).toBe(3);
    expect(startLevel(false, 700)).toBe(3);
    expect(startLevel(false, 1080)).toBe(1);
  });
  it('重いコマが続くと段が下がる（画質を落とす）', () => {
    const g = new Governor(1);
    const ch = run(g, 33, 6);
    expect(ch.length).toBeGreaterThan(0);
    expect(g.level).toBeGreaterThan(1);
  });
  it('段を変えた直後の 2 秒は動かない', () => {
    const g = new Governor(1);
    expect(run(g, 40, 1.9)).toEqual([]);
  });
  it('60 FPS が続くと 1 段上げて試す', () => {
    const g = new Governor(3);
    run(g, 16.7, 12);
    expect(g.level).toBe(2);
  });
  it('上げて落ちた段は、しばらく試さない', () => {
    const g = new Governor(3);
    run(g, 16.7, 11); // 2 へ上がる
    expect(g.level).toBe(2);
    for (let i = 0; i < 1000 && g.level === 2; i++) g.frame(25); // 2 では重い → 3 へ戻る
    expect(g.level).toBe(3);
    run(g, 16.7, 20); // 3 では快適でも、2 はしばらく試さない
    expect(g.level).toBe(3);
  });
  it('一番下の段より下には下がらない。固定のときは動かない', () => {
    const g = new Governor(LEVELS.length - 1);
    run(g, 50, 10);
    expect(g.level).toBe(LEVELS.length - 1);
    const f = new Governor(1, false);
    run(f, 50, 10);
    expect(f.level).toBe(1);
    expect(Math.round(f.fps)).toBe(20);
  });
});
