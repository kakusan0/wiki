// 町並み：マンション・住宅・商店・ブロック塀・道路・電柱と電線・線路ぎわの金網
// 壁は 1 枚の「壁の絵の詰め合わせ」（16 種）から 1 階 × 1 間ずつ貼る。色は頂点の色でつける。
// 束（600 m）ごとに材質別へまとめるので、描画の回数は少ない。
import * as THREE from 'three';
import { at, LENGTH, STATIONS, CROSSINGS, zoneAt, CITY } from '../route';
import { AOBA_TRACK, SAZA_TRACK } from '../net/network';
import { ground, zoneW, C, FORM_W } from './terrain';
import { pbr } from './assets';
import { extrudeAlong, rng, wire, merge } from './geo';
import { onPlatform } from './track';

const TILE = 512, N = 4; // 4×4 枚
enum T { AptBalcony, AptCorridor, AptEnd, AptGround, HouseWin, HouseDoor, HouseShutter, Shop, Plain, Office, Block, HouseWin2, SmallWin, AptBalcony2, Shop2, Roof }

function atlas(): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = TILE * N;
  const c = cv.getContext('2d')!;
  let seed = 3;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const tile = (k: number, draw: (x: number, y: number) => void) => { const x = (k % N) * TILE, y = Math.floor(k / N) * TILE; c.save(); c.beginPath(); c.rect(x, y, TILE, TILE); c.clip(); draw(x, y); c.restore(); };
  const grime = (x: number, y: number, w: number, h: number, a = 0.06) => {
    for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(40,38,30,${r() * a})`; c.fillRect(x + r() * w, y + r() * h, 1 + r() * 3, 1 + r() * 6); }
    const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,55,45,0.12)');
    c.fillStyle = g; c.fillRect(x, y, w, h);
  };
  const siding = (x: number, y: number) => { c.fillStyle = '#f2f0ea'; c.fillRect(x, y, TILE, TILE); c.strokeStyle = 'rgba(0,0,0,0.07)'; c.lineWidth = 2; for (let k = 0; k < TILE; k += 18) { c.beginPath(); c.moveTo(x, y + k); c.lineTo(x + TILE, y + k); c.stroke(); } };
  const glass = (x: number, y: number, w: number, h: number, curtain = true) => {
    const g = c.createLinearGradient(x, y, x + w, y + h); g.addColorStop(0, '#5d7487'); g.addColorStop(0.5, '#2d3c49'); g.addColorStop(1, '#41566a');
    c.fillStyle = g; c.fillRect(x, y, w, h);
    if (curtain) { c.fillStyle = ['#d8cdb4', '#b9c6c9', '#e4dccb', '#c9b8a0'][Math.floor(r() * 4)]; c.globalAlpha = 0.8; c.fillRect(x + 4, y + 4, w * (0.2 + r() * 0.25), h - 8); c.fillRect(x + w - 4 - w * 0.22, y + 4, w * 0.22, h - 8); c.globalAlpha = 1; }
    c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.moveTo(x, y); c.lineTo(x + w * 0.3, y); c.lineTo(x, y + h * 0.5); c.fill();
    c.strokeStyle = '#b8bcbd'; c.lineWidth = 8; c.strokeRect(x, y, w, h); c.beginPath(); c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); c.lineWidth = 6; c.stroke();
  };
  const rail = (x: number, y: number, w: number, h: number, solid = false) => {
    if (solid) { c.fillStyle = '#d9dcdd'; c.fillRect(x, y, w, h); c.fillStyle = 'rgba(0,0,0,0.08)'; c.fillRect(x, y + h - 10, w, 10); return; }
    c.strokeStyle = '#8e9599'; c.lineWidth = 6; c.strokeRect(x, y, w, h);
    c.lineWidth = 4; for (let k = x + 14; k < x + w; k += 18) { c.beginPath(); c.moveTo(k, y); c.lineTo(k, y + h); c.stroke(); }
  };
  const ac = (x: number, y: number) => { c.fillStyle = '#e9ebe8'; c.fillRect(x, y, 110, 78); c.strokeStyle = '#aab'; c.lineWidth = 2; c.strokeRect(x, y, 110, 78); c.fillStyle = '#9aa0a4'; c.beginPath(); c.arc(x + 60, y + 39, 30, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#777'; for (let k = 0; k < 6; k++) { c.beginPath(); c.moveTo(x + 32, y + 14 + k * 10); c.lineTo(x + 88, y + 14 + k * 10); c.stroke(); } };

  tile(T.AptBalcony, (x, y) => { c.fillStyle = '#eeece6'; c.fillRect(x, y, TILE, TILE); glass(x + 60, y + 60, 390, 330); c.fillStyle = '#dcdad3'; c.fillRect(x, y + 400, TILE, 26); rail(x + 10, y + 300, TILE - 20, 100); ac(x + 360, y + 316); c.strokeStyle = '#999'; c.lineWidth = 3; c.beginPath(); c.moveTo(x + 40, y + 120); c.lineTo(x + 470, y + 120); c.stroke(); grime(x, y, TILE, TILE); });
  tile(T.AptBalcony2, (x, y) => { c.fillStyle = '#e6e2d8'; c.fillRect(x, y, TILE, TILE); glass(x + 70, y + 70, 370, 320); rail(x, y + 290, TILE, 130, true); c.fillStyle = ['#d7e1ea', '#f0d8d0', '#e8e8d0'][Math.floor(r() * 3)]; c.fillRect(x + 120, y + 250, 50, 46); c.fillRect(x + 190, y + 255, 40, 40); grime(x, y, TILE, TILE); });
  tile(T.AptCorridor, (x, y) => { c.fillStyle = '#e4e2dc'; c.fillRect(x, y, TILE, TILE); c.fillStyle = '#54606b'; c.fillRect(x + 300, y + 90, 150, 300); c.fillStyle = '#c0c4c6'; c.fillRect(x + 420, y + 230, 14, 14); c.fillStyle = '#2f3a44'; c.fillRect(x + 70, y + 150, 160, 110); c.strokeStyle = '#aaa'; c.lineWidth = 5; for (let k = 0; k < 6; k++) { c.beginPath(); c.moveTo(x + 70 + k * 30, y + 150); c.lineTo(x + 70 + k * 30, y + 260); c.stroke(); } c.fillStyle = '#cfcdc5'; c.fillRect(x, y + 330, TILE, 110); c.fillStyle = '#fffbe8'; c.fillRect(x + 220, y + 40, 60, 20); grime(x, y, TILE, TILE, 0.09); });
  tile(T.AptEnd, (x, y) => { c.fillStyle = '#e9e6de'; c.fillRect(x, y, TILE, TILE); glass(x + 210, y + 120, 90, 200, false); c.strokeStyle = 'rgba(0,0,0,0.08)'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y + TILE - 4); c.lineTo(x + TILE, y + TILE - 4); c.stroke(); grime(x, y, TILE, TILE, 0.1); });
  tile(T.AptGround, (x, y) => { c.fillStyle = '#d8d4cb'; c.fillRect(x, y, TILE, TILE); c.fillStyle = '#2a2f34'; c.fillRect(x + 40, y + 120, 430, 392); c.fillStyle = '#6b7d8c'; c.fillRect(x + 70, y + 150, 170, 362); c.fillRect(x + 270, y + 150, 170, 362); c.fillStyle = 'rgba(255,240,200,0.5)'; c.fillRect(x + 80, y + 160, 150, 60); c.fillStyle = '#b8b2a6'; c.fillRect(x, y, TILE, 60); grime(x, y, TILE, TILE); });
  tile(T.HouseWin, (x, y) => { siding(x, y); c.fillStyle = '#7d7f80'; c.fillRect(x + 120, y + 110, 280, 34); glass(x + 130, y + 150, 260, 200); c.fillStyle = '#cfd2d3'; c.fillRect(x + 120, y + 352, 280, 14); grime(x, y, TILE, TILE); });
  tile(T.HouseWin2, (x, y) => { siding(x, y); glass(x + 90, y + 120, 340, 260); rail(x + 80, y + 300, 360, 80); grime(x, y, TILE, TILE); });
  tile(T.HouseDoor, (x, y) => { siding(x, y); c.fillStyle = '#6b4e36'; c.fillRect(x + 160, y + 160, 170, 352); c.strokeStyle = '#4a3423'; c.lineWidth = 6; c.strokeRect(x + 175, y + 180, 140, 150); c.fillStyle = '#c8a95a'; c.fillRect(x + 300, y + 330, 14, 30); c.fillStyle = '#ddd'; c.fillRect(x + 130, y + 130, 230, 24); glass(x + 380, y + 200, 80, 120, false); grime(x, y, TILE, TILE); });
  tile(T.HouseShutter, (x, y) => { siding(x, y); c.fillStyle = '#8c949a'; c.fillRect(x + 110, y + 130, 300, 240); c.strokeStyle = '#6c7378'; c.lineWidth = 3; for (let k = 0; k < 240; k += 10) { c.beginPath(); c.moveTo(x + 110, y + 130 + k); c.lineTo(x + 410, y + 130 + k); c.stroke(); } grime(x, y, TILE, TILE); });
  tile(T.SmallWin, (x, y) => { siding(x, y); c.fillStyle = '#c9d2d6'; c.fillRect(x + 200, y + 150, 120, 90); c.strokeStyle = '#999'; c.lineWidth = 6; c.strokeRect(x + 200, y + 150, 120, 90); c.fillStyle = '#7a7f80'; c.fillRect(x + 380, y + 60, 40, 452); grime(x, y, TILE, TILE); });
  tile(T.Plain, (x, y) => { siding(x, y); grime(x, y, TILE, TILE, 0.08); });
  const shop = (x: number, y: number, sign: string, signCol: string, glassy: boolean) => {
    c.fillStyle = '#ece8df'; c.fillRect(x, y, TILE, TILE);
    c.fillStyle = signCol; c.fillRect(x, y + 40, TILE, 110);
    c.fillStyle = '#fff'; c.font = '900 72px "Zen Kaku Gothic New", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(sign, x + TILE / 2, y + 98);
    if (glassy) { glass(x + 20, y + 170, 472, 342, false); c.fillStyle = 'rgba(255,250,230,0.35)'; c.fillRect(x + 30, y + 180, 452, 120); }
    else { c.fillStyle = '#9aa1a6'; c.fillRect(x + 20, y + 170, 472, 342); c.strokeStyle = '#7c8388'; c.lineWidth = 3; for (let k = 0; k < 342; k += 12) { c.beginPath(); c.moveTo(x + 20, y + 170 + k); c.lineTo(x + 492, y + 170 + k); c.stroke(); } }
    grime(x, y, TILE, TILE);
  };
  tile(T.Shop, (x, y) => shop(x, y, ['食堂', '理容', '薬局', '酒店', '書店'][Math.floor(r() * 5)], ['#b23a2e', '#2e5fa3', '#3b8a4a', '#8a5a2e', '#4b4b8a'][Math.floor(r() * 5)], r() < 0.6));
  tile(T.Shop2, (x, y) => shop(x, y, ['花', 'パン', '青果', '文具'][Math.floor(r() * 4)], ['#d06a2a', '#2a8a8a', '#a33a6a', '#5a7a2a'][Math.floor(r() * 4)], true));
  tile(T.Office, (x, y) => { c.fillStyle = '#d6d6d2'; c.fillRect(x, y, TILE, TILE); glass(x, y + 140, TILE, 220, false); c.fillStyle = 'rgba(0,0,0,0.1)'; c.fillRect(x, y + 360, TILE, 8); grime(x, y, TILE, TILE); });
  tile(T.Block, (x, y) => { c.fillStyle = '#b9b5ab'; c.fillRect(x, y, TILE, TILE); c.strokeStyle = '#9b978d'; c.lineWidth = 4; for (let k = 0; k < TILE; k += 64) { c.beginPath(); c.moveTo(x, y + k); c.lineTo(x + TILE, y + k); c.stroke(); for (let j = (k / 64) % 2 ? 0 : 64; j < TILE; j += 128) { c.beginPath(); c.moveTo(x + j, y + k); c.lineTo(x + j, y + k + 64); c.stroke(); } } c.fillStyle = 'rgba(70,90,50,0.25)'; c.fillRect(x, y + 440, TILE, 72); grime(x, y, TILE, TILE, 0.12); });
  tile(T.Roof, (x, y) => { c.fillStyle = '#9b9890'; c.fillRect(x, y, TILE, TILE); for (let i = 0; i < 40; i++) { const g = c.createRadialGradient(x + r() * TILE, y + r() * TILE, 0, x + r() * TILE, y + r() * TILE, 60); g.addColorStop(0, 'rgba(50,50,40,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(x, y, TILE, TILE); } grime(x, y, TILE, TILE, 0.15); });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

// ---- まとめ用の入れ物 ----
class Batch {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = [];
  quad(p: THREE.Vector3[], tileId: number, color: THREE.Color, u0 = 0, u1 = 1, v0 = 0, v1 = 1) {
    // p: 左下・右下・右上・左上（外から見て反時計回り）
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[3], p[0])).normalize();
    const tx = (tileId % N) / N, ty = 1 - (Math.floor(tileId / N) + 1) / N, s = 1 / N, e = 0.004; // 端のにじみを避ける
    const uvs = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const base = this.pos.length / 3;
    p.forEach((q, i) => {
      this.pos.push(q.x, q.y, q.z); this.nor.push(n.x, n.y, n.z); this.col.push(color.r, color.g, color.b);
      this.uv.push(tx + e + (s - 2 * e) * uvs[i][0], ty + e + (s - 2 * e) * uvs[i][1]);
    });
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  geometry(): THREE.BufferGeometry | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

interface Ctx { walls: Batch; roofs: Record<'clay' | 'grey', THREE.BufferGeometry[]>; far?: boolean; }

/** 箱型の建物。m は置く位置と向き（ローカル：x 横幅、z 奥行き、y 上）。face(i, floor, bay) で壁の絵を選ぶ */
function building(cx: Ctx, m: THREE.Matrix4, w: number, d: number, floors: number, fh: number, color: THREE.Color,
  face: (side: number, floor: number, bay: number, bays: number) => number, roof: 'flat' | 'clay' | 'grey', r: () => number) {
  const h = floors * fh;
  const corners = [new THREE.Vector3(-w / 2, 0, d / 2), new THREE.Vector3(w / 2, 0, d / 2), new THREE.Vector3(w / 2, 0, -d / 2), new THREE.Vector3(-w / 2, 0, -d / 2)];
  for (let sIdx = 0; sIdx < 4; sIdx++) {
    const a = corners[sIdx], b = corners[(sIdx + 1) % 4];
    const len = a.distanceTo(b);
    const bays = Math.max(1, Math.round(len / 3.4));
    for (let f = 0; f < floors; f++) for (let k = 0; k < bays; k++) {
      const p0 = a.clone().lerp(b, k / bays), p1 = a.clone().lerp(b, (k + 1) / bays);
      const q = [p0.clone().setY(f * fh), p1.clone().setY(f * fh), p1.clone().setY((f + 1) * fh), p0.clone().setY((f + 1) * fh)].map((v) => v.applyMatrix4(m));
      cx.walls.quad(q, face(sIdx, f, k, bays), color);
    }
  }
  if (roof === 'flat') {
    // 屋上と、低い立ち上がり（パラペット）、屋上の機械
    const top = corners.map((v) => v.clone().setY(h).applyMatrix4(m));
    cx.walls.quad([top[3], top[2], top[1], top[0]].reverse(), T.Roof, new THREE.Color(1, 1, 1), 0, w / 6, 0, d / 6);
    const par = 0.6;
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      const a = corners[sIdx], b = corners[(sIdx + 1) % 4];
      const q = [a.clone().setY(h), b.clone().setY(h), b.clone().setY(h + par), a.clone().setY(h + par)].map((v) => v.applyMatrix4(m));
      cx.walls.quad(q, T.Plain, color, 0, a.distanceTo(b) / 3.4, 0, 0.2);
    }
    if (r() < 0.7) box(cx.walls, m, new THREE.Vector3((r() - 0.5) * w * 0.5, h, (r() - 0.5) * d * 0.4), 2.2, 1.6, 1.8, T.Roof, new THREE.Color(0.85, 0.85, 0.85));
  } else {
    // 切妻屋根（屋根は別の材質）と妻壁
    const over = 0.5, pitch = 0.42 + r() * 0.15, rise = (d / 2 + over) * pitch;
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m);
    const roofG = new THREE.BufferGeometry();
    const xs = w / 2 + over;
    const vtx = [
      P(-xs, h - over * pitch, d / 2 + over), P(xs, h - over * pitch, d / 2 + over), P(xs, h + rise - over * pitch, 0), P(-xs, h + rise - over * pitch, 0),
      P(xs, h - over * pitch, -d / 2 - over), P(-xs, h - over * pitch, -d / 2 - over), P(-xs, h + rise - over * pitch, 0), P(xs, h + rise - over * pitch, 0),
    ];
    const arr: number[] = []; vtx.forEach((v) => arr.push(v.x, v.y, v.z));
    roofG.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    const ru = (w + 2 * over) / 2.5, rv = (d / 2 + over) * 1.1 / 2.5;
    roofG.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, ru, 0, ru, rv, 0, rv, 0, 0, ru, 0, ru, rv, 0, rv], 2));
    roofG.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    roofG.computeVertexNormals();
    cx.roofs[roof].push(roofG);
    // 妻壁（三角）
    for (const sx of [-1, 1]) {
      const a = P(sx * w / 2, h, sx * d / 2), b = P(sx * w / 2, h, -sx * d / 2), top = P(sx * w / 2, h + (d / 2) * pitch, 0);
      cx.walls.quad([a, b, top, top.clone()], T.Plain, color, 0, d / 3.4, 0, 0.5);
    }
  }
}

function box(b: Batch, m: THREE.Matrix4, c: THREE.Vector3, w: number, h: number, d: number, tileId: number, col: THREE.Color) {
  const P = (x: number, y: number, z: number) => new THREE.Vector3(c.x + x, c.y + y, c.z + z).applyMatrix4(m);
  const x = w / 2, z = d / 2;
  b.quad([P(-x, 0, z), P(x, 0, z), P(x, h, z), P(-x, h, z)], tileId, col);
  b.quad([P(x, 0, -z), P(-x, 0, -z), P(-x, h, -z), P(x, h, -z)], tileId, col);
  b.quad([P(x, 0, z), P(x, 0, -z), P(x, h, -z), P(x, h, z)], tileId, col);
  b.quad([P(-x, 0, -z), P(-x, 0, z), P(-x, h, z), P(-x, h, -z)], tileId, col);
  b.quad([P(-x, h, z), P(x, h, z), P(x, h, -z), P(-x, h, -z)], tileId, col);
}

const WALL_COLORS = ['#f4f1ea', '#ece4d4', '#e2d8c6', '#dfe3e4', '#d9cdb9', '#c9bba4', '#f0e6d8', '#e6e9e2', '#cfc6b8'].map((c) => new THREE.Color(c));
const APT_COLORS = ['#efede7', '#e8e2d6', '#dcd8cf', '#e5e7e8', '#d6c9b5', '#c7b9a3'].map((c) => new THREE.Color(c));

/** 線路の向きにそろえて、(s, d) に建物を置く行列。front：線路の方に向ける面（ローカル +z） */
function lotMatrix(s: number, d: number, y: number, side: number, jitter: number): THREE.Matrix4 {
  const f = at(s, d);
  // ローカル +z が線路の方（左側の建物なら右＝線路、右側なら左）を向くように回す
  const yaw = -f.th + (side > 0 ? Math.PI / 2 : -Math.PI / 2) + jitter;
  const m = new THREE.Matrix4().makeRotationY(yaw);
  m.setPosition(f.x, y, f.z);
  return m;
}

export function buildTown(group: THREE.Group): void {
  const r = rng(77);
  const wallTex = atlas();
  const wallM = new THREE.MeshStandardMaterial({ map: wallTex, vertexColors: true, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide });
  const roofMats = { clay: pbr('clay_roof_tiles', { color: 0x7d8496 }), grey: pbr('grey_roof_tiles', { color: 0x6c7076 }) };
  const BUCKET = 600;
  const ctxs = new Map<number, Ctx>();
  const ctxAt = (s: number, farRow = false) => { const k = Math.floor(s / BUCKET) * 2 + (farRow ? 1 : 0); if (!ctxs.has(k)) ctxs.set(k, { walls: new Batch(), roofs: { clay: [], grey: [] }, far: farRow }); return ctxs.get(k)!; };
  const nearStation = (s: number) => STATIONS.some((st) => Math.abs(s - st.stop + 40) < 230);
  const isTown = (s: number) => zoneW(s).town > 0.55;
  const crossingNear = (s: number, m: number) => CROSSINGS.some((c) => Math.abs(s - c.s) < m);

  // ---- 区画ごとに建物を置く ----
  for (const side of [1, -1]) {
    // 列（線路から遠ざかる方向）：手前の列から順に
    const near = side > 0 ? [11, 27, 44, 62, 82] : [19, 35, 52, 70, 90];
    const far = [108, 128, 150, 174, 200, 228, 258, 290, 324, 360, 398];
    const rows = [...near, ...far];
    rows.forEach((ad0, row) => {
      let s = -240 + r() * 10;
      while (s < LENGTH + 200) {
        const station = nearStation(s);
        const hama = Math.abs(s - 2110) < 450 && ad0 < 260;
        const apt = station || hama ? r() < 0.5 : r() < 0.12;
        const shop = station && row === 0 && !apt && r() < 0.7;
        const w = apt ? 18 + r() * 14 : shop ? 7 + r() * 3 : 8 + r() * 3.5;
        const dep = apt ? 9 + r() * 3 : 7 + r() * 3;
        const sc = s + w / 2;
        s += w + (apt ? 4 : 1.5) + r() * (station ? 2 : 6);
        if (!isTown(sc) || !isTown(sc - w / 2) || !isTown(sc + w / 2)) continue;
        if (crossingNear(sc, w / 2 + 12)) continue;
        if (ad0 > 100 && (sc < CITY.from || sc > CITY.to)) continue; // 遠い列は都市部だけ
        if (side > 0 && zoneAt(Math.max(0, sc)) === 'coast') continue;
        if (side > 0 && onPlatform(sc) && ad0 < 40) continue; // ホームと駅舎の裏
        if (r() < (station ? 0.08 : 0.22)) continue; // 空き地
        const ad = ad0 + dep / 2 + r() * 2;
        const d = C + side * ad;
        const f = at(sc, d);
        // ほかの線路（あおば線・さざなみ線の高架）の上には建てない
        const rad = Math.hypot(w, dep) / 2;
        if (AOBA_TRACK.nearest(f.x, f.z, 8).dist < rad + 9 || SAZA_TRACK.nearest(f.x, f.z, 8).dist < rad + 10) continue;
        const g = ground(sc, d, f.x, f.z);
        const base = at(Math.max(0, Math.min(LENGTH, sc))).y;
        if (g.h < 0.8 || Math.abs(g.h - (base - 0.85)) > 2.2) continue;
        const m = lotMatrix(sc, d, g.h - 0.15, side, (r() - 0.5) * 0.06);
        const cx = ctxAt(sc, ad0 > 100);
        if (apt) {
          const floors = 3 + Math.floor(r() * (hama ? 9 : station ? 5 : 3));
          const color = APT_COLORS[Math.floor(r() * APT_COLORS.length)];
          const balcony = r() < 0.5 ? T.AptBalcony : T.AptBalcony2;
          building(cx, m, w, dep, floors, 2.9, color, (sIdx, fl, bay) => {
            if (sIdx === 0) return fl === 0 && station ? (bay % 3 === 0 ? T.AptGround : T.Shop2) : balcony; // 線路側はベランダ
            if (sIdx === 2) return fl === 0 && bay === 1 ? T.AptGround : T.AptCorridor;
            return T.AptEnd;
          }, 'flat', r);
        } else if (shop) {
          const floors = 2 + (r() < 0.3 ? 1 : 0);
          const color = WALL_COLORS[Math.floor(r() * WALL_COLORS.length)];
          building(cx, m, w, dep, floors, 2.9, color, (sIdx, fl) => (sIdx === 0 ? (fl === 0 ? (r() < 0.5 ? T.Shop : T.Shop2) : T.HouseWin) : sIdx === 2 ? T.SmallWin : T.Plain), r() < 0.5 ? 'flat' : 'grey', r);
        } else {
          const floors = r() < 0.75 ? 2 : 1;
          const color = WALL_COLORS[Math.floor(r() * WALL_COLORS.length)];
          const pick = [T.HouseWin, T.HouseWin2, T.HouseShutter, T.SmallWin];
          building(cx, m, w, dep, floors, 2.8, color, (sIdx, fl, bay) => {
            if (sIdx === 0) return fl === 1 && bay === 0 ? T.HouseWin2 : pick[Math.floor(r() * 3)];
            if (sIdx === 2) return fl === 0 && bay === 0 ? T.HouseDoor : pick[Math.floor(r() * 4)];
            return r() < 0.5 ? T.SmallWin : T.Plain;
          }, r() < 0.55 ? 'grey' : 'clay', r);
          // ブロック塀（家の線路側）
          if (row > 0 || side < 0) {
            const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(m);
            const z = dep / 2 + 1.6, x = w / 2 + 0.6;
            cx.walls.quad([P(-x, 0, z), P(x, 0, z), P(x, 1.3, z), P(-x, 1.3, z)], T.Block, new THREE.Color(1, 1, 1), 0, (2 * x) / 3.4, 0, 0.45);
            cx.walls.quad([P(x, 0, z + 0.12), P(-x, 0, z + 0.12), P(-x, 1.3, z + 0.12), P(x, 1.3, z + 0.12)], T.Block, new THREE.Color(0.95, 0.95, 0.95), 0, (2 * x) / 3.4, 0, 0.45);
          }
        }
      }
    });
  }
  for (const cx of ctxs.values()) {
    const g = cx.walls.geometry();
    if (g) { const mesh = new THREE.Mesh(g, wallM); mesh.castShadow = !cx.far; mesh.receiveShadow = true; group.add(mesh); }
    for (const k of ['clay', 'grey'] as const) if (cx.roofs[k].length) {
      const mesh = new THREE.Mesh(merge(cx.roofs[k]), roofMats[k]); mesh.castShadow = !cx.far; mesh.receiveShadow = true; group.add(mesh);
    }
  }

  buildStreets(group, isTown, crossingNear);
}

/** 道路・電柱と電線・線路ぎわの金網 */
function buildStreets(group: THREE.Group, isTown: (s: number) => boolean, crossingNear: (s: number, m: number) => boolean) {
  // 町の区間（連続した範囲）を求める
  const spans: [number, number][] = [];
  let st: number | null = null;
  for (let s = -250; s <= LENGTH + 250; s += 10) {
    const t = isTown(s);
    if (t && st === null) st = s;
    if (!t && st !== null) { spans.push([st, s - 10]); st = null; }
  }
  if (st !== null) spans.push([st, LENGTH + 250]);
  const asphalt = pbr('asphalt_02', { color: 0x8a8a8a });
  const white = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7 });
  const concrete = pbr('brushed_concrete', { color: 0xbab6ae });
  const wireM = new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.6 });
  const fenceM = new THREE.MeshStandardMaterial({ map: chainLink(), alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5, color: 0xbfc4c6 });
  fenceM.alphaToCoverage = true;
  const steel = new THREE.MeshStandardMaterial({ color: 0x8d969a, metalness: 0.6, roughness: 0.5 });
  const roadD = C - 13; // 右側の道路の中心
  const poles: THREE.BufferGeometry[] = [], wires: THREE.BufferGeometry[] = [], fposts: THREE.BufferGeometry[] = [];
  for (const [a, b] of spans) {
    if (b - a < 60) continue;
    // 道路（右側、平らな町なので線路の高さ −0.82 m）。踏切の前後は道路を切る
    const segs: [number, number][] = [];
    let s0 = a;
    for (const c of CROSSINGS) if (c.s > a && c.s < b) { segs.push([s0, c.s - 6]); s0 = c.s + 6; }
    segs.push([s0, b]);
    // あおば線が横切る所で道を切る
    const cutAoba = (list: [number, number][], dd: number) => {
      const out: [number, number][] = [];
      for (const [x0, x1] of list) {
        let st = x0;
        for (let q = x0; q <= x1; q += 4) {
          const f = at(q, dd);
          const bad = AOBA_TRACK.nearest(f.x, f.z, 8).dist < 7;
          if (bad) { if (q - st > 12) out.push([st, q - 4]); st = q + 4; }
        }
        if (x1 - st > 12) out.push([st, x1]);
      }
      return out;
    };
    for (const [x0, x1] of cutAoba(segs, roadD)) {
      if (x1 - x0 < 20) continue;
      const road = new THREE.Mesh(extrudeAlong([[roadD + 3.2, -0.79], [roadD - 3.2, -0.79]], x0, x1, 4, { uScale: 0.33, vScale: 0.33 }), asphalt);
      road.receiveShadow = true; group.add(road);
      for (const e of [roadD + 2.9, roadD - 2.9]) {
        const l = new THREE.Mesh(extrudeAlong([[e + 0.08, -0.785], [e - 0.08, -0.785]], x0, x1, 4), white); l.receiveShadow = true; group.add(l);
      }
      // 側溝のふた（コンクリート）
      const gut = new THREE.Mesh(extrudeAlong([[roadD - 3.2, -0.78], [roadD - 3.8, -0.78]], x0, x1, 4, { uScale: 0.5, vScale: 0.5 }), concrete); gut.receiveShadow = true; group.add(gut);
    }
    // 電柱（道路の外側、30 m ごと）と電線
    const pd = roadD - 3.6;
    const ps: number[] = [];
    for (let s = a + 8; s < b - 5; s += 31) if (!crossingNear(s, 8)) ps.push(s);
    ps.forEach((s, i) => {
      const f = at(s, pd), y = at(s).y - 0.8;
      const p = new THREE.CylinderGeometry(0.13, 0.17, 10.5, 10); p.translate(f.x, y + 5.25, f.z); poles.push(p);
      const arm = new THREE.BoxGeometry(1.6, 0.1, 0.1); arm.applyMatrix4(new THREE.Matrix4().makeRotationY(-f.th + Math.PI / 2)); arm.translate(f.x, y + 9.6, f.z); poles.push(arm);
      if (i % 3 === 1) { const tr = new THREE.CylinderGeometry(0.28, 0.28, 0.9, 12); const off = at(s, pd + 0.45); tr.translate(off.x, y + 8.0, off.z); poles.push(tr); }
      if (i > 0) {
        const s0 = ps[i - 1];
        for (const [dd, hh, sag] of [[-0.7, 9.6, 0.5], [0, 9.6, 0.5], [0.7, 9.6, 0.5], [0.3, 7.6, 0.8]] as const) {
          const pts: THREE.Vector3[] = [];
          for (let k = 0; k <= 8; k++) {
            const u = k / 8, ss = s0 + (s - s0) * u, q = at(ss, pd + dd);
            pts.push(new THREE.Vector3(q.x, at(ss).y - 0.8 + hh + 0.02 - sag * 4 * u * (1 - u), q.z));
          }
          wires.push(wire(pts, 0.012));
        }
      }
    });
    // 線路ぎわの金網（両側）
    for (const fd of [C + FORM_W + 0.9, C - FORM_W - 0.9]) {
      const segsF: [number, number][] = [];
      let f0 = a;
      for (let s = a; s <= b; s += 5) {
        const ff = at(s, fd);
        const bad = onPlatform(s) || crossingNear(s, 7) || AOBA_TRACK.nearest(ff.x, ff.z, 8).dist < 6;
        if (bad && f0 !== null && s - f0 > 10) { segsF.push([f0, s]); }
        if (bad) f0 = s + 5;
      }
      if (b - f0 > 10) segsF.push([f0, b]);
      for (const [x0, x1] of segsF) {
        const fm = new THREE.Mesh(extrudeAlong([[fd, -0.8], [fd, 0.95]], x0, x1, 2.5, { uScale: 1 / 1.75, vScale: 1 / 2.5 }), fenceM);
        group.add(fm);
        for (let s = x0; s <= x1; s += 2.5) { const q = at(s, fd); const pg = new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6); pg.translate(q.x, at(s).y - 0.8 + 0.95, q.z); fposts.push(pg); }
      }
    }
  }
  if (poles.length) { const m = new THREE.Mesh(merge(poles), concrete); m.castShadow = true; m.receiveShadow = true; group.add(m); }
  for (let i = 0; i < wires.length; i += 200) group.add(new THREE.Mesh(merge(wires.slice(i, i + 200)), wireM));
  for (let i = 0; i < fposts.length; i += 400) { const m = new THREE.Mesh(merge(fposts.slice(i, i + 400)), steel); m.castShadow = false; group.add(m); }
}

function chainLink(): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, 128, 128);
  c.strokeStyle = '#ffffff'; c.lineWidth = 3;
  for (let k = -128; k < 256; k += 16) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k + 128, 128); c.stroke(); c.beginPath(); c.moveTo(k + 128, 0); c.lineTo(k, 128); c.stroke(); }
  c.lineWidth = 6; c.beginPath(); c.moveTo(0, 3); c.lineTo(128, 3); c.stroke();
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
