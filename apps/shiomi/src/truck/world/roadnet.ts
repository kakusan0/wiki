// 潮見の町の道路網（計算だけ）。北が -z、東が +x。道はすべて東西か南北のまっすぐな道。
// ・最短経路（ダイクストラ）と道案内の指示
// ・いまいる所が道の上か、歩道か、道の外か。制限速度と、左側通行を守っているか

export type Kind = 'main' | 'street' | 'drive';
export const KIND: Record<Kind, { w: number; lanes: number; limit: number; walk: number; name: string }> = {
  main: { w: 15, lanes: 2, limit: 60, walk: 3.5, name: '臨港道路' },
  street: { w: 8.5, lanes: 1, limit: 40, walk: 2.5, name: '町の道' },
  drive: { w: 10, lanes: 1, limit: 20, walk: 0, name: '構内の道' },
};

export interface Node { id: string; x: number; z: number; }
export interface Edge { a: string; b: string; kind: Kind; }
export interface Lot { id: string; x0: number; z0: number; x1: number; z1: number; limit: number; }
export interface Place {
  id: string; name: string; node: string;         // 道路網でいちばん近い所
  dock: { x: number; z: number; h: number };       // 停止枠（荷台の真ん中の位置と向き）
  lot: string;
}

export const NODES: Node[] = [
  { id: 'gate', x: 215, z: 0 },
  { id: 'A', x: 420, z: 0 }, { id: 'B', x: 800, z: 0 }, { id: 'C', x: 1200, z: 0 }, { id: 'D', x: 1500, z: 0 },
  { id: 'E', x: 420, z: 500 }, { id: 'F', x: 420, z: 930 },
  { id: 'G', x: 800, z: -300 }, { id: 'M1', x: 1100, z: -300 }, { id: 'J', x: 1200, z: -300 },
  { id: 'H', x: 800, z: 500 }, { id: 'I', x: 800, z: 900 },
  { id: 'N1', x: 1000, z: 500 }, { id: 'K', x: 1200, z: 500 },
  { id: 'M2', x: 1100, z: -362 },  // ミドリ物流センターの構内
  { id: 'N2', x: 1000, z: 560 },   // 潮見精機の構内
  { id: 'S1', x: 296, z: 930 },    // 潮見貨物駅の構内（東どなりは線路の端）
];

export const EDGES: Edge[] = [
  { a: 'gate', b: 'A', kind: 'main' }, { a: 'A', b: 'B', kind: 'main' }, { a: 'B', b: 'C', kind: 'main' }, { a: 'C', b: 'D', kind: 'main' },
  { a: 'A', b: 'E', kind: 'street' }, { a: 'E', b: 'F', kind: 'street' }, { a: 'F', b: 'S1', kind: 'drive' },
  { a: 'B', b: 'G', kind: 'street' }, { a: 'G', b: 'M1', kind: 'street' }, { a: 'M1', b: 'J', kind: 'street' }, { a: 'J', b: 'C', kind: 'street' },
  { a: 'M1', b: 'M2', kind: 'drive' },
  { a: 'B', b: 'H', kind: 'street' }, { a: 'H', b: 'I', kind: 'street' }, { a: 'E', b: 'H', kind: 'street' },
  { a: 'H', b: 'N1', kind: 'street' }, { a: 'N1', b: 'K', kind: 'street' }, { a: 'K', b: 'C', kind: 'street' },
  { a: 'N1', b: 'N2', kind: 'drive' },
];

// 構内（道の外でも走ってよい所）
export const LOTS: Lot[] = [
  { id: 'yard', x0: -45, z0: -62, x1: 205, z1: 62, limit: 20 },
  { id: 'midori', x0: 1040, z0: -470, x1: 1165, z1: -362, limit: 15 },
  { id: 'seiki', x0: 950, z0: 560, x1: 1080, z1: 660, limit: 15 },
  { id: 'station', x0: 150, z0: 840, x1: 296, z1: 960, limit: 15 },
];

export const PLACES: Place[] = [
  { id: 'midori', name: 'ミドリ物流センター', node: 'M2', dock: { x: 1100, z: -420, h: Math.PI / 2 }, lot: 'midori' },
  { id: 'seiki', name: '潮見精機 第二工場', node: 'N2', dock: { x: 1000, z: 610, h: -Math.PI / 2 }, lot: 'seiki' },
  { id: 'station', name: '潮見貨物駅', node: 'S1', dock: { x: 270, z: 900, h: Math.PI }, lot: 'station' },
];

const byId = new Map(NODES.map((n) => [n.id, n]));
export const node = (id: string) => byId.get(id)!;
export const len = (e: Edge) => { const a = node(e.a), b = node(e.b); return Math.hypot(b.x - a.x, b.z - a.z); };

/** 最短経路（交差点の並び） */
export function route(from: string, to: string): string[] {
  const dist = new Map<string, number>([[from, 0]]), prev = new Map<string, string>();
  const open = new Set(NODES.map((n) => n.id));
  while (open.size) {
    let u = '', best = Infinity;
    for (const id of open) { const d = dist.get(id) ?? Infinity; if (d < best) { best = d; u = id; } }
    if (!u || best === Infinity) break;
    open.delete(u);
    if (u === to) break;
    for (const e of EDGES) {
      const v = e.a === u ? e.b : e.b === u ? e.a : null;
      if (!v || !open.has(v)) continue;
      const nd = best + len(e);
      if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, u); }
    }
  }
  if (!dist.has(to)) return [];
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

export type Turn = 'left' | 'right' | 'straight' | 'arrive';
/** 進む向き d1 から d2 へ：右か左かまっすぐか（右 = 前を上から見て時計回り） */
export function turnOf(d1: [number, number], d2: [number, number]): Turn {
  const rx = -d1[1], rz = d1[0]; // 右向き
  const side = d2[0] * rx + d2[1] * rz;
  if (side > 0.5) return 'right';
  if (side < -0.5) return 'left';
  return 'straight';
}

export interface Step { at: string; x: number; z: number; turn: Turn; }
/** 経路の曲がる所の一覧（まっすぐの交差点は除く）。最後は到着 */
export function steps(path: string[]): Step[] {
  const out: Step[] = [];
  for (let i = 1; i < path.length - 1; i++) {
    const a = node(path[i - 1]), b = node(path[i]), c = node(path[i + 1]);
    const d1 = norm(b.x - a.x, b.z - a.z), d2 = norm(c.x - b.x, c.z - b.z);
    const t = turnOf(d1, d2);
    if (t !== 'straight') out.push({ at: b.id, x: b.x, z: b.z, turn: t });
  }
  const last = node(path[path.length - 1]);
  out.push({ at: last.id, x: last.x, z: last.z, turn: 'arrive' });
  return out;
}
function norm(x: number, z: number): [number, number] { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; }

export interface Where {
  on: 'road' | 'walk' | 'lot' | 'off';
  limit: number;      // 制限速度（km/h）
  kind: Kind | null;
  wrongWay: boolean;  // 右側を走っている（左側通行）
}

/** いまの位置と進む向きから、道のどこにいるか */
export function where(x: number, z: number, hx: number, hz: number): Where {
  // 交差点（道の幅の四角）
  let best: Where | null = null;
  for (const n of NODES) {
    const inc = EDGES.filter((e) => e.a === n.id || e.b === n.id);
    const half = Math.max(...inc.map((e) => KIND[e.kind].w)) / 2;
    if (Math.abs(x - n.x) <= half && Math.abs(z - n.z) <= half) {
      return { on: 'road', limit: Math.min(...inc.map((e) => KIND[e.kind].limit)), kind: inc[0].kind, wrongWay: false };
    }
  }
  for (const e of EDGES) {
    const a = node(e.a), b = node(e.b), k = KIND[e.kind];
    const L = len(e), dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
    const t = (x - a.x) * dx + (z - a.z) * dz;
    if (t < 0 || t > L) continue;
    const lat = (x - a.x) * -dz + (z - a.z) * dx; // a→b の右が正
    const m = Math.abs(lat);
    if (m <= k.w / 2) {
      // 左側通行：a→b へ進むなら左半分（lat < 0）、逆へ進むなら右半分
      const along = hx * dx + hz * dz;
      const wrongWay = e.kind !== 'drive' && Math.abs(along) > 0.5 && (along > 0 ? lat > 0.6 : lat < -0.6);
      return { on: 'road', limit: k.limit, kind: e.kind, wrongWay };
    }
    if (m <= k.w / 2 + k.walk && !best) best = { on: 'walk', limit: k.limit, kind: e.kind, wrongWay: false };
  }
  if (best) return best;
  for (const l of LOTS) if (x >= l.x0 && x <= l.x1 && z >= l.z0 && z <= l.z1) return { on: 'lot', limit: l.limit, kind: null, wrongWay: false };
  return { on: 'off', limit: 20, kind: null, wrongWay: false };
}

/** 折れ線の上で、点に最も近い所（区間の番号と、そこまでの道のり） */
export function nearestOn(pts: { x: number; z: number }[], x: number, z: number) {
  let best = { i: 0, d: Infinity, s: 0 }, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const t = Math.max(0, Math.min(L, ((x - a.x) * (b.x - a.x) + (z - a.z) * (b.z - a.z)) / L));
    const px = a.x + (b.x - a.x) * t / L, pz = a.z + (b.z - a.z) * t / L;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { i, d, s: acc + t };
    acc += L;
  }
  return best;
}

/** いちばん近い交差点 */
export function nearestNode(x: number, z: number): string {
  let id = NODES[0].id, d = Infinity;
  for (const n of NODES) { const k = Math.hypot(n.x - x, n.z - z); if (k < d) { d = k; id = n.id; } }
  return id;
}
