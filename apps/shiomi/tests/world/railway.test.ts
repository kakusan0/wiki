// トラックに乗っている間の鉄道：列車が時刻表どおりに走り、踏切が鳴り、走り終えたらまた走る
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Railway } from '../../src/world/railway';
import { CROSSINGS, T } from '../../src/train/route';
import type { TrackWorld } from '../../src/train/world/track';
import type { LinesWorld } from '../../src/train/world/lines';

function fakeWorld() {
  const track = { signals: [], crossings: CROSSINGS.map(() => ({ s: 0, arms: [new THREE.Object3D()], lights: [] })), tunnelLights: null, sleepers: [] } as unknown as TrackWorld;
  const lines = { signals: [], sleepers: [] } as unknown as LinesWorld;
  return { track, lines };
}
const noShape = () => ({ group: new THREE.Group(), cars: [], place() {} });

describe('トラックに乗っている間の鉄道', () => {
  it('ひかり野線の列車が港町の踏切（s 600）を通り、通る前から踏切が鳴る', () => {
    const { track, lines } = fakeWorld();
    const r = new Railway(new THREE.Group(), track, lines, () => {}, T(7, 0, 0), noShape);
    const i = CROSSINGS.findIndex((c) => c.s === 600);
    let rang = false, crossed = false, ringBefore = false;
    for (let k = 0; k < 10 * 300; k++) {
      r.update(0.1);
      const h = r.debug().ais.find((a) => a.id.startsWith('ai-hikari'))!;
      if (r.crossingActive(i)) { rang = true; if (h.s < 600) ringBefore = true; }
      if (h.s > 640) { crossed = true; break; }
    }
    expect(crossed).toBe(true);
    expect(rang && ringBefore).toBe(true);
    // 通り過ぎたら鳴りやむ
    for (let k = 0; k < 200; k++) r.update(0.1);
    // （下りの列車が近くに来ていなければ）
    if (!r.debug().oncoming.some((s) => s < 1100)) expect(r.crossingActive(i)).toBe(false);
  });

  it('潮見台で発車を待つ間は、港町の踏切は鳴らない', () => {
    const { track, lines } = fakeWorld();
    const r = new Railway(new THREE.Group(), track, lines, () => {}, T(7, 0, 0), noShape);
    const i = CROSSINGS.findIndex((c) => c.s === 600);
    r.update(0.1);
    expect(r.debug().ais.find((a) => a.id.startsWith('ai-hikari'))!.v).toBe(0);
    expect(r.crossingActive(i)).toBe(false);
  });

  it('走り終えた列車は、しばらくしてまた走り出す。下りの列車も出てくる', () => {
    const { track, lines } = fakeWorld();
    const r = new Railway(new THREE.Group(), track, lines, () => {}, T(7, 0, 0), noShape);
    const first = r.debug().ais.map((a) => a.id);
    let sawOncoming = false;
    for (let k = 0; k < 10 * 1200; k++) { r.update(0.1); if (r.debug().oncoming.length) sawOncoming = true; }
    const now = r.debug().ais.map((a) => a.id);
    expect(now.length).toBe(first.length);
    expect(now.some((id) => !first.includes(id))).toBe(true);
    expect(sawOncoming).toBe(true);
    expect(r.t).toBeCloseTo(T(7, 0, 0) + 1200, 0);
  });
});
