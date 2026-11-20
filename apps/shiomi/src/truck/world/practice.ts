// 練習用の広場：コンクリートの構内、コーンのスラローム、コンテナの谷間の通路、
// 門型クレーンの下の停止枠（前進で入って止める）
import * as THREE from 'three';
import { pbr, canvas, ctex, rng, box } from './tex';
import { ISO, LINES, isoMaterials } from './containers';
import type { Box } from '../sim/vehicle';

export interface Practice {
  group: THREE.Group;
  rtg: THREE.Group;      // 門型クレーン（レーンの向きに動く）
  gate: { open: boolean; setOpen(v: boolean): void; update(dt: number): void };
  trolley: THREE.Group;  // 台車（左右に動く。下に運転室）
  obstacles: Box[];
  target: { x: number; z: number; h: number };
  start: { x: number; z: number; h: number };
}

const hazardTex = () => {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#f2c21b'; g.fillRect(0, 0, 256, 64);
  g.fillStyle = '#151515';
  for (let x = -64; x < 256; x += 40) { g.beginPath(); g.moveTo(x, 64); g.lineTo(x + 20, 64); g.lineTo(x + 84, 0); g.lineTo(x + 64, 0); g.closePath(); g.fill(); }
  return ctex(c, true);
};

export function buildPractice(): Practice {
  const group = new THREE.Group();
  const obstacles: Box[] = [];
  const R = rng(31);

  // 地面
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(250, 124), pbr('concrete', 250 / 5, 124 / 5, { color: 0xb8b4ab }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(80, 0.005, 0); ground.receiveShadow = true; group.add(ground);

  // 地面の線と字：スタートの枠、通路の黄色の線、停止枠、タイヤの跡
  {
    const W = 4096, H = 512; // x -20〜180（200 m）× z -25〜25（50 m）
    const [c, g] = canvas(W, H);
    const xp = (x: number) => (x + 20) / 200 * W, zp = (z: number) => (z + 25) / 50 * H;
    const Rg = rng(41);
    [-1.2, 1.2].forEach((z) => { const y = zp(z); const gr = g.createLinearGradient(0, y - 6, 0, y + 6); gr.addColorStop(0, 'rgba(30,25,20,0)'); gr.addColorStop(0.5, 'rgba(30,25,20,0.35)'); gr.addColorStop(1, 'rgba(30,25,20,0)'); g.fillStyle = gr; g.fillRect(xp(-10), y - 6, xp(170) - xp(-10), 12); });
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(25,20,15,${0.12 + Rg() * 0.25})`; g.beginPath(); g.ellipse(Rg() * W, zp((Rg() - 0.5) * 30), 3 + Rg() * 14, 1.5 + Rg() * 4, 0, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#e2b230';
    g.fillRect(xp(60), zp(-5.8) - 3, xp(170) - xp(60), 6); g.fillRect(xp(60), zp(5.8) - 3, xp(170) - xp(60), 6);
    g.strokeStyle = '#f0f0ea'; g.lineWidth = 5;
    g.strokeRect(xp(-12.8), zp(-2.2), xp(6.6) - xp(-12.8), zp(2.2) - zp(-2.2));
    g.fillStyle = '#f0f0ea'; g.font = '700 46px "Zen Kaku Gothic New", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.save(); g.translate(xp(-15), zp(0)); g.rotate(Math.PI / 2); g.fillText('スタート', 0, 0); g.restore();
    // 停止枠（積み込みレーン 3 番）
    const tx = 140;
    g.strokeStyle = '#f0f0ea'; g.lineWidth = 6;
    g.strokeRect(xp(tx - 7.2), zp(-1.6), xp(tx + 7.2) - xp(tx - 7.2), zp(1.6) - zp(-1.6));
    g.fillStyle = '#f0f0ea'; g.fillRect(xp(tx + 7.2) - 4, zp(-1.6), 10, zp(1.6) - zp(-1.6));
    g.save(); g.translate(xp(tx + 9), zp(0)); g.rotate(Math.PI / 2); g.font = '700 60px "Barlow Semi Condensed", sans-serif'; g.fillText('STOP', 0, 0); g.restore();
    g.save(); g.translate(xp(tx - 9.5), zp(0)); g.rotate(Math.PI / 2); g.font = '700 50px "Zen Kaku Gothic New", sans-serif'; g.fillText('3 番レーン', 0, 0); g.restore();
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(0,0,0,${0.3 + Rg() * 0.7})`; g.fillRect(Rg() * W, Rg() * H, 1 + Rg() * 4, 1 + Rg() * 3); }
    const t = ctex(c, true); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    const ov = new THREE.Mesh(new THREE.PlaneGeometry(200, 50), new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    ov.rotation.x = -Math.PI / 2; ov.position.set(80, 0.003, 0); ov.receiveShadow = true; group.add(ov);
  }

  // コーンのスラローム（x 20〜52）
  const coneMat = new THREE.MeshStandardMaterial({ color: 0xf2642a, roughness: 0.6 });
  const bandMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4 });
  const coneGeo = new THREE.ConeGeometry(0.22, 0.78, 16); coneGeo.translate(0, 0.43, 0);
  const cones: [number, number][] = [];
  for (let i = 0; i < 5; i++) cones.push([22 + i * 8, i % 2 ? 2.6 : -2.6]);
  for (const [x, z] of cones) {
    const cm = new THREE.Mesh(coneGeo, coneMat); cm.position.set(x, 0, z); cm.castShadow = true; group.add(cm);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.12, 16), bandMat); b.position.set(x, 0.55, z); group.add(b);
    box(0.5, 0.05, 0.5, new THREE.MeshStandardMaterial({ color: 0x1a1a1a }), x, 0.025, z, group, false);
    obstacles.push({ cx: x, cz: z, h: 0, len: 0.45, wid: 0.45 });
  }

  // コンテナの谷間（x 62〜170、通路の幅 12 m）
  const variants = LINES.map((ln, i) => ({ len: 40 as const, mats: isoMaterials(ln, 40, 200 + i), list: [] as [number, number, number, number][] }));
  for (const side of [-1, 1]) {
    for (let r = 0; r < 3; r++) {
      const z = side * (7.4 + r * 2.6);
      for (let x = 68; x < 170; x += 12.6) {
        const h = r === 0 ? 3 + Math.floor(R() * 3) : 1 + Math.floor(R() * 4);
        for (let t = 0; t < h; t++) variants[Math.floor(R() * variants.length)].list.push([x + (R() - 0.5) * 0.08, ISO.H / 2 + t * ISO.H, z + (R() - 0.5) * 0.05, R() < 0.5 ? 0 : Math.PI]);
        obstacles.push({ cx: x, cz: z, h: 0, len: ISO.L40, wid: ISO.W });
      }
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const v of variants) {
    if (!v.list.length) continue;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(ISO.L40, ISO.H, ISO.W), v.mats, v.list.length);
    v.list.forEach(([x, y, z, ry], i) => { q.setFromAxisAngle(up, ry); im.setMatrixAt(i, m4.compose(p.set(x, y, z), q, one)); });
    im.castShadow = true; im.receiveShadow = true; group.add(im);
  }

  // 停止枠の上の門型クレーン（脚は通路の両わき）と、誘導の信号
  const target = { x: 140, z: 0, h: 0 };
  const rtg = new THREE.Group(), trolley = new THREE.Group();
  {
    const mat = new THREE.MeshStandardMaterial({ color: 0xe0785a, roughness: 0.5, metalness: 0.35 });
    const haz = new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.6 });
    const Hh = 19;
    [-3.6, 3.6].forEach((dx) => [-5.3, 5.3].forEach((z) => { box(1.0, Hh, 1.0, mat, dx, Hh / 2, z, rtg); obstacles.push({ cx: target.x + dx, cz: z, h: 0, len: 1.0, wid: 1.0 }); }));
    [-5.3, 5.3].forEach((z) => { box(8.6, 1.2, 1.2, mat, 0, 1.6, z, rtg); box(1.4, 1.0, 1.0, haz, -3.6, 0.5, z, rtg); box(1.4, 1.0, 1.0, haz, 3.6, 0.5, z, rtg); });
    [-3.6, 3.6].forEach((dx) => box(1.4, 1.6, 12.2, mat, dx, Hh + 0.8, 0, rtg));
    // 台車（左右に動く）と、その下の運転室
    const grey = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.5, metalness: 0.4 });
    box(8.4, 2.0, 3.4, grey, 0, 0, 0, trolley);
    box(1.8, 2.0, 1.8, grey, -2.6, -3.6, 1.6, trolley);
    box(1.7, 1.2, 1.82, new THREE.MeshPhysicalMaterial({ color: 0x0c1418, roughness: 0.05, metalness: 0.2, clearcoat: 1 }), -2.6, -3.4, 1.6, trolley);
    trolley.position.set(0, Hh + 2.4, 0);
    rtg.add(trolley);
    rtg.position.set(target.x, 0, 0);
    rtg.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(rtg);
  }
  // まわりの低い柵（広場の外へ出ないように）
  const fenceMat = new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.6 });
  // 東の柵は真ん中をあけて、出口のゲートにする
  const edges: [number, number, number, number][] = [[80, -60, 240, 0.5], [80, 60, 240, 0.5], [-40, 0, 0.5, 120], [200, -35, 0.5, 50], [200, 35, 0.5, 50]];
  for (const [x, z, l, w] of edges) { box(l, 0.8, w, fenceMat, x, 0.4, z, group); obstacles.push({ cx: x, cz: z, h: 0, len: l, wid: w }); }

  // 出口のゲート：守衛所と遮断機。積み込みが終わるまで閉じている
  const gateBox: Box = { cx: 200, cz: 0, h: 0, len: 0.6, wid: 20 };
  obstacles.push(gateBox);
  const booth = new THREE.Group();
  box(3, 2.8, 3, new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.7 }), 0, 1.4, 0, booth);
  box(3.2, 0.2, 3.2, new THREE.MeshStandardMaterial({ color: 0x3b4250, roughness: 0.6 }), 0, 2.9, 0, booth);
  box(2.2, 1.0, 0.05, new THREE.MeshPhysicalMaterial({ color: 0x0c1418, roughness: 0.05, clearcoat: 1 }), 0, 1.9, -1.53, booth, false);
  booth.position.set(204, 0, -12.5); group.add(booth);
  obstacles.push({ cx: 204, cz: -12.5, h: 0, len: 3, wid: 3 });
  const post = box(0.5, 1.1, 0.5, new THREE.MeshStandardMaterial({ color: 0xf2c21b, roughness: 0.5 }), 200, 0.55, -10.6, group);
  void post;
  const arm = new THREE.Group(); arm.position.set(200, 1.0, -10.4); group.add(arm);
  const armMat = new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.5 });
  box(0.12, 0.12, 20.4, armMat, 0, 0, 10.2, arm, true);
  // ゲートの看板
  {
    const [c, g] = canvas(1024, 160);
    g.fillStyle = '#1e4f9c'; g.fillRect(0, 0, 1024, 160);
    g.fillStyle = '#ffffff'; g.font = '900 72px "Zen Kaku Gothic New", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('潮見港 第 2 ターミナル', 512, 64);
    g.font = '700 34px "Barlow Semi Condensed", sans-serif'; g.fillText('SHIOMI PORT TERMINAL 2 ・ EXIT', 512, 128);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), new THREE.MeshStandardMaterial({ map: ctex(c, true), roughness: 0.5, side: THREE.DoubleSide }));
    sign.position.set(200, 6, 0); sign.rotation.y = Math.PI / 2; group.add(sign);
    [-10.5, 10.5].forEach((z) => box(0.3, 6.6, 0.3, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 }), 200, 3.3, z, group));
    box(0.3, 0.3, 21.3, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 }), 200, 6.8, 0, group);
  }
  const gate = {
    open: false,
    setOpen(v: boolean) { gate.open = v; gateBox.off = v; },
    /** 遮断機の腕を、開くときは上げ、閉じるときは下げる */
    update(dt: number) { const want = gate.open ? -Math.PI / 2 * 0.95 : 0; arm.rotation.x += Math.sign(want - arm.rotation.x) * Math.min(Math.abs(want - arm.rotation.x), dt * 1.5); },
  };

  return { group, rtg, trolley, obstacles, target, gate, start: { x: 0, z: 0, h: 0 } };
}
