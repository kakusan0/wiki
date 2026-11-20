// 局面：盤・持ち駒・手番。合法手の生成、指す・戻す、王手の判定、SFEN の読み書き
import {
  B, G, K, L, MOVES, N, P, R, RULESETS, S, SFEN_CHAR, canPromoteType, promote, unpromote, type PieceType, type Ruleset,
} from './rules';

// 指し手は 1 つの整数：from(7bit) | to(7bit)<<7 | 成り<<14 | 打つ駒<<15。打つときの from は DROP
export const DROP = 127;
export type Move = number;
export const mkMove = (from: number, to: number, promo = false, drop = 0): Move => from | (to << 7) | (promo ? 1 << 14 : 0) | (drop << 15);
export const mFrom = (m: Move) => m & 127;
export const mTo = (m: Move) => (m >> 7) & 127;
export const mPromo = (m: Move) => ((m >> 14) & 1) === 1;
export const mDrop = (m: Move) => m >> 15; // 打つ駒の種類（打たない手は 0）
export const isDrop = (m: Move) => mFrom(m) === DROP;

// 動きの向きの表（先手から見た dx,dy を 0..24 の番号にする）
const vkey = (dx: number, dy: number) => (dx + 2) * 5 + (dy + 2);
const STEP_SET: Record<number, Set<number>> = {};
const SLIDE_SET: Record<number, Set<number>> = {};
for (const [t, mv] of Object.entries(MOVES)) {
  STEP_SET[+t] = new Set(mv.step.map(([dx, dy]) => vkey(dx, dy)));
  SLIDE_SET[+t] = new Set(mv.slide.map(([dx, dy]) => vkey(dx, dy)));
}
const DIRS8: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]];

// 局面の印（同一局面の判定・置換表）：2 つの 32bit 乱数を足し合わせて 53bit 未満の数にする
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0; };
}
const rand = rng(20261118);
const Z_PIECE = Array.from({ length: 81 * 29 }, () => [rand(), rand() & 0x1fffff]);
const Z_HAND = Array.from({ length: 2 * 8 * 20 }, () => [rand(), rand() & 0x1fffff]);
const Z_SIDE = [rand(), rand() & 0x1fffff];

export interface Undo { captured: number; h1: number; h2: number }

export class Position {
  readonly rules: Ruleset;
  readonly w: number;
  readonly h: number;
  readonly n: number;
  board: Int8Array;
  hands: [Int8Array, Int8Array]; // [先手, 後手]、添字は駒の種類（1..7）
  side: 0 | 1; // 0 = 先手、1 = 後手
  ply: number;
  kings: [number, number];
  h1 = 0;
  h2 = 0;

  constructor(rules: Ruleset) {
    this.rules = rules;
    this.w = rules.w;
    this.h = rules.h;
    this.n = rules.w * rules.h;
    this.board = new Int8Array(this.n);
    this.hands = [new Int8Array(9), new Int8Array(9)];
    this.side = 0;
    this.ply = 1;
    this.kings = [-1, -1];
  }

  get key(): number { return this.h1 * 2097152 + this.h2; }

  clone(): Position {
    const p = new Position(this.rules);
    p.board.set(this.board);
    p.hands[0].set(this.hands[0]);
    p.hands[1].set(this.hands[1]);
    p.side = this.side;
    p.ply = this.ply;
    p.kings = [this.kings[0], this.kings[1]];
    p.h1 = this.h1;
    p.h2 = this.h2;
    return p;
  }

  // ---------- SFEN ----------
  static fromSfen(sfen: string, rules: Ruleset = RULESETS.standard): Position {
    const p = new Position(rules);
    const [boardPart, sidePart = 'b', handPart = '-', plyPart = '1'] = sfen.trim().split(/\s+/);
    const rows = boardPart.split('/');
    if (rows.length !== rules.h) throw new Error(`SFEN の段の数が違います（${rows.length}）`);
    rows.forEach((row, y) => {
      let x = 0;
      for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (/\d/.test(c)) { x += Number(c); continue; }
        let promoted = false;
        let ch = c;
        if (c === '+') { promoted = true; ch = row[++i]; }
        const t0 = charType(ch);
        if (!t0) throw new Error(`SFEN の駒が読めません（${ch}）`);
        const t = promoted ? promote(t0) : t0;
        const sign = ch === ch.toUpperCase() ? 1 : -1;
        if (x >= rules.w) throw new Error('SFEN の筋の数が多すぎます');
        p.board[y * rules.w + x] = sign * t;
        x++;
      }
      if (x !== rules.w) throw new Error(`SFEN の ${y + 1} 段目の筋の数が違います`);
    });
    p.side = sidePart === 'w' ? 1 : 0;
    if (handPart !== '-') {
      let num = '';
      for (const c of handPart) {
        if (/\d/.test(c)) { num += c; continue; }
        const t = charType(c);
        if (!t) throw new Error(`SFEN の持ち駒が読めません（${c}）`);
        p.hands[c === c.toUpperCase() ? 0 : 1][t] += num ? Number(num) : 1;
        num = '';
      }
    }
    p.ply = Number(plyPart) || 1;
    p.rehash();
    return p;
  }

  toSfen(withPly = true): string {
    const rows: string[] = [];
    for (let y = 0; y < this.h; y++) {
      let row = '';
      let empty = 0;
      for (let x = 0; x < this.w; x++) {
        const v = this.board[y * this.w + x];
        if (!v) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        const t = Math.abs(v);
        const base = SFEN_CHAR[unpromote(t)];
        const ch = (t !== unpromote(t) ? '+' : '') + base;
        row += v > 0 ? ch : ch.toLowerCase();
      }
      if (empty) row += empty;
      rows.push(row);
    }
    let hand = '';
    for (const s of [0, 1] as const) {
      for (const t of [R, B, G, S, N, L, P]) {
        const c = this.hands[s][t];
        if (!c) continue;
        const ch = s === 0 ? SFEN_CHAR[t] : SFEN_CHAR[t].toLowerCase();
        hand += (c > 1 ? c : '') + ch;
      }
    }
    return `${rows.join('/')} ${this.side === 0 ? 'b' : 'w'} ${hand || '-'}${withPly ? ` ${this.ply}` : ''}`;
  }

  rehash() {
    this.h1 = 0; this.h2 = 0;
    this.kings = [-1, -1];
    for (let i = 0; i < this.n; i++) {
      const v = this.board[i];
      if (!v) continue;
      this.xorPiece(i, v);
      if (v === K) this.kings[0] = i;
      if (v === -K) this.kings[1] = i;
    }
    for (const s of [0, 1] as const) for (let t = 1; t <= 7; t++) for (let c = 1; c <= this.hands[s][t]; c++) this.xorHand(s, t, c);
    if (this.side === 1) this.xorSide();
  }
  private xorPiece(sq: number, v: number) { const z = Z_PIECE[sq * 29 + v + 14]; this.h1 = (this.h1 ^ z[0]) >>> 0; this.h2 ^= z[1]; }
  private xorHand(s: number, t: number, c: number) { const z = Z_HAND[(s * 8 + t) * 20 + Math.min(c, 19)]; this.h1 = (this.h1 ^ z[0]) >>> 0; this.h2 ^= z[1]; }
  private xorSide() { this.h1 = (this.h1 ^ Z_SIDE[0]) >>> 0; this.h2 ^= Z_SIDE[1]; }

  // ---------- 盤の座標 ----------
  xy(sq: number): [number, number] { return [sq % this.w, Math.floor(sq / this.w)]; }
  sq(x: number, y: number): number { return y * this.w + x; }
  inZone(sq: number, side: 0 | 1): boolean {
    const y = Math.floor(sq / this.w);
    return side === 0 ? y < this.rules.zone : y >= this.h - this.rules.zone;
  }
  // その段に置くと（または動くと）もう動けない駒か（歩・香は最終段、桂は最後の 2 段）
  deadEnd(t: PieceType, sq: number, side: 0 | 1): boolean {
    const y = Math.floor(sq / this.w);
    const r = side === 0 ? y : this.h - 1 - y; // 敵陣の奥から数えた段（0 が最終段）
    if (t === P || t === L) return r === 0;
    if (t === N) return r <= 1;
    return false;
  }

  // ---------- 利き ----------
  // sq に by の駒の利きがあるか
  attacked(sq: number, by: 0 | 1): boolean {
    const [x, y] = this.xy(sq);
    const w = this.w, h = this.h, b = this.board;
    for (const [ux, uy] of DIRS8) {
      for (let k = 1; ; k++) {
        const nx = x + ux * k, ny = y + uy * k;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) break;
        const v = b[ny * w + nx];
        if (!v) continue;
        if ((v > 0 ? 0 : 1) !== by) break;
        const t = v > 0 ? v : -v;
        // 攻める駒から見た向き（後手は上下が逆）
        const vx = -ux, vy = by === 0 ? -uy : uy;
        const key = vkey(vx, vy);
        if (k === 1 && STEP_SET[t].has(key)) return true;
        if (SLIDE_SET[t].has(key)) return true;
        break;
      }
    }
    // 桂
    const ky = by === 0 ? y + 2 : y - 2;
    if (ky >= 0 && ky < h) {
      for (const kx of [x - 1, x + 1]) {
        if (kx < 0 || kx >= w) continue;
        if (b[ky * w + kx] === (by === 0 ? N : -N)) return true;
      }
    }
    return false;
  }

  inCheck(side: 0 | 1 = this.side): boolean {
    const k = this.kings[side];
    return k >= 0 && this.attacked(k, side === 0 ? 1 : 0);
  }

  // ---------- 指し手の生成 ----------
  // 王手放置を考えない手（打ち歩詰めも未判定）
  pseudoMoves(out: Move[] = []): Move[] {
    const s = this.side, sign = s === 0 ? 1 : -1, w = this.w, h = this.h, b = this.board;
    for (let from = 0; from < this.n; from++) {
      const v = b[from];
      if (!v || (v > 0) !== (s === 0)) continue;
      const t = v * sign;
      const fx = from % w, fy = (from - fx) / w;
      const mv = MOVES[t];
      for (const [dx, dy0] of mv.step) {
        const dy = s === 0 ? dy0 : -dy0;
        const tx = fx + dx, ty = fy + dy;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
        const to = ty * w + tx;
        const tv = b[to];
        if (tv && (tv > 0) === (s === 0)) continue;
        this.pushMove(out, t, from, to);
      }
      for (const [dx, dy0] of mv.slide) {
        const dy = s === 0 ? dy0 : -dy0;
        for (let tx = fx + dx, ty = fy + dy; tx >= 0 && ty >= 0 && tx < w && ty < h; tx += dx, ty += dy) {
          const to = ty * w + tx;
          const tv = b[to];
          if (tv && (tv > 0) === (s === 0)) break;
          this.pushMove(out, t, from, to);
          if (tv) break;
        }
      }
    }
    // 打つ手
    const hand = this.hands[s];
    for (let t = 1; t <= 7; t++) {
      if (!hand[t]) continue;
      let pawnFiles: Set<number> | null = null;
      if (t === P) {
        pawnFiles = new Set();
        for (let i = 0; i < this.n; i++) if (b[i] === sign * P) pawnFiles.add(i % w);
      }
      for (let to = 0; to < this.n; to++) {
        if (b[to]) continue;
        if (this.deadEnd(t, to, s)) continue;
        if (pawnFiles?.has(to % w)) continue; // 二歩
        out.push(mkMove(DROP, to, false, t));
      }
    }
    return out;
  }

  private pushMove(out: Move[], t: PieceType, from: number, to: number) {
    const s = this.side;
    if (canPromoteType(t) && (this.inZone(from, s) || this.inZone(to, s))) {
      out.push(mkMove(from, to, true));
      if (!this.deadEnd(t, to, s)) out.push(mkMove(from, to, false));
    } else {
      out.push(mkMove(from, to, false));
    }
  }

  // ---------- 指す・戻す ----------
  make(m: Move): Undo {
    const s = this.side, sign = s === 0 ? 1 : -1;
    const undo: Undo = { captured: 0, h1: this.h1, h2: this.h2 };
    const to = mTo(m);
    if (isDrop(m)) {
      const t = mDrop(m);
      this.xorHand(s, t, this.hands[s][t]);
      this.hands[s][t]--;
      this.board[to] = sign * t;
      this.xorPiece(to, sign * t);
    } else {
      const from = mFrom(m);
      const v = this.board[from];
      const cap = this.board[to];
      if (cap) {
        undo.captured = cap;
        this.xorPiece(to, cap);
        const ct = unpromote(Math.abs(cap));
        this.hands[s][ct]++;
        this.xorHand(s, ct, this.hands[s][ct]);
      }
      this.xorPiece(from, v);
      this.board[from] = 0;
      const nv = mPromo(m) ? sign * promote(v * sign) : v;
      this.board[to] = nv;
      this.xorPiece(to, nv);
      if (v === K) this.kings[0] = to;
      if (v === -K) this.kings[1] = to;
    }
    this.side = s === 0 ? 1 : 0;
    this.xorSide();
    this.ply++;
    return undo;
  }

  unmake(m: Move, undo: Undo) {
    this.side = this.side === 0 ? 1 : 0;
    this.ply--;
    const s = this.side, sign = s === 0 ? 1 : -1;
    const to = mTo(m);
    if (isDrop(m)) {
      this.board[to] = 0;
      this.hands[s][mDrop(m)]++;
    } else {
      const from = mFrom(m);
      const nv = this.board[to];
      const v = mPromo(m) ? sign * unpromote(nv * sign) : nv;
      this.board[from] = v;
      this.board[to] = undo.captured;
      if (undo.captured) this.hands[s][unpromote(Math.abs(undo.captured))]--;
      if (v === K) this.kings[0] = from;
      if (v === -K) this.kings[1] = from;
    }
    this.h1 = undo.h1;
    this.h2 = undo.h2;
  }

  // ---------- 合法手 ----------
  // 自玉に王手がかかったままの手・打ち歩詰めを除く
  legalMoves(): Move[] {
    const out: Move[] = [];
    const me = this.side;
    for (const m of this.pseudoMoves()) {
      const u = this.make(m);
      const ok = !this.inCheck(me);
      let legal = ok;
      if (ok && isDrop(m) && mDrop(m) === P && this.inCheck(this.side) && !this.hasLegalMove()) legal = false; // 打ち歩詰め
      this.unmake(m, u);
      if (legal) out.push(m);
    }
    return out;
  }

  // 合法手が 1 つでもあるか（詰みの判定用。打ち歩詰めの判定はしない＝相手が歩を打って詰めることはない局面で使う）
  hasLegalMove(): boolean {
    const me = this.side;
    for (const m of this.pseudoMoves()) {
      const u = this.make(m);
      const ok = !this.inCheck(me);
      this.unmake(m, u);
      if (ok) return true;
    }
    return false;
  }

  isLegal(m: Move): boolean {
    return this.legalMoves().includes(m);
  }

  pieceAt(sq: number): { side: 0 | 1; type: PieceType } | null {
    const v = this.board[sq];
    return v ? { side: v > 0 ? 0 : 1, type: Math.abs(v) } : null;
  }
}

function charType(c: string): PieceType | 0 {
  switch (c.toUpperCase()) {
    case 'P': return P; case 'L': return L; case 'N': return N; case 'S': return S;
    case 'G': return G; case 'B': return B; case 'R': return R; case 'K': return K;
    default: return 0;
  }
}

// 合法手の数（テスト用）
export function perft(p: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = p.legalMoves();
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const u = p.make(m);
    n += perft(p, depth - 1);
    p.unmake(m, u);
  }
  return n;
}
