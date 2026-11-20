import { describe, expect, it } from 'vitest';
import { NODES, EDGES, PLACES, LOTS, KIND, route, steps, turnOf, where, nearestOn, node, len } from '../../src/truck/world/roadnet';

describe('道路網', () => {
  it('道はすべて東西か南北で、両端の交差点がある', () => {
    for (const e of EDGES) {
      const a = node(e.a), b = node(e.b);
      expect(a && b).toBeTruthy();
      expect(a.x === b.x || a.z === b.z).toBe(true);
      expect(len(e)).toBeGreaterThan(20);
    }
  });

  it('どの 2 つの交差点の間にも経路がある（つながっている）', () => {
    for (const a of NODES) for (const b of NODES) {
      const p = route(a.id, b.id);
      expect(p[0]).toBe(a.id);
      expect(p[p.length - 1]).toBe(b.id);
    }
  });

  it('ゲートからミドリ物流センターへ：臨港道路を東へ、B で左（北）、G で右（東）、M1 で左（構内へ）', () => {
    const p = route('gate', 'M2');
    expect(p).toEqual(['gate', 'A', 'B', 'G', 'M1', 'M2']);
    const st = steps(p);
    expect(st.map((s) => [s.at, s.turn])).toEqual([['B', 'left'], ['G', 'right'], ['M1', 'left'], ['M2', 'arrive']]);
  });

  it('右と左：東へ進んで南へ曲がるのは右', () => {
    expect(turnOf([1, 0], [0, 1])).toBe('right');
    expect(turnOf([1, 0], [0, -1])).toBe('left');
    expect(turnOf([0, -1], [1, 0])).toBe('right'); // 北へ進んで東へ
    expect(turnOf([1, 0], [1, 0])).toBe('straight');
  });

  it('道の上・歩道・構内・道の外と、制限速度', () => {
    // 臨港道路の左車線を東へ（東へ進むとき、左は北 = -z）
    expect(where(600, -3, 1, 0)).toMatchObject({ on: 'road', limit: 60, wrongWay: false });
    expect(where(600, 3, 1, 0).wrongWay).toBe(true);   // 右側（南）を東へ
    expect(where(600, 3, -1, 0).wrongWay).toBe(false); // 西へ進むなら南が左
    expect(where(600, KIND.main.w / 2 + 1, 1, 0).on).toBe('walk');
    expect(where(800, -150, 0, -1)).toMatchObject({ on: 'road', limit: 40 });
    expect(where(100, 0, 1, 0)).toMatchObject({ on: 'lot', limit: 20 });
    expect(where(600, 200, 1, 0).on).toBe('off');
  });

  it('届け先は構内の中にあり、構内は道とつながっている', () => {
    for (const p of PLACES) {
      const lot = LOTS.find((l) => l.id === p.lot)!;
      expect(p.dock.x).toBeGreaterThanOrEqual(lot.x0);
      expect(p.dock.x).toBeLessThanOrEqual(lot.x1);
      expect(p.dock.z).toBeGreaterThanOrEqual(lot.z0);
      expect(p.dock.z).toBeLessThanOrEqual(lot.z1);
      expect(route('gate', p.node).length).toBeGreaterThan(1);
    }
  });

  it('折れ線の上の最も近い所', () => {
    const pts = [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 50 }];
    const r = nearestOn(pts, 100.5, 20);
    expect(r.i).toBe(1);
    expect(r.s).toBeCloseTo(120);
    expect(r.d).toBeCloseTo(0.5);
  });
});

import { stationJobs, allJobs, RIGID_CAP, DEST_ID } from '../../src/truck/sim/jobs';
import { RIGID_12FT, cargoPose, createState } from '../../src/truck/sim/vehicle';
describe('依頼', () => {
  const b = (id: number, dest: string, w = 4000) => ({ id, num: `19D-${id}`, contents: '木材', weight: w, dest });
  it('駅のコンテナを、届け先ごとに 2 個までの依頼にまとめる', () => {
    const jobs = stationJobs([b(1, 'ミドリ物流センター'), b(2, 'ミドリ物流センター'), b(3, 'ミドリ物流センター'), b(4, '潮見精機 第二工場'), b(5, '山ノ口')]);
    expect(jobs.map((j) => [j.to, j.boxes.length])).toEqual([['midori', 2], ['midori', 1], ['seiki', 1]]);
    expect(jobs.every((j) => j.boxes.length <= RIGID_CAP)).toBe(true);
  });
  it('届け先はすべて地図にある', () => {
    for (const id of Object.values(DEST_ID)) expect(PLACES.some((p) => p.id === id)).toBe(true);
    for (const j of allJobs([])) for (const id of [j.from, j.to]) expect(id === 'port' || PLACES.some((p) => p.id === id)).toBe(true);
  });
  it('単車の荷台の真ん中は、運転台より後ろで、12ft 2 個ぶんの長さがある', () => {
    const s = createState(RIGID_12FT);
    const c = cargoPose(RIGID_12FT, s);
    const deck = RIGID_12FT.front - 2.4 + RIGID_12FT.rear;
    expect(deck).toBeGreaterThanOrEqual(2 * 3.715 - 0.05);
    expect(c.x).toBeLessThan(RIGID_12FT.front - 2.25);
  });
});
