// 札の絵（独自の図案を Canvas で描く）。月ごとの植物・動物・短冊・光を、簡単な形の組み合わせで描く
import { CARDS, type Card } from '../game/cards';

export const W = 200;
export const H = 320;
export const COLS = 10;
export const ATLAS = 2048;
export const BACK = 48; // 裏の絵の位置

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

// 決まった乱数（同じ札はいつも同じ絵）
function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

function circle(c: Ctx, x: number, y: number, r: number, fill: string) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = fill; c.fill(); }
function flower(c: Ctx, x: number, y: number, r: number, petals: number, fill: string, center: string, rot = 0) {
  for (let i = 0; i < petals; i++) {
    const a = rot + (i / petals) * TAU;
    circle(c, x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5, fill);
  }
  circle(c, x, y, r * 0.28, center);
}
function branch(c: Ctx, pts: [number, number][], width: number, color = '#3b2a1e') {
  c.strokeStyle = color; c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
  c.stroke();
}
function leaf(c: Ctx, x: number, y: number, len: number, ang: number, fill: string) {
  c.save(); c.translate(x, y); c.rotate(ang);
  c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(len * 0.5, -len * 0.3, len, 0); c.quadraticCurveTo(len * 0.5, len * 0.3, 0, 0);
  c.fillStyle = fill; c.fill(); c.restore();
}
function star(c: Ctx, x: number, y: number, r: number, n: number, fill: string, rot = 0) {
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * TAU - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath(); c.fillStyle = fill; c.fill();
}
function bird(c: Ctx, x: number, y: number, s: number, body: string, dir = 1) {
  c.save(); c.translate(x, y); c.scale(s * dir, s);
  c.fillStyle = body;
  c.beginPath(); c.ellipse(0, 0, 22, 12, -0.2, 0, TAU); c.fill(); // 胴
  circle(c, 20, -10, 8, body); // 頭
  c.beginPath(); c.moveTo(27, -10); c.lineTo(36, -7); c.lineTo(27, -6); c.fillStyle = '#d99a2b'; c.fill(); // くちばし
  c.beginPath(); c.moveTo(-6, -4); c.quadraticCurveTo(-18, -34, 8, -26); c.quadraticCurveTo(4, -12, -6, -4); c.fillStyle = body; c.fill(); // 羽
  c.beginPath(); c.moveTo(-20, 2); c.lineTo(-36, 10); c.lineTo(-20, 8); c.fill(); // 尾
  circle(c, 22, -12, 1.8, '#111');
  c.restore();
}

// 月ごとの背景（植物）
function plant(c: Ctx, card: Card, r: () => number) {
  const m = card.month;
  switch (m) {
    case 0: { // 松
      branch(c, [[30, 320], [70, 230], [60, 160], [110, 110]], 14);
      for (const [x, y, s] of [[60, 120, 1], [130, 90, 1.2], [100, 170, 0.9], [150, 150, 0.8], [40, 200, 0.8]]) {
        c.fillStyle = '#1e5b3a';
        c.beginPath(); c.ellipse(x, y, 42 * s, 20 * s, 0, Math.PI, 0); c.fill();
        c.strokeStyle = '#2f7d4f'; c.lineWidth = 2;
        for (let i = -4; i <= 4; i++) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + i * 9 * s, y - 18 * s); c.stroke(); }
      }
      break;
    }
    case 1: { // 梅
      branch(c, [[10, 300], [80, 220], [120, 140], [180, 90]], 10);
      branch(c, [[80, 220], [150, 230]], 6);
      for (let i = 0; i < 9; i++) flower(c, 40 + r() * 140, 80 + r() * 170, 12 + r() * 5, 5, '#d1263b', '#f6d24a', r());
      break;
    }
    case 2: { // 桜
      for (let i = 0; i < 26; i++) flower(c, 20 + r() * 160, 40 + r() * 150, 11 + r() * 5, 5, i % 3 ? '#f4b6c8' : '#f08aa8', '#fff3f6', r());
      break;
    }
    case 3: { // 藤
      branch(c, [[0, 40], [200, 30]], 8, '#4a3a2a');
      for (let k = 0; k < 4; k++) {
        const x = 30 + k * 45;
        for (let i = 0; i < 9; i++) circle(c, x + Math.sin(i) * 5, 50 + i * 15, 9 - i * 0.6, i % 2 ? '#8b5fbf' : '#6b3fa0');
      }
      break;
    }
    case 4: { // 菖蒲
      for (let i = 0; i < 7; i++) leaf(c, 20 + i * 25, 320, 220, -Math.PI / 2 + (r() - 0.5) * 0.3, '#2f7d4f');
      for (const [x, y] of [[60, 110], [140, 90], [100, 160]]) {
        for (let k = 0; k < 3; k++) leaf(c, x, y, 34, -Math.PI / 2 + (k - 1) * 0.9, '#4b3fb8');
        circle(c, x, y, 6, '#f2d14b');
      }
      break;
    }
    case 5: { // 牡丹
      for (let i = 0; i < 6; i++) leaf(c, 100, 250, 70, -Math.PI / 2 + (i - 2.5) * 0.5, '#2f6b3f');
      for (let k = 0; k < 3; k++) for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + k;
        circle(c, 100 + Math.cos(a) * (40 - k * 12), 150 + Math.sin(a) * (34 - k * 10), 22 - k * 5, k % 2 ? '#e2435c' : '#b81d38');
      }
      break;
    }
    case 6: { // 萩
      for (let k = 0; k < 5; k++) {
        const x0 = 20 + k * 40;
        c.strokeStyle = '#5a3a2a'; c.lineWidth = 3;
        c.beginPath(); c.moveTo(x0, 320); c.quadraticCurveTo(x0 + 40, 160, x0 + 10, 40); c.stroke();
        for (let i = 0; i < 10; i++) circle(c, x0 + 20 + Math.sin(i) * 14, 60 + i * 24, 5, i % 2 ? '#c2337a' : '#e05a9b');
      }
      break;
    }
    case 7: { // 芒
      c.fillStyle = '#161616';
      c.beginPath(); c.ellipse(100, 330, 140, 130, 0, Math.PI, 0); c.fill();
      c.strokeStyle = '#d9d2bc'; c.lineWidth = 2;
      for (let i = 0; i < 30; i++) { const x = r() * 200; c.beginPath(); c.moveTo(x, 330); c.quadraticCurveTo(x + 10, 260, x + 20 + r() * 20, 200 + r() * 40); c.stroke(); }
      break;
    }
    case 8: { // 菊
      for (let i = 0; i < 5; i++) leaf(c, 100, 300, 60, -Math.PI / 2 + (i - 2) * 0.6, '#2f6b3f');
      for (const [x, y, s] of [[70, 120, 1], [140, 170, 0.8], [90, 220, 0.7]]) {
        for (let i = 0; i < 16; i++) leaf(c, x, y, 34 * s, (i / 16) * TAU, i % 2 ? '#f2c230' : '#e8a91a');
        circle(c, x, y, 8 * s, '#c97a12');
      }
      break;
    }
    case 9: { // 紅葉
      for (let i = 0; i < 12; i++) star(c, 30 + r() * 140, 40 + r() * 200, 16 + r() * 8, 5, i % 2 ? '#c8241c' : '#e8501f', r());
      break;
    }
    case 10: { // 柳
      c.strokeStyle = '#3f7d3a'; c.lineWidth = 3;
      for (let i = 0; i < 9; i++) { const x = 15 + i * 22; c.beginPath(); c.moveTo(x, 0); c.bezierCurveTo(x + 20, 80, x - 10, 160, x + 5, 240); c.stroke(); }
      c.strokeStyle = 'rgba(40,40,60,.35)'; c.lineWidth = 1.5;
      for (let i = 0; i < 26; i++) { const x = r() * 200, y = r() * 300; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 8, y + 26); c.stroke(); }
      break;
    }
    case 11: { // 桐
      for (let i = 0; i < 3; i++) leaf(c, 100, 260, 90, -Math.PI / 2 + (i - 1) * 0.8, '#2f6b3f');
      for (let k = 0; k < 3; k++) for (let i = 0; i < 6; i++) circle(c, 60 + k * 40, 70 + i * 16 + (k % 2) * 10, 8, i % 2 ? '#8e62c4' : '#6d43a8');
      break;
    }
  }
}

// 札ごとの主役（光・タネ・短冊）
function feature(c: Ctx, card: Card) {
  const name = card.name;
  if (card.kind === 'tan') {
    const color = card.tag === 'aotan' ? '#25408f' : '#c42a2a';
    c.save(); c.translate(100, 140); c.rotate(-0.12);
    c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(-20, -86, 44, 176);
    c.fillStyle = color; c.fillRect(-22, -90, 44, 176);
    if (card.tag) { c.strokeStyle = '#e8c35a'; c.lineWidth = 3; c.strokeRect(-16, -82, 32, 160); c.beginPath(); c.moveTo(0, -70); c.lineTo(0, 66); c.stroke(); }
    c.restore();
    return;
  }
  if (name === '柳に雷') { // カスの雷
    c.fillStyle = '#1b1b1b'; c.fillRect(0, 0, 200, 70);
    c.strokeStyle = '#e04a2a'; c.lineWidth = 7; c.beginPath(); c.moveTo(60, 0); c.lineTo(110, 50); c.lineTo(85, 60); c.lineTo(140, 120); c.stroke();
    return;
  }
  switch (name) {
    case '松に鶴': circle(c, 140, 70, 40, '#d6322d'); bird(c, 90, 230, 2.0, '#fbfbf7'); circle(c, 128, 208, 6, '#d6322d'); break;
    case '梅に鶯': bird(c, 110, 180, 1.4, '#7a8f2e', -1); break;
    case '桜に幕':
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#f6f0e0' : '#b5202a'; c.fillRect(i * 25, 210, 25, 100); }
      c.fillStyle = '#3a2a1a'; c.fillRect(0, 206, 200, 8);
      circle(c, 100, 260, 26, '#f3d34a'); star(c, 100, 260, 18, 5, '#b5202a');
      break;
    case '藤に不如帰': circle(c, 150, 260, 34, '#e7c25a'); bird(c, 70, 240, 1.3, '#2b2b35', 1); break;
    case '菖蒲に八橋':
      c.fillStyle = '#8a5a2b';
      for (let i = 0; i < 3; i++) { c.save(); c.translate(30 + i * 60, 240 + (i % 2) * 20); c.rotate(i % 2 ? 0.3 : -0.3); c.fillRect(-35, -8, 70, 16); c.restore(); }
      break;
    case '牡丹に蝶':
      for (const [x, y] of [[60, 80], [150, 60]]) {
        for (const d of [-1, 1]) { c.beginPath(); c.ellipse(x + d * 14, y, 16, 22, d * 0.5, 0, TAU); c.fillStyle = '#2a2a7a'; c.fill(); c.beginPath(); c.ellipse(x + d * 12, y + 18, 9, 12, d * 0.5, 0, TAU); c.fillStyle = '#e4b12a'; c.fill(); }
        c.fillStyle = '#111'; c.fillRect(x - 2, y - 18, 4, 40);
      }
      break;
    case '萩に猪':
      c.fillStyle = '#5a3b22';
      c.beginPath(); c.ellipse(100, 250, 70, 38, 0, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(160, 236); c.lineTo(196, 256); c.lineTo(160, 270); c.fill();
      for (const x of [55, 80, 120, 145]) c.fillRect(x, 275, 10, 30);
      circle(c, 165, 245, 3, '#fff');
      break;
    case '芒に月':
      c.fillStyle = '#c8392b'; c.fillRect(0, 0, 200, 200);
      circle(c, 100, 100, 62, '#f6efd6');
      c.fillStyle = '#161616'; c.beginPath(); c.ellipse(100, 330, 140, 130, 0, Math.PI, 0); c.fill();
      break;
    case '芒に雁':
      c.strokeStyle = '#1b1b1b'; c.lineWidth = 5;
      for (const [x, y] of [[50, 60], [100, 40], [150, 70]]) { c.beginPath(); c.moveTo(x - 20, y + 10); c.lineTo(x, y); c.lineTo(x + 20, y + 10); c.stroke(); }
      break;
    case '菊に盃':
      c.fillStyle = '#b8242a'; c.beginPath(); c.ellipse(100, 250, 56, 18, 0, 0, Math.PI); c.fill();
      c.beginPath(); c.ellipse(100, 250, 56, 14, 0, 0, TAU); c.fillStyle = '#d63a3a'; c.fill();
      c.fillStyle = '#e8c35a'; c.fillRect(85, 268, 30, 14);
      c.fillStyle = '#f2d36a'; c.font = 'bold 22px serif'; c.textAlign = 'center'; c.fillText('壽', 100, 258);
      break;
    case '紅葉に鹿':
      c.fillStyle = '#8a5a2b';
      c.beginPath(); c.ellipse(95, 245, 55, 28, 0, 0, TAU); c.fill();
      c.fillRect(130, 190, 14, 50); circle(c, 140, 185, 14, '#8a5a2b');
      for (const x of [55, 75, 115, 130]) c.fillRect(x, 265, 8, 40);
      c.strokeStyle = '#5a3a1a'; c.lineWidth = 4; c.beginPath(); c.moveTo(136, 172); c.lineTo(122, 140); c.moveTo(146, 172); c.lineTo(162, 140); c.stroke();
      for (let i = 0; i < 6; i++) circle(c, 75 + i * 9, 238 + (i % 2) * 8, 3, '#f1e3c4');
      break;
    case '柳に小野道風':
      c.fillStyle = '#2a2a52'; c.beginPath(); c.arc(100, 200, 60, Math.PI, 0); c.fill(); // 傘
      c.strokeStyle = '#2a2a52'; c.lineWidth = 4; c.beginPath(); c.moveTo(100, 200); c.lineTo(100, 290); c.stroke();
      c.fillStyle = '#d8d0b8'; c.fillRect(70, 210, 60, 70); // 人の衣
      circle(c, 150, 295, 12, '#4f8a2f'); // 蛙
      break;
    case '柳に燕':
      c.fillStyle = '#1d2033';
      c.beginPath(); c.moveTo(60, 160); c.lineTo(150, 130); c.lineTo(110, 170); c.lineTo(160, 210); c.lineTo(90, 180); c.closePath(); c.fill();
      circle(c, 148, 133, 7, '#c93030');
      break;
    case '桐に鳳凰': {
      const cols = ['#d8392b', '#e8a91a', '#2f7d4f', '#3a5ab8', '#8e3ab8'];
      for (let i = 0; i < 5; i++) leaf(c, 90, 230, 110, -Math.PI / 2 - 0.6 + i * 0.3, cols[i]);
      bird(c, 100, 230, 1.6, '#d8392b', 1);
      break;
    }
  }
}

export function drawCard(c: Ctx, id: number) {
  const card = CARDS[id];
  const r = rng(id + 1);
  c.save();
  // 紙
  const g = c.createLinearGradient(0, 0, 0, H);
  const sky = ['#f3ead2', '#f3e6d6', '#f6e9ee', '#efe7f1', '#e9eef3', '#f5e9e2', '#f0e7ea', '#f2e6cf', '#f4ecd0', '#f4e4d2', '#e7eee0', '#ece6f2'][card.month];
  g.addColorStop(0, sky); g.addColorStop(1, '#efe5cc');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // 紙の細かいむら
  for (let i = 0; i < 300; i++) { c.fillStyle = `rgba(120,90,40,${r() * 0.05})`; c.fillRect(r() * W, r() * H, 2, 2); }
  plant(c, card, r);
  feature(c, card);
  // 光の札は金色の枠と印
  if (card.kind === 'hikari') {
    c.strokeStyle = '#d9a520'; c.lineWidth = 8; c.strokeRect(8, 8, W - 16, H - 16);
    circle(c, 30, 30, 18, '#d9a520'); c.fillStyle = '#fff'; c.font = 'bold 20px serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('光', 30, 31);
  }
  // 右下：月の印（初めての人のため）
  c.fillStyle = 'rgba(20,16,10,.72)';
  c.beginPath(); c.roundRect(W - 52, H - 34, 46, 28, 8); c.fill();
  c.fillStyle = '#fff'; c.font = 'bold 16px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(`${card.month + 1}月`, W - 29, H - 20);
  // 縁
  c.strokeStyle = '#2a1a10'; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6);
  c.restore();
}

export function drawBack(c: Ctx) {
  const g = c.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, H * 0.7);
  g.addColorStop(0, '#b0232a'); g.addColorStop(1, '#5a0d14');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(232,195,90,.35)'; c.lineWidth = 1.5;
  for (let i = -H; i < W + H; i += 18) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i + H, H); c.stroke(); c.beginPath(); c.moveTo(i, H); c.lineTo(i + H, 0); c.stroke(); }
  c.strokeStyle = '#e8c35a'; c.lineWidth = 4; c.strokeRect(14, 14, W - 28, H - 28);
  circle(c, W / 2, H / 2, 38, '#2a0a0e');
  c.strokeStyle = '#e8c35a'; c.lineWidth = 3; c.beginPath(); c.arc(W / 2, H / 2, 38, 0, TAU); c.stroke();
  c.fillStyle = '#e8c35a'; c.font = 'bold 40px serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('花', W / 2, H / 2 + 2);
  c.strokeStyle = '#1a0508'; c.lineWidth = 6; c.strokeRect(3, 3, W - 6, H - 6);
}

// すべての札と裏を 1 枚の大きな絵にまとめる（WebGL の画像）
export function atlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = ATLAS; cv.height = ATLAS;
  const c = cv.getContext('2d')!;
  for (let i = 0; i <= 48; i++) {
    c.save();
    c.translate((i % COLS) * W, Math.floor(i / COLS) * H);
    c.beginPath(); c.rect(0, 0, W, H); c.clip();
    if (i === BACK) drawBack(c); else drawCard(c, i);
    c.restore();
  }
  return cv;
}

// 画像の中での位置（u0, v0, u1, v1）。WebGL では上下が逆なので v を反転して使う
export function uvRect(i: number): [number, number, number, number] {
  const x = (i % COLS) * W, y = Math.floor(i / COLS) * H;
  return [x / ATLAS, 1 - (y + H) / ATLAS, (x + W) / ATLAS, 1 - y / ATLAS];
}

// 2D 表示・一覧用の画像
const urlCache = new Map<number, string>();
export function cardUrl(i: number): string {
  const hit = urlCache.get(i);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  if (i === BACK) drawBack(c); else drawCard(c, i);
  const url = cv.toDataURL('image/png');
  urlCache.set(i, url);
  return url;
}
