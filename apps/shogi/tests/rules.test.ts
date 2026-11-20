import { describe, expect, it } from 'vitest';
import { Game, declarePoints } from '../src/engine/game';
import { moveName } from '../src/engine/notation';
import { DROP, Position, isDrop, mDrop, mTo, mkMove, mPromo } from '../src/engine/position';
import { G, N, P, RULESETS } from '../src/engine/rules';

// 筋（1〜9）と段（1〜9）からマスの番号（本将棋）
const sq = (file: number, rank: number) => (rank - 1) * 9 + (9 - file);
const drops = (p: Position, t: number) => p.legalMoves().filter((m) => isDrop(m) && mDrop(m) === t).map(mTo);

describe('反則の判定', () => {
  it('二歩：歩のある筋には歩を打てない', () => {
    const p = Position.fromSfen('4k4/9/9/9/9/9/4P4/9/4K4 b P 1');
    const d = drops(p, P);
    expect(d.some((s) => s % 9 === 4)).toBe(false); // 5 筋
    expect(d.includes(sq(4, 5))).toBe(true);
  });
  it('行き所のない駒：歩・香は 1 段目、桂は 1・2 段目に打てない', () => {
    const p = Position.fromSfen('4k4/9/9/9/9/9/9/9/4K4 b PN 1');
    expect(drops(p, P).some((s) => s < 9)).toBe(false);
    expect(drops(p, N).some((s) => s < 18)).toBe(false);
    expect(drops(p, N).includes(sq(5, 3))).toBe(true);
  });
  it('成らなければならない：2 段目の歩が 1 段目へ進むときは成るだけ', () => {
    const p = Position.fromSfen('k8/4P4/9/9/9/9/9/9/4K4 b - 1');
    const ms = p.legalMoves().filter((m) => mTo(m) === sq(5, 1));
    expect(ms).toHaveLength(1);
    expect(mPromo(ms[0])).toBe(true);
  });
  it('打ち歩詰め：歩を打って詰ますのは反則。金なら詰ませてよい', () => {
    const s = '8k/9/5B1G1/9/9/9/9/9/4K4 b GP 1';
    const p = Position.fromSfen(s);
    expect(drops(p, P).includes(sq(1, 2))).toBe(false);
    expect(drops(p, G).includes(sq(1, 2))).toBe(true);
    const g = new Game(RULESETS.standard, s);
    g.play(mkMove(DROP, sq(1, 2), false, G));
    expect(g.result).toEqual({ kind: 'checkmate', winner: 0 });
  });
  it('王手放置はできない', () => {
    const p = Position.fromSfen('4k4/9/9/9/9/9/9/4r4/4K4 b - 1'); // 5八の飛車で王手
    for (const m of p.legalMoves()) {
      const u = p.make(m);
      expect(p.inCheck(0)).toBe(false);
      p.unmake(m, u);
    }
  });
  it('指して戻すと元の局面（SFEN と印）に戻る', () => {
    const p = Position.fromSfen(RULESETS.standard.start);
    const before = p.toSfen();
    const key = p.key;
    for (const m of p.legalMoves()) {
      const u = p.make(m);
      p.unmake(m, u);
      expect(p.toSfen()).toBe(before);
      expect(p.key).toBe(key);
    }
  });
});

describe('千日手', () => {
  const k = (file: number, rank: number) => sq(file, rank);
  it('同じ局面が 4 回で引き分け', () => {
    const g = new Game(RULESETS.standard, '4k4/9/9/9/9/9/9/9/4K4 b - 1');
    const cycle = [mkMove(k(5, 9), k(4, 9)), mkMove(k(5, 1), k(4, 1)), mkMove(k(4, 9), k(5, 9)), mkMove(k(4, 1), k(5, 1))];
    for (let i = 0; i < 3; i++) for (const m of cycle) g.play(m);
    expect(g.result).toEqual({ kind: 'repetition' });
  });
  it('連続王手の千日手は、王手をかけ続けた側の負け', () => {
    const g = new Game(RULESETS.standard, '8k/9/9/9/7R1/9/9/9/4K4 b - 1');
    const cycle = [mkMove(k(2, 5), k(1, 5)), mkMove(k(1, 1), k(2, 1)), mkMove(k(1, 5), k(2, 5)), mkMove(k(2, 1), k(1, 1))];
    for (let i = 0; i < 3; i++) for (const m of cycle) g.play(m);
    expect(g.result).toEqual({ kind: 'perpetual', winner: 1 });
  });
});

describe('棋譜の表記', () => {
  it('▲7六歩 △3四歩 ▲2二角成 △同　銀', () => {
    const g = new Game();
    g.play(mkMove(sq(7, 7), sq(7, 6)));
    g.play(mkMove(sq(3, 3), sq(3, 4)));
    g.play(mkMove(sq(8, 8), sq(2, 2), true));
    g.play(mkMove(sq(3, 1), sq(2, 2)));
    expect(g.record.map((r) => r.name)).toEqual(['▲7六歩', '△3四歩', '▲2二角成', '△同　銀']);
    expect(g.kif()).toContain('２二角成(88)');
  });
  it('持ち駒を打つと「打」、成れるのに成らないと「不成」', () => {
    const p = Position.fromSfen('4k4/9/9/9/9/9/9/9/4K4 b B 1');
    expect(moveName(p, mkMove(DROP, sq(5, 5), false, 6))).toBe('▲5五角打');
    const q = Position.fromSfen('4k4/9/9/4S4/9/9/9/9/4K4 b - 1');
    expect(moveName(q, mkMove(sq(5, 4), sq(5, 3), false))).toBe('▲5三銀不成');
  });
});

describe('入玉の点数', () => {
  it('飛・角は 5 点、ほかは 1 点（敵陣の駒と持ち駒）', () => {
    const p = Position.fromSfen('4K4/9/2G6/9/9/9/9/9/4k4 b RB2P 1');
    expect(declarePoints(p, 0)).toBe(5 + 5 + 2 + 1);
  });
});

describe('待った', () => {
  it('最後の手を戻せる', () => {
    const g = new Game();
    g.play(mkMove(sq(7, 7), sq(7, 6)));
    g.play(mkMove(sq(3, 3), sq(3, 4)));
    g.undo(2);
    expect(g.pos.toSfen()).toBe(RULESETS.standard.start);
    expect(g.record).toHaveLength(0);
  });
});
