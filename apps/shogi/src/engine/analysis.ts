// 対局の解析：局面ごとの評価値と最善手、指した手の損（悪手・疑問手）を調べる
import { MATE, search } from './ai';
import { moveName } from './notation';
import { Position, mTo, type Move } from './position';
import type { Ruleset } from './rules';

// 1 局面の結果。score は手番の側から見た点数
export interface PlyEval { score: number; best: Move | null; bestName: string | null; depth: number }

// 指した手の評価
export type Mark = 'best' | 'good' | 'dubious' | 'mistake' | 'blunder';
export const MARK_NAMES: Record<Mark, string> = { best: '最善手', good: '', dubious: '疑問手', mistake: '悪手', blunder: '大悪手' };
export const MARK_SIGNS: Record<Mark, string> = { best: '', good: '', dubious: '?!', mistake: '?', blunder: '??' };

export interface MoveReview {
  ply: number; // 何手目か（1 から）
  side: 0 | 1; // 指した側
  loss: number; // 最善手と比べて損した点数（0 以上）
  mark: Mark;
  bestName: string | null; // 指す前の局面の最善手
}

export const isMateScore = (s: number) => Math.abs(s) >= MATE - 1000;

// 1 局面を調べる。終わった局面（指す手がない）は負けの点数
export function evalPosition(p: Position, timeMs: number, lastTo: number | null = null): PlyEval {
  if (!p.hasLegalMove()) return { score: -MATE, best: null, bestName: null, depth: 0 };
  const r = search(p, { level: 'advanced', timeMs, full: true });
  return { score: r.score, best: r.move, bestName: r.move != null ? moveName(p, r.move, lastTo) : null, depth: r.depth };
}

// 先手から見た評価値（グラフ用）
export function senteScore(e: PlyEval, side: 0 | 1): number { return side === 0 ? e.score : -e.score; }

// 損の大きさで印をつける
export function markOf(loss: number, played: Move, best: Move | null): Mark {
  if (best != null && played === best) return 'best';
  if (loss >= 1000) return 'blunder';
  if (loss >= 400) return 'mistake';
  if (loss >= 150) return 'dubious';
  return 'good';
}

// evals[k] は k 手目を指したあとの局面（evals[0] ははじめの局面）。moves[k-1] が k 手目
export function reviewMoves(evals: PlyEval[], moves: Move[], startSide: 0 | 1): MoveReview[] {
  const out: MoveReview[] = [];
  for (let k = 1; k < evals.length && k <= moves.length; k++) {
    const before = evals[k - 1], after = evals[k];
    const side = ((startSide + k - 1) % 2) as 0 | 1;
    const played = moves[k - 1];
    // 指した側から見て：指す前の最善の点数 − 指したあとの点数
    let loss = played === before.best ? 0 : Math.max(0, before.score + after.score);
    // どちらも詰みの点数なら、手数の差は損に数えない（詰みを逃したときだけ大きく数える）
    if (isMateScore(before.score) && isMateScore(after.score) && Math.sign(before.score) === Math.sign(-after.score)) loss = 0;
    out.push({ ply: k, side, loss, mark: markOf(loss, played, before.best), bestName: before.bestName });
  }
  return out;
}

// 一局ぶんを順に調べる（Web Worker から呼ぶ）。onPly は 1 局面ごとに呼ばれる
export function analyzeGame(rules: Ruleset, startSfen: string, moves: Move[], timeMs: number, onPly: (k: number, e: PlyEval) => boolean | void): void {
  const p = Position.fromSfen(startSfen, rules);
  let lastTo: number | null = null;
  for (let k = 0; k <= moves.length; k++) {
    if (k > 0) { p.make(moves[k - 1]); lastTo = mTo(moves[k - 1]); }
    if (onPly(k, evalPosition(p, timeMs, lastTo)) === false) return;
  }
}

// 評価値の言葉（先手から見た点数）
export function scoreLabel(s: number): string {
  if (isMateScore(s)) return s > 0 ? '先手の勝ち筋（詰みあり）' : '後手の勝ち筋（詰みあり）';
  const a = Math.abs(s);
  const who = s > 0 ? '先手' : '後手';
  if (a < 200) return '互角';
  if (a < 600) return `${who}が少しよい`;
  if (a < 1500) return `${who}がよい`;
  return `${who}が勝ちそう`;
}

export function scoreText(s: number): string {
  if (isMateScore(s)) return s > 0 ? '+詰み' : '−詰み';
  const v = Math.round(s);
  return v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '±0';
}
