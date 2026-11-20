// 町の建物：北は倉庫と工場（北浜工業地帯）、南は家・マンション・店（駅前・住宅地）。
// 届け先の建物、貨物駅、海と岸壁。建物は当たり判定の箱も返す
import * as THREE from 'three';
import { EDGES, KIND, LOTS, NODES } from './roadnet';
import { Geo, flat, edgeFrame, nodeHalf } from './roads3d';
import { canvas, ctex, rng, grain, pbr, box } from './tex';
import { overlap } from '../sim/collide';
import type { Box } from '../sim/vehicle';
import { RAIL, LAND, CROSS_LOCAL, roadLift } from '../../world/port';

/** 線路（複線の真ん中）の x を、港の座標の z から引く（港町の中では、線路は南北にのびる） */
function railX(z: number): number | null {
  for (let i = 0; i < RAIL.length - 1; i++) {
    const a = RAIL[i], b = RAIL[i + 1];
    if ((z - a.z) * (z - b.z) <= 0 && a.z !== b.z) return a.x + (b.x - a.x) * (z - a.z) / (b.z - a.z);
  }
  return null;
}
/** 線路の両側で、地面の板を切っておく幅（複線の真ん中から） */
export const RAIL_GAP = 16;
/** 線路ぞいの柵（複線の真ん中から） */
export const FENCE_D = 9;

/**
 * 港町の地面の板。線路のまわり（±RAIL_GAP）は切って、ひかり野線の路盤と地形を見せる。
 * 線路の西側は、積み込み場とその北、貨物駅のまわりだけ（潮見台の西の町は、ひかり野線の町のまま）。
 */
function buildGround(): THREE.BufferGeometry {
  const g = new Geo();
  const uv = (x: number, z: number): [number, number] => [x / 6, z / 6];
  const strip = (x0a: number, x1a: number, x0b: number, x1b: number, z0: number, z1: number) => {
    if (x1a - x0a < 0.5 && x1b - x0b < 0.5) return;
    g.quad([[x0a, 0, z0], [x0b, 0, z1], [x1b, 0, z1], [x1a, 0, z0]], [uv(x0a, z0), uv(x0b, z1), uv(x1b, z1), uv(x1a, z0)]);
  };
  const X1 = LAND.x1 + 30, Z0 = LAND.z0 - 170, Z1 = LAND.z1 + 110;
  for (let z0 = Z0; z0 < Z1; z0 += 10) {
    const z1 = z0 + 10;
    const ra = railX(z0), rb = railX(z1);
    if (ra === null || rb === null) {
      // 線路の南の端より南：貨物駅のまわりから東ぜんぶ
      strip(120, X1, 120, X1, z0, z1);
      continue;
    }
    // 東側
    strip(ra + RAIL_GAP, X1, rb + RAIL_GAP, X1, z0, z1);
    // 西側：積み込み場とその北（z < 100）、貨物駅のまわり（z 760〜）
    if (z1 <= 100) strip(-46, ra - RAIL_GAP, -46, rb - RAIL_GAP, z0, z1);
    else if (z0 >= 760) strip(120, ra - RAIL_GAP, 120, rb - RAIL_GAP, z0, z1);
  }
  return g.build();
}

type Facade = 'shed' | 'shedDoor' | 'apt' | 'house' | 'shop';
// 壁の絵 1 枚が表す大きさ（横 m, 縦 m）
const TILE: Record<Facade, [number, number]> = { shed: [8, 8], shedDoor: [8, 8], apt: [6, 3], house: [5, 3], shop: [6, 3.5] };

function facadeTex(kind: Facade): THREE.CanvasTexture {
  const W = 512, H = kind === 'shed' || kind === 'shedDoor' ? 512 : 256;
  const [c, g] = canvas(W, H);
  const R = rng(kind.length * 31);
  if (kind === 'shed' || kind === 'shedDoor') {
    g.fillStyle = '#e4e2dc'; g.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 16) { g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x + 10, 0, 4, H); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 2, 0, 2, H); }
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, W, 10); // 軒
    if (kind === 'shedDoor') {
      // 巻き上げのシャッター（幅 5 m・高さ 5 m）
      const x0 = W * 0.19, w = W * 0.62, y0 = H * 0.375;
      g.fillStyle = '#b9bcbf'; g.fillRect(x0, y0, w, H - y0);
      for (let y = y0; y < H; y += 7) { g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(x0, y, w, 2); }
      g.fillStyle = '#6d7276'; g.fillRect(x0 - 6, y0 - 14, w + 12, 14);
      g.fillStyle = 'rgba(30,25,20,0.35)'; g.fillRect(x0, H - 30, w, 30);
    } else {
      // 明かり取りの窓
      g.fillStyle = '#7d8c99'; g.fillRect(W * 0.1, H * 0.2, W * 0.8, H * 0.08);
    }
    for (let i = 0; i < 40; i++) { const x = R() * W, l = H * (0.1 + R() * 0.5); const gr = g.createLinearGradient(0, 10, 0, 10 + l); gr.addColorStop(0, `rgba(60,50,40,${0.08 + R() * 0.1})`); gr.addColorStop(1, 'rgba(60,50,40,0)'); g.fillStyle = gr; g.fillRect(x, 10, 2 + R() * 6, l); }
    const mud = g.createLinearGradient(0, H, 0, H * 0.85); mud.addColorStop(0, 'rgba(70,60,50,0.35)'); mud.addColorStop(1, 'rgba(70,60,50,0)'); g.fillStyle = mud; g.fillRect(0, H * 0.85, W, H * 0.15);
  } else if (kind === 'apt') {
    g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#3d4b58'; g.fillRect(70, 40, 300, 150);            // 窓
    g.fillStyle = 'rgba(220,210,190,0.8)'; g.fillRect(76, 46, 80, 138); // カーテン
    g.fillStyle = '#c9cbcb'; g.fillRect(40, 150, 432, 90);             // ベランダの手すり
    for (let x = 48; x < 470; x += 14) { g.fillStyle = '#9aa0a3'; g.fillRect(x, 150, 4, 90); }
    g.fillStyle = '#ecece8'; g.fillRect(390, 170, 60, 44);             // 室外機
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 240, W, 16);
  } else if (kind === 'house') {
    g.fillStyle = '#efe9dc'; g.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 14) { g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, y, W, 2); }
    g.fillStyle = '#3f4d59'; g.fillRect(150, 60, 200, 120);
    g.strokeStyle = '#b5b0a6'; g.lineWidth = 8; g.strokeRect(150, 60, 200, 120);
    g.fillStyle = 'rgba(230,220,200,0.8)'; g.fillRect(156, 66, 60, 108);
  } else {
    g.fillStyle = '#cfcac0'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#41535f'; g.fillRect(30, 70, 452, 170);
    g.fillStyle = 'rgba(255,240,210,0.35)'; g.fillRect(40, 80, 200, 150);
    g.fillStyle = ['#2f6e9e', '#b3302c', '#2f7552'][Math.floor(R() * 3)]; g.fillRect(0, 10, W, 46); // 看板の帯
  }
  grain(g, W, H, R, 3000, true);
  return ctex(c, true);
}

/** 箱の建物の壁 4 面（外向き）と屋根 */
function building(walls: Geo, roof: Geo, x0: number, z0: number, x1: number, z1: number, h: number, tile: [number, number]) {
  const ring: [number, number][] = [[x0, z1], [x1, z1], [x1, z0], [x0, z0], [x0, z1]];
  for (let i = 0; i < 4; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[i + 1];
    const w = Math.hypot(bx - ax, bz - az);
    // 絵の継ぎ目が建物ごとにそろわないよう、横の始まりをずらす
    const u0 = Math.floor((ax + az) * 7) % 3;
    walls.quad([[ax, 0, az], [bx, 0, bz], [bx, h, bz], [ax, h, az]], [[u0, 0], [u0 + w / tile[0], 0], [u0 + w / tile[0], h / tile[1]], [u0, h / tile[1]]]);
  }
  flat(roof, (x0 + x1) / 2, (z0 + z1) / 2, 1, 0, x1 - x0, z1 - z0, h, (_a, _l, x, z) => [x / 4, z / 4]);
}

function signPlane(text: string, sub: string, color: string, w: number, h: number): THREE.Mesh {
  const [c, g] = canvas(1024, Math.round(1024 * h / w));
  g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = color; g.fillRect(0, 0, 40, c.height);
  g.fillStyle = color; g.font = `900 ${Math.round(c.height * 0.5)}px "Zen Kaku Gothic New", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2 + 20, c.height * 0.42, c.width - 100);
  g.fillStyle = '#4a4f55'; g.font = `700 ${Math.round(c.height * 0.2)}px "Barlow Semi Condensed", sans-serif`; g.fillText(sub, c.width / 2 + 20, c.height * 0.82);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: ctex(c, true), roughness: 0.5 }));
}

export interface Town { group: THREE.Group; obstacles: Box[]; }

export function buildTown(): Town {
  const group = new THREE.Group();
  const obstacles: Box[] = [];
  const R = rng(2024);

  // ---- 地面と岸壁（海は、ひかり野線の海） ----
  const ground = new THREE.Mesh(buildGround(), pbr('gravel_floor_02', 1, 1, { color: 0x9e998e }));
  ground.position.y = -0.01; ground.receiveShadow = true; group.add(ground);
  // 岸壁：海面（港町の地面より 5 m ほど下）まで届く壁
  box(1.2, 9, 1200, new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.9 }), -45.6, -4.4, -250, group);
  obstacles.push({ cx: -46.5, cz: -250, h: 0, len: 3, wid: 1200 }); // 岸壁（海に落ちない）

  // ---- 建物を置いてはいけない所（道・歩道・交差点・構内） ----
  const keep: Box[] = [];
  const fence: Box[] = [];
  for (const e of EDGES) {
    const f = edgeFrame(e), k = KIND[e.kind];
    keep.push({ cx: (f.a.x + f.b.x) / 2, cz: (f.a.z + f.b.z) / 2, h: Math.atan2(-f.dz, f.dx), len: f.L + 2, wid: k.w + 2 * k.walk + 2 });
  }
  for (const n of NODES) { const h = nodeHalf(n.id) + 6; keep.push({ cx: n.x, cz: n.z, h: 0, len: h * 2, wid: h * 2 }); }
  for (const l of LOTS) keep.push({ cx: (l.x0 + l.x1) / 2, cz: (l.z0 + l.z1) / 2, h: 0, len: l.x1 - l.x0 + 6, wid: l.z1 - l.z0 + 6 });
  // 線路と柵の外の 6 m（建物を置かない）。柵は当たり判定にも入れる（踏切だけあける）
  for (let i = 0; i < RAIL.length - 1; i++) {
    const a = RAIL[i], b = RAIL[i + 1];
    const L = Math.hypot(b.x - a.x, b.z - a.z), h = Math.atan2(-(b.z - a.z), b.x - a.x);
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    keep.push({ cx, cz, h, len: L + 1, wid: 2 * (FENCE_D + 6) });
    if (Math.abs(cz - CROSS_LOCAL.z) < 16 && Math.abs(cx - CROSS_LOCAL.x) < 40) continue;
    const rx = -(b.z - a.z) / L, rz = (b.x - a.x) / L; // 線路の左
    for (const side of [1, -1]) fence.push({ cx: cx + rx * FENCE_D * side, cz: cz + rz * FENCE_D * side, h, len: L + 0.2, wid: 0.3 });
  }
  const placed: Box[] = [];
  const free = (b: Box) => {
    if (b.cx - b.len / 2 < -40 || b.cx + b.len / 2 > 1620 || b.cz - b.wid / 2 < -640 || b.cz + b.wid / 2 > 1080) return false;
    const grown = { ...b, len: b.len + 3, wid: b.wid + 3 };
    return !keep.some((k) => overlap(grown, k) > 0) && !placed.some((p) => overlap(grown, p) > 0);
  };

  const walls: Record<Facade, Geo> = { shed: new Geo(), shedDoor: new Geo(), apt: new Geo(), house: new Geo(), shop: new Geo() };
  const roof = new Geo();
  const tint = (a: [number, number, number][]) => a[Math.floor(R() * a.length)];
  const SHED_COLORS: [number, number, number][] = [[1, 1, 1], [0.86, 0.92, 1.0], [1.0, 0.96, 0.86], [0.9, 0.95, 0.9], [0.8, 0.82, 0.85]];
  const HOME_COLORS: [number, number, number][] = [[1, 1, 1], [1.0, 0.95, 0.88], [0.92, 0.94, 0.98], [0.96, 0.92, 0.86], [0.88, 0.86, 0.84]];

  /** 道ぞいに建物を並べる */
  for (const e of EDGES) {
    if (e.kind === 'drive') continue;
    const f = edgeFrame(e), k = KIND[e.kind];
    const rx = -f.dz, rz = f.dx;
    for (const side of [-1, 1]) {
      let s = f.s0 + 10;
      while (s < f.s1 - 10) {
        // 道の中ほどの位置で、どの地区かを決める
        const px = f.a.x + f.dx * s + rx * side * 30, pz = f.a.z + f.dz * s + rz * side * 30;
        const industrial = pz < -15 || (px < 430 && pz > -15 && pz < 15) || (px < 560 && pz > 600);
        let type: Facade, front: number, depth: number, h: number, back: number;
        if (industrial) { type = 'shedDoor'; front = 28 + R() * 40; depth = 22 + R() * 30; h = 8 + R() * 7; back = 10 + R() * 8; }
        else {
          const r = R();
          if (e.kind === 'main' || r < 0.15) { type = 'shop'; front = 10 + R() * 6; depth = 10 + R() * 6; h = 3.5 + (R() < 0.5 ? 3 : 0); back = 1; }
          else if (r < 0.4) { type = 'apt'; front = 18 + R() * 8; depth = 11 + R() * 3; h = 3 * (3 + Math.floor(R() * 4)); back = 4; }
          else { type = 'house'; front = 8.5 + R() * 3; depth = 8.5 + R() * 2; h = 6; back = 2.5 + R(); }
        }
        const off = side * (k.w / 2 + k.walk + back + depth / 2);
        const c = f.a.x + f.dx * (s + front / 2) + rx * off, d = f.a.z + f.dz * (s + front / 2) + rz * off;
        // 道の向きに合わせて、x と z の大きさを決める（道はすべて東西か南北）
        const alongX = Math.abs(f.dx) > 0.5;
        const sx = alongX ? front : depth, sz = alongX ? depth : front;
        const b: Box = { cx: c, cz: d, h: 0, len: sx, wid: sz };
        if (free(b)) {
          placed.push(b);
          const tile = TILE[type];
          // 工業地帯は、道に面した面だけシャッター、ほかは波板の壁
          const g = type === 'shedDoor' ? walls.shed : walls[type];
          g.color = type === 'shedDoor' ? tint(SHED_COLORS) : tint(HOME_COLORS);
          walls.shedDoor.color = g.color;
          building(g, roof, c - sx / 2, d - sz / 2, c + sx / 2, d + sz / 2, h, tile);
          if (type === 'shedDoor') {
            // 道に面した面にシャッターの絵を重ねる（壁から 5 cm 前）
            const fx = -rx * side, fz = -rz * side; // 道の方向
            const wx = alongX ? sx : sz;
            const cxF = c + fx * (alongX ? sz : sx) / 2 + fx * 0.05, czF = d + fz * (alongX ? sz : sx) / 2 + fz * 0.05;
            const tx = fz, tz = -fx; // 面に沿った向き（外から見て右）
            const p0: [number, number, number] = [cxF - tx * wx / 2, 0, czF - tz * wx / 2], p1: [number, number, number] = [cxF + tx * wx / 2, 0, czF + tz * wx / 2];
            walls.shedDoor.quad([p0, p1, [p1[0], h, p1[2]], [p0[0], h, p0[2]]], [[0, 0], [wx / tile[0], 0], [wx / tile[0], h / tile[1]], [0, h / tile[1]]]);
          }
          obstacles.push(b);
          s += front + 4 + R() * 10;
        } else s += 6;
      }
    }
  }

  // ---- 届け先と貨物駅 ----
  const named: [string, string, string, number, number, number, number, number, 'n' | 's' | 'e' | 'w'][] = [
    // 名前, 英字, 色, x0, z0, x1, z1, 高さ, 看板の面
    ['ミドリ物流センター', 'MIDORI LOGISTICS', '#2f7552', 1032, -548, 1172, -474, 15, 's'],
    ['潮見精機 第二工場', 'SHIOMI SEIKI', '#2d5c97', 945, 664, 1088, 734, 12, 'n'],
    ['潮見貨物駅', 'SHIOMI FREIGHT TERMINAL', '#8a2747', 160, 800, 270, 836, 9, 's'],
  ];
  for (const [name, sub, color, x0, z0, x1, z1, h, faceSide] of named) {
    walls.shed.color = [1, 1, 1]; walls.shedDoor.color = [1, 1, 1];
    building(walls.shed, roof, x0, z0, x1, z1, h, TILE.shed);
    obstacles.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, h: 0, len: x1 - x0, wid: z1 - z0 });
    const sg = signPlane(name, sub, color, Math.min(40, (x1 - x0) * 0.5), 5);
    const cx = (x0 + x1) / 2;
    if (faceSide === 's') { sg.position.set(cx, h - 3.5, z1 + 0.08); }
    else if (faceSide === 'n') { sg.position.set(cx, h - 3.5, z0 - 0.08); sg.rotation.y = Math.PI; }
    group.add(sg);
  }
  // 貨物駅：12ft コンテナの山（線路は、ひかり野線の線路の西に並べる着発線。次の段階で作る）
  {
    const maroon = new THREE.MeshStandardMaterial({ color: 0x8a2747, roughness: 0.6, metalness: 0.2 });
    for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) {
      const x = 162 + i * 4.1, z = 852 + j * 2.6;
      box(3.715, 2.5, 2.45, maroon, x, 1.25 + (i % 3 === 0 ? 0 : 0), z, group);
      if ((i + j) % 2 === 0) box(3.715, 2.5, 2.45, maroon, x, 3.75, z, group);
    }
    obstacles.push({ cx: 172.5, cz: 853.3, h: 0, len: 25, wid: 5.2 });
  }

  // ---- 住宅地の並木 ----
  {
    const pts: [number, number][] = [];
    for (const e of EDGES.filter((x) => x.kind === 'street')) {
      const f = edgeFrame(e), k = KIND.street;
      for (let s = f.s0 + 8; s < f.s1 - 8; s += 13) for (const side of [-1, 1]) {
        const x = f.a.x + f.dx * s - f.dz * side * (k.w / 2 + k.walk - 0.6), z = f.a.z + f.dz * s + f.dx * side * (k.w / 2 + k.walk - 0.6);
        if (z > 20 && R() < 0.8) pts.push([x, z]);
      }
    }
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 2.6, 6).translate(0, 1.3, 0), new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.9 }), pts.length);
    const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.6, 1).translate(0, 3.6, 0), new THREE.MeshStandardMaterial({ color: 0x4f6b2f, roughness: 0.95, flatShading: true }), pts.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    pts.forEach(([x, z], i) => {
      const k = 0.8 + R() * 0.5;
      m.compose(v.set(x, 0, z), q.setFromEuler(new THREE.Euler(0, R() * 6, 0)), sc.set(k, k, k));
      trunk.setMatrixAt(i, m); crown.setMatrixAt(i, m);
      obstacles.push({ cx: x, cz: z, h: 0, len: 0.4, wid: 0.4 });
    });
    trunk.castShadow = crown.castShadow = true;
    group.add(trunk, crown);
  }

  // ---- 線路ぞいの柵（コンクリートの柱と金網の上の線） ----
  {
    const postG = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.5, 0.12).translate(0, 0.75, 0), new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.9 }), fence.length * 4);
    const railM = new THREE.MeshStandardMaterial({ color: 0x8f9aa0, metalness: 0.5, roughness: 0.5 });
    const railG = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.05, 0.05), railM, fence.length * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    let k = 0, r = 0;
    for (const f of fence) {
      const fx = Math.cos(f.h), fz = -Math.sin(f.h);
      for (let t = -0.5; t < 0.5; t += 0.25) postG.setMatrixAt(k++, m.makeTranslation(f.cx + fx * f.len * t, 0, f.cz + fz * f.len * t));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.h);
      for (const y of [0.4, 1.45]) railG.setMatrixAt(r++, m.compose(v.set(f.cx, y, f.cz), q, sc.set(f.len, 1, 1)));
    }
    postG.count = k; railG.count = r;
    postG.castShadow = true;
    group.add(postG, railG);
    obstacles.push(...fence);
  }

  // ---- 踏切の板：臨港道路が線路を渡る所で、レール面の高さまで上がる ----
  {
    const g = new Geo();
    const W = 11; // 道の半分の幅（歩道まで）
    for (let x = CROSS_LOCAL.x - 32; x < CROSS_LOCAL.x + 32; x += 1) {
      const y = (px: number, pz: number) => roadLift(px, pz) + 0.03;
      g.quad([[x, y(x, -W), -W], [x, y(x, W), W], [x + 1, y(x + 1, W), W], [x + 1, y(x + 1, -W), -W]],
        [[x / 4, -W / 4], [x / 4, W / 4], [(x + 1) / 4, W / 4], [(x + 1) / 4, -W / 4]]);
    }
    const deck = new THREE.Mesh(g.build(), pbr('asphalt_02', 1, 1, { color: 0x8c8c8c }));
    deck.receiveShadow = true; group.add(deck);
  }

  // ---- まとめて描く ----
  for (const t of Object.keys(walls) as Facade[]) {
    const mesh = new THREE.Mesh(walls[t].build(), new THREE.MeshStandardMaterial({ map: facadeTex(t), vertexColors: true, roughness: 0.85, polygonOffset: t === 'shedDoor', polygonOffsetFactor: -1 }));
    mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  }
  const roofMesh = new THREE.Mesh(roof.build(), pbr('concrete', 1, 1, { color: 0x8f8c86 }));
  roofMesh.receiveShadow = true; group.add(roofMesh);
  return { group, obstacles };
}
