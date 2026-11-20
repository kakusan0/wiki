// 形（ポリゴン）。頂点ごとに [x,y,z, nx,ny,nz, u,v] を並べた配列。底は y=0、幅・奥行き 1、高さ 1
export type Geo = number[];
export const STRIDE = 8;
export const triangles = (g: Geo) => g.length / STRIDE / 3;

type V3 = [number, number, number];
const UV4 = [[0, 0], [1, 0], [1, 1], [0, 1]];

function quad(out: Geo, q: V3[], n: V3, uv = UV4) {
  for (const k of [0, 1, 2, 0, 2, 3]) out.push(...q[k], ...n, ...uv[k]);
}

export function cube(): Geo {
  const out: Geo = [];
  const faces: [V3, V3[]][] = [
    [[0, 1, 0], [[-.5, 1, .5], [.5, 1, .5], [.5, 1, -.5], [-.5, 1, -.5]]],
    [[0, -1, 0], [[-.5, 0, -.5], [.5, 0, -.5], [.5, 0, .5], [-.5, 0, .5]]],
    [[1, 0, 0], [[.5, 0, .5], [.5, 0, -.5], [.5, 1, -.5], [.5, 1, .5]]],
    [[-1, 0, 0], [[-.5, 0, -.5], [-.5, 0, .5], [-.5, 1, .5], [-.5, 1, -.5]]],
    [[0, 0, 1], [[-.5, 0, .5], [.5, 0, .5], [.5, 1, .5], [-.5, 1, .5]]],
    [[0, 0, -1], [[.5, 0, -.5], [-.5, 0, -.5], [-.5, 1, -.5], [.5, 1, -.5]]],
  ];
  for (const [n, q] of faces) quad(out, q, n);
  return out;
}

// 回転体。profile は [半径, 高さ] を下から並べたもの。上下の端が半径 0 でなければふたをする
export function lathe(profile: [number, number][], seg: number): Geo {
  const out: Geo = [];
  const len: number[] = [0];
  for (let j = 1; j < profile.length; j++) {
    len.push(len[j - 1] + Math.hypot(profile[j][0] - profile[j - 1][0], profile[j][1] - profile[j - 1][1]));
  }
  const total = len[len.length - 1] || 1;
  // 各点の法線（隣どうしの辺の法線の平均）
  const nrm = profile.map((_, j) => {
    const a = profile[Math.max(0, j - 1)];
    const b = profile[Math.min(profile.length - 1, j + 1)];
    const dr = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  });
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    for (let j = 0; j < profile.length - 1; j++) {
      const P = (a: number, k: number, u: number) => {
        const [r, y] = profile[k];
        const [nr, ny] = nrm[k];
        return [Math.cos(a) * r, y, Math.sin(a) * r, Math.cos(a) * nr, ny, Math.sin(a) * nr, u, len[k] / total];
      };
      const A = P(a0, j, i / seg), B = P(a1, j, (i + 1) / seg), C = P(a1, j + 1, (i + 1) / seg), D = P(a0, j + 1, i / seg);
      out.push(...A, ...C, ...B, ...A, ...D, ...C);
    }
    const cap = (k: number, up: number) => {
      const [r, y] = profile[k];
      if (r <= 0) return;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const pts = [[0, y, 0, .5, .5], [c0 * r, y, s0 * r, c0 * .5 + .5, s0 * .5 + .5], [c1 * r, y, s1 * r, c1 * .5 + .5, s1 * .5 + .5]];
      const order = up > 0 ? [0, 2, 1] : [0, 1, 2];
      for (const o of order) { const p = pts[o]; out.push(p[0], p[1], p[2], 0, up, 0, p[3], p[4]); }
    };
    cap(0, -1);
    cap(profile.length - 1, 1);
  }
  return out;
}

export const cylinder = (seg: number) => lathe([[.5, 0], [.5, 1]], seg);
export const cone = (seg: number) => lathe([[.5, 0], [0, 1]], seg);

export function sphere(lat: number, lon: number): Geo {
  const out: Geo = [];
  const P = (j: number, i: number) => {
    const t = (j / lat) * Math.PI;
    const p = (i / lon) * Math.PI * 2;
    const n = [Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p)];
    return [n[0] * .5, .5 + n[1] * .5, n[2] * .5, n[0], n[1], n[2], i / lon, 1 - j / lat];
  };
  for (let j = 0; j < lat; j++) for (let i = 0; i < lon; i++) {
    const a = P(j, i), b = P(j + 1, i), c = P(j + 1, i + 1), d = P(j, i + 1);
    out.push(...a, ...d, ...c, ...a, ...c, ...b);
  }
  return out;
}

// 切妻屋根（棟は x 方向）
export function prism(): Geo {
  const out: Geo = [];
  const k = 1 / Math.hypot(.5, 1);
  quad(out, [[-.5, 0, .5], [.5, 0, .5], [.5, 1, 0], [-.5, 1, 0]], [0, .5 * k, 1 * k]);
  quad(out, [[.5, 0, -.5], [-.5, 0, -.5], [-.5, 1, 0], [.5, 1, 0]], [0, .5 * k, -1 * k]);
  out.push(.5, 0, .5, 1, 0, 0, 0, 0, .5, 0, -.5, 1, 0, 0, 1, 0, .5, 1, 0, 1, 0, 0, .5, 1);
  out.push(-.5, 0, -.5, -1, 0, 0, 0, 0, -.5, 0, .5, -1, 0, 0, 1, 0, -.5, 1, 0, -1, 0, 0, .5, 1);
  return out;
}

export function plane(): Geo {
  const out: Geo = [];
  quad(out, [[-.5, 0, .5], [.5, 0, .5], [.5, 0, -.5], [-.5, 0, -.5]], [0, 1, 0]);
  return out;
}

// 角を丸めた箱。面ごとに seg×seg に分け、角を半径 r で丸める。
// atlas を渡すと、面ごとに 4×2 の絵の中の 1 枠を使う（サイコロの目。左の 3 列だけ使う）
export function roundedBox(seg: number, r: number, atlas?: number[]): Geo {
  const out: Geo = [];
  const h = .5 - r;
  const faces: { n: V3; u: V3; v: V3 }[] = [
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
  ];
  faces.forEach((f, fi) => {
    const cell = atlas ? atlas[fi] : -1;
    const P = (a: number, b: number) => {
      const s = a / seg - .5, t = b / seg - .5;
      const p = [0, 1, 2].map((k) => f.n[k] * .5 + f.u[k] * s + f.v[k] * t);
      const c = p.map((x) => Math.max(-h, Math.min(h, x)));
      const d = p.map((x, k) => x - c[k]);
      const l = Math.hypot(d[0], d[1], d[2]) || 1;
      const n = d.map((x) => x / l);
      const pos = c.map((x, k) => x + n[k] * r);
      let u = a / seg, v = b / seg;
      if (cell >= 0) { u = ((cell % 3) + u) / 4; v = (Math.floor(cell / 3) + v) / 2; }
      return [pos[0], pos[1] + .5, pos[2], n[0], n[1], n[2], u, v];
    };
    for (let a = 0; a < seg; a++) for (let b = 0; b < seg; b++) {
      const A = P(a, b), B = P(a + 1, b), C = P(a + 1, b + 1), D = P(a, b + 1);
      out.push(...A, ...B, ...C, ...A, ...C, ...D);
    }
  });
  return out;
}

// 立てた 1 枚の板（正面は +z、横 -0.5〜0.5、高さ 0〜1）。いつも手前に描く札に使う（裏面が描かれないように）
export function card(): Geo {
  const out: Geo = [];
  quad(out, [[-.5, 0, 0], [.5, 0, 0], [.5, 1, 0], [-.5, 1, 0]], [0, 0, 1]);
  return out;
}
