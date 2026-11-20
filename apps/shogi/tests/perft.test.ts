import { describe, expect, it } from 'vitest';
import { Position, perft } from '../src/engine/position';
import { RULESETS } from '../src/engine/rules';

describe('合法手の数（perft）', () => {
  it('本将棋の初期局面：1 手 30・2 手 900・3 手 25,470', () => {
    const p = Position.fromSfen(RULESETS.standard.start);
    expect(perft(p, 1)).toBe(30);
    expect(perft(p, 2)).toBe(900);
    expect(perft(p, 3)).toBe(25470);
  });
  it('本将棋の初期局面：4 手 719,731', { timeout: 120_000 }, () => {
    const p = Position.fromSfen(RULESETS.standard.start);
    expect(perft(p, 4)).toBe(719731);
  });
  it('5五将棋の初期局面：1 手 14', () => {
    expect(perft(Position.fromSfen(RULESETS.mini55.start, RULESETS.mini55), 1)).toBe(14);
  });
  it('SFEN を読んで書くと同じになる', () => {
    for (const r of Object.values(RULESETS)) expect(Position.fromSfen(r.start, r).toSfen()).toBe(r.start);
    const s = 'l6nl/5+P1gk/2np1S3/p1p4Pp/3P2Sp1/1PPb2P1P/P5GS1/R8/LN4bKL w RGgsn5p 1';
    expect(Position.fromSfen(s).toSfen()).toBe(s);
  });
});
