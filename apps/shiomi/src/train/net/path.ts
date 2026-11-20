// 線路の中心線：1 m ごとに位置・向き・高さを持つ。曲率と勾配から作るか、ほかの中心線をつないで作る。

export interface Frame { x: number; y: number; z: number; th: number; dx: number; dz: number; lx: number; lz: number; }
export interface Pose { x: number; y: number; z: number; th: number; }

/** 区分的に直線でつないだ表 [位置, 値] を引く */
export function interp(tab: [number, number][], s: number): number {
  if (s <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) {
    if (s <= tab[i][0]) {
      const [s0, v0] = tab[i - 1], [s1, v1] = tab[i];
      return v0 + (v1 - v0) * ((s - s0) / (s1 - s0));
    }
  }
  return tab[tab.length - 1][1];
}

export class Path {
  readonly PX: Float64Array; readonly PZ: Float64Array; readonly PY: Float64Array; readonly TH: Float64Array;
  readonly K: Float64Array; readonly G: Float64Array; // 曲率（左が正）と勾配
  readonly n: number;
  constructor(n: number) {
    this.n = n;
    this.PX = new Float64Array(n); this.PZ = new Float64Array(n); this.PY = new Float64Array(n); this.TH = new Float64Array(n);
    this.K = new Float64Array(n); this.G = new Float64Array(n);
  }
  get length() { return this.n - 1; }

  /** start の姿勢から、曲率 k(u)・勾配 g(u) を len m 積分する（向き th：0 で -z 方向、左カーブで減る） */
  static integrate(start: Pose, len: number, k: (u: number) => number, g: (u: number) => number): Path {
    const n = Math.floor(len) + 1;
    const p = new Path(n);
    let { x, y, z, th } = start;
    for (let i = 0; i < n; i++) {
      p.PX[i] = x; p.PZ[i] = z; p.PY[i] = y; p.TH[i] = th;
      const kk = k(i + 0.5), gg = g(i + 0.5);
      p.K[i] = kk; p.G[i] = gg;
      th -= kk;
      const mid = th + kk / 2;
      x += Math.sin(mid); z -= Math.cos(mid);
      y += gg;
    }
    return p;
  }

  /** 終わりの姿勢 end から逆向きに積分して、end で終わる中心線を作る。k・g は「進む向き」での値（u は終点からの距離） */
  static integrateTo(end: Pose, len: number, k: (u: number) => number, g: (u: number) => number): Path {
    const back = Path.integrate({ x: end.x, y: end.y, z: end.z, th: end.th + Math.PI }, len, (u) => -k(u), (u) => -g(u));
    const n = back.n, p = new Path(n);
    for (let i = 0; i < n; i++) {
      const j = n - 1 - i;
      p.PX[i] = back.PX[j]; p.PZ[i] = back.PZ[j]; p.PY[i] = back.PY[j]; p.TH[i] = back.TH[j] - Math.PI;
      p.K[i] = -back.K[Math.max(0, j - 1)]; p.G[i] = -back.G[Math.max(0, j - 1)];
    }
    return p;
  }

  /** 中心線をつなぐ。b は a の終わりから続く（a の最後の点と b の最初の点は同じ所） */
  static concat(a: Path, b: Path, bFrom = 0, bTo = b.length): Path {
    const nb = Math.floor(bTo - bFrom);
    const n = a.n + nb;
    const p = new Path(n);
    p.PX.set(a.PX); p.PZ.set(a.PZ); p.PY.set(a.PY); p.TH.set(a.TH); p.K.set(a.K); p.G.set(a.G);
    for (let i = 1; i <= nb; i++) {
      const f = b.at(bFrom + i);
      const j = a.n - 1 + i;
      p.PX[j] = f.x; p.PZ[j] = f.z; p.PY[j] = f.y; p.TH[j] = f.th;
      p.K[j] = b.curvatureAt(bFrom + i); p.G[j] = b.gradeAt(bFrom + i);
    }
    return p;
  }

  /** s の位置での中心線。d は左向きの横ずれ。両端の外はまっすぐ延ばす */
  at(s: number, d = 0): Frame {
    const n = this.n;
    let ext = 0;
    if (s < 0) { ext = s; s = 0; } else if (s > n - 1) { ext = s - (n - 1); s = n - 1; }
    const i = Math.min(n - 2, Math.floor(s)), f = s - i;
    const th = this.TH[i] + (this.TH[i + 1] - this.TH[i]) * f;
    const dx = Math.sin(th), dz = -Math.cos(th);
    const lx = -Math.cos(th), lz = -Math.sin(th);
    const x = this.PX[i] + (this.PX[i + 1] - this.PX[i]) * f + lx * d + dx * ext;
    const z = this.PZ[i] + (this.PZ[i + 1] - this.PZ[i]) * f + lz * d + dz * ext;
    const y = this.PY[i] + (this.PY[i + 1] - this.PY[i]) * f;
    return { x, y, z, th, dx, dz, lx, lz };
  }
  gradeAt(s: number) { return this.G[Math.max(0, Math.min(this.n - 1, Math.floor(s)))]; }
  curvatureAt(s: number) { return this.K[Math.max(0, Math.min(this.n - 1, Math.floor(s)))]; }
  pose(s: number): Pose { const f = this.at(s); return { x: f.x, y: f.y, z: f.z, th: f.th }; }

  /** 世界の点から、いちばん近い s と横ずれ d（左が正）。粗く探してから詰める */
  nearest(x: number, z: number, step = 10): { s: number; d: number; dist: number } {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.n; i += step) {
      const e = (this.PX[i] - x) ** 2 + (this.PZ[i] - z) ** 2;
      if (e < bd) { bd = e; best = i; }
    }
    for (let i = Math.max(0, best - step); i <= Math.min(this.n - 1, best + step); i++) {
      const e = (this.PX[i] - x) ** 2 + (this.PZ[i] - z) ** 2;
      if (e < bd) { bd = e; best = i; }
    }
    // 近い点のまわりで、線に垂直に下ろした位置まで詰める（両端の外はまっすぐ延ばす）
    const f0 = this.at(best);
    let s = best + (x - f0.x) * f0.dx + (z - f0.z) * f0.dz;
    if (best > 0 && best < this.n - 1) s = Math.max(best - 1, Math.min(best + 1, s));
    else if (best === 0) s = Math.min(1, s);
    else s = Math.max(this.n - 2, s);
    const f = this.at(s);
    const d = (x - f.x) * f.lx + (z - f.z) * f.lz;
    return { s, d, dist: Math.hypot(x - f.x, z - f.z) };
  }
}

/** 2 本の中心線（の横ずれ da・db の線）が交わる所。なければ null */
export function intersect(a: Path, b: Path, da = 0, db = 0, aRange: [number, number] = [0, a.length], bRange: [number, number] = [0, b.length]): { sa: number; sb: number; angle: number } | null {
  const step = 2;
  for (let s = aRange[0]; s < aRange[1]; s += step) {
    const p0 = a.at(s, da), p1 = a.at(s + step, da);
    for (let t = bRange[0]; t < bRange[1]; t += step) {
      const q0 = b.at(t, db), q1 = b.at(t + step, db);
      const rx = p1.x - p0.x, rz = p1.z - p0.z, sx = q1.x - q0.x, sz = q1.z - q0.z;
      const den = rx * sz - rz * sx;
      if (Math.abs(den) < 1e-9) continue;
      const u = ((q0.x - p0.x) * sz - (q0.z - p0.z) * sx) / den;
      const v = ((q0.x - p0.x) * rz - (q0.z - p0.z) * rx) / den;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        const angle = Math.abs(Math.atan2(rx * sz - rz * sx, rx * sx + rz * sz));
        return { sa: s + u * step, sb: t + v * step, angle: Math.min(angle, Math.PI - angle) };
      }
    }
  }
  return null;
}
