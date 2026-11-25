// コンピューター：アルファベータ探索（反復深化・静止探索・置換表・手の並べ替え）
import { Position, isDrop, mDrop, mFrom, mPromo, mTo, mkMove, type Move } from './position';
import { K, VALUE, promote, unpromote } from './rules';

export type Level = 'intro' | 'beginner' | 'intermediate' | 'advanced';
export const LEVEL_NAMES: Record<Level, string> = { intro: '入門', beginner: '初級', intermediate: '中級', advanced: '上級' };

interface LevelConf { maxDepth: number; timeMs: number; quiesce: boolean; noise: number }
const LEVELS: Record<Level, LevelConf> = {
  intro: { maxDepth: 1, timeMs: 300, quiesce: false, noise: 250 },
  beginner: { maxDepth: 2, timeMs: 600, quiesce: true, noise: 60 },
  intermediate: { maxDepth: 3, timeMs: 1500, quiesce: true, noise: 10 },
  advanced: { maxDepth: 8, timeMs: 2500, quiesce: true, noise: 0 },
};

export const MATE = 100000;
const HAND_BONUS = 1.15; // 持ち駒は盤上より少し高く見る

// ---------- 評価（手番の側から見た点数） ----------
export function evaluate(p: Position): number {
  let score = 0;
  const w = p.w;
  const kings = p.kings;
  for (let i = 0; i < p.n; i++) {
    const v = p.board[i];
    if (!v) continue;
    const t = v > 0 ? v : -v;
    const sgn = v > 0 ? 1 : -1;
    let val = VALUE[t];
    // 玉の近くの駒：味方なら守り、敵なら攻め
    const own = kings[v > 0 ? 0 : 1], opp = kings[v > 0 ? 1 : 0];
    if (t !== K) {
      if (own >= 0 && near(i, own, w) <= 1) val += 40;
      if (opp >= 0 && near(i, opp, w) <= 2) val += 30;
    }
    score += sgn * val;
  }
  for (let t = 1; t <= 7; t++) score += (p.hands[0][t] - p.hands[1][t]) * VALUE[t] * HAND_BONUS;
  return p.side === 0 ? score : -score;
}
function near(a: number, b: number, w: number) {
  return Math.max(Math.abs((a % w) - (b % w)), Math.abs(Math.floor(a / w) - Math.floor(b / w)));
}

// ---------- 探索 ----------
interface TTEntry { depth: number; score: number; flag: 0 | 1 | 2; move: Move } // 0=ちょうど 1=下限 2=上限

export interface SearchResult { move: Move | null; score: number; depth: number; nodes: number }

export function search(root: Position, opts: { level?: Level; timeMs?: number; maxDepth?: number; random?: () => number; full?: boolean } = {}): SearchResult {
  const conf = { ...LEVELS[opts.level ?? 'intermediate'] };
  if (opts.timeMs != null) conf.timeMs = opts.timeMs;
  if (opts.maxDepth != null) conf.maxDepth = opts.maxDepth;
  const random = opts.random ?? Math.random;
  const p = root.clone();
  const tt = new Map<number, TTEntry>();
  const deadline = Date.now() + conf.timeMs;
  let nodes = 0;
  let stopped = false;
  const killers: Move[][] = [];

  const rootMoves = p.legalMoves();
  if (!rootMoves.length) return { move: null, score: -MATE, depth: 0, nodes: 0 };
  // 手が 1 つしかなければ考えずに指す（解析のときは点数がほしいので考える）
  if (rootMoves.length === 1 && !opts.full) return { move: rootMoves[0], score: 0, depth: 0, nodes: 0 };

  const order = (moves: Move[], ttMove: Move | null, ply: number) => {
    const k = killers[ply] ?? [];
    const sc = (m: Move) => {
      if (m === ttMove) return 1e9;
      let s = 0;
      if (!isDrop(m)) {
        const cap = p.board[mTo(m)];
        if (cap) s += 1e6 + VALUE[Math.abs(cap)] * 10 - VALUE[Math.abs(p.board[mFrom(m)])];
        if (mPromo(m)) s += 5e5 + VALUE[promote(Math.abs(p.board[mFrom(m)]))];
      }
      if (k.includes(m)) s += 4e5;
      return s;
    };
    return moves.map((m) => [sc(m), m] as const).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  };

  // 合法かどうか（自玉に王手がかかる手・打ち歩詰めを除く）
  const tryMake = (m: Move) => {
    const me = p.side;
    const u = p.make(m);
    if (p.inCheck(me)) { p.unmake(m, u); return null; }
    if (isDrop(m) && mDrop(m) === 1 && p.inCheck() && !p.hasLegalMove()) { p.unmake(m, u); return null; } // 打ち歩詰め
    return u;
  };

  const quiesce = (alpha: number, beta: number, ply: number): number => {
    nodes++;
    const stand = evaluate(p);
    if (!conf.quiesce || ply > 24) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const caps = p.pseudoMoves().filter((m) => !isDrop(m) && p.board[mTo(m)] !== 0);
    for (const m of order(caps, null, ply)) {
      const u = tryMake(m);
      if (!u) continue;
      const v = -quiesce(-beta, -alpha, ply + 1);
      p.unmake(m, u);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  };

  const negamax = (depth: number, alpha: number, beta: number, ply: number): number => {
    if ((++nodes & 1023) === 0 && Date.now() > deadline) stopped = true;
    if (stopped) return 0;
    if (depth <= 0) return quiesce(alpha, beta, ply);
    const key = p.key;
    const e = tt.get(key);
    if (e && e.depth >= depth) {
      if (e.flag === 0) return e.score;
      if (e.flag === 1 && e.score >= beta) return e.score;
      if (e.flag === 2 && e.score <= alpha) return e.score;
    }
    const a0 = alpha;
    let best = -MATE - 1;
    let bestMove: Move = 0;
    let legal = 0;
    for (const m of order(p.pseudoMoves(), e?.move ?? null, ply)) {
      const u = tryMake(m);
      if (!u) continue;
      legal++;
      const v = -negamax(depth - 1, -beta, -alpha, ply + 1);
      p.unmake(m, u);
      if (stopped) return 0;
      if (v > best) { best = v; bestMove = m; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        if (!isDrop(m) && !p.board[mTo(m)]) killers[ply] = [m, ...(killers[ply] ?? [])].slice(0, 2);
        break;
      }
    }
    if (!legal) return -MATE + ply; // 指す手がない＝負け
    tt.set(key, { depth, score: best, flag: best <= a0 ? 2 : best >= beta ? 1 : 0, move: bestMove });
    if (tt.size > 400000) tt.clear();
    return best;
  };

  let bestMove: Move = rootMoves[0];
  let bestScore = 0;
  let reached = 0;
  for (let depth = 1; depth <= conf.maxDepth; depth++) {
    let alpha = -MATE - 1; // 探索の窓は本当の点数で決める
    let iterBest: Move | null = null;
    let iterNoisy = -Infinity;
    let iterScore = 0;
    for (const m of order(rootMoves, bestMove, 0)) {
      const u = p.make(m);
      const v = -negamax(depth - 1, -MATE - 1, -alpha, 1);
      p.unmake(m, u);
      if (stopped) break;
      if (v > alpha) alpha = v;
      // ゆらぎ（弱いレベルほど大きい）は手の選び方だけに使う。詰み・詰まされは揺らさない
      const noisy = Math.abs(v) >= MATE - 1000 ? v * 10 : v + (conf.noise ? (random() - 0.5) * 2 * conf.noise : 0);
      if (iterBest == null || noisy > iterNoisy) { iterNoisy = noisy; iterBest = m; iterScore = v; }
    }
    if (stopped && depth > 1) break;
    if (iterBest != null) {
      bestMove = iterBest;
      bestScore = iterScore;
      reached = depth;
    }
    if (bestScore > MATE - 1000 || Date.now() > deadline) break;
  }
  return { move: bestMove, score: bestScore, depth: reached, nodes };
}

// ---------- 定跡（序盤の数手。独自の短い一覧） ----------
const sqStd = (file: number, rank: number) => (rank - 1) * 9 + (9 - file);
const BOOK: Record<string, Move[]> = {
  // 初手
  'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -': [mkMove(sqStd(7, 7), sqStd(7, 6)), mkMove(sqStd(2, 7), sqStd(2, 6))],
};
export function bookMove(p: Position, random: () => number = Math.random): Move | null {
  const key = p.toSfen(false);
  const list = BOOK[key];
  if (list?.length) return list[Math.floor(random() * list.length)];
  // 2 手目（後手）：3 四歩か 8 四歩
  if (p.rules.id === 'standard' && p.ply === 2 && p.side === 1) {
    const cands = [mkMove(sqStd(3, 3), sqStd(3, 4)), mkMove(sqStd(8, 3), sqStd(8, 4))].filter((m) => p.isLegal(m));
    if (cands.length) return cands[Math.floor(random() * cands.length)];
  }
  return null;
}

export function think(p: Position, level: Level, random: () => number = Math.random): SearchResult {
  if (level !== 'intro') {
    const b = bookMove(p, random);
    if (b != null) return { move: b, score: 0, depth: 0, nodes: 0 };
  }
  return search(p, { level, random });
}

export { unpromote };
