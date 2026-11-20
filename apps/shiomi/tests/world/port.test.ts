// 港町（トラックの世界）を、ひかり野線の世界に重ねたときの決まりごと
import { describe, it, expect } from 'vitest';
import { OFFSET, PORT_Y, CROSS_S, CROSS_LOCAL, RAIL, railDist, roadLift, portLand, portSea, toWorld, DECK_H } from '../../src/world/port';
import { at, CROSSINGS } from '../../src/train/route';
import { EDGES, LOTS, PLACES, node } from '../../src/truck/world/roadnet';

describe('港町の置き場所', () => {
  it('港の座標の踏切は、ひかり野線の踏切（s 600）と同じ所で、地面は路盤の高さ', () => {
    const f = at(CROSS_S);
    expect(CROSS_LOCAL.x + OFFSET.x).toBeCloseTo(f.x, 6);
    expect(CROSS_LOCAL.z + OFFSET.z).toBeCloseTo(f.z, 6);
    expect(PORT_Y).toBeCloseTo(f.y - 0.8, 6);
    expect(CROSSINGS.some((c) => c.s === CROSS_S && c.road === false)).toBe(true);
  });

  it('港町の道は、踏切のほかでは線路に近づかない', () => {
    for (const e of EDGES) {
      const a = node(e.a), b = node(e.b);
      let min = Infinity;
      for (let t = 0; t <= 1; t += 0.005) min = Math.min(min, railDist(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t).d);
      const crossing = (e.a === 'gate' && e.b === 'A');
      if (crossing) expect(min).toBeLessThan(3);
      else expect(min, `${e.a}–${e.b}`).toBeGreaterThan(14);
    }
  });

  it('構内と停止枠は、線路から離れている', () => {
    for (const l of LOTS) {
      let min = Infinity;
      for (let x = l.x0; x <= l.x1; x += 4) for (let z = l.z0; z <= l.z1; z += 4) min = Math.min(min, railDist(x, z).d);
      expect(min, l.id).toBeGreaterThan(12);
    }
    for (const p of PLACES) expect(railDist(p.dock.x, p.dock.z).d, p.id).toBeGreaterThan(20);
  });

  it('陸と海：港町の東は陸、潮見台の西の町は港町の外、岸壁の西は海', () => {
    const east = toWorld(800, 300), seaP = toWorld(-200, -100);
    const westTown = toWorld(150, 400); // 潮見台の西（線路の西、積み込み場の南）
    const nr = (p: { x: number; z: number }) => { let best = { s: 0, d: 0, dist: Infinity }; for (let s = -300; s < 2000; s += 2) { const f = at(s); const dd = Math.hypot(p.x - f.x, p.z - f.z); if (dd < best.dist) best = { s, d: (p.x - f.x) * f.lx + (p.z - f.z) * f.lz, dist: dd }; } return best.d; };
    expect(portLand(east.x, east.z, nr(east))).toBeCloseTo(1, 5);
    expect(portLand(westTown.x, westTown.z, nr(westTown))).toBe(0);
    expect(portSea(seaP.x, seaP.z)).toBeCloseTo(1, 5);
    expect(portSea(east.x, east.z)).toBe(0);
  });

  it('踏切の板：線路の上はレール面の高さ、離れると港町の地面', () => {
    const r = railDist(CROSS_LOCAL.x, CROSS_LOCAL.z);
    expect(r.d).toBeLessThan(3);
    expect(roadLift(CROSS_LOCAL.x + 1, 0)).toBeCloseTo(DECK_H, 5);
    expect(roadLift(CROSS_LOCAL.x + 30, 0)).toBe(0);
    expect(roadLift(CROSS_LOCAL.x, 200)).toBe(0);
  });

  it('線路の点は、港の座標で港町を南北に通る', () => {
    expect(RAIL[0].s).toBe(-300);
    expect(RAIL.every((p, i) => i === 0 || p.z < RAIL[i - 1].z)).toBe(true);
  });
});
