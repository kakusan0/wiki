// 詰将棋の解き手：攻め方（先手）は王手だけ、受け方（後手）はすべての合法手。奇数手で詰むかを調べる
import { Position, type Move } from './position';

// 攻め方の王手になる合法手
export function checkingMoves(p: Position): Move[] {
  return p.legalMoves().filter((m) => {
    const u = p.make(m);
    const c = p.inCheck();
    p.unmake(m, u);
    return c;
  });
}

// plies 手以内（奇数）で詰むか。詰むなら手順（最短・受け方は最も長く逃げる手）を返す
export function solve(p0: Position, maxPlies: number): Move[] | null {
  const p = p0.clone();
  const memo = new Map<string, Move[] | null>();
  // 攻め方の番：left 手以内に詰ませる手順
  const attack = (left: number): Move[] | null => {
    if (left <= 0) return null;
    const key = `a${p.key}:${left}`;
    if (memo.has(key)) return memo.get(key)!;
    let best: Move[] | null = null;
    for (const m of checkingMoves(p)) {
      const u = p.make(m);
      const rest = defend(left - 1);
      p.unmake(m, u);
      if (rest && (!best || rest.length + 1 < best.length)) best = [m, ...rest];
      if (best && best.length === 1) break;
    }
    memo.set(key, best);
    return best;
  };
  // 受け方の番：どの応手でも詰むなら、最も長く逃げる手順
  const defend = (left: number): Move[] | null => {
    const moves = p.legalMoves();
    if (!moves.length) return p.inCheck() ? [] : null; // 詰み
    if (left <= 0) return null;
    let longest: Move[] | null = null;
    for (const m of moves) {
      const u = p.make(m);
      const rest = attack(left - 1);
      p.unmake(m, u);
      if (!rest) return null;
      if (!longest || rest.length + 1 > longest.length) longest = [m, ...rest];
    }
    return longest;
  };
  for (let n = 1; n <= maxPlies; n += 2) {
    const r = attack(n);
    if (r) return r;
  }
  return null;
}

// 攻め方の最初の一手で詰む手（plies 手以内）をすべて返す（正解が 1 つかの確認・答え合わせ用）
export function mateFirstMoves(p0: Position, plies: number): Move[] {
  const p = p0.clone();
  const out: Move[] = [];
  for (const m of checkingMoves(p)) {
    const u = p.make(m);
    const q = p.clone();
    p.unmake(m, u);
    if (plies === 1) {
      if (!q.legalMoves().length) out.push(m);
      continue;
    }
    // 受け方のすべての応手に対して、残り手数で詰むか
    const replies = q.legalMoves();
    if (!replies.length) { out.push(m); continue; }
    let all = true;
    for (const r of replies) {
      const uu = q.make(r);
      const ok = solve(q, plies - 2) !== null;
      q.unmake(r, uu);
      if (!ok) { all = false; break; }
    }
    if (all) out.push(m);
  }
  return out;
}
