import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MAIN } from '../route';
import type { Path } from '../net/path';

/** 線路に沿った押し出し。profile は (横 d, 高さ y) の点列（railY からの相対高さ）。 */
export function extrudeAlong(profile: [number, number][], s0: number, s1: number, step: number, opt: {
  closed?: boolean; uScale?: number; vScale?: number; colors?: (i: number) => [number, number, number]; yAbs?: (s: number) => number; path?: Path;
} = {}): THREE.BufferGeometry {
  const P = opt.path ?? MAIN;
  const rows: number[] = [];
  for (let s = s0; s < s1; s += step) rows.push(s);
  rows.push(s1);
  const np = profile.length;
  // 輪郭の長さ（u 座標）
  const ul: number[] = [0];
  for (let i = 1; i < np; i++) ul.push(ul[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  const us = opt.uScale ?? 1, vs = opt.vScale ?? 1;
  for (const s of rows) {
    const f = P.at(s);
    const y0 = opt.yAbs ? opt.yAbs(s) : f.y;
    for (let i = 0; i < np; i++) {
      const [d, y] = profile[i];
      pos.push(f.x + f.lx * d, y0 + y, f.z + f.lz * d);
      uv.push(ul[i] * us, s * vs);
      if (opt.colors) col.push(...opt.colors(i));
    }
  }
  const idx: number[] = [];
  const segs = opt.closed ? np : np - 1;
  for (let r = 0; r < rows.length - 1; r++) for (let i = 0; i < segs; i++) {
    const j = (i + 1) % np;
    const a = r * np + i, b = (r + 1) * np + i, c = r * np + j, d = (r + 1) * np + j;
    idx.push(a, c, b, c, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (opt.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
/** 2 点を結ぶ角材 */
export function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h = w): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, h, len);
  const dir = b.clone().sub(a).normalize();
  const m = new THREE.Matrix4();
  const up = Math.abs(dir.y) > 0.99 ? new THREE.Vector3(1, 0, 0) : UP;
  m.lookAt(new THREE.Vector3(), dir, up);
  m.setPosition(a.clone().add(b).multiplyScalar(0.5));
  g.applyMatrix4(m);
  return g;
}

/** 細い線（電線など）。点列を 4 角の管でつなぐ */
export function wire(points: THREE.Vector3[], r: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < points.length - 1; i++) parts.push(beam(points[i], points[i + 1], r * 2));
  return merge(parts);
}

export function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = gs.map((g) => {
    let x = g.index ? g.toNonIndexed() : g;
    if (!x.getAttribute('uv')) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.getAttribute('position').count * 2), 2));
    for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') x.deleteAttribute(k);
    if (!x.getAttribute('normal')) x.computeVertexNormals();
    return x;
  });
  return mergeGeometries(norm, false)!;
}

/** 線路の (s, d, 高さ) に置き、線路の向きにそろえる行列 */
export function placeAt(s: number, d: number, y: number, yaw = 0, scale = 1, path: Path = MAIN): THREE.Matrix4 {
  const f = path.at(s, d);
  const m = new THREE.Matrix4().makeRotationY(-f.th + yaw);
  m.scale(new THREE.Vector3(scale, scale, scale));
  m.setPosition(f.x, y, f.z);
  return m;
}

/** 文字の板（標識・駅名標）のテクスチャ */
export function labelTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d')!;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** たくさんの小物を、材質ごとに 1 つのメッシュへまとめる（描画の回数を減らす） */
export function bake(objs: THREE.Object3D[], cast = true): THREE.Mesh[] {
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const o of objs) {
    o.updateMatrixWorld(true);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      if (!by.has(mat)) by.set(mat, []);
      by.get(mat)!.push(m.geometry.clone().applyMatrix4(m.matrixWorld));
    });
  }
  const out: THREE.Mesh[] = [];
  for (const [mat, gs] of by) {
    const mesh = new THREE.Mesh(merge(gs), mat);
    mesh.castShadow = cast; mesh.receiveShadow = true;
    out.push(mesh);
  }
  return out;
}
