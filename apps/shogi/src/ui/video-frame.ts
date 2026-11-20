// 動画の 1 コマを Canvas に描く（盤・駒・駒台・名前・指し手・題名と結果のカード）
import type { Game } from '../engine/game';
import { Position } from '../engine/position';
import { HAND_TYPES, KANJI, isPromoted } from '../engine/rules';
import { easeMove, frameAt, motionOf, type Motion, type Timeline } from './video-timeline';

export type Shape = 'portrait' | 'landscape' | 'square';
export const SIZES: Record<Shape, [number, number]> = { portrait: [1080, 1920], landscape: [1920, 1080], square: [1080, 1080] };

export interface VideoSpec {
  game: Game;
  plies: number; // 何手目まで
  names: [string, string];
  title: string; // 例：本将棋・平手
  result: string | null; // 終わっていれば結果の文
  flipped: boolean; // 後手を手前に
  shape: Shape;
  scale: number; // 1 か 0.5
}

const C = {
  bg: '#F6F1E7', ink: '#1F1A12', sub: '#5E5546', board: '#E6C38A', board2: '#D9AF6B', grid: '#5A3B16',
  koma: '#F2DDB0', komaEdge: '#6E4A1C', red: '#C02A1A', stand: '#C99B5B', last: 'rgba(255,214,90,.55)', check: 'rgba(220,40,30,.45)', accent: '#2F5BD3',
};
const SERIF = "'Yuji Syuku', 'Hiragino Mincho ProN', 'Yu Mincho', serif";
const SANS = "'Zen Maru Gothic', 'Hiragino Sans', 'Yu Gothic', system-ui, sans-serif";
const KAN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

// 手数ごとの局面（使い回す）
export function positions(game: Game, plies: number): Position[] {
  const out: Position[] = [];
  const p = Position.fromSfen(game.startSfen, game.rules);
  out.push(p.clone());
  for (let i = 0; i < plies; i++) { p.make(game.record[i].move); out.push(p.clone()); }
  return out;
}

interface Layout {
  W: number; H: number;
  bx: number; by: number; cell: number; cw: number; ch: number; // 盤（マスの大きさ）
  stand: [{ x: number; y: number; w: number; h: number }, { x: number; y: number; w: number; h: number }]; // 先手・後手の駒台
  name: [{ x: number; y: number; align: CanvasTextAlign }, { x: number; y: number; align: CanvasTextAlign }];
  moveText: { x: number; y: number; size: number };
  list: { x: number; y: number; w: number; h: number } | null;
}

function layout(spec: VideoSpec): Layout {
  const [W0, H0] = SIZES[spec.shape];
  const W = W0 * spec.scale, H = H0 * spec.scale;
  const p = spec.game.pos;
  const cols = p.w, rows = p.h;
  const s = spec.scale;
  let boardW: number, bx: number, by: number;
  if (spec.shape === 'portrait') { boardW = Math.min(W - 80 * s, (H * 0.5)); bx = (W - boardW) / 2; by = H * 0.27; }
  else if (spec.shape === 'landscape') {
    // 盤の上下に駒台が入る高さにおさめる
    const standH = 96 * s, gap = 24 * s, margin = 50 * s;
    const maxBh = H - 2 * (standH + gap + margin);
    boardW = Math.min(W * 0.48, (maxBh / (rows * 1.08)) * cols);
    bx = 140 * s; by = (H - boardW * (rows / cols) * 1.08) / 2;
  }
  else { boardW = W * 0.62; bx = (W - boardW) / 2; by = H * 0.19; }
  const cw = boardW / cols, ch = cw * 1.08, cell = cw;
  const bh = ch * rows;
  // 先手は手前（下）、後手は奥（上）。反転なら入れ替え
  const near = spec.flipped ? 1 : 0;
  const st = (y: number) => ({ x: bx, y, w: boardW, h: Math.max(70 * s, ch * 0.9) });
  const standNear = st(by + bh + 24 * s), standFar = st(by - 24 * s - Math.max(70 * s, ch * 0.9));
  const stands: Layout['stand'] = near === 0 ? [standNear, standFar] : [standFar, standNear];
  let name: Layout['name'];
  let moveText: Layout['moveText'];
  let list: Layout['list'] = null;
  if (spec.shape === 'landscape') {
    const lx = bx + boardW + 90 * s;
    name = near === 0 ? [{ x: lx, y: H - 90 * s, align: 'left' }, { x: lx, y: 110 * s, align: 'left' }] : [{ x: lx, y: 110 * s, align: 'left' }, { x: lx, y: H - 90 * s, align: 'left' }];
    moveText = { x: lx, y: H / 2 - 230 * s, size: 64 * s };
    list = { x: lx, y: H / 2 - 170 * s, w: W - lx - 80 * s, h: 440 * s };
  } else {
    const topY = spec.shape === 'portrait' ? H * 0.12 : 70 * s;
    const botY = spec.shape === 'portrait' ? H * 0.86 : H - 40 * s;
    name = near === 0 ? [{ x: W / 2, y: botY, align: 'center' }, { x: W / 2, y: topY, align: 'center' }] : [{ x: W / 2, y: topY, align: 'center' }, { x: W / 2, y: botY, align: 'center' }];
    moveText = spec.shape === 'portrait' ? { x: W / 2, y: H * 0.93, size: 72 * s } : { x: W / 2, y: H - 110 * s, size: 56 * s };
    if (spec.shape === 'square') name = near === 0 ? [{ x: 60 * s, y: H - 40 * s, align: 'left' }, { x: 60 * s, y: 70 * s, align: 'left' }] : [{ x: 60 * s, y: 70 * s, align: 'left' }, { x: 60 * s, y: H - 40 * s, align: 'left' }];
  }
  return { W, H, bx, by, cell, cw, ch, stand: stands, name, moveText, list };
}

// マスの画面上の中心
function sqCenter(L: Layout, pos: Position, sq: number, flipped: boolean): [number, number] {
  let x = sq % pos.w, y = Math.floor(sq / pos.w);
  if (flipped) { x = pos.w - 1 - x; y = pos.h - 1 - y; }
  return [L.bx + (x + 0.5) * L.cw, L.by + (y + 0.5) * L.ch];
}

// 駒台の中で、その種類の駒を置く場所
function handSlot(L: Layout, side: 0 | 1, type: number): [number, number] {
  const st = L.stand[side];
  const i = HAND_TYPES.indexOf(type);
  const n = HAND_TYPES.length;
  return [st.x + st.w * ((i + 0.5) / n), st.y + st.h / 2];
}

function piece(c: CanvasRenderingContext2D, x: number, y: number, size: number, type: number, upsideDown: boolean, alpha = 1) {
  c.save();
  c.globalAlpha = alpha;
  c.translate(x, y);
  if (upsideDown) c.rotate(Math.PI);
  const s = size / 100;
  c.scale(s, s);
  c.beginPath(); c.moveTo(0, -44); c.lineTo(30, -32); c.lineTo(40, 44); c.lineTo(-40, 44); c.lineTo(-30, -32); c.closePath();
  c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 6; c.shadowOffsetY = 2;
  c.fillStyle = C.koma; c.fill();
  c.shadowColor = 'transparent';
  c.lineWidth = 2.5; c.strokeStyle = C.komaEdge; c.stroke();
  c.fillStyle = isPromoted(type) ? C.red : '#1B1408';
  c.font = `44px ${SERIF}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(KANJI[type], 0, 10);
  c.restore();
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}

function drawBoard(c: CanvasRenderingContext2D, L: Layout, pos: Position, spec: VideoSpec, hide: Set<number>, highlight: { from: number | null; to: number | null; check: number | null }) {
  const s = spec.scale;
  const bw = L.cw * pos.w, bh = L.ch * pos.h;
  const g = c.createLinearGradient(L.bx, L.by, L.bx + bw, L.by + bh);
  g.addColorStop(0, C.board); g.addColorStop(1, C.board2);
  c.fillStyle = g; roundRect(c, L.bx - 14 * s, L.by - 14 * s, bw + 28 * s, bh + 28 * s, 14 * s); c.fill();
  // 強調するマス
  const mark = (sq: number | null, color: string) => {
    if (sq == null) return;
    const [x, y] = sqCenter(L, pos, sq, spec.flipped);
    c.fillStyle = color; c.fillRect(x - L.cw / 2, y - L.ch / 2, L.cw, L.ch);
  };
  mark(highlight.from, 'rgba(255,214,90,.28)'); mark(highlight.to, C.last); mark(highlight.check, C.check);
  // 線
  c.strokeStyle = C.grid; c.lineWidth = 2 * s;
  for (let i = 0; i <= pos.w; i++) { c.beginPath(); c.moveTo(L.bx + i * L.cw, L.by); c.lineTo(L.bx + i * L.cw, L.by + bh); c.stroke(); }
  for (let i = 0; i <= pos.h; i++) { c.beginPath(); c.moveTo(L.bx, L.by + i * L.ch); c.lineTo(L.bx + bw, L.by + i * L.ch); c.stroke(); }
  // 筋と段
  c.fillStyle = C.sub; c.font = `${22 * s}px ${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  for (let x = 0; x < pos.w; x++) c.fillText(String(spec.flipped ? x + 1 : pos.w - x), L.bx + (x + 0.5) * L.cw, L.by - 28 * s);
  for (let y = 0; y < pos.h; y++) c.fillText(KAN[spec.flipped ? pos.h - 1 - y : y], L.bx + bw + 30 * s, L.by + (y + 0.5) * L.ch);
  // 駒
  for (let sq = 0; sq < pos.n; sq++) {
    const v = pos.board[sq];
    if (!v || hide.has(sq)) continue;
    const [x, y] = sqCenter(L, pos, sq, spec.flipped);
    piece(c, x, y, L.cw * 0.88, Math.abs(v), (v < 0) !== spec.flipped);
  }
}

function drawStands(c: CanvasRenderingContext2D, L: Layout, pos: Position, spec: VideoSpec, minus: { side: number; type: number } | null) {
  const s = spec.scale;
  for (const side of [0, 1] as const) {
    const st = L.stand[side];
    c.fillStyle = C.stand; roundRect(c, st.x - 14 * s, st.y, st.w + 28 * s, st.h, 12 * s); c.fill();
    for (const t of HAND_TYPES) {
      let n = pos.hands[side][t];
      if (minus && minus.side === side && minus.type === t) n--;
      if (n <= 0) continue;
      const [x, y] = handSlot(L, side, t);
      piece(c, x, y, Math.min(st.h * 0.85, L.cw * 0.8), t, (side === 1) !== spec.flipped);
      if (n > 1) { c.fillStyle = C.ink; c.font = `700 ${26 * s}px ${SANS}`; c.textAlign = 'left'; c.fillText(String(n), x + L.cw * 0.3, y + st.h * 0.3); }
    }
  }
}

function drawNames(c: CanvasRenderingContext2D, L: Layout, spec: VideoSpec, turn: 0 | 1 | null) {
  const s = spec.scale;
  for (const side of [0, 1] as const) {
    const n = L.name[side];
    c.textAlign = n.align; c.textBaseline = 'middle';
    c.fillStyle = turn === side ? C.accent : C.ink;
    c.font = `900 ${40 * s}px ${SANS}`;
    c.fillText(`${side === 0 ? '▲' : '△'} ${spec.names[side]}`, n.x, n.y);
  }
}

// 1 コマを描く
export function drawFrame(c: CanvasRenderingContext2D, spec: VideoSpec, t: Timeline, i: number, pos: Position[]) {
  const L = layout(spec);
  const s = spec.scale;
  const info = frameAt(t, i);
  c.fillStyle = C.bg; c.fillRect(0, 0, L.W, L.H);
  const rec = spec.game.record;
  // 盤と駒
  let shownPly = info.phase === 'move' ? info.ply : info.ply;
  let motion: Motion | null = null;
  if (info.phase === 'move' && info.k < 1) motion = motionOf(pos[info.ply], rec[info.ply].move);
  else if (info.phase === 'move') shownPly = info.ply + 1;
  const p = pos[shownPly];
  const hide = new Set<number>();
  let minus: { side: number; type: number } | null = null;
  if (motion) {
    if ('sq' in motion.from) hide.add(motion.from.sq); else minus = { side: motion.side, type: motion.from.hand };
    if (motion.captured && info.k > 0.65) hide.add(motion.to);
  }
  const lastIdx = shownPly - 1;
  const lastMove = lastIdx >= 0 && !motion ? rec[lastIdx].move : null;
  const hl = { from: null as number | null, to: null as number | null, check: null as number | null };
  if (lastMove != null) {
    const mm = motionOf(pos[lastIdx], lastMove);
    hl.to = mm.to; hl.from = 'sq' in mm.from ? mm.from.sq : null;
    if (rec[lastIdx].check) hl.check = p.kings[p.side];
  }
  drawStands(c, L, p, spec, minus);
  drawBoard(c, L, p, spec, hide, hl);
  if (motion) {
    const e = easeMove(info.k);
    const [x0, y0] = 'sq' in motion.from ? sqCenter(L, p, motion.from.sq, spec.flipped) : handSlot(L, motion.side, motion.from.hand);
    const [x1, y1] = sqCenter(L, p, motion.to, spec.flipped);
    const lift = Math.sin(info.k * Math.PI) * L.cw * 0.25;
    const type = info.k > 0.8 ? motion.after : motion.type;
    piece(c, x0 + (x1 - x0) * e, y0 + (y1 - y0) * e - lift, L.cw * 0.88 * (1 + Math.sin(info.k * Math.PI) * 0.12), type, (motion.side === 1) !== spec.flipped);
  }
  const turn = info.phase === 'outro' ? null : (p.side as 0 | 1);
  drawNames(c, L, spec, turn);
  // 指し手の文字
  const cur = info.phase === 'move' ? info.ply : shownPly - 1;
  if (cur >= 0 && info.phase !== 'intro') {
    c.textAlign = L.list ? 'left' : 'center'; c.textBaseline = 'middle';
    c.fillStyle = C.sub; c.font = `700 ${L.moveText.size * 0.45}px ${SANS}`;
    c.fillText(`${cur + 1} 手目`, L.moveText.x, L.moveText.y - L.moveText.size * 0.75);
    c.fillStyle = C.ink; c.font = `${L.moveText.size}px ${SERIF}`;
    c.fillText(rec[cur].name + (rec[cur].check ? '　王手' : ''), L.moveText.x, L.moveText.y);
  }
  // 棋譜の一覧（横長）
  if (L.list) {
    const lines = 9, start = Math.max(0, Math.min(cur - 4, spec.plies - lines));
    c.textAlign = 'left'; c.font = `${30 * s}px ${SANS}`;
    for (let k = 0; k < lines && start + k < spec.plies; k++) {
      const idx = start + k;
      const y = L.list.y + k * 46 * s;
      if (idx === cur) { c.fillStyle = 'rgba(47,91,211,.12)'; c.fillRect(L.list.x - 12 * s, y - 22 * s, L.list.w, 44 * s); }
      c.fillStyle = idx <= cur ? C.ink : '#A89F8E';
      c.fillText(`${String(idx + 1).padStart(3, ' ')}  ${rec[idx].name}`, L.list.x, y);
    }
  }
  // 題名と結果のカード
  if (info.phase === 'intro' || info.phase === 'outro') {
    const local = info.phase === 'intro' ? i / t.intro : (i - (t.total - t.outro)) / t.outro;
    const a = info.phase === 'intro' ? Math.min(1, (1 - local) * 3) : Math.min(1, local * 4);
    c.save(); c.globalAlpha = a;
    c.fillStyle = 'rgba(246,241,231,.94)';
    const cw = L.W * 0.82, chh = 420 * s;
    roundRect(c, (L.W - cw) / 2, (L.H - chh) / 2, cw, chh, 28 * s); c.fill();
    c.strokeStyle = C.grid; c.lineWidth = 3 * s; c.stroke();
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = C.ink;
    if (info.phase === 'intro') {
      c.font = `${84 * s}px ${SERIF}`; c.fillText('まちかど将棋', L.W / 2, L.H / 2 - 110 * s);
      c.font = `700 ${40 * s}px ${SANS}`; c.fillText(`▲${spec.names[0]}　対　△${spec.names[1]}`, L.W / 2, L.H / 2 + 10 * s);
      c.fillStyle = C.sub; c.font = `${32 * s}px ${SANS}`; c.fillText(spec.title, L.W / 2, L.H / 2 + 90 * s);
    } else {
      c.font = `${72 * s}px ${SERIF}`;
      c.fillText(spec.result ?? `${spec.plies} 手まで`, L.W / 2, L.H / 2 - 40 * s, cw - 60 * s);
      c.fillStyle = C.sub; c.font = `${32 * s}px ${SANS}`; c.fillText(`▲${spec.names[0]}　対　△${spec.names[1]}・${spec.plies} 手`, L.W / 2, L.H / 2 + 80 * s, cw - 60 * s);
    }
    c.restore();
  }
}
