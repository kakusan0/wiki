// 貨物列車：電気機関車 1 両と、12ft コンテナを 5 個まで積むコンテナ貨車 1 両（どちらも 20 m）。
// 置き方は makeTrain と同じ（原点は床下中心のレール面、-z が前）。
import * as THREE from 'three';
import { MAIN } from './route';
import { CAR_LEN, type TrainView } from './train';
import type { Path } from './net/path';

export interface Box12 { id: number; num: string; contents: string; }

function boxTex(num: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 344;
  const g = c.getContext('2d')!;
  g.fillStyle = '#8a2747'; g.fillRect(0, 0, 512, 344);
  for (let x = 0; x < 512; x += 12) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x + 6, 0, 5, 344); }
  g.fillStyle = '#ece8e4'; g.fillRect(0, 20, 512, 8);
  g.fillStyle = 'rgba(0,0,0,0.3)'; [300, 360, 420, 480].forEach((x) => g.fillRect(x - 4, 20, 8, 304));
  g.fillStyle = '#f6f2ee'; g.font = '900 34px "Zen Kaku Gothic New", sans-serif'; g.textBaseline = 'middle'; g.fillText('潮見貨物', 18, 120);
  g.font = '700 30px "Share Tech Mono", monospace'; g.textAlign = 'center'; g.textBaseline = 'top';
  let y = 40; for (const ch of num) { g.fillText(ch, 240, y); y += ch === '-' ? 18 : 27; }
  // 汚れ
  for (let i = 0; i < 40; i++) { const x = Math.random() * 512, l = 60 + Math.random() * 200; g.fillStyle = `rgba(40,25,20,${0.05 + Math.random() * 0.1})`; g.fillRect(x, 28, 2 + Math.random() * 4, l); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const mat = (color: number, rough = 0.45, metal = 0.4) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function add(g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) {
  const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); return mesh;
}

/** 電気機関車（赤い車体、両端に運転台、屋根にパンタグラフ） */
function makeLoco(): THREE.Group {
  const g = new THREE.Group();
  const L = CAR_LEN - 1.2, red = mat(0xb3302c, 0.35, 0.35), dark = mat(0x2b2e33, 0.6, 0.6), glass = mat(0x0d1418, 0.08, 0.9);
  add(g, new THREE.BoxGeometry(2.9, 2.6, L), red, 0, 2.55, 0);
  add(g, new THREE.BoxGeometry(2.92, 0.12, L - 0.2), mat(0xf2f2ee, 0.4, 0.2), 0, 2.2, 0);
  for (const dir of [-1, 1]) {
    add(g, new THREE.BoxGeometry(2.6, 0.9, 0.05), glass, 0, 3.2, dir * (L / 2 + 0.01));
    add(g, new THREE.BoxGeometry(0.3, 0.15, 0.05), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: dir < 0 ? 4 : 0 }), 0.9, 1.8, dir * (L / 2 + 0.01));
    add(g, new THREE.BoxGeometry(0.3, 0.15, 0.05), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff4dc, emissiveIntensity: dir < 0 ? 4 : 0 }), -0.9, 1.8, dir * (L / 2 + 0.01));
    add(g, new THREE.BoxGeometry(2.4, 0.9, 3.2), dark, 0, 0.7, dir * (L / 2 - 3.2)); // 台車
  }
  for (let z = -L / 2 + 3; z < L / 2 - 2; z += 2.4) for (const sx of [-1, 1]) add(g, new THREE.BoxGeometry(0.03, 0.5, 0.9), glass, sx * 1.46, 3.0, z);
  add(g, new THREE.BoxGeometry(0.1, 0.9, 1.6), dark, 0, 4.3, -3); // パンタグラフ（簡単な形）
  add(g, new THREE.BoxGeometry(1.4, 0.06, 0.1), dark, 0, 4.75, -3);
  return g;
}

/** コンテナ貨車：平らな台と、12ft を 5 個まで */
function makeWagon(boxes: Box12[]): THREE.Group {
  const g = new THREE.Group();
  const dark = mat(0x3a3d42, 0.6, 0.5);
  add(g, new THREE.BoxGeometry(2.6, 0.35, CAR_LEN - 0.6), dark, 0, 1.25, 0);
  for (const dir of [-1, 1]) add(g, new THREE.BoxGeometry(2.2, 0.8, 2.6), dark, 0, 0.6, dir * (CAR_LEN / 2 - 3));
  const L = 3.715, W = 2.45, H = 2.5;
  boxes.slice(0, 5).forEach((b, i) => {
    const side = new THREE.MeshStandardMaterial({ map: boxTex(b.num), roughness: 0.6, metalness: 0.25 });
    const plain = mat(0x86244a, 0.6, 0.25);
    // 長い辺が線路の向き（z）。側面は ±x
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(W, H, L), [side, side, plain, plain, plain, plain]);
    mesh.position.set(0, 1.42 + H / 2, -CAR_LEN / 2 + 0.6 + L / 2 + i * (L + 0.06));
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
  });
  return g;
}

/** 機関車と貨車の 2 両。置き方は makeTrain と同じ */
export function makeFreight(boxes: Box12[]): TrainView {
  const group = new THREE.Group();
  const cars = [makeLoco(), makeWagon(boxes)];
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
