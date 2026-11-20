// 棋譜の表記（例：▲7六歩、△同　銀、▲5五角打、▲2三歩成）
import { DROP, isDrop, mDrop, mFrom, mPromo, mTo, type Move, type Position } from './position';
import { NAME, canPromoteType } from './rules';

const KAN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const ZEN = ['１', '２', '３', '４', '５', '６', '７', '８', '９'];

// マスの名前（筋は右から 1、段は上から一）
export function squareName(p: Position, sq: number, zenkaku = false): string {
  const x = sq % p.w, y = Math.floor(sq / p.w);
  const file = p.w - x;
  return `${zenkaku ? ZEN[file - 1] : file}${KAN[y]}`;
}

// 指す前の局面 p での手 m の表記。prevTo は直前の手の行き先（「同」に使う）
export function moveName(p: Position, m: Move, prevTo: number | null = null): string {
  const mark = p.side === 0 ? '▲' : '△';
  const to = mTo(m);
  const place = prevTo === to ? '同　' : squareName(p, to);
  if (isDrop(m)) return `${mark}${place}${NAME[mDrop(m)]}打`;
  const t = Math.abs(p.board[mFrom(m)]);
  let suffix = '';
  if (mPromo(m)) suffix = '成';
  else if (canPromoteType(t) && (p.inZone(mFrom(m), p.side) || p.inZone(to, p.side))) suffix = '不成';
  return `${mark}${place}${NAME[t]}${suffix}`;
}

// KIF 形式の 1 手（例「７六歩(77)」「同　銀(68)」「５五角打」）
export function kifMove(p: Position, m: Move, prevTo: number | null): string {
  const to = mTo(m);
  const place = prevTo === to ? '同　' : squareName(p, to, true);
  if (mFrom(m) === DROP) return `${place}${NAME[mDrop(m)]}打`;
  const from = mFrom(m);
  const t = Math.abs(p.board[from]);
  const fx = p.w - (from % p.w), fy = Math.floor(from / p.w) + 1;
  return `${place}${NAME[t]}${mPromo(m) ? '成' : ''}(${fx}${fy})`;
}
