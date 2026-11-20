// 液晶（スロット・お知らせ）と星図ルーレットの絵
import { POCKETS, POCKET_INFO, SYMBOLS, STOCK_MAX, type Game } from '../game/game';

export interface Message { text: string; sub?: string; color?: string; until: number; big?: boolean }
const font = (px: number, weight = 900) => `${weight} ${px}px 'Dela Gothic One', 'Zen Kaku Gothic New', sans-serif`;

// 液晶（1024×512）
export function drawLcd(c: CanvasRenderingContext2D, g: Game, now: number, msg: Message | null, jpShown: number) {
  const W = 1024, H = 512;
  c.fillStyle = '#0E1440'; c.fillRect(0, 0, W, H);
  // 上の帯：ジャックポットと保留
  c.fillStyle = '#121A45'; c.fillRect(0, 0, W, 92);
  c.fillStyle = '#F5C542'; c.font = font(30, 700); c.textBaseline = 'middle'; c.textAlign = 'left';
  c.fillText('星海ジャックポット', 30, 46);
  c.fillStyle = '#FFE38A'; c.font = font(54); c.textAlign = 'right';
  c.fillText(Math.round(jpShown).toLocaleString('ja-JP'), 760, 50);
  for (let i = 0; i < STOCK_MAX; i++) {
    c.beginPath(); c.arc(820 + i * 48, 46, 15, 0, Math.PI * 2);
    c.fillStyle = i < g.stock ? '#5CE1E6' : '#2B356F'; c.fill();
  }
  c.textAlign = 'center';
  const s = g.slot;
  if (s) {
    // スロット：左から順に止まる
    const stops = [s.dur * 0.42, s.dur * 0.62, s.dur];
    const allButLast = s.t >= stops[1];
    const reach = s.reach && allButLast && s.t < stops[2];
    if (reach) {
      c.fillStyle = `rgba(232,81,58,${0.25 + 0.2 * Math.sin(now * 14)})`; c.fillRect(0, 92, W, H - 92);
      c.fillStyle = '#FFFFFF'; c.font = font(56); c.fillText('リーチ！', W / 2, 140);
    }
    for (let i = 0; i < 3; i++) {
      const x = 212 + i * 300, y = 320;
      c.fillStyle = '#F4F1FF'; roundRect(c, x - 120, y - 130, 240, 260, 28); c.fill();
      c.save(); c.beginPath(); roundRect(c, x - 120, y - 130, 240, 260, 28); c.clip();
      if (s.t >= stops[i]) {
        c.fillStyle = s.reels[i] === '船' ? '#E8513A' : '#0E1440'; c.font = font(150); c.fillText(s.reels[i], x, y + 8);
      } else {
        const speed = reach && i === 2 ? 6 : 16;
        const f = s.t * speed + i * 1.7;
        const k = Math.floor(f), off = (f - k) * 200;
        for (let j = -1; j <= 1; j++) {
          c.fillStyle = '#4A4F7A'; c.font = font(150);
          c.fillText(SYMBOLS[(k + j + 50) % SYMBOLS.length], x, y + 8 + j * 200 - off + 100);
        }
      }
      c.restore();
    }
  } else if (msg && now < msg.until) {
    c.fillStyle = msg.color ?? '#FFE38A'; c.font = font(msg.big ? 110 : 84);
    const pulse = 1 + 0.03 * Math.sin(now * 10);
    c.save(); c.translate(W / 2, 270); c.scale(pulse, pulse); c.fillText(msg.text, 0, 0); c.restore();
    if (msg.sub) { c.fillStyle = '#F4F1FF'; c.font = font(40, 700); c.fillText(msg.sub, W / 2, 400); }
  } else {
    // ふだん：船と波
    drawShip(c, 250, 300, 1.25, now);
    c.fillStyle = '#FFE38A'; c.font = font(70); c.textAlign = 'left'; c.fillText('航海チャンス', 450, 260);
    c.fillStyle = '#C9C3E8'; c.font = font(32, 700); c.fillText('チャッカーを狙って、星の目をそろえよう', 450, 340);
    c.textAlign = 'center';
  }
  // 帆ゲージ
  for (let i = 0; i < 7; i++) {
    c.fillStyle = i < g.gauge ? '#E8513A' : '#2B356F';
    const x = 390 + i * 42, y = 470;
    c.beginPath(); c.moveTo(x, y - 26); c.lineTo(x + 24, y + 8); c.lineTo(x, y + 8); c.closePath(); c.fill();
  }
}

function drawShip(c: CanvasRenderingContext2D, x: number, y: number, s: number, now: number) {
  c.save(); c.translate(x, y + Math.sin(now * 1.5) * 6); c.scale(s, s);
  c.strokeStyle = '#F4F1FF'; c.lineWidth = 5; c.beginPath(); c.moveTo(0, -110); c.lineTo(0, 10); c.stroke();
  c.fillStyle = '#5CE1E6'; c.beginPath(); c.moveTo(5, -104); c.lineTo(70, -10); c.lineTo(5, -10); c.closePath(); c.fill();
  c.fillStyle = '#A8F3F5'; c.beginPath(); c.moveTo(-5, -90); c.lineTo(-60, -10); c.lineTo(-5, -10); c.closePath(); c.fill();
  c.fillStyle = '#E8513A'; c.beginPath(); c.moveTo(0, -110); c.lineTo(36, -98); c.lineTo(0, -86); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(-90, 6); c.lineTo(90, 6); c.lineTo(68, 40); c.lineTo(-68, 40); c.closePath(); c.fill();
  c.restore();
  c.strokeStyle = '#5CE1E6'; c.lineWidth = 4; c.beginPath();
  for (let i = 0; i <= 380; i += 4) c.lineTo(x - 190 + i, y + 62 + Math.sin(i / 22 + now * 2) * 6);
  c.stroke();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

// 星図ルーレットの盤（512×512）。ポケット i は上から時計回りに 30° ずつ
export function drawRoulette(c: CanvasRenderingContext2D) {
  const S = 512, cx = 256, cy = 256;
  c.clearRect(0, 0, S, S);
  c.fillStyle = '#121A45'; c.beginPath(); c.arc(cx, cy, 250, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#F5C542'; c.lineWidth = 12; c.stroke();
  POCKETS.forEach((p, i) => {
    const a0 = -Math.PI / 2 + (i * Math.PI) / 6, a1 = a0 + Math.PI / 6;
    c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, 236, a0 + 0.01, a1 - 0.01); c.closePath();
    c.fillStyle = POCKET_INFO[p].color; c.fill();
    const am = (a0 + a1) / 2;
    c.save(); c.translate(cx + Math.cos(am) * 190, cy + Math.sin(am) * 190); c.rotate(am + Math.PI / 2);
    c.fillStyle = p === 'treasure' || p === 'wave' ? '#0E1440' : '#FFFFFF'; c.font = font(40); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(POCKET_INFO[p].name, 0, 0); c.restore();
  });
  c.fillStyle = '#0E1440'; c.beginPath(); c.arc(cx, cy, 130, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#FFE38A'; c.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 36 : 84; c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  c.closePath(); c.fill();
}
