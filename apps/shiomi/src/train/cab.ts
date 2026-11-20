// 運転台（昔ながらの電車の運転台をイメージした独自デザイン）
// 塗装の金属の室内、丸い計器の列、表示灯、スイッチ盤、マスコン（左）とブレーキ弁（右）、時刻表差し、天井の機器箱、配線
import * as THREE from 'three';
import { Sim, kmh, EB } from './sim';
import { HIKARI, Route, fmtTime } from './route';
import { merge } from './world/geo';

export interface Cab {
  group: THREE.Group;
  update(sim: Sim, dt: number, opts: { wipers: boolean; guide: boolean; dist: number | null }): void;
  setRoute(r: Route): void;
}

// ---- 塗装（使い込んだ金属の塗り）を作る ----
function paintTex(base: string, seed: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const c = cv.getContext('2d')!;
  c.fillStyle = base; c.fillRect(0, 0, 512, 512);
  let a = seed;
  const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  // ムラ
  for (let i = 0; i < 260; i++) {
    const x = rnd() * 512, y = rnd() * 512, r = 10 + rnd() * 60;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const dark = rnd() < 0.5;
    g.addColorStop(0, dark ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 細かい点（ほこり・はげ）
  for (let i = 0; i < 2400; i++) {
    c.fillStyle = rnd() < 0.7 ? `rgba(30,30,25,${rnd() * 0.12})` : `rgba(240,240,225,${rnd() * 0.12})`;
    c.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  // こすれ傷
  c.strokeStyle = 'rgba(255,255,240,0.07)'; c.lineWidth = 1;
  for (let i = 0; i < 60; i++) { const x = rnd() * 512, y = rnd() * 512; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rnd() - 0.5) * 60, y + (rnd() - 0.5) * 12); c.stroke(); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

/** 箱の UV を m 単位にする（塗装の模様が伸びないように） */
function boxUV(g: THREE.BufferGeometry, scale = 2) {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute, p = g.getAttribute('position') as THREE.BufferAttribute, n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
    const u = ax > 0.5 ? p.getZ(i) : p.getX(i), v = ay > 0.5 ? p.getZ(i) : p.getY(i);
    uv.setXY(i, u * scale, v * scale);
  }
  return g;
}

// ---- 計器の文字盤（一度だけ描く） ----
type Dial = { label: string; max: number; step: number; major: number; red?: number; unit: string; scale?: number; face?: string };
function dialTex(d: Dial): THREE.CanvasTexture {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const cx = S / 2, cy = S / 2, R = S / 2 - 8;
  c.fillStyle = d.face ?? '#f4f1e6'; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
  const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
  const ang = (v: number) => A0 + (A1 - A0) * (v / d.max);
  const ink = d.face ? '#e8e4d8' : '#1a1a1a';
  if (d.red !== undefined) { c.strokeStyle = '#c8261e'; c.lineWidth = 16; c.beginPath(); c.arc(cx, cy, R - 30, ang(d.red), ang(d.max)); c.stroke(); }
  c.strokeStyle = ink; c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '700 44px "Share Tech Mono", monospace';
  for (let v = 0; v <= d.max + 1e-6; v += d.step) {
    const a = ang(v), big = Math.abs(v / d.major - Math.round(v / d.major)) < 1e-6;
    c.lineWidth = big ? 7 : 3;
    const r0 = R - 22, r1 = R - (big ? 62 : 44);
    c.beginPath(); c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); c.stroke();
    if (big) c.fillText(String(Math.round(v * (d.scale ?? 1))), cx + Math.cos(a) * (R - 104), cy + Math.sin(a) * (R - 104));
  }
  c.font = '700 34px "Zen Kaku Gothic New", sans-serif'; c.fillText(d.label, cx, cy + 110);
  c.font = '700 26px "Share Tech Mono", monospace'; c.fillText(d.unit, cx, cy + 150);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function timetableTex(route: Route): THREE.CanvasTexture {
  const STATIONS = route.stations;
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 768;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#f2efe4'; c.fillRect(0, 0, 512, 768);
  c.fillStyle = '#1a1a1a'; c.font = '900 40px "Zen Kaku Gothic New", sans-serif'; c.textBaseline = 'top';
  c.fillStyle = route.color; c.fillRect(0, 0, 512, 10); c.fillStyle = '#1a1a1a';
  c.fillText(`${route.name} 普通`, 24, 22);
  c.font = '700 24px "Zen Kaku Gothic New", sans-serif'; c.fillText(`2 両　${STATIONS[0].name} → ${STATIONS[STATIONS.length - 1].name}`, 24, 76);
  c.strokeStyle = '#1a1a1a'; c.lineWidth = 3; c.strokeRect(16, 120, 480, 600);
  c.lineWidth = 1.5;
  ['駅', '着', '発', '制限'].forEach((h, i) => c.fillText(h, [30, 200, 320, 430][i], 132));
  c.beginPath(); c.moveTo(16, 170); c.lineTo(496, 170); c.stroke();
  STATIONS.forEach((st, i) => {
    const y = 190 + i * 120;
    c.font = '900 40px "Zen Kaku Gothic New", sans-serif'; c.fillText(st.name, 30, y);
    c.font = '700 30px "Share Tech Mono", monospace';
    c.fillText(i === 0 ? '' : fmtTime(st.arr).slice(3), 200, y + 6);
    c.fillText(i === STATIONS.length - 1 ? '' : fmtTime(st.dep).slice(3), 320, y + 6);
    c.fillText(String(route.maxKmh), 430, y + 6);
    c.beginPath(); c.moveTo(16, y + 100); c.lineTo(496, y + 100); c.stroke();
  });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function labelStrip(labels: string[]): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 64;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#2b2f2c'; c.fillRect(0, 0, 1024, 64);
  c.fillStyle = '#e8e4d8'; c.font = '700 30px "Zen Kaku Gothic New", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  labels.forEach((l, i) => c.fillText(l, (i + 0.5) * (1024 / labels.length), 33));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function buildCab(): Cab {
  const g = new THREE.Group();
  const greenTex = paintTex('#5d7067', 7), creamTex = paintTex('#c4c2b4', 11), darkTex = paintTex('#3d4643', 5);
  const paint = new THREE.MeshStandardMaterial({ map: greenTex, roughness: 0.62, metalness: 0.15 });
  const paintDark = new THREE.MeshStandardMaterial({ map: darkTex, roughness: 0.55, metalness: 0.2 });
  const ceil = new THREE.MeshStandardMaterial({ map: creamTex, roughness: 0.8 });
  const black = new THREE.MeshStandardMaterial({ color: 0x141616, roughness: 0.5, metalness: 0.3 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xd8dbdc, metalness: 1, roughness: 0.2 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb08d4a, metalness: 1, roughness: 0.35 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.9 });
  const bakelite = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.35, metalness: 0.05 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D = g, cast = true) => {
    const mesh = new THREE.Mesh(geo, m); mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };

  // 車体中心はカメラから右へ 0.5 m。幅 2.84 m
  const L = -0.92, R = 1.92, FZ = -1.15, TILT = -0.07;
  const WIN_Y0 = -0.3, WIN_Y1 = 0.62;
  const W1: [number, number] = [-0.8, 0.6], W2: [number, number] = [1.0, 1.82];
  // 前面の壁（窓 2 つ。間は太い柱）
  const hole = (x0: number, x1: number, y0: number, y1: number, rr: number) => {
    const p = new THREE.Path();
    p.moveTo(x0 + rr, y0); p.lineTo(x1 - rr, y0); p.quadraticCurveTo(x1, y0, x1, y0 + rr); p.lineTo(x1, y1 - rr);
    p.quadraticCurveTo(x1, y1, x1 - rr, y1); p.lineTo(x0 + rr, y1); p.quadraticCurveTo(x0, y1, x0, y1 - rr); p.lineTo(x0, y0 + rr);
    p.quadraticCurveTo(x0, y0, x0 + rr, y0);
    return p;
  };
  const wall = new THREE.Shape();
  wall.moveTo(L, -1.7); wall.lineTo(R, -1.7); wall.lineTo(R, 1.05); wall.lineTo(L, 1.05); wall.closePath();
  wall.holes.push(hole(W1[0], W1[1], WIN_Y0, WIN_Y1, 0.09), hole(W2[0], W2[1], WIN_Y0, WIN_Y1, 0.09));
  const wg = new THREE.ExtrudeGeometry(wall, { depth: 0.1, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
  const wuv = wg.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * 0.8, wuv.getY(i) * 0.8);
  wg.translate(0, 0, -0.05);
  const front = add(wg, paint); front.position.z = FZ; front.rotation.x = TILT;
  // 窓の H ゴム
  for (const [x0, x1] of [W1, W2]) {
    const sh = new THREE.Shape(); const o = hole(x0 - 0.025, x1 + 0.025, WIN_Y0 - 0.025, WIN_Y1 + 0.025, 0.1);
    sh.curves = o.curves; sh.currentPoint = o.currentPoint;
    sh.holes.push(hole(x0 + 0.012, x1 - 0.012, WIN_Y0 + 0.012, WIN_Y1 - 0.012, 0.08));
    const m = add(new THREE.ShapeGeometry(sh, 8), rubber, g, false); m.position.z = FZ + 0.06; m.rotation.x = TILT;
  }
  // ガラス
  const glassM = new THREE.MeshStandardMaterial({ color: 0xffffff, map: makeDirt(), transparent: true, roughness: 0.1, depthWrite: false, envMapIntensity: 0.4 });
  for (const [x0, x1] of [W1, W2]) {
    const pg = new THREE.PlaneGeometry(x1 - x0, WIN_Y1 - WIN_Y0); pg.translate((x0 + x1) / 2, (WIN_Y0 + WIN_Y1) / 2, 0);
    const m = new THREE.Mesh(pg, glassM); m.position.z = FZ - 0.04; m.rotation.x = TILT; m.renderOrder = 5; g.add(m);
  }
  // 天井（少し丸く）と、天井の機器箱・スピーカー・扇風機
  const ceilG = new THREE.CylinderGeometry(3.2, 3.2, 2.2, 32, 1, true, -0.47, 0.94);
  ceilG.rotateX(Math.PI / 2); ceilG.rotateZ(Math.PI); ceilG.translate((L + R) / 2, 1.05 + 3.2 - 0.06, -0.15);
  boxUV(ceilG, 1.5);
  const cm = add(ceilG, ceil); (cm.material as THREE.Material).side = THREE.DoubleSide;
  const box1 = boxUV(new THREE.BoxGeometry(0.62, 0.2, 0.34)); box1.translate(-0.42, 0.84, -0.86); add(box1, paint);
  const box2 = boxUV(new THREE.BoxGeometry(0.34, 0.16, 0.26)); box2.translate(1.25, 0.88, -0.88); add(box2, paint);
  const sp = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.12), new THREE.MeshStandardMaterial({ map: grilleTex(), roughness: 0.6 }));
  sp.position.set(1.25, 0.88, -0.749); g.add(sp);
  const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 24), paint); fan.position.set(0.55, 0.98, -0.2); g.add(fan);
  const fanGrille = new THREE.Mesh(new THREE.CircleGeometry(0.19, 24), new THREE.MeshStandardMaterial({ map: grilleTex(true), transparent: true, roughness: 0.6 }));
  fanGrille.rotation.x = Math.PI / 2; fanGrille.position.set(0.55, 0.937, -0.2); g.add(fanGrille);
  // 天井の機器箱のスイッチ
  for (let i = 0; i < 5; i++) { const sw = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6), chrome); sw.position.set(-0.64 + i * 0.1, 0.74, -0.69); sw.rotation.x = 0.5; g.add(sw); }
  // 側壁と側窓
  const side = new THREE.Shape();
  side.moveTo(FZ, -1.7); side.lineTo(0.9, -1.7); side.lineTo(0.9, 1.1); side.lineTo(FZ, 1.1); side.closePath();
  side.holes.push(hole(-1.02, -0.18, -0.2, 0.6, 0.06));
  const sg = new THREE.ExtrudeGeometry(side, { depth: 0.06, bevelEnabled: false });
  sg.rotateY(-Math.PI / 2);
  add(sg, paint).position.x = L;
  add(sg.clone(), paint).position.x = R + 0.06;
  const sgl = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.8), glassM); sgl.rotation.y = Math.PI / 2; sgl.position.set(L - 0.03, 0.2, -0.6); g.add(sgl);
  // 日よけ（青い半透明）
  const visor = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.26), new THREE.MeshStandardMaterial({ color: 0x2c5f9a, transparent: true, opacity: 0.5, roughness: 0.2, side: THREE.DoubleSide }));
  visor.position.set(-0.15, 0.5, -1.02); visor.rotation.x = 0.4; g.add(visor);
  add(new THREE.BoxGeometry(0.8, 0.025, 0.025).translate(-0.15, 0.63, -1.08), chrome, g, false);
  // 配線の管（窓の上と柱）
  const pipes: THREE.BufferGeometry[] = [];
  const pipe = (a: THREE.Vector3, b: THREE.Vector3, r: number) => {
    const len = a.distanceTo(b); const pg = new THREE.CylinderGeometry(r, r, len, 8); pg.translate(0, len / 2, 0);
    pg.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())));
    pg.translate(a.x, a.y, a.z); pipes.push(pg);
  };
  pipe(new THREE.Vector3(L + 0.05, 0.74, FZ + 0.12), new THREE.Vector3(R - 0.05, 0.74, FZ + 0.12), 0.018);
  pipe(new THREE.Vector3(L + 0.05, 0.69, FZ + 0.13), new THREE.Vector3(0.75, 0.69, FZ + 0.13), 0.012);
  pipe(new THREE.Vector3(0.8, 0.72, FZ + 0.14), new THREE.Vector3(0.8, -0.3, FZ + 0.1), 0.016);
  pipe(new THREE.Vector3(0.84, 0.72, FZ + 0.14), new THREE.Vector3(0.84, -0.3, FZ + 0.1), 0.01);
  add(merge(pipes), paintDark, g, false);
  // 柱の上の小箱（列車無線のような箱）
  const rb = boxUV(new THREE.BoxGeometry(0.15, 0.2, 0.1)); rb.translate(0.8, 0.3, FZ + 0.14); add(rb, paintDark);
  const rbs = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.08), new THREE.MeshStandardMaterial({ map: grilleTex(), roughness: 0.6 })); rbs.position.set(0.8, 0.34, FZ + 0.192); rbs.scale.setScalar(0.8); g.add(rbs);
  const handset = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.14, 4, 8), bakelite); handset.position.set(0.8, 0.12, FZ + 0.21); handset.rotation.z = 0.2; g.add(handset);

  // ---- 机（運転台の台） ----
  // 窓の下から手前へ下がる斜めの計器面。形の x を z、押し出しを x にする
  const desk = new THREE.Shape();
  desk.moveTo(FZ, WIN_Y0 - 0.05); desk.lineTo(FZ + 0.14, WIN_Y0 - 0.05);
  desk.lineTo(-0.72, -0.5); desk.lineTo(-0.6, -0.56); desk.quadraticCurveTo(-0.52, -0.58, -0.5, -0.66);
  desk.lineTo(-0.5, -1.7); desk.lineTo(FZ, -1.7); desk.closePath();
  const dg = new THREE.ExtrudeGeometry(desk, { depth: R - L, bevelEnabled: false });
  dg.rotateY(-Math.PI / 2); dg.translate(R, 0, 0);
  const duv = dg.getAttribute('uv') as THREE.BufferAttribute; for (let i = 0; i < duv.count; i++) duv.setXY(i, duv.getX(i) * 1.6, duv.getY(i) * 1.6);
  add(dg, paint);
  // 計器面：机の斜面にそって置く（傾きと高さ）
  const slope = Math.atan2(-0.5 - (WIN_Y0 - 0.05), -0.72 - (FZ + 0.14)); // 下向きの傾き
  const panel = new THREE.Group();
  panel.position.set(0, (WIN_Y0 - 0.05 - 0.5) / 2 + 0.012, (FZ + 0.14 - 0.72) / 2);
  panel.rotation.x = -(Math.PI / 2 + slope); // 面の +z が運転士の方を向く
  g.add(panel);
  // 計器の台（黒い板）
  add(boxUV(new THREE.BoxGeometry(1.12, 0.3, 0.03)).translate(0.05, 0.0, 0.0), paintDark, panel);
  // 丸い計器 4 つ
  const dials: { def: Dial; x: number; y: number; r: number }[] = [
    { def: { label: '速度', max: 120, step: 5, major: 20, red: 85, unit: 'km/h' }, x: -0.24, y: 0.0, r: 0.078 },
    { def: { label: '圧力', max: 10, step: 0.5, major: 2, unit: '×100kPa' }, x: -0.05, y: 0.0, r: 0.066 },
    { def: { label: '電流', max: 600, step: 50, major: 200, unit: 'A', face: '#20231f' }, x: 0.12, y: 0.01, r: 0.055 },
    { def: { label: '電圧', max: 2000, step: 100, major: 500, red: 1800, unit: 'V', scale: 1, face: '#20231f' }, x: 0.26, y: 0.01, r: 0.055 },
  ];
  const needles: THREE.Object3D[][] = [];
  dials.forEach((d) => {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(d.r + 0.012, d.r + 0.016, 0.05, 40), black);
    body.rotation.x = Math.PI / 2; body.position.set(d.x, d.y, 0.035); panel.add(body);
    const face = new THREE.Mesh(new THREE.CircleGeometry(d.r, 48), new THREE.MeshStandardMaterial({ map: dialTex(d.def), roughness: 0.5, emissive: 0xffffff, emissiveMap: undefined, emissiveIntensity: 0 }));
    face.position.set(d.x, d.y, 0.061); panel.add(face);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r + 0.006, 0.008, 10, 48), chrome); ring.position.set(d.x, d.y, 0.064); panel.add(ring);
    const glass = new THREE.Mesh(new THREE.CircleGeometry(d.r, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0, envMapIntensity: 1.2, depthWrite: false }));
    glass.position.set(d.x, d.y, 0.07); panel.add(glass);
    const ns: THREE.Object3D[] = [];
    const cols = d.def.label === '圧力' ? [0x111111, 0xc8261e] : [d.def.face ? 0xf2c14e : 0x111111];
    for (const col of cols) {
      const piv = new THREE.Group(); piv.position.set(d.x, d.y, 0.064); panel.add(piv);
      const nd = new THREE.Mesh(new THREE.BoxGeometry(0.004, d.r * 0.88, 0.002), new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 }));
      nd.position.y = d.r * 0.36; piv.add(nd);
      ns.push(piv);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.006, 16), chrome); cap.rotation.x = Math.PI / 2; cap.position.set(d.x, d.y, 0.067); panel.add(cap);
    needles.push(ns);
  });
  const dialAngle = (v: number, max: number) => -(Math.PI * 0.75 + Math.PI * 1.5 * Math.max(0, Math.min(1, v / max))) - Math.PI / 2;
  // 表示灯の列（計器の上）と、名前の札
  const lampDefs: { name: string; color: number }[] = [
    { name: '戸閉', color: 0xffa020 }, { name: '力行', color: 0x38e070 }, { name: 'ブレーキ', color: 0xf0f0ff }, { name: 'ATS', color: 0xff2a1a },
    { name: '非常', color: 0xff2a1a }, { name: '回生', color: 0xffd020 },
  ];
  const lamps: Record<string, THREE.MeshStandardMaterial> = {};
  lampDefs.forEach((l, i) => {
    const x = -0.27 + i * 0.085;
    const hous = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.019, 0.025, 16), chrome); hous.rotation.x = Math.PI / 2; hous.position.set(x, 0.115, 0.028); panel.add(hous);
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(l.color).multiplyScalar(0.25), emissive: l.color, emissiveIntensity: 0, roughness: 0.25 });
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), m); lens.rotation.x = Math.PI / 2; lens.position.set(x, 0.115, 0.04); panel.add(lens);
    lamps[l.name] = m;
  });
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.036), new THREE.MeshStandardMaterial({ map: labelStrip(lampDefs.map((l) => l.name)), roughness: 0.6 }));
  strip.position.set(-0.27 + 2.5 * 0.085, 0.086, 0.017); strip.scale.x = 0.9; panel.add(strip);
  // スイッチ盤（机の右手前）：トグルスイッチと押しボタン
  const swPanel = new THREE.Group(); swPanel.position.set(0.85, -0.5, -0.86); swPanel.rotation.x = -0.75; g.add(swPanel);
  add(boxUV(new THREE.BoxGeometry(0.62, 0.3, 0.03)), paintDark, swPanel);
  const toggles: THREE.BufferGeometry[] = [], bases: THREE.BufferGeometry[] = [];
  for (let r = 0; r < 2; r++) for (let i = 0; i < 6; i++) {
    const x = -0.25 + i * 0.1, y = 0.07 - r * 0.12;
    const b = new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12); b.rotateX(Math.PI / 2); b.translate(x, y, 0.02); bases.push(b);
    const t = new THREE.CylinderGeometry(0.004, 0.0055, 0.045, 8); t.translate(0, 0.022, 0); t.rotateX(((i + r) % 3 ? 1 : -1) * 0.45 + Math.PI / 2 - Math.PI / 2); t.rotateX(0.9); t.translate(x, y, 0.024); toggles.push(t);
  }
  add(merge(bases), chrome, swPanel, false); add(merge(toggles), chrome, swPanel, false);
  [0xc8261e, 0x2a6fd0, 0x38a050, 0xe8e4d8].forEach((c, i) => {
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 20), new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 }));
    btn.rotation.x = Math.PI / 2; btn.position.set(-0.24 + i * 0.07, -0.11, 0.025); swPanel.add(btn);
  });
  // 左の小さなスイッチ盤（ドア・前照灯）
  const swL = new THREE.Group(); swL.position.set(-0.8, -0.48, -0.95); swL.rotation.x = -0.7; g.add(swL);
  add(boxUV(new THREE.BoxGeometry(0.2, 0.24, 0.03)), paintDark, swL);
  for (let i = 0; i < 3; i++) { const k = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.025, 16), bakelite); k.rotation.x = Math.PI / 2; k.position.set(0, 0.07 - i * 0.07, 0.025); swL.add(k); }

  // ---- マスコン（左。回すハンドル） ----
  const mc = new THREE.Group(); mc.position.set(-0.58, -0.62, -0.74); g.add(mc);
  add(boxUV(new THREE.BoxGeometry(0.24, 0.2, 0.26)).translate(0, -0.08, 0), paintDark, mc);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.02, 32), chrome); top.position.y = 0.03; mc.add(top);
  const scale = new THREE.Mesh(new THREE.RingGeometry(0.075, 0.105, 40, 1, Math.PI * 0.5, Math.PI * 0.9), new THREE.MeshStandardMaterial({ map: notchArc(), roughness: 0.5 }));
  scale.rotation.x = -Math.PI / 2; scale.position.y = 0.042; mc.add(scale);
  const crank = new THREE.Group(); crank.position.y = 0.045; mc.add(crank);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.17), chrome); arm.position.z = 0.07; crank.add(arm);
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.09, 16), bakelite); knob.position.set(0, 0.05, 0.15); crank.add(knob);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 20), chrome); crank.add(hub);
  // ---- ブレーキ弁（右。レバー） ----
  const bv = new THREE.Group(); bv.position.set(0.5, -0.64, -0.72); g.add(bv);
  add(new THREE.CylinderGeometry(0.09, 0.1, 0.16, 28).translate(0, -0.06, 0), black, bv);
  const bTop = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.015, 28), brass); bTop.position.y = 0.025; bv.add(bTop);
  const bLever = new THREE.Group(); bLever.position.y = 0.04; bv.add(bLever);
  const bArm = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, 0.22), chrome); bArm.position.z = 0.1; bLever.add(bArm);
  const bGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 16), bakelite); bGrip.position.set(0, 0.04, 0.2); bLever.add(bGrip);
  // 時刻表差し（右の柱の手前）と懐中時計
  const tt = new THREE.Group(); tt.position.set(1.12, -0.36, -0.98); tt.rotation.x = -0.5; tt.rotation.y = -0.25; g.add(tt);
  add(new THREE.BoxGeometry(0.26, 0.36, 0.02), black, tt);
  const sheetM = new THREE.MeshStandardMaterial({ map: timetableTex(HIKARI), roughness: 0.8 });
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.32), sheetM); sheet.position.z = 0.012; tt.add(sheet);
  const watchFace = new THREE.Mesh(new THREE.CircleGeometry(0.032, 32), new THREE.MeshStandardMaterial({ map: dialTex({ label: '', max: 12, step: 1, major: 3, unit: '' }), roughness: 0.4 }));
  watchFace.position.set(0.0, -0.13, 0.03); tt.add(watchFace);
  const watchRing = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.005, 8, 32), brass); watchRing.position.copy(watchFace.position); tt.add(watchRing);

  // ワイパー
  const wipers: THREE.Group[] = [];
  for (const [px, len] of [[(W1[0] + W1[1]) / 2 + 0.1, 0.72], [(W2[0] + W2[1]) / 2, 0.55]]) {
    const piv = new THREE.Group(); piv.position.set(px, WIN_Y0 - 0.03, FZ - 0.08); piv.rotation.x = TILT; g.add(piv);
    const a = new THREE.Group(); piv.add(a);
    const am = new THREE.Mesh(new THREE.BoxGeometry(0.016, len, 0.01), black); am.position.y = len / 2; a.add(am);
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.01, len * 0.85, 0.018), rubber); bl.position.set(0.012, len * 0.55, -0.01); a.add(bl);
    a.rotation.z = 1.5; wipers.push(a);
  }
  // 室内灯（弱い）と、窓から入る光のはね返り
  const lamp = new THREE.PointLight(0xfff0dc, 1.0, 4, 1.5); lamp.position.set(0.4, 0.8, -0.3); g.add(lamp);
  for (const m of [paint, paintDark, ceil, chrome, brass, black, bakelite]) m.envMapIntensity = 1.1;

  let wipeT = 0;
  const update: Cab['update'] = (sim, dt, opts) => {
    // マスコン：力行の段で回す。ブレーキ弁：ブレーキの段で回す
    const p = Math.max(0, sim.notch);
    const b = sim.notch === EB ? 9 : Math.max(0, -sim.notch);
    crank.rotation.y += (-p * 0.28 - crank.rotation.y) * Math.min(1, dt * 12);
    bLever.rotation.y += (b * 0.16 - bLever.rotation.y) * Math.min(1, dt * 12);
    // 針（実際の値に少し遅れてついていく）
    const sp = kmh(sim.v);
    const set = (o: THREE.Object3D, v: number, max: number, k = 8) => { o.rotation.z += (dialAngle(v, max) - o.rotation.z) * Math.min(1, dt * k); };
    set(needles[0][0], sp, 120, 10);
    set(needles[1][0], 8.2 + Math.sin(sim.t * 0.3) * 0.3, 10, 2);
    set(needles[1][1], Math.min(1, sim.brake / 1.4) * 4.4, 10, 6);
    const amps = sim.power > 0.01 ? sim.power / 0.78 * 480 : sim.brake > 0.05 && sim.v > 2 ? sim.brake * 160 : 0;
    set(needles[2][0], amps, 600, 5);
    set(needles[3][0], 1500 + Math.sin(sim.t * 0.7) * 25 - amps * 0.08, 2000, 3);
    // 表示灯
    const blink = Math.floor(sim.t * 3) % 2 === 0;
    lamps['戸閉'].emissiveIntensity = sim.door === 'closed' ? 3 : 0;
    lamps['力行'].emissiveIntensity = sim.power > 0.02 ? 3 : 0;
    lamps['ブレーキ'].emissiveIntensity = sim.brake > 0.05 ? 2.2 : 0;
    lamps['ATS'].emissiveIntensity = sim.ats === 'brake' || (sim.ats === 'warn' && blink) ? 4 : 0;
    lamps['非常'].emissiveIntensity = sim.notch === EB || sim.ats === 'brake' ? 4 : 0;
    lamps['回生'].emissiveIntensity = sim.brake > 0.05 && sim.v > 2 && sim.notch !== EB ? 2.5 : 0;
    // ワイパー
    if (opts.wipers || Math.cos(wipeT) < 0.995) {
      wipeT += dt * 3.2;
      const u = 0.5 + 0.5 * Math.cos(wipeT);
      for (const w of wipers) w.rotation.z = 1.5 * u - (1 - u) * 0.15;
      if (!opts.wipers && Math.cos(wipeT) > 0.995) wipeT = 0;
    }
  };
  const setRoute = (r: Route) => { sheetM.map?.dispose(); sheetM.map = timetableTex(r); sheetM.needsUpdate = true; };
  return { group: g, update, setRoute };
}

function notchArc(): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#26292a'; c.fillRect(0, 0, 256, 64);
  c.fillStyle = '#e8e4d8'; c.font = '700 22px "Share Tech Mono", monospace'; c.textBaseline = 'middle'; c.textAlign = 'center';
  ['切', '1', '2', '3', '4', '5'].forEach((l, i) => c.fillText(l, 20 + i * 44, 32));
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function grilleTex(round = false): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d')!;
  if (round) { c.clearRect(0, 0, 128, 128); c.strokeStyle = '#c9c9c0'; c.lineWidth = 3; for (let r = 10; r < 64; r += 9) { c.beginPath(); c.arc(64, 64, r, 0, Math.PI * 2); c.stroke(); } c.beginPath(); c.moveTo(0, 64); c.lineTo(128, 64); c.moveTo(64, 0); c.lineTo(64, 128); c.stroke(); }
  else { c.fillStyle = '#3a403d'; c.fillRect(0, 0, 128, 128); c.fillStyle = '#151817'; for (let y = 8; y < 128; y += 12) for (let x = 8; x < 128; x += 12) { c.beginPath(); c.arc(x, y, 3.2, 0, Math.PI * 2); c.fill(); } }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makeDirt(): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 512;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, 512, 512);
  const grd = c.createLinearGradient(0, 512, 0, 300);
  grd.addColorStop(0, 'rgba(120,110,95,0.22)'); grd.addColorStop(1, 'rgba(120,110,95,0.0)');
  c.fillStyle = grd; c.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = Math.random() * 1.8 + 0.3;
    c.fillStyle = `rgba(200,195,180,${0.04 + Math.random() * 0.08})`;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  }
  c.strokeStyle = 'rgba(160,150,135,0.06)'; c.lineWidth = 3;
  for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(256, 560, 380 + k * 14, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
