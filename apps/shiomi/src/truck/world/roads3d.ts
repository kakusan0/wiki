// 道路の 3D：路面・白線と黄線・横断歩道と停止線・歩道と縁石・街灯・標識
// 同じ材質のものは 1 つの形にまとめて、描く回数を減らす
import * as THREE from 'three';
import { NODES, EDGES, KIND, LOTS, node, len, type Edge } from './roadnet';
import { pbr, canvas, ctex, rng } from './tex';

/** 四角い面を足していく道具（三角形 2 つずつ） */
export class Geo {
  pos: number[] = []; uv: number[] = []; idx: number[] = []; col: number[] = [];
  /** 色（頂点の色）。建物ごとに色を変えるのに使う */
  color: [number, number, number] = [1, 1, 1];
  quad(p: [number, number, number][], uv: [number, number][]) {
    const b = this.pos.length / 3;
    for (const v of p) this.pos.push(...v);
    for (const t of uv) this.uv.push(...t);
    for (let i = 0; i < 4; i++) this.col.push(...this.color);
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}

/** 地面に平らな長方形。中心、向き（前の単位ベクトル）、長さ、幅。uv は (前, 横) → 好きな値 */
export function flat(g: Geo, cx: number, cz: number, dx: number, dz: number, L: number, W: number, y: number, uvf: (a: number, l: number, x: number, z: number) => [number, number]) {
  const rx = -dz, rz = dx;
  const c: [number, number][] = [[-L / 2, -W / 2], [L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2]];
  // 上から見て反時計回りにすると、面が上を向く
  const order = [0, 3, 2, 1];
  const p = order.map((i) => [cx + dx * c[i][0] + rx * c[i][1], y, cz + dz * c[i][0] + rz * c[i][1]] as [number, number, number]);
  const uv = order.map((i) => uvf(c[i][0] + L / 2, c[i][1] + W / 2, p[order.indexOf(i)][0], p[order.indexOf(i)][2]));
  g.quad(p, uv);
}

/** 交差点の半分の幅（つながる道でいちばん広いもの） */
export function nodeHalf(id: string): number {
  const inc = EDGES.filter((e) => e.a === id || e.b === id);
  return Math.max(...inc.map((e) => KIND[e.kind].w)) / 2;
}

export function edgeFrame(e: Edge) {
  const a = node(e.a), b = node(e.b), L = len(e);
  const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
  const ta = nodeHalf(e.a), tb = nodeHalf(e.b);
  const s0 = ta, s1 = L - tb; // 交差点の四角を除いた所
  return { a, b, L, dx, dz, s0, s1, mid: (s0 + s1) / 2, cx: a.x + dx * (s0 + s1) / 2, cz: a.z + dz * (s0 + s1) / 2, span: s1 - s0 };
}

/** 道の白線・黄線の絵（20 m ぶんを 1 枚。横が道の向き、縦が道幅） */
function markingTex(kind: Edge['kind']): THREE.CanvasTexture {
  const k = KIND[kind];
  const W = 1024, H = Math.round(k.w * 24);
  const [c, g] = canvas(W, H);
  const R = rng(kind.length * 17);
  const m = (meters: number) => (meters / k.w) * H;
  const line = (y: number, w: number, color: string, dash = false) => {
    g.fillStyle = color;
    if (!dash) g.fillRect(0, m(y) - m(w) / 2, W, m(w));
    else g.fillRect(0, m(y) - m(w) / 2, W * 0.4, m(w)); // 8 m 引いて 12 m あける
  };
  if (kind === 'main') {
    line(0.5, 0.15, '#f2f2ee'); line(k.w - 0.5, 0.15, '#f2f2ee');
    line(k.w / 2 - 0.12, 0.15, '#f0b528'); line(k.w / 2 + 0.12, 0.15, '#f0b528');
    line(k.w / 4 + 0.1, 0.15, '#f2f2ee', true); line(k.w * 3 / 4 - 0.1, 0.15, '#f2f2ee', true);
  } else if (kind === 'street') {
    line(0.4, 0.15, '#f2f2ee'); line(k.w - 0.4, 0.15, '#f2f2ee');
    line(k.w / 2, 0.15, '#f2f2ee', true);
  }
  // かすれ
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + R() * 0.7})`; g.fillRect(R() * W, R() * H, 1 + R() * 5, 1 + R() * 3); }
  for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(R() * W, 0, 4 + R() * 20, H); }
  const t = ctex(c, true);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** 路面の汚れ（タイヤの跡・補修の跡・ひび）。白い所ほど濃く汚す */
function grimeTex(): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 256);
  const R = rng(7);
  g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 256);
  [0.22, 0.32, 0.68, 0.78].forEach((v) => { const y = v * 256; const gr = g.createLinearGradient(0, y - 14, 0, y + 14); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, y - 14, 1024, 28); });
  for (let i = 0; i < 50; i++) { g.fillStyle = `rgba(255,255,255,${0.15 + R() * 0.3})`; g.beginPath(); g.ellipse(R() * 1024, (R() < 0.5 ? 0.27 : 0.73) * 256 + (R() - 0.5) * 20, 6 + R() * 30, 3 + R() * 6, 0, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 4; i++) { g.fillStyle = `rgba(255,255,255,${0.12 + R() * 0.15})`; g.fillRect(R() * 1024, R() * 200, 40 + R() * 140, 20 + R() * 50); }
  g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5;
  for (let i = 0; i < 20; i++) { let x = R() * 1024, y = R() * 256; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (R() - 0.3) * 30; y += (R() - 0.5) * 20; g.lineTo(x, y); } g.stroke(); }
  const t = ctex(c, false);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function signTex(text: string, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 256): THREE.CanvasTexture {
  const [c, g] = canvas(w, h);
  draw(g, w, h);
  void text;
  return ctex(c, true);
}

export function buildRoads(): THREE.Group {
  const group = new THREE.Group();
  // ---- 路面（世界の座標で模様を貼るので、継ぎ目が出ない） ----
  const road = new Geo();
  const wuv = (s: number) => (_a: number, _l: number, x: number, z: number): [number, number] => [x / s, z / s];
  for (const e of EDGES) { const f = edgeFrame(e); flat(road, f.cx, f.cz, f.dx, f.dz, f.span, KIND[e.kind].w, 0.02, wuv(4)); }
  for (const n of NODES) { const h = nodeHalf(n.id); flat(road, n.x, n.z, 1, 0, h * 2, h * 2, 0.02, wuv(4)); }
  const roadMesh = new THREE.Mesh(road.build(), pbr('asphalt_02', 1, 1, { color: 0xc8c8c4, normalScale: 1.2 }));
  roadMesh.receiveShadow = true; group.add(roadMesh);

  // ---- 構内（コンクリート） ----
  const lot = new Geo();
  for (const l of LOTS) if (l.id !== 'yard') flat(lot, (l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2, 1, 0, l.x1 - l.x0, l.z1 - l.z0, 0.015, wuv(5));
  const lotMesh = new THREE.Mesh(lot.build(), pbr('concrete', 1, 1, { color: 0xb8b4ab }));
  lotMesh.receiveShadow = true; group.add(lotMesh);

  // ---- 白線・黄線（種類ごとに 1 つ）と、路面の汚れ ----
  const grime = new Geo();
  for (const kind of ['main', 'street'] as const) {
    const g = new Geo();
    for (const e of EDGES.filter((x) => x.kind === kind)) {
      const f = edgeFrame(e);
      flat(g, f.cx, f.cz, f.dx, f.dz, f.span, KIND[kind].w, 0.035, (a, l) => [a / 20, l / KIND[kind].w]);
      flat(grime, f.cx, f.cz, f.dx, f.dz, f.span, KIND[kind].w, 0.03, (a, l) => [a / 40, l / KIND[kind].w]);
    }
    const m = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ map: markingTex(kind), transparent: true, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.receiveShadow = true; group.add(m);
  }
  const gm = new THREE.Mesh(grime.build(), new THREE.MeshStandardMaterial({ color: 0x1a1612, alphaMap: grimeTex(), transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  gm.receiveShadow = true; group.add(gm);

  // ---- 横断歩道と停止線（3 本以上の道が集まる交差点の手前） ----
  const zebra = new Geo(), stop = new Geo();
  for (const n of NODES) {
    const inc = EDGES.filter((e) => e.a === n.id || e.b === n.id);
    if (inc.length < 3) continue;
    const h = nodeHalf(n.id);
    for (const e of inc) {
      if (e.kind === 'drive') continue;
      const other = node(e.a === n.id ? e.b : e.a);
      const L = Math.hypot(other.x - n.x, other.z - n.z);
      const dx = (other.x - n.x) / L, dz = (other.z - n.z) / L; // 交差点から外へ
      const W = KIND[e.kind].w;
      // 横断歩道：交差点の四角のすぐ外、幅 4 m。しま模様は道の向きに平行
      flat(zebra, n.x + dx * (h + 2.2), n.z + dz * (h + 2.2), dx, dz, 4, W - 0.6, 0.04, (_a, l) => [0, l / 0.9]);
      // 停止線：交差点へ向かう車線（その向きで左の半分）だけ
      const tx = -dx, tz = -dz; // 交差点へ向かう向き
      const lx = tz, lz = -tx;   // その左
      const cx = n.x + dx * (h + 5.6) + lx * W / 4, cz = n.z + dz * (h + 5.6) + lz * W / 4;
      flat(stop, cx, cz, dx, dz, 0.45, W / 2 - 0.4, 0.04, () => [0, 0]);
    }
  }
  const [zc, zg] = canvas(16, 64);
  zg.fillStyle = '#f0f0ea'; zg.fillRect(0, 0, 16, 32);
  const zt = ctex(zc, true); zt.magFilter = THREE.NearestFilter;
  const zm = new THREE.Mesh(zebra.build(), new THREE.MeshStandardMaterial({ map: zt, transparent: true, alphaTest: 0.5, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }));
  zm.receiveShadow = true; group.add(zm);
  const sm = new THREE.Mesh(stop.build(), new THREE.MeshStandardMaterial({ color: 0xf0f0ea, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }));
  sm.receiveShadow = true; group.add(sm);

  // ---- 歩道と縁石（少し高い） ----
  const walk = new Geo(), curb = new Geo();
  for (const e of EDGES) {
    const k = KIND[e.kind];
    if (!k.walk) continue;
    const f = edgeFrame(e);
    const rx = -f.dz, rz = f.dx;
    for (const side of [-1, 1]) {
      const off = side * (k.w / 2 + k.walk / 2);
      flat(walk, f.cx + rx * off, f.cz + rz * off, f.dx, f.dz, f.span, k.walk, 0.16, wuv(2));
      // 縁石の立ち上がり（道の側の縦の面）
      const ex = f.cx + rx * side * k.w / 2, ez = f.cz + rz * side * k.w / 2;
      const p0: [number, number, number] = [ex - f.dx * f.span / 2, 0.02, ez - f.dz * f.span / 2];
      const p1: [number, number, number] = [ex + f.dx * f.span / 2, 0.02, ez + f.dz * f.span / 2];
      const q = [p0, p1, [p1[0], 0.16, p1[2]], [p0[0], 0.16, p0[2]]] as [number, number, number][];
      curb.quad(side > 0 ? q : [q[1], q[0], q[3], q[2]], [[0, 0], [f.span / 2, 0], [f.span / 2, 0.1], [0, 0.1]]);
    }
  }
  const wm = new THREE.Mesh(walk.build(), pbr('brushed_concrete', 1, 1, { color: 0xd4d0c8 }));
  wm.receiveShadow = true; group.add(wm);
  const cm = new THREE.Mesh(curb.build(), new THREE.MeshStandardMaterial({ color: 0xbdb9b0, roughness: 0.9, side: THREE.DoubleSide }));
  cm.receiveShadow = true; group.add(cm);

  // ---- 街灯（臨港道路の両側） ----
  {
    const pts: [number, number, number][] = []; // x, z, 腕の向き（rad）
    for (const e of EDGES.filter((x) => x.kind === 'main')) {
      const f = edgeFrame(e), k = KIND.main;
      for (let s = f.s0 + 10; s < f.s1 - 10; s += 38) {
        for (const side of [-1, 1]) {
          const off = side * (k.w / 2 + 0.8);
          pts.push([f.a.x + f.dx * s - f.dz * off, f.a.z + f.dz * s + f.dx * off, Math.atan2(f.dz * side, -f.dx * side) /* 腕は道の真ん中の方へ */]);
        }
      }
    }
    const dark = new THREE.MeshStandardMaterial({ color: 0x5d636b, roughness: 0.5, metalness: 0.6 });
    const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 9, 8).translate(0, 4.5, 0), dark, pts.length);
    const armG = new THREE.BoxGeometry(0.1, 0.1, 2.6).translate(0, 8.95, 1.2);
    const arm = new THREE.InstancedMesh(armG, dark, pts.length);
    const headG = new THREE.BoxGeometry(0.35, 0.14, 0.7).translate(0, 8.88, 2.4);
    const head = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.3 }), pts.length);
    const m = new THREE.Matrix4();
    pts.forEach(([x, z, r], i) => { m.makeRotationY(r).setPosition(x, 0, z); pole.setMatrixAt(i, m); arm.setMatrixAt(i, m); head.setMatrixAt(i, m); });
    pole.castShadow = true; group.add(pole, arm, head);
  }

  // ---- 制限速度の標識（道の入り口、進む向きの左） ----
  const limitTex = new Map<number, THREE.Texture>();
  const limitMat = (n: number) => {
    if (!limitTex.has(n)) limitTex.set(n, signTex(String(n), (g, w, h) => {
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#d42a24'; g.lineWidth = 26; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 18, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#1f3a8a'; g.font = '700 110px "Barlow Semi Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), w / 2, h / 2 + 6);
    }));
    return new THREE.MeshStandardMaterial({ map: limitTex.get(n)!, transparent: true, alphaTest: 0.5, roughness: 0.5 });
  };
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.5, metalness: 0.6 });
  for (const e of EDGES) {
    if (e.kind === 'drive') continue;
    const f = edgeFrame(e), k = KIND[e.kind];
    for (const dir of [1, -1]) {
      const s = dir > 0 ? f.s0 + 14 : f.s1 - 14;
      const tdx = f.dx * dir, tdz = f.dz * dir;         // 進む向き
      const lx = tdz, lz = -tdx;                         // その左
      const x = f.a.x + f.dx * s + lx * (k.w / 2 + 0.7), z = f.a.z + f.dz * s + lz * (k.w / 2 + 0.7);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), poleMat); p.position.set(x, 1.3, z); group.add(p);
      const d = new THREE.Mesh(new THREE.CircleGeometry(0.4, 32), limitMat(k.limit));
      d.position.set(x, 2.45, z);
      d.rotation.y = Math.atan2(-tdx, -tdz); // 来る車の方を向く
      group.add(d);
    }
  }

  // ---- 行き先の案内標識（青。臨港道路の交差点の手前） ----
  const label = (dx: number, dz: number) => (dz < -0.5 ? '北浜工業地帯' : dz > 0.5 ? '駅前・住宅地' : dx > 0.5 ? '東浜' : '潮見港');
  for (const [nid, fromId] of [['A', 'gate'], ['B', 'A'], ['C', 'B']] as const) {
    const n = node(nid), from = node(fromId);
    const L = Math.hypot(n.x - from.x, n.z - from.z);
    const tdx = (n.x - from.x) / L, tdz = (n.z - from.z) / L;
    const lines: [string, string][] = [];
    for (const e of EDGES.filter((x) => (x.a === nid || x.b === nid) && x.kind !== 'drive')) {
      const o = node(e.a === nid ? e.b : e.a);
      if (o.id === fromId) continue;
      const l = Math.hypot(o.x - n.x, o.z - n.z), dx = (o.x - n.x) / l, dz = (o.z - n.z) / l;
      const side = dx * -tdz + dz * tdx; // 右が正
      lines.push([side > 0.5 ? '→' : side < -0.5 ? '←' : '↑', label(dx, dz)]);
    }
    const tex = signTex('', (g, w, h) => {
      g.fillStyle = '#1e4f9c'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#ffffff'; g.textBaseline = 'middle';
      lines.forEach(([arrow, text], i) => {
        const y = 70 + i * 110;
        g.font = '900 80px "Zen Kaku Gothic New", sans-serif'; g.textAlign = 'center'; g.fillText(arrow, 80, y);
        g.font = '700 64px "Zen Kaku Gothic New", sans-serif'; g.textAlign = 'left'; g.fillText(text, 150, y, w - 180);
      });
    }, 768, 80 + lines.length * 110);
    const k = KIND.main;
    const s = L - nodeHalf(nid) - 60;
    const lx = tdz, lz = -tdx;
    const x = from.x + tdx * s + lx * (k.w / 2 + 1.2), z = from.z + tdz * s + lz * (k.w / 2 + 1.2);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 6, 8), poleMat); p.position.set(x, 3, z); group.add(p);
    const hgt = 0.5 + lines.length * 0.75;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, hgt * 1.0), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    board.position.set(x - lx * 1.6, 5.4, z - lz * 1.6);
    board.rotation.y = Math.atan2(-tdx, -tdz);
    group.add(board);
  }
  return group;
}
