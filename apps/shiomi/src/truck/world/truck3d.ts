// トラクター（箱型の運転台）と 40ft のシャーシの 3D の形。
// 原点：トラクターはうしろの 2 軸の真ん中、トレーラーは 3 軸の真ん中（動きの計算と同じ点）。前は +x。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { canvas, ctex, box } from './tex';
import type { TruckSpec } from '../sim/vehicle';

export const mats = {
  paint: new THREE.MeshPhysicalMaterial({ color: 0xf29b12, roughness: 0.32, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x0c1418, roughness: 0.03, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.6 }),
  black: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.55, metalness: 0.6 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xd9dde2, roughness: 0.18, metalness: 1 }),
  alloy: new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.35, metalness: 0.9 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xe8b52a, roughness: 0.5, metalness: 0.3 }),
  head: new THREE.MeshStandardMaterial({ color: 0xdfe6ea, roughness: 0.1, metalness: 0.5, emissive: 0xfff6e0, emissiveIntensity: 0 }),
  amber: new THREE.MeshStandardMaterial({ color: 0xf0a020, roughness: 0.2, emissive: 0xff9a20, emissiveIntensity: 0 }),
  red: new THREE.MeshStandardMaterial({ color: 0x8a1010, roughness: 0.2, emissive: 0xff2010, emissiveIntensity: 0 }),
  chassis: new THREE.MeshStandardMaterial({ color: 0x2d3034, roughness: 0.6, metalness: 0.5 }),
};

function cabDecal(frontRight: boolean): THREE.Texture {
  const [c, g] = canvas(1024, 1000);
  const u = (t: number) => (frontRight ? t : 1 - t) * 1024;
  const x0 = Math.min(u(0.3), u(0.93)), x1 = Math.max(u(0.3), u(0.93));
  g.strokeStyle = 'rgba(40,20,0,0.75)'; g.lineWidth = 4;
  g.beginPath(); g.roundRect(x0, 40, x1 - x0, 900, 24); g.stroke();
  g.fillStyle = 'rgba(30,30,30,0.85)'; g.fillRect(frontRight ? x0 + 40 : x1 - 110, 470, 70, 18);
  g.fillStyle = '#183650'; g.font = '900 70px "Zen Kaku Gothic New", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('ナギサ運輸', (x0 + x1) / 2, 640);
  g.font = '700 30px "Barlow Semi Condensed", sans-serif'; g.fillText('NAGISA LOGISTICS', (x0 + x1) / 2, 712);
  return ctex(c, true);
}
function plateTex(): THREE.Texture {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#1f6b3a'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#dfe8e0'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 120);
  g.fillStyle = '#f2f4ee'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 28px "Zen Kaku Gothic New", sans-serif'; g.fillText('潮見 100', 128, 30);
  g.font = '700 30px "Zen Kaku Gothic New", sans-serif'; g.fillText('か', 34, 84);
  g.font = '700 62px "Barlow Semi Condensed", sans-serif'; g.fillText('25-08', 146, 84);
  return ctex(c, true);
}
function rimTex(): THREE.Texture {
  const [c, g] = canvas(256, 256);
  const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  gr.addColorStop(0, '#9aa0a6'); gr.addColorStop(0.55, '#e3e6ea'); gr.addColorStop(0.75, '#b6bbc1'); gr.addColorStop(0.8, '#5c6168'); gr.addColorStop(0.86, '#d0d4d8'); gr.addColorStop(1, '#8e949a');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#1b1d20';
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.2; g.beginPath(); g.ellipse(128 + Math.cos(a) * 78, 128 + Math.sin(a) * 78, 15, 10, a, 0, Math.PI * 2); g.fill(); }
  for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; g.fillStyle = '#f0f2f4'; g.beginPath(); g.arc(128 + Math.cos(a) * 42, 128 + Math.sin(a) * 42, 6, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#4a4f55'; g.beginPath(); g.arc(128, 128, 22, 0, Math.PI * 2); g.fill();
  const d = g.createRadialGradient(128, 128, 60, 128, 128, 128); d.addColorStop(0, 'rgba(60,40,30,0)'); d.addColorStop(1, 'rgba(60,40,30,0.35)');
  g.fillStyle = d; g.fillRect(0, 0, 256, 256);
  return ctex(c, true);
}

const R_WHEEL = 0.52;
export interface Wheel { obj: THREE.Object3D; spin: THREE.Object3D; }
let wheelParts: { tire: THREE.Material; rim: THREE.Material; side: THREE.Material } | null = null;
function wheel(parent: THREE.Object3D, x: number, side: number, dual: boolean, list: Wheel[]): Wheel {
  wheelParts ??= {
    tire: new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.9 }),
    rim: new THREE.MeshStandardMaterial({ map: rimTex(), metalness: 0.85, roughness: 0.32 }),
    side: new THREE.MeshStandardMaterial({ color: 0x202022, roughness: 0.85 }),
  };
  const w = dual ? 0.6 : 0.31;
  const steerG = new THREE.Group();
  steerG.position.set(x, R_WHEEL, side * (1.245 - w / 2 - 0.02));
  const spin = new THREE.Group(); steerG.add(spin);
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(R_WHEEL, R_WHEEL, w, 32, 1, true), wheelParts.tire);
  tire.rotation.x = Math.PI / 2; tire.castShadow = true; spin.add(tire);
  const sw = new THREE.Mesh(new THREE.RingGeometry(0.34, R_WHEEL, 32), wheelParts.side);
  sw.position.z = side * w / 2; if (side < 0) sw.rotation.y = Math.PI; spin.add(sw);
  const rim = new THREE.Mesh(new THREE.CircleGeometry(0.34, 32), wheelParts.rim);
  rim.position.z = side * (w / 2 - 0.04); if (side < 0) rim.rotation.y = Math.PI; spin.add(rim);
  parent.add(steerG);
  const out = { obj: steerG, spin };
  list.push(out);
  return out;
}

export interface TruckModel {
  tractor: THREE.Group;
  trailer: THREE.Group | null;
  cargoSlot: THREE.Group;   // コンテナを置く所（荷台の上の真ん中）
  frontWheels: Wheel[];
  wheels: Wheel[];
  setLights(on: number): void;
  update(steer: number, odo: number): void;
}

export function buildTractor(spec: TruckSpec): TruckModel {
  const t = new THREE.Group();
  const { paint, glass, black, dark, chrome, alloy, head, amber, red } = mats;
  const front = spec.front;
  const cabL = 2.25, cabX = front - cabL / 2;
  const cab = new THREE.Mesh(new RoundedBoxGeometry(cabL, 2.2, 2.49, 5, 0.13), paint);
  cab.position.set(cabX, 2.15, 0); cab.castShadow = true; cab.receiveShadow = true; t.add(cab);
  // 屋根の整流板
  const sp = new THREE.Shape();
  sp.moveTo(0, 0); sp.lineTo(1.95, 0); sp.quadraticCurveTo(1.85, 0.42, 1.55, 0.7); sp.lineTo(0, 0.8); sp.lineTo(0, 0);
  const spoiler = new THREE.Mesh(new THREE.ExtrudeGeometry(sp, { depth: 2.3, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 }), paint);
  spoiler.position.set(front - cabL + 0.05, 3.22, -1.15); spoiler.castShadow = true; t.add(spoiler);
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.0), glass);
  ws.rotation.y = Math.PI / 2; ws.position.set(front + 0.004, 2.62, 0); t.add(ws);
  [-0.45, 0.55].forEach((z) => { const w = box(0.02, 0.025, 0.9, black, front + 0.02, 2.25, z, t, false); w.rotation.x = 0.35; });
  [1, -1].forEach((s) => {
    const sw = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.72), glass);
    sw.position.set(cabX + 0.25, 2.77, s * 1.247); if (s < 0) sw.rotation.y = Math.PI; t.add(sw);
    const dec = new THREE.Mesh(new THREE.PlaneGeometry(cabL, 2.2), new THREE.MeshPhysicalMaterial({ map: cabDecal(s > 0), transparent: true, roughness: 0.32, clearcoat: 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    dec.position.set(cabX, 2.15, s * 1.2455); if (s < 0) dec.rotation.y = Math.PI; t.add(dec);
    box(0.5, 0.05, 0.05, black, front - 0.05, 2.85, s * 1.3, t);
    box(0.06, 0.06, 0.25, black, front + 0.15, 2.85, s * 1.4, t);
    box(0.1, 0.46, 0.24, black, front + 0.18, 2.55, s * 1.52, t);
    box(0.75, 0.42, 0.1, dark, cabX + 0.28, 0.82, s * 1.17, t);
    box(0.7, 0.04, 0.25, chrome, cabX + 0.28, 0.62, s * 1.1, t);
    box(0.06, 0.08, 0.14, amber, front + 0.03, 3.12, s * 1.05, t, false);
    box(0.04, 0.2, 0.42, head, front + 0.07, 0.8, s * 0.88, t, false);
    box(0.04, 0.09, 0.16, amber, front + 0.07, 0.8, s * 1.15, t, false);
  });
  box(0.05, 0.62, 1.5, black, front, 1.65, 0, t, false);
  [1.43, 1.63, 1.83].forEach((y) => box(0.06, 0.07, 1.46, paint, front + 0.03, y, 0, t, false));
  box(0.28, 0.62, 2.47, paint, front - 0.08, 0.72, 0, t);
  box(0.3, 0.12, 2.4, dark, front - 0.06, 0.37, 0, t);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.22), new THREE.MeshStandardMaterial({ map: plateTex(), roughness: 0.4 }));
  plate.rotation.y = Math.PI / 2; plate.position.set(front + 0.075, 0.58, 0); t.add(plate);
  box(1.9, 0.5, 2.0, dark, cabX - 0.1, 0.8, 0, t);
  // 骨組み、燃料タンク、排気管、連結器（第五輪）
  [0.45, -0.45].forEach((z) => box(front + spec.rear - 0.4, 0.28, 0.14, black, (front - spec.rear) / 2 - 0.2, 0.9, z, t));
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.3, 28), alloy);
  tank.rotation.z = Math.PI / 2; tank.position.set(cabX - 1.75, 0.72, 0.95); tank.castShadow = true; t.add(tank);
  box(0.6, 0.5, 0.5, black, cabX - 1.7, 0.75, -0.95, t);
  const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 14), chrome);
  ex.position.set(front - cabL - 0.15, 2.4, -1.0); t.add(ex);
  if (spec.kind === 'semi') {
    const fw = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.16, 28), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.4, metalness: 0.6 }));
    fw.position.set(spec.hitch, 1.18, 0); fw.castShadow = true; t.add(fw);
    // うしろの泥よけ
    [1, -1].forEach((s) => { box(2.2, 0.05, 0.64, black, 0, 1.1, s * 0.93, t); box(0.02, 0.55, 0.6, black, -1.0, 0.6, s * 0.93, t); });
    box(0.08, 0.14, 2.2, dark, -spec.rear + 0.05, 0.75, 0, t);
    [1, -1].forEach((s) => box(0.04, 0.1, 0.25, red, -spec.rear, 0.78, s * 0.9, t, false));
  }
  const wheels: Wheel[] = [], frontWheels: Wheel[] = [];
  const fwX = spec.wheelbase;
  [1, -1].forEach((s) => frontWheels.push(wheel(t, fwX, s, false, wheels)));
  // 単車は前が 2 軸（どちらも曲がる）
  if (spec.kind === 'rigid') [1, -1].forEach((s) => { frontWheels.push(wheel(t, fwX - 1.75, s, false, wheels)); box(1.15, 0.05, 0.36, black, fwX - 1.75, 1.1, s * 1.08, t); });
  [-0.65, 0.65].forEach((x) => [1, -1].forEach((s) => wheel(t, x, s, true, wheels)));
  [1, -1].forEach((s) => box(1.15, 0.05, 0.36, black, fwX, 1.1, s * 1.08, t));

  let trailer: THREE.Group | null = null;
  const cargoSlot = new THREE.Group();
  if (spec.kind === 'semi') {
    trailer = new THREE.Group();
    const L = spec.trailerFront + spec.trailerLen + spec.trailerRear;
    const xFront = spec.trailerLen + spec.trailerFront, cx = xFront - L / 2;
    // 骨組みのシャーシ（2 本の主桁と横桁）
    [0.5, -0.5].forEach((z) => box(L, 0.32, 0.16, mats.chassis, cx, 1.18, z, trailer!));
    for (let x = -spec.trailerRear + 0.2; x < xFront; x += 1.6) box(0.12, 0.14, 2.3, mats.chassis, x, 1.26, 0, trailer);
    [1, -1].forEach((s) => box(L, 0.12, 0.1, mats.chassis, cx, 1.3, s * 1.17, trailer!));
    box(0.16, 0.36, 2.44, mats.chassis, xFront - 0.08, 1.2, 0, trailer);
    // 黄色の固定金具（四隅）
    [cx - 6.0, cx + 6.0].forEach((x) => [1, -1].forEach((s) => box(0.18, 0.1, 0.18, mats.yellow, x, 1.41, s * 1.13, trailer!, false)));
    // 脚（前の方）と、うしろの灯
    [1, -1].forEach((s) => { box(0.12, 0.85, 0.12, mats.dark, spec.trailerLen - 1.6, 0.6, s * 0.95, trailer!); box(0.3, 0.06, 0.3, mats.dark, spec.trailerLen - 1.6, 0.18, s * 0.95, trailer!); });
    box(0.1, 0.16, 2.4, mats.dark, -spec.trailerRear + 0.05, 0.85, 0, trailer);
    [1, -1].forEach((s) => box(0.04, 0.12, 0.3, red, -spec.trailerRear, 0.86, s * 0.95, trailer!, false));
    [1, -1].forEach((s) => box(0.02, 0.6, 0.55, mats.black, -spec.trailerRear + 0.4, 0.55, s * 0.95, trailer!));
    [-1.31, 0, 1.31].forEach((x) => [1, -1].forEach((s) => wheel(trailer!, x, s, true, wheels)));
    cargoSlot.position.set(cx, 1.46, 0);
    trailer.add(cargoSlot);
  } else {
    // 単車の荷台：鉄の床、運転台のうしろの壁、横の巻き込み防止の柵、うしろの灯
    const x0 = -spec.rear, x1 = front - cabL - 0.15, cx = (x0 + x1) / 2, L = x1 - x0;
    box(L, 0.12, 2.49, mats.chassis, cx, 1.14, 0, t);
    [1, -1].forEach((s) => box(L, 0.2, 0.06, mats.alloy, cx, 1.09, s * 1.22, t));
    box(0.1, 1.8, 2.4, mats.alloy, x1 + 0.05, 2.1, 0, t);
    [1, -1].forEach((s) => {
      [0.55, 0.85].forEach((y) => box(2.8, 0.07, 0.07, mats.alloy, 2.4, y, s * 1.16, t));
      box(0.02, 0.6, 0.55, mats.black, x0 + 0.35, 0.55, s * 0.95, t);
      box(0.04, 0.12, 0.3, red, x0 - 0.01, 0.78, s * 0.95, t, false);
    });
    box(2.4, 0.05, 2.5, mats.black, 0, 1.08, 0, t);
    // 12ft を 2 個置く所の、黄色の固定金具
    for (const k of [-1, 1]) [1, -1].forEach((s) => [-1.75, 1.75].forEach((dx) => box(0.16, 0.08, 0.16, mats.yellow, cx + k * 1.87 + dx, 1.23, s * 1.1, t, false)));
    cargoSlot.position.set(cx, 1.2, 0);
    t.add(cargoSlot);
  }
  return {
    tractor: t, trailer, cargoSlot, frontWheels, wheels,
    setLights(on: number) { head.emissiveIntensity = 6 * on; red.emissiveIntensity = 2.5 * on; amber.emissiveIntensity = 1.6 * on; },
    update(steer: number, odo: number) {
      for (const w of wheels) w.spin.rotation.z = -odo / R_WHEEL;
      for (const w of frontWheels) w.obj.rotation.y = -steer;
    },
  };
}

