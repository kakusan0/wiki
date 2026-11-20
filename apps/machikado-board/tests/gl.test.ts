import { describe, expect, it } from 'vitest';
import * as G from '../src/ui/gl/geometry';
import { lookAt, mul, persp, project } from '../src/ui/gl/math';

const verts = (g: G.Geo) => Array.from({ length: g.length / G.STRIDE }, (_, i) => g.slice(i * G.STRIDE, i * G.STRIDE + G.STRIDE));

describe('形', () => {
  it('頂点数と三角形の数', () => {
    expect(G.triangles(G.cube())).toBe(12);
    expect(G.triangles(G.plane())).toBe(2);
    expect(G.triangles(G.prism())).toBe(6);
    expect(G.triangles(G.sphere(8, 16))).toBe(8 * 16 * 2);
    expect(G.triangles(G.cylinder(24))).toBe(24 * 4); // 側面 2 ＋ ふた 2
    expect(G.triangles(G.cone(24))).toBe(24 * 3); // 側面 2 ＋ 底 1
    expect(G.triangles(G.roundedBox(4, 0.1))).toBe(6 * 4 * 4 * 2);
  });
  it('細かさで分割が増える', () => {
    expect(G.triangles(G.cylinder(48))).toBe(4 * G.triangles(G.cylinder(12)));
  });
  for (const [name, geo] of [['cube', G.cube()], ['sphere', G.sphere(12, 24)], ['cylinder', G.cylinder(24)],
    ['roundedBox', G.roundedBox(6, 0.14)], ['lathe', G.lathe([[.5, 0], [.3, .5], [.2, 1]], 16)]] as const) {
    it(`${name}：法線の長さ 1、外向き、範囲は幅 1・高さ 0〜1`, () => {
      for (const v of verts(geo)) {
        expect(Math.hypot(v[3], v[4], v[5])).toBeCloseTo(1, 4);
        expect(Math.abs(v[0])).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(Math.abs(v[2])).toBeLessThanOrEqual(0.5 + 1e-9);
        expect(v[1]).toBeGreaterThanOrEqual(-1e-9);
        expect(v[1]).toBeLessThanOrEqual(1 + 1e-9);
        // 中心軸から見て外向き（ふた・底の面は上下向き）
        const out = v[0] * v[3] + (v[1] - 0.5) * v[4] + v[2] * v[5];
        expect(out).toBeGreaterThan(-1e-6);
        expect(v[6]).toBeGreaterThanOrEqual(-1e-9);
        expect(v[7]).toBeLessThanOrEqual(1 + 1e-9);
      }
    });
  }
  it('サイコロ：面ごとに目の枠の UV に入る', () => {
    const g = G.roundedBox(2, 0.1, [0, 5, 1, 4, 2, 3]);
    const top = verts(g).filter((v) => v[4] > 0.99);
    for (const v of top) { expect(v[6]).toBeLessThanOrEqual(0.25 + 1e-9); expect(v[7]).toBeLessThanOrEqual(0.5 + 1e-9); }
  });
});

describe('行列', () => {
  it('見ている中心は画面の真ん中に写る', () => {
    const vp = mul(persp(0.8, 1, 0.1, 100), lookAt([5, 5, 5], [0, 0, 0], [0, 1, 0]));
    const p = project(vp, [0, 0, 0])!;
    expect(p[0]).toBeCloseTo(0.5);
    expect(p[1]).toBeCloseTo(0.5);
    const up = project(vp, [0, 1, 0])!;
    expect(up[1]).toBeLessThan(0.5); // 上のものは画面の上へ
  });
  it('カメラの後ろは null', () => {
    const vp = mul(persp(0.8, 1, 0.1, 100), lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]));
    expect(project(vp, [0, 0, 10])).toBeNull();
  });
});
