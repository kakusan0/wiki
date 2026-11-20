import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/game';
import { mkMove, DROP } from '../src/engine/position';
import { RULESETS, B, UM, P } from '../src/engine/rules';
import { frameAt, motionOf, timeline } from '../src/ui/video-timeline';

const sq = (file: number, rank: number) => (rank - 1) * 9 + (9 - file);

describe('動画の時間割', () => {
  it('コマ数＝題名＋手数×1 手＋結果', () => {
    const t = timeline(10, 'normal', 30);
    expect(t.total).toBe(45 + 10 * 30 + 75);
    expect(timeline(10, 'fast', 30).perMove).toBe(15);
    expect(timeline(10, 'slow', 30).perMove).toBe(48);
  });
  it('各コマが何手目のどの途中かを返す', () => {
    const t = timeline(3, 'normal', 30);
    expect(frameAt(t, 0)).toEqual({ phase: 'intro', ply: 0, k: 0 });
    expect(frameAt(t, t.intro)).toMatchObject({ phase: 'move', ply: 0 });
    expect(frameAt(t, t.intro).k).toBeGreaterThan(0);
    expect(frameAt(t, t.intro + t.anim - 1).k).toBe(1); // 動き終わり
    expect(frameAt(t, t.intro + t.perMove)).toMatchObject({ phase: 'move', ply: 1 });
    expect(frameAt(t, t.intro + 3 * t.perMove)).toEqual({ phase: 'outro', ply: 3, k: 1 });
    expect(frameAt(t, t.total - 1).phase).toBe('outro');
  });
});

describe('駒の動き', () => {
  it('動かす・取る・成る・打つ', () => {
    const g = new Game();
    for (const m of [mkMove(sq(7, 7), sq(7, 6)), mkMove(sq(3, 3), sq(3, 4))]) g.play(m);
    const cap = mkMove(sq(8, 8), sq(2, 2), true); // 角で角を取って成る
    const mo = motionOf(g.pos, cap);
    expect(mo).toMatchObject({ side: 0, from: { sq: sq(8, 8) }, to: sq(2, 2), type: B, after: UM, captured: B });
    g.play(cap);
    g.play(mkMove(sq(3, 1), sq(2, 2))); // 同銀
    const drop = mkMove(DROP, sq(5, 5), false, B);
    expect(motionOf(g.pos, drop)).toMatchObject({ side: 0, from: { hand: B }, to: sq(5, 5), type: B, after: B, captured: 0 });
  });
  it('小さい盤でも同じ', () => {
    const g = new Game(RULESETS.mini34);
    const m = g.legalMoves().find((x) => (x & 127) === DROP && x >> 15 === P)!;
    expect(motionOf(g.pos, m)).toMatchObject({ from: { hand: P }, type: P });
  });
});
