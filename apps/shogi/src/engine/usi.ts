// USI 形式の指し手（例「7g7f」「P*5e」「8h2b+」）と、この将棋の手の行き来
import { DROP, isDrop, mDrop, mFrom, mPromo, mTo, mkMove, type Move, type Position } from './position';

const DROP_CH: Record<string, number> = { P: 1, L: 2, N: 3, S: 4, G: 5, B: 6, R: 7 };
const CH_DROP = Object.fromEntries(Object.entries(DROP_CH).map(([k, v]) => [v, k]));

// マス（筋は右から 1、段は上から a）
function sqOf(p: Position, s: string): number | null {
  const file = Number(s[0]);
  const rank = s.charCodeAt(1) - 97;
  if (!(file >= 1 && file <= p.w) || !(rank >= 0 && rank < p.h)) return null;
  return rank * p.w + (p.w - file);
}
const sqName = (p: Position, sq: number) => `${p.w - (sq % p.w)}${String.fromCharCode(97 + Math.floor(sq / p.w))}`;

// 局面 p で指せる手なら Move、読めないか指せないなら null
export function fromUsi(p: Position, usi: string): Move | null {
  const m = usi.trim().match(/^(?:([PLNSGBR])\*(\d[a-z])|(\d[a-z])(\d[a-z])(\+)?)$/);
  if (!m) return null;
  let mv: Move;
  if (m[1]) {
    const to = sqOf(p, m[2]);
    if (to == null) return null;
    mv = mkMove(DROP, to, false, DROP_CH[m[1]]);
  } else {
    const from = sqOf(p, m[3]), to = sqOf(p, m[4]);
    if (from == null || to == null) return null;
    mv = mkMove(from, to, !!m[5]);
  }
  return p.isLegal(mv) ? mv : null;
}

export function toUsi(p: Position, m: Move): string {
  if (isDrop(m)) return `${CH_DROP[mDrop(m)]}*${sqName(p, mTo(m))}`;
  return `${sqName(p, mFrom(m))}${sqName(p, mTo(m))}${mPromo(m) ? '+' : ''}`;
}
