// 長方形どうしの当たり判定（上から見た 2 次元。分離軸の判定）
import { fwd, type Box } from './vehicle';

function axes(b: Box): [number, number][] {
  const [fx, fz] = fwd(b.h);
  return [[fx, fz], [-fz, fx]];
}
function corners(b: Box): [number, number][] {
  const [fx, fz] = fwd(b.h);
  const rx = -fz, rz = fx;
  const hl = b.len / 2, hw = b.wid / 2;
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, c]) => [b.cx + fx * hl * a + rx * hw * c, b.cz + fz * hl * a + rz * hw * c]);
}

/** 重なっていれば、押し戻す深さ（m）を返す。重なっていなければ 0 */
export function overlap(a: Box, b: Box): number {
  const ca = corners(a), cb = corners(b);
  let depth = Infinity;
  for (const [ax, az] of [...axes(a), ...axes(b)]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [x, z] of ca) { const p = x * ax + z * az; a0 = Math.min(a0, p); a1 = Math.max(a1, p); }
    for (const [x, z] of cb) { const p = x * ax + z * az; b0 = Math.min(b0, p); b1 = Math.max(b1, p); }
    const d = Math.min(a1 - b0, b1 - a0);
    if (d <= 0) return 0;
    depth = Math.min(depth, d);
  }
  return depth;
}

/** 車体のどれかが障害物のどれかに当たっていれば、その障害物の番号 */
export function hit(bodies: Box[], obstacles: Box[]): number {
  for (const b of bodies) {
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      if (o.off) continue; // 開いたゲートなど
      // 遠いものは先に外す
      if (Math.abs(o.cx - b.cx) > (o.len + b.len) && Math.abs(o.cz - b.cz) > (o.len + b.len)) continue;
      if (overlap(b, o) > 0) return i;
    }
  }
  return -1;
}

/** 障害物を格子に分けて、近くのものだけ調べる（建物が多くても軽い） */
export class Grid {
  private cells = new Map<string, number[]>();
  constructor(public items: Box[], private size = 40) {
    items.forEach((b, i) => {
      const r = Math.hypot(b.len, b.wid) / 2;
      for (const k of this.keys(b.cx - r, b.cz - r, b.cx + r, b.cz + r)) {
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(i);
      }
    });
  }
  private *keys(x0: number, z0: number, x1: number, z1: number) {
    const s = this.size;
    for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) for (let j = Math.floor(z0 / s); j <= Math.floor(z1 / s); j++) yield `${i},${j}`;
  }
  /** 車体のどれかが当たっている障害物の番号。なければ -1 */
  hit(bodies: Box[]): number {
    for (const b of bodies) {
      const r = Math.hypot(b.len, b.wid) / 2;
      for (const k of this.keys(b.cx - r, b.cz - r, b.cx + r, b.cz + r)) {
        for (const i of this.cells.get(k) ?? []) {
          const o = this.items[i];
          if (!o.off && overlap(b, o) > 0) return i;
        }
      }
    }
    return -1;
  }
}
