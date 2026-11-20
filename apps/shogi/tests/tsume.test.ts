import { describe, expect, it } from 'vitest';
import { TSUME } from '../src/data/tsume';
import { Position } from '../src/engine/position';
import { mateFirstMoves, solve } from '../src/engine/tsume';

describe('収録した詰将棋', () => {
  it('1・3・5 手詰めがそろっている', () => {
    for (const n of [1, 3, 5]) expect(TSUME.filter((t) => t.plies === n).length).toBeGreaterThanOrEqual(6);
    expect(new Set(TSUME.map((t) => t.id)).size).toBe(TSUME.length);
  });
  for (const t of TSUME) {
    it(`${t.title}：ちょうど ${t.plies} 手で詰み、正解の初手が 1 つ`, { timeout: 60_000 }, () => {
      const p = Position.fromSfen(t.sfen);
      expect(p.inCheck(1)).toBe(false); // はじめから王手になっていない
      const sol = solve(p, t.plies);
      expect(sol?.length).toBe(t.plies);
      if (t.plies > 1) expect(solve(p, t.plies - 2)).toBeNull();
      expect(mateFirstMoves(p, t.plies)).toHaveLength(1);
    });
  }
});
