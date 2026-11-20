// 動画の時間割（純粋な関数）：題名のカード → 1 手ずつ（動く・止まって見せる） → 結果のカード
import { Position, isDrop, mDrop, mFrom, mPromo, mTo, type Move } from '../engine/position';
import { promote } from '../engine/rules';

export type Speed = 'slow' | 'normal' | 'fast';
export const SPEED_SEC: Record<Speed, number> = { slow: 1.6, normal: 1.0, fast: 0.5 };
export const INTRO_SEC = 1.5;
export const OUTRO_SEC = 2.5;

export interface Timeline { fps: number; moves: number; perMove: number; anim: number; intro: number; outro: number; total: number }

export function timeline(moves: number, speed: Speed, fps = 30): Timeline {
  const perMove = Math.round(SPEED_SEC[speed] * fps);
  const anim = Math.max(4, Math.round(Math.min(0.45, SPEED_SEC[speed] * 0.55) * fps));
  const intro = Math.round(INTRO_SEC * fps), outro = Math.round(OUTRO_SEC * fps);
  return { fps, moves, perMove, anim, intro, outro, total: intro + moves * perMove + outro };
}

// このコマで何を見せるか。ply は「指し終えた手数」、k は動いている手の進み（0〜1、止まっている間は 1）
export type FrameInfo =
  | { phase: 'intro'; ply: 0; k: 0 }
  | { phase: 'move'; ply: number; k: number } // ply 手目（0 から）を指している途中
  | { phase: 'outro'; ply: number; k: 1 };

export function frameAt(t: Timeline, i: number): FrameInfo {
  if (i < t.intro) return { phase: 'intro', ply: 0, k: 0 };
  const j = i - t.intro;
  if (j < t.moves * t.perMove) {
    const ply = Math.floor(j / t.perMove), f = j % t.perMove;
    return { phase: 'move', ply, k: Math.min(1, (f + 1) / t.anim) };
  }
  return { phase: 'outro', ply: t.moves, k: 1 };
}

// 1 手の動き：どこから（盤のマス・持ち駒）どこへ、駒の種類（成る前・後）、取った駒
export interface Motion {
  side: 0 | 1;
  from: { sq: number } | { hand: number };
  to: number;
  type: number; // 動かす前の種類
  after: number; // 動かした後の種類
  captured: number; // 取った駒の種類（0 は取らない）
}

export function motionOf(pos: Position, m: Move): Motion {
  const side = pos.side as 0 | 1;
  if (isDrop(m)) return { side, from: { hand: mDrop(m) }, to: mTo(m), type: mDrop(m), after: mDrop(m), captured: 0 };
  const v = pos.board[mFrom(m)];
  const t = Math.abs(v);
  const cap = pos.board[mTo(m)];
  return { side, from: { sq: mFrom(m) }, to: mTo(m), type: t, after: mPromo(m) ? promote(t) : t, captured: cap ? Math.abs(cap) : 0 };
}

// なめらかな動き（ゆっくり始まり、すっと止まる）
export const easeMove = (k: number) => 1 - Math.pow(1 - k, 3);
