// 地形：線路に沿った細かい帯（左右 ±420 m）と、その外側の遠い山
import * as THREE from 'three';
import { at, nearest, zoneAt, LENGTH, TUNNEL, BRIDGE, Zone, CITY } from '../route';
import { tex } from './assets';

// ---- ノイズ ----
function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; }
  return s / (1 - Math.pow(0.5, oct));
}
export const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const C = -2; // 複線の中心
export const FORM_W = 6.4; // 路盤の半分の幅

const ZONES: Zone[] = ['coast', 'town', 'paddy', 'forest'];
export function zoneW(s: number): Record<Zone, number> {
  const w: Record<Zone, number> = { coast: 0, town: 0, paddy: 0, forest: 0 };
  let n = 0;
  for (let k = -60; k <= 60; k += 20) { w[zoneAt(s + k)]++; n++; }
  for (const z of ZONES) w[z] /= n;
  return w;
}

export const RIVER_LEVEL = () => at(BRIDGE.river).y - 10.5;
export const riverS = (d: number) => BRIDGE.river + 25 * Math.sin(d * 0.012);

export interface Ground { h: number; sand: number; dirt: number; forest: number; paddy: number; }

/** 線路からの座標 (s, d) とその世界座標での地面 */
export function ground(s: number, d: number, x: number, z: number, wz?: Record<Zone, number>, cap = false): Ground {
  const w = wz ?? zoneW(s);
  const base = at(Math.max(0, Math.min(LENGTH, s))).y;
  const ad = Math.abs(d - C);
  const left = d > C;
  const n1 = fbm(x * 0.0035 + 11, z * 0.0035 - 7, 4);
  const n2 = fbm(x * 0.03, z * 0.03, 3);
  const hillH = w.forest * 75 + w.town * 20 + w.paddy * 26 + w.coast * (left ? 0 : 48);
  const far = w.paddy * 250 + (1 - w.paddy) * 70;
  let h = base - 1.0
    + smooth(far, far + 330, ad) * hillH * (0.45 + n1)
    + smooth(15, 90, ad) * hillH * 0.12 * n1
    + (n2 - 0.5) * 2.4 * smooth(10, 40, ad);
  // 遠く：線路の区間によらない山並み（区間の境で段がつかないように）
  const baseFar = 6 + 41 * smooth(-3900, -5400, z);
  let hFar = baseFar - 1 + 50 * (0.25 + n1) * smooth(200, 600, ad) + smooth(420, 2600, ad) * 270 * (0.35 + n1);
  const seaF = smooth(-2050, -1550, z) * smooth(30, 160, d - C);
  hFar = hFar + (-24 - hFar) * seaF;
  const farW = smooth(380, 720, ad);
  let sand = 0;
  // 海岸：左手は砂浜から海へ
  const coastL = w.coast * (left ? smooth(C, C + 12, d) : 0);
  if (coastL > 0) {
    const hc = base - 1.6 - Math.max(0, ad - 20) * 0.32 + (n2 - 0.5) * 1.2;
    h = h + (Math.max(-22, hc) - h) * coastL;
    sand = coastL * smooth(3.5, 1.2, h) ;
  }
  // 田んぼ：平らに
  const flatP = w.paddy * (1 - smooth(220, 300, ad));
  h = h + (base - 1.25 + (n2 - 0.5) * 0.2 - h) * flatP;
  // 町：平らに
  const flatT = w.town * (1 - smooth(35, 130, ad));
  h = h + (base - 0.85 + (n2 - 0.5) * 0.3 - h) * flatT;
  // 川の谷
  const rd = Math.abs(s - riverS(d));
  const valley = 12.5 * (1 - smooth(14, 75, rd));
  if (valley > 0) h = Math.min(h, base - 1.0 - valley + (n2 - 0.5) * 0.8);
  // トンネルの山
  const tw = smooth(TUNNEL.from - 90, TUNNEL.from + 10, s) * (1 - smooth(TUNNEL.to - 10, TUNNEL.to + 90, s));
  if (tw > 0) h = Math.max(h, base + tw * (30 * (1 - smooth(20, 320, ad) * 0.7) + n1 * 12));
  if (cap) return { h, sand: 0, dirt: 0, forest: 1, paddy: 0 };
  h = h + (hFar - h) * farW;
  // 都市部：線路から 440 m まで平らな町
  const cw = smooth(CITY.from - 120, CITY.from, s) * (1 - smooth(CITY.to, CITY.to + 120, s));
  if (cw > 0) { const k = cw * (1 - smooth(440, 540, ad)); h = h + (base - 0.85 + (n2 - 0.5) * 0.3 - h) * k; }
  // 路盤（築堤・切土）
  const inTunnel = s > TUNNEL.from && s < TUNNEL.to;
  const onBridge = s > BRIDGE.from && s < BRIDGE.to;
  if (inTunnel && ad < 7.5) h = base - 0.8; // 管の通る溝（上はふたの地形でおおう）
  if (!inTunnel && !onBridge) {
    const f = base - 0.8;
    if (ad < FORM_W) h = f;
    else {
      const k = (ad - FORM_W) / 1.4;
      h = f + Math.max(-k, Math.min(k, h - f));
      if (ad < FORM_W + 1.6 && h >= f - 0.05) h -= 0.35 * Math.sin(((ad - FORM_W) / 1.6) * Math.PI); // 側溝
    }
  }
  const dirt = Math.max(smooth(FORM_W + 1.8, FORM_W, ad), flatT * 0.25 * (1 - flatP));
  const forest = w.forest * smooth(14, 30, ad) * (1 - sand);
  const paddy = flatP * smooth(14, 20, ad) * (1 - smooth(200, 225, ad)) * (rd > 70 ? 1 : 0);
  return { h, sand, dirt, forest, paddy };
}

export function groundH(s: number, d: number): number {
  const f = at(s, d);
  return ground(s, d, f.x, f.z).h;
}

const OFFS = [0, 3, 6.4, 7.2, 8.4, 9.8, 11.5, 13.5, 16, 19, 23, 28, 34, 42, 52, 64, 78, 95, 115, 140, 170, 205, 250, 300, 360, 420];
const COLS = [...OFFS.slice(1).reverse().map((o) => C - o), ...OFFS.map((o) => C + o)];

function terrainMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, color: 0xffffff });
  const T = {
    tGrass: { value: tex('tex/leafy_grass_diff.jpg', true) },
    tRock: { value: tex('tex/rock_face_diff.jpg', true) },
    tDirt: { value: tex('tex/gravel_floor_02_diff.jpg', true) },
    tSand: { value: tex('tex/coast_sand_01_diff.jpg', true) },
    tForest: { value: tex('tex/forest_leaves_02_diff.jpg', true) },
    tMud: { value: tex('tex/brown_mud_02_diff.jpg', true) },
  };
  m.userData.patch = (sh: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(sh.uniforms, T);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splatA;\nattribute vec2 splatB;\nvarying vec4 vSA;\nvarying vec2 vSB;\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSA = splatA; vSB = splatB; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D tGrass, tRock, tDirt, tSand, tForest, tMud;
varying vec4 vSA; varying vec2 vSB; varying vec3 vWP; varying vec3 vWN;
float tRough = 1.0;
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 tri(sampler2D t, float sc){
  vec3 n = abs(vWN); n = pow(n, vec3(4.0)); n /= (n.x + n.y + n.z);
  return texture2D(t, vWP.zy * sc).rgb * n.x + texture2D(t, vWP.xz * sc).rgb * n.y + texture2D(t, vWP.xy * sc).rgb * n.z;
}
vec3 two(sampler2D t, float sc){ // 2 つの大きさで重ねて、繰り返しを目立たなくする
  return mix(texture2D(t, vWP.xz * sc).rgb, texture2D(t, vWP.xz * sc * 0.23 + 0.37).rgb, 0.45);
}`)
      .replace('#include <map_fragment>', `
{
  float slope = 1.0 - clamp(vWN.y, 0.0, 1.0);
  float rockW = smoothstep(0.3, 0.5, slope);
  vec3 grass = two(tGrass, 0.16);
  float macro = texture2D(tMud, vWP.xz * 0.004).r;
  grass *= mix(vec3(0.72, 0.9, 0.5), vec3(0.95, 1.05, 0.62), macro);
  vec3 col = grass;
  float rough = 0.95;
  col = mix(col, two(tForest, 0.18) * vec3(0.42, 0.45, 0.3), vSB.x * 0.8);
  col = mix(col, two(tDirt, 0.25) * vec3(0.62, 0.6, 0.56), vSA.z);
  col = mix(col, two(tSand, 0.16), vSA.w);
  // 田んぼ：あぜ道と、苗の並ぶ水面
  if (vSB.y > 0.01) {
    vec2 g = vWP.xz / vec2(31.0, 19.0);
    vec2 cell = floor(g); vec2 f = fract(g) * vec2(31.0, 19.0);
    float edge = min(min(f.x, 31.0 - f.x), min(f.y, 19.0 - f.y));
    float bund = 1.0 - smoothstep(0.55, 0.85, edge);
    float rows = smoothstep(0.35, 0.0, abs(fract(f.x / 0.3) - 0.5)) * smoothstep(0.4, 0.0, abs(fract(f.y / 0.3) - 0.5));
    float hcell = h21(cell);
    vec3 water = mix(vec3(0.16, 0.15, 0.11), vec3(0.20, 0.27, 0.12), hcell * 0.5);
    vec3 rice = vec3(0.30, 0.42, 0.12) * (0.8 + 0.4 * hcell);
    vec3 pcol = mix(water, rice, 0.55 + 0.4 * rows);
    pcol = mix(pcol, grass * 1.05, bund);
    col = mix(col, pcol, vSB.y);
    rough = mix(rough, mix(0.35, 0.9, max(bund, rows * 0.7)), vSB.y);
  }
  col = mix(col, tri(tRock, 0.07) * vec3(0.85, 0.83, 0.8), rockW * (1.0 - vSB.y));
  tRough = rough;
  diffuseColor.rgb *= col;
}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * tRough;');
  };
  return m;
}

function buildStrip(s0: number, s1: number, step: number, mat: THREE.Material): THREE.Mesh {
  const rows: number[] = [];
  for (let s = s0; s <= s1 + 1e-6; s += step) rows.push(s);
  const nc = COLS.length, nr = rows.length;
  const pos = new Float32Array(nc * nr * 3);
  const sa = new Float32Array(nc * nr * 4), sb = new Float32Array(nc * nr * 2);
  rows.forEach((s, r) => {
    const wz = zoneW(s);
    COLS.forEach((d, c) => {
      const f = at(s, d);
      const g = ground(s, d, f.x, f.z, wz);
      const i = r * nc + c;
      pos.set([f.x, g.h, f.z], i * 3);
      sa.set([1, 0, g.dirt, g.sand], i * 4);
      sb.set([g.forest, g.paddy], i * 2);
    });
  });
  const idx: number[] = [];
  for (let r = 0; r < nr - 1; r++) for (let c = 0; c < nc - 1; c++) {
    const a = r * nc + c, b = (r + 1) * nc + c, d = r * nc + c + 1, e = (r + 1) * nc + c + 1;
    idx.push(a, b, d, d, b, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('splatA', new THREE.BufferAttribute(sa, 4));
  g.setAttribute('splatB', new THREE.BufferAttribute(sb, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  return m;
}

export function buildTerrain(group: THREE.Group): THREE.MeshStandardMaterial {
  const mat = terrainMaterial();
  // 300 m ごとの帯。トンネルの山のあたりだけは 100 m（影を落とす所を小さくする）
  for (let s0 = -300, len = 300; s0 < LENGTH + 300; s0 += len) {
    len = s0 + 300 > TUNNEL.from - 200 && s0 < TUNNEL.to + 200 ? 100 : 300;
    const m = buildStrip(s0, s0 + len, 2.5, mat);
    // トンネルの山は影を落とす（中に日が差さないように）
    m.castShadow = s0 >= TUNNEL.from - 200 && s0 <= TUNNEL.to + 100;
    group.add(m);
  }
  // トンネルの上のふた
  {
    const ds: number[] = []; for (let d = C - 9.5; d <= C + 9.5 + 1e-6; d += 1.9) ds.push(d);
    const rows: number[] = []; for (let s = TUNNEL.from; s <= TUNNEL.to + 1e-6; s += 2.5) rows.push(s);
    const pos: number[] = [], sa: number[] = [], sbv: number[] = [], idx: number[] = [];
    rows.forEach((s) => {
      const base = at(s).y;
      ds.forEach((d) => {
        const f = at(s, d);
        let h = ground(s, d, f.x, f.z, undefined, true).h;
        h = Math.min(h, base + 13.4 + Math.max(0, Math.min(s - TUNNEL.from, TUNNEL.to - s)) * 3);
        pos.push(f.x, h, f.z); sa.push(1, 0, 0, 0); sbv.push(1, 0);
      });
    });
    const nc = ds.length;
    for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < nc - 1; c++) {
      const a = r * nc + c, b = (r + 1) * nc + c, d = a + 1, e = b + 1;
      idx.push(a, b, d, d, b, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('splatA', new THREE.Float32BufferAttribute(sa, 4));
    g.setAttribute('splatB', new THREE.Float32BufferAttribute(sbv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const capM = new THREE.Mesh(g, mat); capM.castShadow = true; capM.receiveShadow = true;
    group.add(capM);
  }
  // 遠景：粗い格子。帯の下にもぐるよう少し下げる
  const b = new THREE.Box3();
  for (let s = 0; s <= LENGTH; s += 50) { const f = at(s); b.expandByPoint(new THREE.Vector3(f.x, 0, f.z)); }
  b.expandByScalar(3200);
  const n = 170;
  const sx = (b.max.x - b.min.x) / n, sz = (b.max.z - b.min.z) / n;
  const pos = new Float32Array((n + 1) * (n + 1) * 3), sa = new Float32Array((n + 1) * (n + 1) * 4), sbb = new Float32Array((n + 1) * (n + 1) * 2);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = b.min.x + i * sx, z = b.min.z + j * sz;
    const nr = nearest(x, z);
    let s = nr.s, d = nr.d;
    // 起点・終点の外側：まっすぐ延びた線路があるとみなす
    const f0 = at(0), fl = at(LENGTH);
    const t0 = (x - f0.x) * f0.dx + (z - f0.z) * f0.dz;
    if (s < 1 && t0 < 0) { s = t0; d = (x - f0.x) * f0.lx + (z - f0.z) * f0.lz; }
    const tl = (x - fl.x) * fl.dx + (z - fl.z) * fl.dz;
    if (s > LENGTH - 1 && tl > 0) { s = LENGTH + tl; d = (x - fl.x) * fl.lx + (z - fl.z) * fl.lz; }
    const g = ground(Math.max(-300, Math.min(LENGTH + 300, s)), d, x, z);
    const k = j * (n + 1) + i;
    const sink = 3 + 70 * (1 - smooth(330, 445, Math.abs(d - C)));
    pos.set([x, g.h - sink, z], k * 3);
    sa.set([1, 0, 0, g.sand], k * 4);
    sbb.set([g.forest, 0], k * 2);
  }
  const idx: number[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * (n + 1) + i, bq = a + 1, c = a + n + 1, d = c + 1;
    idx.push(a, c, bq, bq, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('splatA', new THREE.BufferAttribute(sa, 4));
  g.setAttribute('splatB', new THREE.BufferAttribute(sbb, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const far = new THREE.Mesh(g, mat);
  far.receiveShadow = true;
  group.add(far);
  return mat;
}
