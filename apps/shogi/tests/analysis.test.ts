import { describe, expect, it } from 'vitest';
import { MATE } from '../src/engine/ai';
import { analyzeGame, markOf, reviewMoves, scoreText, senteScore, type PlyEval } from '../src/engine/analysis';
import { Game } from '../src/engine/game';
import { Position, mkMove } from '../src/engine/position';
import { RULESETS } from '../src/engine/rules';

const sq = (file: number, rank: number) => (rank - 1) * 9 + (9 - file);

describe('解析', () => {
  it('局面ごとに評価値と最善手を出す（はじめの局面＋手数ぶん）', () => {
    const moves = [mkMove(sq(7, 7), sq(7, 6)), mkMove(sq(3, 3), sq(3, 4))];
    const evals: PlyEval[] = [];
    analyzeGame(RULESETS.standard, RULESETS.standard.start, moves, 100, (k, e) => { evals[k] = e; });
    expect(evals).toHaveLength(3);
    for (const e of evals) { expect(e.best).not.toBeNull(); expect(e.bestName).toMatch(/^[▲△]/); }
  });

  it('ただで取れる飛車を取らなかった手は悪手になる', () => {
    // 先手は 5 八の飛車で 5 五の飛車をただで取れるのに、玉を動かす
    const start = '4k4/9/9/9/4r4/9/9/4R4/4K4 b - 1';
    const p = Position.fromSfen(start);
    const bad = mkMove(sq(5, 9), sq(4, 9));
    expect(p.isLegal(bad)).toBe(true);
    const evals: PlyEval[] = [];
    analyzeGame(RULESETS.standard, start, [bad], 300, (k, e) => { evals[k] = e; });
    const [r] = reviewMoves(evals, [bad], 0);
    expect(['mistake', 'blunder']).toContain(r.mark);
    expect(r.bestName).toBe('▲5五飛');
  });

  it('最善手を指せば損は 0', () => {
    const start = '4k4/9/9/9/4r4/9/9/4R4/4K4 b - 1';
    const good = mkMove(sq(5, 8), sq(5, 5));
    const evals: PlyEval[] = [];
    analyzeGame(RULESETS.standard, start, [good], 300, (k, e) => { evals[k] = e; });
    const [r] = reviewMoves(evals, [good], 0);
    expect(r.loss).toBe(0);
    expect(r.mark).toBe('best');
  });

  it('詰んだ局面は負けの点数で、詰ませた手は損なし', () => {
    const start = '8k/9/5B1G1/9/9/9/9/9/4K4 b G 1'; // 1 手詰め
    const p = Position.fromSfen(start);
    const mate = p.legalMoves().find((m) => { const q = p.clone(); q.make(m); return !q.hasLegalMove(); })!;
    const evals: PlyEval[] = [];
    analyzeGame(RULESETS.standard, start, [mate], 300, (k, e) => { evals[k] = e; });
    expect(evals[1].score).toBe(-MATE);
    expect(reviewMoves(evals, [mate], 0)[0].loss).toBe(0);
    expect(senteScore(evals[1], 1)).toBe(MATE);
    expect(scoreText(MATE)).toBe('+詰み');
  });

  it('損の大きさで印が変わる', () => {
    expect(markOf(0, 1, 2)).toBe('good');
    expect(markOf(200, 1, 2)).toBe('dubious');
    expect(markOf(500, 1, 2)).toBe('mistake');
    expect(markOf(1200, 1, 2)).toBe('blunder');
    expect(markOf(9999, 2, 2)).toBe('best');
  });

  it('小さい盤でも一局を最後まで解析できる', () => {
    const g = new Game(RULESETS.mini55);
    for (let i = 0; i < 6 && !g.result; i++) g.play(g.legalMoves()[0]);
    const evals: PlyEval[] = [];
    analyzeGame(RULESETS.mini55, g.startSfen, g.moves, 50, (k, e) => { evals[k] = e; });
    expect(evals).toHaveLength(g.moves.length + 1);
    expect(reviewMoves(evals, g.moves, 0)).toHaveLength(g.moves.length);
  });
});
