import { describe, expect, it } from 'vitest';
import { search, think } from '../src/engine/ai';
import { Game } from '../src/engine/game';
import { Position, mkMove, DROP } from '../src/engine/position';
import { G, RULESETS } from '../src/engine/rules';
import { solve, mateFirstMoves } from '../src/engine/tsume';

const sq = (file: number, rank: number) => (rank - 1) * 9 + (9 - file);

describe('コンピューター', () => {
  it('1 手詰めを見つける（どのレベルでも）', () => {
    const p = Position.fromSfen('8k/9/5B1G1/9/9/9/9/9/4K4 b G 1');
    for (const level of ['beginner', 'intermediate', 'advanced'] as const) {
      const r = search(p, { level, timeMs: 2000 });
      const q = p.clone();
      q.make(r.move!);
      expect(q.legalMoves()).toHaveLength(0); // 指した手で詰んでいる
    }
  });
  it('ただで取れる駒は取る', () => {
    const p = Position.fromSfen('4k4/9/9/9/4r4/9/9/4R4/4K4 b - 1'); // 5五の飛車をただで取れる
    expect(search(p, { level: 'intermediate' }).move).toBe(mkMove(sq(5, 8), sq(5, 5)));
  });
  it('初期局面で合法な手を返す（定跡も含む）', () => {
    const p = Position.fromSfen(RULESETS.standard.start);
    for (const level of ['intro', 'beginner', 'intermediate'] as const) {
      const r = think(p, level);
      expect(r.move).not.toBeNull();
      expect(p.isLegal(r.move!)).toBe(true);
    }
  });
  it('強いほうが弱いほうに勝ち越す（5五将棋で 6 局）', { timeout: 300_000 }, () => {
    let strongWins = 0;
    for (let g = 0; g < 6; g++) {
      const game = new Game(RULESETS.mini55);
      const strongSide = g % 2;
      let seed = g * 7 + 1;
      const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      while (!game.result && game.record.length < 160) {
        const level = game.pos.side === strongSide ? 'intermediate' : 'intro';
        const r = search(game.pos, { level, timeMs: 300, random });
        game.play(r.move!);
      }
      const res = game.result as { winner?: number } | null;
      if (res && 'winner' in res && res.winner === strongSide) strongWins++;
    }
    expect(strongWins).toBeGreaterThanOrEqual(4);
  });
});

describe('詰将棋の解き手', () => {
  it('1 手詰め', () => {
    const p = Position.fromSfen('8k/9/5B1G1/9/9/9/9/9/4K4 b G 1');
    expect(solve(p, 1)).toHaveLength(1);
    // この局面は 2一・2二・1二 のどこに金を打っても詰む
    expect(mateFirstMoves(p, 1).sort()).toEqual([sq(2, 1), sq(2, 2), sq(1, 2)].map((s) => mkMove(DROP, s, false, G)).sort());
  });
  it('詰まない局面は null', () => {
    expect(solve(Position.fromSfen('4k4/9/9/9/9/9/9/9/4K4 b G 1'), 3)).toBeNull();
  });
});
