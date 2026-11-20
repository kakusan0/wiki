// コンテナの見た目（ISO の 20ft・40ft）。会社名とマークはすべて架空
import * as THREE from 'three';
import { canvas, ctex, rng, normalFromHeight, grain } from './tex';

export const ISO = { H: 2.59, W: 2.44, L40: 12.19, L20: 6.06 };

export interface Line { name: string; color: string; ink: string; mark: 'wave' | 'sail' | 'frame' | 'hill' | 'flower' | 'none'; }
export const LINES: Line[] = [
  { name: 'AOSHIO LINE', color: '#a8452e', ink: '#f4efe8', mark: 'wave' },
  { name: 'KOMORI KAIUN', color: '#2d5c97', ink: '#f2f4f6', mark: 'sail' },
  { name: 'HARBORIA', color: '#d6d5cd', ink: '#24466e', mark: 'frame' },
  { name: 'NAGISA', color: '#2f7552', ink: '#f2f4ee', mark: 'hill' },
  { name: 'TSUBAKI EXPRESS', color: '#b3302c', ink: '#f6f0ea', mark: 'flower' },
  { name: 'SEIRAN', color: '#5b9496', ink: '#f2f6f4', mark: 'wave' },
  { name: 'BLUEWAKE', color: '#243b60', ink: '#e8eef4', mark: 'sail' },
  { name: 'KAZAHANA', color: '#8c9196', ink: '#1e2530', mark: 'frame' },
  { name: 'ORIMO LINES', color: '#c46a2c', ink: '#fbf3ea', mark: 'hill' },
  { name: 'AKANE LEASING', color: '#7b2e2b', ink: '#f2e9e4', mark: 'none' },
];

function waveMark(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  g.strokeStyle = color; g.lineWidth = s * 0.12; g.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    const yy = y + k * s * 0.32;
    g.beginPath(); g.moveTo(x, yy);
    g.bezierCurveTo(x + s * 0.25, yy - s * 0.25, x + s * 0.5, yy + s * 0.25, x + s * 0.75, yy);
    g.bezierCurveTo(x + s * 0.88, yy - s * 0.12, x + s, yy - s * 0.05, x + s * 1.05, yy);
    g.stroke();
  }
}
function drawMark(g: CanvasRenderingContext2D, kind: Line['mark'], x: number, y: number, s: number, color: string) {
  g.save(); g.fillStyle = color; g.strokeStyle = color; g.lineWidth = s * 0.12;
  if (kind === 'wave') waveMark(g, x - s / 2, y - s * 0.1, s, color);
  else if (kind === 'sail') { g.beginPath(); g.moveTo(x, y - s / 2); g.lineTo(x + s * 0.42, y + s * 0.4); g.lineTo(x - s * 0.42, y + s * 0.4); g.closePath(); g.fill(); }
  else if (kind === 'frame') { g.strokeRect(x - s * 0.4, y - s * 0.4, s * 0.8, s * 0.8); g.fillRect(x - s * 0.15, y - s * 0.15, s * 0.3, s * 0.3); }
  else if (kind === 'hill') { g.beginPath(); g.moveTo(x - s / 2, y + s * 0.35); g.quadraticCurveTo(x, y - s * 0.75, x + s / 2, y + s * 0.35); g.closePath(); g.fill(); }
  else if (kind === 'flower') { for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; g.beginPath(); g.arc(x + Math.cos(a) * s * 0.22, y + Math.sin(a) * s * 0.22, s * 0.2, 0, Math.PI * 2); g.fill(); } }
  g.restore();
}

// 波板などの凹凸（法線）は、長さごとに 1 回だけ作って使い回す
let shared: { 40: THREE.Texture; 20: THREE.Texture; door: THREE.Texture; front: THREE.Texture; roofMap: THREE.Texture; roofNor: THREE.Texture } | null = null;
function sideHeight(len: number) {
  const W = 1024, H = 256;
  const [hc, hg] = canvas(W, H);
  const period = 0.28 * W / len;
  for (let x = 0; x < W; x++) {
    const p = (x % period) / period;
    const s = p < 0.15 ? p / 0.15 : p < 0.5 ? 1 : p < 0.65 ? 1 - (p - 0.5) / 0.15 : 0;
    const v = 70 + 120 * s; hg.fillStyle = `rgb(${v},${v},${v})`; hg.fillRect(x, 0, 1, H);
  }
  const rail = H * 0.06, post = 0.16 * W / len;
  hg.fillStyle = '#a0a0a0'; hg.fillRect(0, 0, W, rail); hg.fillRect(0, H - rail, W, rail); hg.fillRect(0, 0, post, H); hg.fillRect(W - post, 0, post, H);
  return normalFromHeight(hc, 3);
}
function getShared() {
  if (shared) return shared;
  const [dc, dg] = canvas(256, 272);
  dg.fillStyle = '#808080'; dg.fillRect(0, 0, 256, 272);
  for (let y = 0; y < 272; y++) { const v = 128 + 40 * Math.sin(y / 18 * Math.PI * 2); dg.fillStyle = `rgb(${v},${v},${v})`; dg.fillRect(18, y, 220, 1); }
  dg.fillStyle = '#a0a0a0'; dg.fillRect(0, 0, 256, 18); dg.fillRect(0, 254, 256, 18); dg.fillRect(0, 0, 18, 272); dg.fillRect(238, 0, 18, 272);
  dg.fillStyle = '#404040'; dg.fillRect(126, 18, 4, 236);
  dg.fillStyle = '#f0f0f0'; [52, 98, 158, 204].forEach((x) => dg.fillRect(x - 4, 22, 8, 228));
  const [fc, fg] = canvas(256, 272);
  for (let y = 0; y < 272; y++) { const p = (y % 22) / 22; const v = p < 0.5 ? 180 : 80; fg.fillStyle = `rgb(${v},${v},${v})`; fg.fillRect(0, y, 256, 1); }
  fg.fillStyle = '#a0a0a0'; fg.fillRect(0, 0, 256, 18); fg.fillRect(0, 254, 256, 18); fg.fillRect(0, 0, 18, 272); fg.fillRect(238, 0, 18, 272);
  const [rc, rg] = canvas(512, 128); const [rh, rhg] = canvas(512, 128);
  const R = rng(77);
  rg.fillStyle = '#d8d8d8'; rg.fillRect(0, 0, 512, 128);
  for (let x = 0; x < 512; x++) { const v = 128 + 50 * Math.sin(x / 10 * Math.PI * 2); rhg.fillStyle = `rgb(${v},${v},${v})`; rhg.fillRect(x, 0, 1, 128); }
  for (let i = 0; i < 40; i++) { const r = 4 + R() * 14; const gr = rg.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, `rgba(60,45,35,${0.06 + R() * 0.12})`); gr.addColorStop(1, 'rgba(60,45,35,0)'); rg.save(); rg.translate(R() * 512, R() * 128); rg.fillStyle = gr; rg.fillRect(-r, -r, r * 2, r * 2); rg.restore(); }
  grain(rg, 512, 128, R, 3000, true);
  shared = { 40: sideHeight(ISO.L40), 20: sideHeight(ISO.L20), door: normalFromHeight(dc, 3), front: normalFromHeight(fc, 2.5), roofMap: ctex(rc, true), roofNor: normalFromHeight(rh, 2) };
  return shared;
}

function base(g: CanvasRenderingContext2D, W: number, H: number, color: string, R: () => number) {
  g.fillStyle = color; g.fillRect(0, 0, W, H);
  const fade = g.createLinearGradient(0, 0, 0, H); fade.addColorStop(0, 'rgba(255,245,235,0.14)'); fade.addColorStop(0.5, 'rgba(255,255,255,0.02)'); fade.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = fade; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 16; i++) { const x = R() * W, y = R() * H, r = 20 + R() * 90; const gr = g.createRadialGradient(x, y, 0, x, y, r); const a = 0.03 + R() * 0.06; gr.addColorStop(0, R() < 0.5 ? `rgba(255,240,230,${a})` : `rgba(20,10,5,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
}
function grime(g: CanvasRenderingContext2D, W: number, H: number, R: () => number, edge: number) {
  for (let i = 0; i < 50; i++) {
    const x = R() * W, len = H * (0.1 + R() * 0.6), w = 1 + R() * 4, a = 0.05 + R() * 0.12;
    const gr = g.createLinearGradient(0, edge, 0, edge + len); gr.addColorStop(0, `rgba(40,25,20,${a})`); gr.addColorStop(1, 'rgba(40,25,20,0)');
    g.fillStyle = gr; g.fillRect(x, edge, w, len);
  }
  const mud = g.createLinearGradient(0, H, 0, H * 0.7); mud.addColorStop(0, 'rgba(70,52,40,0.35)'); mud.addColorStop(1, 'rgba(70,52,40,0)');
  g.fillStyle = mud; g.fillRect(0, H * 0.7, W, H * 0.3);
  for (let i = 0; i < 120; i++) {
    const near = R() < 0.6;
    const x = near ? (R() < 0.5 ? R() * W * 0.04 : W - R() * W * 0.04) : R() * W;
    const y = near ? R() * H : (R() < 0.5 ? R() * H * 0.12 : H - R() * H * 0.15);
    const r = 0.6 + R() * 3;
    g.fillStyle = `rgba(${105 + R() * 40},${52 + R() * 20},28,${0.3 + R() * 0.5})`;
    g.beginPath(); g.ellipse(x, y, r * (1 + R() * 2), r, R() * 3, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 50; i++) { g.fillStyle = `rgba(215,210,205,${0.2 + R() * 0.4})`; g.fillRect(R() * W, R() * H, 1 + R() * 3, 1 + R() * 2); }
  grain(g, W, H, R, 4000, true);
}

/** 箱の面の順（+x 扉, -x 前, 上, 下, +z 側, -z 側）の材質 */
export function isoMaterials(line: Line, len: 20 | 40, seed: number): THREE.Material[] {
  const S = getShared();
  const R = rng(seed);
  const L = len === 40 ? ISO.L40 : ISO.L20;
  const code = line.name.replace(/[^A-Z]/g, '').slice(0, 3).padEnd(3, 'X') + 'U';
  const serial = `${code} ${String(100000 + Math.floor(R() * 899999))} ${Math.floor(R() * 10)}`;
  const [sc, sg] = canvas(1024, 256);
  base(sg, 1024, 256, line.color, R);
  sg.fillStyle = 'rgba(0,0,0,0.16)'; sg.fillRect(0, 240, 1024, 16);
  const k = (ISO.H * 1024) / (256 * L); // 引き伸ばされる分、字の横幅を補正する
  sg.save(); sg.scale(k, 1);
  const cx = 512 / k;
  sg.fillStyle = line.ink; sg.textAlign = 'center'; sg.textBaseline = 'middle';
  sg.font = `700 ${len === 40 ? 54 : 40}px "Barlow Semi Condensed", sans-serif`;
  if (line.mark !== 'none') drawMark(sg, line.mark, cx - (len === 40 ? 260 : 150), 128, len === 40 ? 70 : 52, line.ink);
  sg.fillText(line.name, cx + (line.mark !== 'none' ? 40 : 0), 132, (1024 / k) * (len === 40 ? 0.5 : 0.62));
  sg.font = '700 20px "Barlow Semi Condensed", sans-serif'; sg.textAlign = 'right';
  sg.fillText(serial, 1024 / k - 30, 40);
  sg.fillText(len === 40 ? '45G1' : '22G1', 1024 / k - 30, 64);
  sg.restore();
  grime(sg, 1024, 256, R, 16);
  const [dc, dg] = canvas(256, 272);
  base(dg, 256, 272, line.color, R);
  dg.fillStyle = 'rgba(0,0,0,0.3)'; dg.fillRect(126, 18, 4, 236);
  [52, 98, 158, 204].forEach((x) => { dg.fillStyle = 'rgba(0,0,0,0.25)'; dg.fillRect(x - 4, 22, 8, 228); dg.fillStyle = 'rgba(255,255,255,0.18)'; dg.fillRect(x - 3, 22, 2, 228); dg.fillStyle = '#b9b5ae'; dg.fillRect(x - 3, 150, 22, 6); });
  dg.fillStyle = '#cfcfc8'; dg.fillRect(140, 200, 40, 22);
  dg.fillStyle = line.ink; dg.font = '700 16px "Barlow Semi Condensed", sans-serif'; dg.textAlign = 'left'; dg.textBaseline = 'top';
  dg.fillText(serial, 136, 30); dg.fillText(line.name, 136, 50, 110);
  dg.font = '600 11px "Barlow Semi Condensed", sans-serif';
  ['MAX GROSS 30,480 KG', 'TARE 3,750 KG', 'NET 26,730 KG'].forEach((t, i) => dg.fillText(t, 136, 82 + i * 14));
  grime(dg, 256, 272, R, 18);
  const [fc, fg] = canvas(256, 272);
  base(fg, 256, 272, line.color, R);
  for (let y = 18; y < 254; y += 22) { fg.fillStyle = 'rgba(0,0,0,0.08)'; fg.fillRect(18, y + 11, 220, 11); }
  grime(fg, 256, 272, R, 18);
  const mk = (map: THREE.Texture, normal: THREE.Texture) => { const m = new THREE.MeshStandardMaterial({ map, normalMap: normal, roughness: 0.62, metalness: 0.25 }); m.normalScale.set(1.1, 1.1); return m; };
  const side = mk(ctex(sc, true), S[len]);
  const roof = new THREE.MeshStandardMaterial({ map: S.roofMap, normalMap: S.roofNor, color: new THREE.Color(line.color).lerp(new THREE.Color('#888'), 0.3), roughness: 0.75, metalness: 0.2 });
  return [mk(ctex(dc, true), S.door), mk(ctex(fc, true), S.front), roof, new THREE.MeshStandardMaterial({ color: 0x252322, roughness: 0.9 }), side, side];
}

/** 一つのコンテナ（向き：長い方が x） */
export function container(line: Line, len: 20 | 40, seed: number): THREE.Mesh {
  const L = len === 40 ? ISO.L40 : ISO.L20;
  const m = new THREE.Mesh(new THREE.BoxGeometry(L, ISO.H, ISO.W), isoMaterials(line, len, seed));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---- 鉄道の 12ft コンテナ（潮見貨物。えんじ色、側面の扉、縦書きの番号） ----
export const C12 = { L: 3.715, W: 2.45, H: 2.5 };
let railShared: { side: THREE.Texture; end: THREE.Texture } | null = null;
export function railMaterials(num: string, seed: number): THREE.Material[] {
  const S = getShared();
  if (!railShared) {
    const [hc, hg] = canvas(512, 344);
    for (let x = 0; x < 512; x++) { const p = (x % 12) / 12; const v = p < 0.5 ? 190 : 80; hg.fillStyle = `rgb(${v},${v},${v})`; hg.fillRect(x, 0, 1, 344); }
    hg.fillStyle = '#a0a0a0'; hg.fillRect(0, 0, 512, 16); hg.fillRect(0, 328, 512, 16);
    hg.fillStyle = '#f0f0f0'; [300, 360, 420, 480].forEach((x) => hg.fillRect(x - 4, 20, 8, 304));
    railShared = { side: normalFromHeight(hc, 3), end: S.front };
  }
  const R = rng(seed);
  const [c, g] = canvas(512, 344);
  base(g, 512, 344, R() < 0.5 ? '#8a2747' : '#86244a', R);
  g.fillStyle = '#ece8e4'; g.fillRect(0, 20, 512, 8);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(268, 16, 3, 312); g.fillRect(390, 16, 3, 312);
  [300, 360, 420, 480].forEach((x) => { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 4, 20, 8, 304); g.fillStyle = '#d7b33a'; g.fillRect(x - 7, 22, 14, 12); g.fillRect(x - 7, 306, 14, 12); });
  g.fillStyle = '#f2f0ec'; g.fillRect(14, 40, 70, 40);
  g.fillStyle = '#222'; g.font = '700 16px "Zen Kaku Gothic New", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('鉄道', 49, 52); g.fillText('コンテナ', 49, 70);
  g.fillStyle = '#f6f2ee'; g.font = '900 34px "Zen Kaku Gothic New", sans-serif'; g.textAlign = 'left'; g.fillText('潮見貨物', 18, 120);
  g.font = '700 30px "Barlow Semi Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
  let y = 40; for (const ch of num) { g.fillText(ch, 240, y); y += ch === '-' ? 18 : 27; }
  grime(g, 512, 344, R, 16);
  const mk = (map: THREE.Texture, nor: THREE.Texture) => new THREE.MeshStandardMaterial({ map, normalMap: nor, roughness: 0.6, metalness: 0.25 });
  const side = mk(ctex(c, true), railShared.side);
  const end = new THREE.MeshStandardMaterial({ color: 0x86244a, normalMap: railShared.end, roughness: 0.6, metalness: 0.25 });
  const roof = new THREE.MeshStandardMaterial({ map: S.roofMap, normalMap: S.roofNor, color: 0x9a5468, roughness: 0.75 });
  return [end, end, roof, new THREE.MeshStandardMaterial({ color: 0x252322 }), side, side];
}
export function railBox(num: string, seed: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(C12.L, C12.H, C12.W), railMaterials(num, seed));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
