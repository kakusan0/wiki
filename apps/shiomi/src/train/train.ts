// 外から見た列車（自分の列車と、すれ違う列車）。白い車体に青と橙の帯
import * as THREE from 'three';
import { MAIN } from './route';
import type { Path } from './net/path';
import { pbr } from './world/assets';
import { merge } from './world/geo';

export const CAR_LEN = 20;

let mats: Record<string, THREE.Material> | null = null;
const bandMats = new Map<string, THREE.Material>();
function band(color: string) {
  if (!bandMats.has(color)) bandMats.set(color, new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.35 }));
  return bandMats.get(color)!;
}
function M(): Record<string, THREE.Material> {
  if (mats) return mats;
  mats = {
    body: new THREE.MeshStandardMaterial({ color: 0xe6eaea, metalness: 0.35, roughness: 0.32 }),
    blue: new THREE.MeshStandardMaterial({ color: 0x1f6fb4, metalness: 0.4, roughness: 0.35 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xf08a24, metalness: 0.4, roughness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0d1418, metalness: 0.9, roughness: 0.08 }),
    dark: pbr('rusty_metal_02', { color: 0x3a3836, metalness: 0.6, roughness: 0.7 }),
    gray: new THREE.MeshStandardMaterial({ color: 0x9aa0a4, metalness: 0.6, roughness: 0.45 }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: 5 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2010, emissiveIntensity: 0 }),
  };
  return mats;
}

/** 1 両。原点は床下中心のレール面、-z が前。front=true なら前面に運転台の顔 */
export function makeCar(front: boolean, back: boolean, panto: boolean, color = '#1f6fb4'): THREE.Group {
  const m: Record<string, THREE.Material> = { ...M(), blue: band(color) };
  const g = new THREE.Group();
  const L = CAR_LEN, W = 2.86, Y0 = 1.15, Y1 = 3.9;
  // 車体（屋根を丸く）
  const sh = new THREE.Shape();
  sh.moveTo(-W / 2, Y0); sh.lineTo(W / 2, Y0); sh.lineTo(W / 2, Y1 - 0.35);
  sh.quadraticCurveTo(W / 2, Y1, 0, Y1 + 0.05); sh.quadraticCurveTo(-W / 2, Y1, -W / 2, Y1 - 0.35); sh.closePath();
  const body = new THREE.ExtrudeGeometry(sh, { depth: L - 0.3, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.08, bevelSegments: 2 });
  body.translate(0, 0, -(L - 0.3) / 2);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => { const x = new THREE.Mesh(geo, mat); x.castShadow = true; x.receiveShadow = true; g.add(x); return x; };
  add(body, m.body);
  // 帯と窓
  const bands: THREE.BufferGeometry[] = [], oranges: THREE.BufferGeometry[] = [], wins: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    bands.push(new THREE.BoxGeometry(0.02, 0.32, L - 0.4).translate(sx * (W / 2 + 0.01), 2.05, 0));
    oranges.push(new THREE.BoxGeometry(0.02, 0.07, L - 0.4).translate(sx * (W / 2 + 0.012), 2.27, 0));
    for (let z = -L / 2 + 3.2; z < L / 2 - 2.6; z += 2.2) {
      const isDoor = Math.abs(z - (-4.6)) < 0.9 || Math.abs(z - 4.4) < 0.9;
      if (isDoor) {
        wins.push(new THREE.BoxGeometry(0.03, 1.95, 1.3).translate(sx * (W / 2 + 0.005), 2.3, z));
      } else wins.push(new THREE.BoxGeometry(0.03, 0.95, 1.6).translate(sx * (W / 2 + 0.008), 2.85, z));
    }
  }
  add(merge(bands), m.blue); add(merge(oranges), m.orange); add(merge(wins), m.glass);
  // 顔
  for (const [is, dir] of [[front, -1], [back, 1]] as const) {
    if (!is) continue;
    const z = dir * (L / 2 - 0.05);
    add(new THREE.BoxGeometry(2.3, 1.05, 0.04).translate(0, 2.95, z + dir * 0.08), m.glass);
    add(new THREE.BoxGeometry(W - 0.05, 0.4, 0.06).translate(0, 2.05, z + dir * 0.08), m.blue);
    for (const x of [-0.95, 0.95]) {
      const hl = add(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 16).rotateX(Math.PI / 2).translate(x, 1.75, z + dir * 0.1), dir < 0 ? m.head : m.tail);
      hl.castShadow = false;
    }
    add(new THREE.BoxGeometry(2.2, 0.6, 0.3).translate(0, 0.75, z), m.dark); // スカート
  }
  // 床下・台車
  add(new THREE.BoxGeometry(2.4, 0.5, L - 5).translate(0, 0.85, 0), m.dark);
  for (const bz of [-L / 2 + 2.6, L / 2 - 2.6]) {
    add(new THREE.BoxGeometry(2.1, 0.45, 2.6).translate(0, 0.62, bz), m.dark);
    for (const wz of [-0.95, 0.95]) for (const wx of [-0.6, 0.6]) {
      add(new THREE.CylinderGeometry(0.43, 0.43, 0.12, 20).rotateZ(Math.PI / 2).translate(wx, 0.43, bz + wz), m.gray);
    }
  }
  // 屋根上（クーラーとパンタグラフ）
  add(new THREE.BoxGeometry(1.6, 0.35, 3.2).translate(0, Y1 + 0.2, panto ? 3.5 : 0), m.gray);
  if (panto) {
    const pz = -5.5;
    add(new THREE.BoxGeometry(1.4, 0.15, 1.2).translate(0, Y1 + 0.12, pz), m.dark);
    const arms: THREE.BufferGeometry[] = [];
    const top = 5.15 - 0.02;
    for (const sx of [-0.45, 0.45]) {
      const a = new THREE.Vector3(sx, Y1 + 0.2, pz - 0.5), b = new THREE.Vector3(sx * 0.6, (Y1 + top) / 2, pz), c = new THREE.Vector3(0, top, pz);
      const s1 = new THREE.Vector3().subVectors(b, a), s2 = new THREE.Vector3().subVectors(c, b);
      const beamG = (p: THREE.Vector3, q: THREE.Vector3) => { const len = p.distanceTo(q); const geo = new THREE.CylinderGeometry(0.025, 0.025, len, 6); geo.translate(0, len / 2, 0); geo.applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), q.clone().sub(p).normalize()))); geo.translate(p.x, p.y, p.z); return geo; };
      arms.push(beamG(a, b), beamG(b, c)); void s1; void s2;
      const a2 = new THREE.Vector3(sx, Y1 + 0.2, pz + 0.5);
      arms.push(beamG(a2, b));
    }
    arms.push(new THREE.BoxGeometry(1.7, 0.05, 0.12).translate(0, top, pz));
    add(merge(arms), m.gray);
  }
  return g;
}

export interface TrainView { cars: THREE.Group[]; place(s: number, d: number, reverse?: boolean, path?: Path): void; group: THREE.Group; }

/** 2 両編成。s は先頭の位置。reverse=true は逆向きに走る列車 */
export function makeTrain(color = '#1f6fb4'): TrainView {
  const group = new THREE.Group();
  const cars = [makeCar(true, false, true, color), makeCar(false, true, false, color)];
  cars.forEach((c) => group.add(c));
  const place = (s: number, d: number, reverse = false, P: Path = MAIN) => {
    cars.forEach((c, i) => {
      const center = reverse ? s + CAR_LEN * (i + 0.5) : s - CAR_LEN * (i + 0.5);
      const f = P.at(center, d);
      const fa = P.at(center - 7, d), fb = P.at(center + 7, d);
      c.position.set(f.x, f.y, f.z);
      const yaw = Math.atan2(-(fb.x - fa.x), -(fb.z - fa.z));
      const pitch = Math.atan2(fb.y - fa.y, 14);
      c.rotation.set(0, 0, 0);
      c.rotation.order = 'YXZ';
      c.rotation.y = yaw + (reverse ? Math.PI : 0);
      c.rotation.x = reverse ? -pitch : pitch;
    });
  };
  return { cars, place, group };
}
