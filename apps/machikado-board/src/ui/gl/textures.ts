// テクスチャを 2D キャンバスで描く（画像ファイルは使わない）
export type Canvas = HTMLCanvasElement;
const FONT = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif';

function rnd(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function canvas(w: number, h: number): [Canvas, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
// 色を明るく（+）・暗く（−）する
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
export function rgb(hex: string, k = 0): [number, number, number] {
  const m = shade(hex, k).match(/\d+/g)!.map(Number);
  return [m[0] / 255, m[1] / 255, m[2] / 255];
}
function noise(g: CanvasRenderingContext2D, w: number, h: number, n: number, color: string, r: () => number, size = 1.5) {
  for (let i = 0; i < n; i++) { g.fillStyle = color.replace('A', String(r() * 0.12)); g.fillRect(r() * w, r() * h, size, size); }
}
function fitText(g: CanvasRenderingContext2D, text: string, max: number, size: number) {
  do { g.font = `900 ${size}px ${FONT}`; size -= 4; } while (g.measureText(text).width > max && size > 20);
}

export function stone(): Canvas {
  const [c, g] = canvas(512, 512); const r = rnd(7);
  g.fillStyle = '#c9ccd4'; g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = 206 + Math.floor(r() * 34);
    g.fillStyle = `rgb(${v},${v},${v + 6})`;
    g.beginPath(); g.roundRect(x * 64 + 3, y * 64 + 3, 58, 58, 6); g.fill();
  }
  noise(g, 512, 512, 9000, 'rgba(40,45,60,A)', r);
  return c;
}

// 石畳（ずらして並べた小さな石）
export function cobble(): Canvas {
  const [c, g] = canvas(512, 512); const r = rnd(13);
  g.fillStyle = '#8e8a84'; g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 16; y++) for (let x = -1; x < 16; x++) {
    const ox = x * 32 + (y % 2 ? 16 : 0);
    const v = 150 + Math.floor(r() * 60);
    g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
    g.beginPath(); g.ellipse(ox + 16, y * 32 + 16, 13 + r() * 2, 12 + r() * 2, r() * .5, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.ellipse(ox + 12, y * 32 + 11, 6, 4, 0, 0, Math.PI * 2); g.fill();
  }
  noise(g, 512, 512, 6000, 'rgba(20,20,20,A)', r);
  return c;
}

export function grass(): Canvas {
  const [c, g] = canvas(512, 512); const r = rnd(11);
  g.fillStyle = '#7fbf86'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16000; i++) {
    const x = r() * 512, y = r() * 512, l = 3 + r() * 6;
    g.strokeStyle = r() < .5 ? 'rgba(52,120,70,.55)' : 'rgba(170,220,160,.5)';
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - .5) * 3, y - l); g.stroke();
  }
  return c;
}

function window2(g: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, frame: string) {
  g.fillStyle = frame; g.fillRect(x - 6, y - 6, w + 12, hh + 12);
  const grd = g.createLinearGradient(x, y, x + w, y + hh);
  grd.addColorStop(0, '#b7d4f2'); grd.addColorStop(.55, '#5d86c0'); grd.addColorStop(1, '#3a5f96');
  g.fillStyle = grd; g.fillRect(x, y, w, hh);
  g.fillStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.moveTo(x + 6, y + 4); g.lineTo(x + w * .45, y + 4); g.lineTo(x + 6, y + hh * .45); g.fill();
  g.fillStyle = frame; g.fillRect(x + w / 2 - 3, y, 6, hh); g.fillRect(x, y + hh / 2 - 3, w, 6);
  g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x - 8, y + hh + 6, w + 16, 8);
}

// 建物の外観 1 階ぶん（縦にくり返す）。kind 0=れんが 1=しっくい 2=板張り
export function facade(color: string, kind: number): Canvas {
  const [c, g] = canvas(512, 512); const r = rnd(31 + kind);
  if (kind === 0) {
    g.fillStyle = shade(color, -.45); g.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 24) for (let x = (y / 24) % 2 ? -24 : 0; x < 512; x += 48) {
      g.fillStyle = shade(color, -.1 + r() * .25); g.fillRect(x + 2, y + 2, 44, 20);
    }
  } else if (kind === 1) {
    g.fillStyle = shade(color, .7); g.fillRect(0, 0, 512, 512);
    noise(g, 512, 512, 14000, 'rgba(90,80,60,A)', r, 2);
    g.fillStyle = shade(color, -.2); g.fillRect(0, 0, 512, 22); g.fillRect(0, 490, 512, 22);
  } else {
    for (let x = 0; x < 512; x += 32) {
      g.fillStyle = shade(color, .25 + r() * .2); g.fillRect(x, 0, 32, 512);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x, 0, 3, 512);
      for (let i = 0; i < 6; i++) { g.strokeStyle = 'rgba(80,50,20,.15)'; g.beginPath(); const xx = x + 6 + r() * 20; g.moveTo(xx, 0); g.bezierCurveTo(xx + 4, 170, xx - 4, 340, xx, 512); g.stroke(); }
    }
  }
  const frame = kind === 1 ? shade(color, -.35) : '#FFFFFF';
  window2(g, 70, 120, 140, 240, frame);
  window2(g, 302, 120, 140, 240, frame);
  // 窓辺の花
  for (const wx of [70, 302]) for (let i = 0; i < 9; i++) {
    g.fillStyle = ['#E2463B', '#F2C230', '#FFFFFF', '#D9547E'][i % 4];
    g.beginPath(); g.arc(wx + 8 + i * 16, 372, 6, 0, Math.PI * 2); g.fill();
  }
  return c;
}

// 屋根。kind 0=瓦 1=金属のたて筋
export function roof(color: string, kind: number): Canvas {
  const [c, g] = canvas(512, 512);
  if (kind === 0) {
    g.fillStyle = shade(color, -.45); g.fillRect(0, 0, 512, 512);
    for (let row = 0; row < 16; row++) for (let i = -1; i < 17; i++) {
      const x = i * 32 + (row % 2 ? 16 : 0), y = row * 32;
      g.fillStyle = shade(color, row % 2 ? -.22 : -.12);
      g.beginPath(); g.arc(x + 16, y + 8, 16, 0, Math.PI); g.lineTo(x, y); g.lineTo(x + 32, y); g.fill();
      g.strokeStyle = shade(color, -.55); g.lineWidth = 2; g.beginPath(); g.arc(x + 16, y + 8, 16, 0, Math.PI); g.stroke();
    }
  } else {
    const grd = g.createLinearGradient(0, 0, 512, 0);
    for (let i = 0; i <= 16; i++) grd.addColorStop(i / 16, i % 2 ? shade(color, -.15) : shade(color, -.4));
    g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
    g.fillStyle = 'rgba(255,255,255,.08)'; for (let y = 0; y < 512; y += 64) g.fillRect(0, y, 512, 2);
  }
  return c;
}

export function awning(color: string): Canvas {
  const [c, g] = canvas(512, 128);
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#FFFFFF' : color; g.fillRect(i * 32, 0, 32, 128); }
  g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 108, 512, 20);
  return c;
}

export function sign(text: string, color: string, ink = '#1B2340', bg = '#FFFBF2'): Canvas {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = color; g.beginPath(); g.roundRect(0, 0, 1024, 256, 30); g.fill();
  g.fillStyle = bg; g.beginPath(); g.roundRect(18, 18, 988, 220, 20); g.fill();
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, text, 920, 150);
  g.fillText(text, 512, 136);
  return c;
}

export function bank(): Canvas {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#E6E2D6'; g.fillRect(0, 0, 512, 512);
  noise(g, 512, 512, 8000, 'rgba(80,70,50,A)', rnd(3), 2);
  for (const x of [48, 208, 368]) {
    g.fillStyle = '#26314F'; g.fillRect(x, 80, 96, 300);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x + 8, 88, 20, 284);
    g.fillStyle = '#C9A227'; g.fillRect(x, 226, 96, 6);
  }
  g.fillStyle = '#C9C3B2'; g.fillRect(0, 0, 512, 36); g.fillRect(0, 428, 512, 84);
  return c;
}

export function chance(): Canvas {
  const [c, g] = canvas(512, 512);
  const grd = g.createRadialGradient(256, 220, 40, 256, 256, 360);
  grd.addColorStop(0, '#FFE27A'); grd.addColorStop(1, '#E0A21B');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#9A7300'; g.lineWidth = 26; g.strokeRect(13, 13, 486, 486);
  g.fillStyle = '#1B2340'; g.font = `900 340px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 256, 276);
  return c;
}

// スタンプの絵（パン・花・本・鍵）。絵文字は端末で出ないことがあるので図形で描く
export function stamp(kind: number): Canvas {
  const [c, g] = canvas(512, 512);
  const bg = ['#F4C27A', '#F5A3C0', '#9EC5F0', '#F2D16B'][kind];
  g.fillStyle = bg; g.fillRect(0, 0, 512, 512);
  g.strokeStyle = '#FFFFFF'; g.lineWidth = 18; g.beginPath(); g.arc(256, 256, 210, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 10; g.strokeStyle = '#1B2340'; g.fillStyle = '#FFFFFF';
  if (kind === 0) { // パン
    g.fillStyle = '#C8823A'; g.beginPath(); g.ellipse(256, 270, 150, 95, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    g.strokeStyle = '#FFE7C2'; g.lineWidth = 14;
    for (const x of [-70, 0, 70]) { g.beginPath(); g.moveTo(256 + x - 25, 230); g.lineTo(256 + x + 25, 310); g.stroke(); }
  } else if (kind === 1) { // 花
    g.fillStyle = '#E2466F';
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; g.beginPath(); g.ellipse(256 + Math.cos(a) * 80, 256 + Math.sin(a) * 80, 62, 46, a, 0, Math.PI * 2); g.fill(); g.stroke(); }
    g.fillStyle = '#F2C230'; g.beginPath(); g.arc(256, 256, 52, 0, Math.PI * 2); g.fill(); g.stroke();
  } else if (kind === 2) { // 本
    g.fillStyle = '#2F5BD3'; g.beginPath(); g.moveTo(256, 180); g.lineTo(110, 150); g.lineTo(110, 350); g.lineTo(256, 380); g.lineTo(402, 350); g.lineTo(402, 150); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#FFFFFF'; g.beginPath(); g.moveTo(256, 196); g.lineTo(130, 172); g.lineTo(130, 336); g.lineTo(256, 360); g.lineTo(382, 336); g.lineTo(382, 172); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(256, 196); g.lineTo(256, 360); g.stroke();
    g.lineWidth = 6; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(150, 210 + i * 32); g.lineTo(236, 226 + i * 32); g.moveTo(276, 226 + i * 32); g.lineTo(362, 210 + i * 32); g.stroke(); }
  } else { // 鍵
    g.fillStyle = '#C9A227'; g.beginPath(); g.arc(180, 256, 80, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = bg; g.beginPath(); g.arc(180, 256, 32, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#C9A227'; g.fillRect(250, 236, 180, 40); g.strokeRect(250, 236, 180, 40);
    g.fillRect(370, 276, 26, 50); g.strokeRect(370, 276, 26, 50); g.fillRect(320, 276, 26, 36); g.strokeRect(320, 276, 26, 36);
  }
  return c;
}

export function wood(): Canvas {
  const [c, g] = canvas(256, 256); const r = rnd(3);
  g.fillStyle = '#8a6440'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 140; i++) {
    g.strokeStyle = `rgba(60,38,20,${0.15 + r() * 0.3})`;
    g.beginPath(); const x = r() * 256; g.moveTo(x, 0); g.bezierCurveTo(x + 8, 80, x - 8, 160, x + 4, 256); g.stroke();
  }
  return c;
}

export function bark(): Canvas {
  const [c, g] = canvas(256, 256); const r = rnd(17);
  g.fillStyle = '#6b4a2e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(30,18,8,${0.2 + r() * 0.35})`; g.fillRect(r() * 256, r() * 256, 2 + r() * 3, 12 + r() * 30); }
  return c;
}

export function leaves(): Canvas {
  const [c, g] = canvas(512, 512); const r = rnd(5);
  g.fillStyle = '#3f9a5c'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 3600; i++) {
    g.fillStyle = r() < .5 ? 'rgba(30,100,55,.5)' : 'rgba(140,210,140,.45)';
    g.beginPath(); g.ellipse(r() * 512, r() * 512, 4 + r() * 9, 3 + r() * 5, r() * 3, 0, Math.PI * 2); g.fill();
  }
  return c;
}

export function water(): Canvas {
  const [c, g] = canvas(256, 256); const r = rnd(9);
  const grd = g.createLinearGradient(0, 0, 256, 256); grd.addColorStop(0, '#6fb7ea'); grd.addColorStop(1, '#3f86c8');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 220; i++) {
    g.strokeStyle = `rgba(255,255,255,${0.2 + r() * 0.4})`;
    g.beginPath(); const x = r() * 256, y = r() * 256; g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 4, x + 16, y); g.stroke();
  }
  return c;
}

export function blob(): Canvas {
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return c;
}

export function shutter(): Canvas {
  const [c, g] = canvas(256, 256);
  for (let y = 0; y < 256; y += 16) {
    const grd = g.createLinearGradient(0, y, 0, y + 16); grd.addColorStop(0, '#c7ccd6'); grd.addColorStop(1, '#8d94a3');
    g.fillStyle = grd; g.fillRect(0, y, 256, 16);
  }
  g.fillStyle = '#1B2340'; g.font = `900 64px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('本日休業', 128, 128);
  return c;
}

// サイコロの目（4×2 の枠のうち 3×2 に 1〜6 を並べる。WebGL1 のミップマップは 2 のべき乗の大きさが必要）
export function diceAtlas(): Canvas {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#FFFDF7'; g.fillRect(0, 0, 1024, 512);
  const pips: Record<number, [number, number][]> = {
    1: [[.5, .5]], 2: [[.27, .27], [.73, .73]], 3: [[.25, .25], [.5, .5], [.75, .75]],
    4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]], 5: [[.25, .25], [.75, .25], [.5, .5], [.25, .75], [.75, .75]],
    6: [[.27, .22], [.73, .22], [.27, .5], [.73, .5], [.27, .78], [.73, .78]],
  };
  for (let k = 0; k < 6; k++) {
    const ox = (k % 3) * 256, oy = (1 - Math.floor(k / 3)) * 256; // テクスチャは上下が反転する
    g.fillStyle = '#FFFDF7'; g.fillRect(ox, oy, 256, 256);
    g.fillStyle = k === 0 ? '#C8402F' : '#1B2340';
    for (const [x, y] of pips[k + 1]) { g.beginPath(); g.arc(ox + x * 256, oy + y * 256, k === 0 ? 40 : 26, 0, Math.PI * 2); g.fill(); }
  }
  return c;
}

export function lantern(): Canvas {
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#E2463B'; g.fillRect(0, 0, 128, 256);
  g.strokeStyle = 'rgba(80,0,0,.4)'; g.lineWidth = 4; for (let y = 20; y < 256; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  g.fillStyle = '#FFF2D8'; g.font = `900 70px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('祭', 64, 128);
  return c;
}

// 頭上のピンの札（利用料）。512×256（ミップマップのため 2 のべき乗）
export function pinLabel(text: string, color: string, crown = false): Canvas {
  const [c, g] = canvas(512, 256);
  g.fillStyle = crown ? '#F2C230' : '#FFFFFF'; g.beginPath(); g.roundRect(4, 4, 504, 248, 64); g.fill();
  g.fillStyle = color; g.beginPath(); g.roundRect(18, 18, 476, 220, 52); g.fill();
  g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.roundRect(30, 26, 452, 90, 40); g.fill();
  let cx = 256;
  if (crown) {
    // 独占中：左に金色の王冠（図形で描く）
    const x0 = 46, y0 = 78, w = 112, hh = 100;
    g.fillStyle = '#FFD84A'; g.strokeStyle = '#8A5A00'; g.lineWidth = 6; g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(x0, y0 + hh); g.lineTo(x0, y0 + 20); g.lineTo(x0 + w * 0.25, y0 + 52); g.lineTo(x0 + w * 0.5, y0);
    g.lineTo(x0 + w * 0.75, y0 + 52); g.lineTo(x0 + w, y0 + 20); g.lineTo(x0 + w, y0 + hh); g.closePath();
    g.fill(); g.stroke();
    g.fillStyle = '#E2463B';
    for (const [px, py] of [[x0, y0 + 16], [x0 + w * 0.5, y0 - 4], [x0 + w, y0 + 16]]) { g.beginPath(); g.arc(px, py, 10, 0, Math.PI * 2); g.fill(); }
    cx = 318;
  }
  g.fillStyle = '#FFFFFF'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, text, crown ? 300 : 430, 150);
  g.lineWidth = 10; g.strokeStyle = 'rgba(0,0,0,.25)'; g.strokeText(text, cx, 136);
  g.fillText(text, cx, 136);
  return c;
}

// 分かれ道で選べるマスの名前の札（2 行）。1024×256（ミップマップのため 2 のべき乗）
export function choiceLabel(name: string, sub: string, color: string): Canvas {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = '#FFFFFF'; g.beginPath(); g.roundRect(4, 4, 1016, 248, 60); g.fill();
  g.fillStyle = color; g.beginPath(); g.roundRect(16, 16, 992, 224, 50); g.fill();
  g.fillStyle = '#FFFFFF'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, name, 940, 110);
  g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.25)'; g.strokeText(name, 512, 92); g.fillText(name, 512, 92);
  g.font = `700 64px ${FONT}`;
  let size = 64;
  while (g.measureText(sub).width > 940 && size > 28) { size -= 4; g.font = `700 ${size}px ${FONT}`; }
  g.fillStyle = 'rgba(255,255,255,.95)'; g.fillText(sub, 512, 188);
  return c;
}

// 自分のコマの足元の光る輪（真ん中は透明）
export function ring(color: string): Canvas {
  const [c, g] = canvas(256, 256);
  const grd = g.createRadialGradient(128, 128, 60, 128, 128, 124);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.55, color);
  grd.addColorStop(0.75, '#FFFFFF');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.beginPath(); g.arc(128, 128, 124, 0, Math.PI * 2); g.fill();
  return c;
}

// サイコロで止まる候補の札（左に小さなサイコロ、右に目の数か「止まる」）。512×256
export function landLabel(text: string): Canvas {
  const [c, g] = canvas(512, 256);
  g.fillStyle = '#FFFFFF'; g.beginPath(); g.roundRect(4, 4, 504, 248, 56); g.fill();
  g.fillStyle = '#2F5BD3'; g.beginPath(); g.roundRect(16, 16, 480, 224, 46); g.fill();
  // サイコロの絵
  g.fillStyle = '#FFFFFF'; g.beginPath(); g.roundRect(40, 58, 140, 140, 24); g.fill();
  g.fillStyle = '#2F5BD3';
  for (const [x, y] of [[75, 93], [145, 93], [110, 128], [75, 163], [145, 163]]) { g.beginPath(); g.arc(x, y, 13, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#FFFFFF'; g.textAlign = 'center'; g.textBaseline = 'middle';
  fitText(g, text, 280, 130);
  g.fillText(text, 340, 136);
  return c;
}
