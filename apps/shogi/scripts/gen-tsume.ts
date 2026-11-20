// 詰将棋の問題を作る：駒をランダムに置き、解き手で「ちょうど N 手で詰み・正解の初手が 1 つ」を満たすものだけ残す
// 使い方：npx vite-node scripts/gen-tsume.ts <手数> <問題数> <乱数の種>
import { Position } from '../src/engine/position';
import { B, G, K, L, N, P, R, RULESETS, S, promote } from '../src/engine/rules';
import { mateFirstMoves, solve } from '../src/engine/tsume';

const plies = Number(process.argv[2] ?? 1);
const want = Number(process.argv[3] ?? 5);
let seed = Number(process.argv[4] ?? 1);
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const TOTAL: Record<number, number> = { [P]: 18, [L]: 4, [N]: 4, [S]: 4, [G]: 4, [B]: 2, [R]: 2 };

const found: string[] = [];
const seen = new Set<string>();
let tries = 0;
const t0 = Date.now();
while (found.length < want && Date.now() - t0 < 240_000) {
  tries++;
  const p = Position.fromSfen('9/9/9/9/9/9/9/9/9 b - 1', RULESETS.standard);
  const used: Record<number, number> = { [P]: 0, [L]: 0, [N]: 0, [S]: 0, [G]: 0, [B]: 0, [R]: 0 };
  // 玉は右上の隅のあたり（1〜3 筋・1〜2 段）
  const kx = 8 - Math.floor(rnd() * 3), ky = Math.floor(rnd() * 2);
  p.board[ky * 9 + kx] = -K;
  const empty = (x: number, y: number) => x >= 0 && y >= 0 && x < 9 && y < 9 && !p.board[y * 9 + x];
  const place = (sign: number, types: number[], n: number, spread: number) => {
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < 20; a++) {
        const x = kx + Math.round((rnd() - 0.5) * 2 * spread), y = ky + Math.floor(rnd() * (spread + 2));
        if (!empty(x, y)) continue;
        let t = pick(types);
        if (used[t] >= TOTAL[t]) continue;
        // 行き所のない駒は置かない
        if (sign > 0 && (t === P || t === L) && y === 0) continue;
        if (sign > 0 && t === N && y <= 1) continue;
        if (sign < 0 && (t === P || t === L) && y === 8) continue;
        used[t]++;
        if (rnd() < 0.15 && t !== G && t !== K) t = promote(t);
        p.board[y * 9 + x] = sign * t;
        break;
      }
    }
  };
  place(-1, [G, S, P, L, N], Math.floor(rnd() * 3), 2); // 受け方の駒
  place(1, [G, S, B, R, L, N, P], 1 + Math.floor(rnd() * 3), 3); // 攻め方の盤上の駒
  // 攻め方の持ち駒
  const handN = Math.floor(rnd() * 3);
  for (let i = 0; i < handN; i++) {
    const t = pick([G, S, B, R, N, L, P]);
    if (used[t] >= TOTAL[t]) continue;
    used[t]++;
    p.hands[0][t]++;
  }
  // 受け方は残りの駒を全部持つ（詰将棋の決まり）
  for (const t of [P, L, N, S, G, B, R]) p.hands[1][t] = TOTAL[t] - used[t];
  p.side = 0;
  p.rehash();
  if (p.inCheck(1) || p.inCheck(0)) continue;
  // 二歩がないか
  const files = new Map<string, number>();
  let nifu = false;
  for (let i = 0; i < 81; i++) {
    const v = p.board[i];
    if (Math.abs(v) !== P) continue;
    const k = `${v > 0}:${i % 9}`;
    if (files.has(k)) nifu = true;
    files.set(k, 1);
  }
  if (nifu) continue;
  const sfen = p.toSfen();
  if (seen.has(sfen)) continue;
  seen.add(sfen);
  // ちょうど plies 手（短い手数では詰まない）・初手が 1 つ
  const sol = solve(p, plies);
  if (!sol || sol.length !== plies) continue;
  if (plies > 1 && solve(p, plies - 2)) continue;
  const firsts = mateFirstMoves(p, plies);
  if (firsts.length !== 1) continue;
  found.push(sfen);
  console.error(`見つけた（${found.length}/${want}・${tries} 回目）：${sfen}`);
}
console.log(JSON.stringify(found));
