import { describe, expect, it } from 'vitest';
import { Position, mkMove } from '../src/engine/position';
import { RULESETS } from '../src/engine/rules';
import { act, checkTimeout, deadline, join, newRoom, viewFor } from '../src/worker/logic';

let n = 0;
const tok = () => `t${++n}`;
const sq = (file: number, rank: number) => (rank - 1) * 9 + (9 - file);
const setup = (time = 'm10b30') => {
  const r = newRoom('ABCDEF', 'standard', time, 0);
  join(r, null, 'あ', 0, () => 0.1, tok); // 0.1 < 0.5 → 部屋を作った人が先手
  join(r, null, 'い', 0, () => 0.1, tok);
  return r;
};

describe('オンライン対局の部屋', () => {
  it('2 人そろうと振り駒で始まり、3 人目は入れない', () => {
    const r = setup();
    expect(r.sideOf).toEqual([0, 1]);
    expect(join(r, null, 'う', 0, () => 0.1, tok)).toMatchObject({ ok: false });
    expect(viewFor(r, 0, 0)).toMatchObject({ you: 0, names: ['あ', 'い'], waiting: false });
  });
  it('手番の人の合法手だけ受け付ける', () => {
    const r = setup();
    expect(act(r, 1, { type: 'move', move: mkMove(sq(3, 3), sq(3, 4)) }, 10)).toMatchObject({ ok: false }); // 後手は待つ
    expect(act(r, 0, { type: 'move', move: mkMove(sq(7, 7), sq(7, 3)) }, 10)).toMatchObject({ ok: false }); // 指せない手
    expect(act(r, 0, { type: 'move', move: mkMove(sq(7, 7), sq(7, 6)) }, 10)).toMatchObject({ ok: true });
    expect(act(r, 1, { type: 'move', move: mkMove(sq(3, 3), sq(3, 4)) }, 20)).toMatchObject({ ok: true });
    expect(r.moves).toHaveLength(2);
  });
  it('持ち時間を使い、秒読みを過ぎると時間切れ負け', () => {
    const r = setup('b30'); // 持ち時間 0・秒読み 30 秒
    expect(deadline(r)).toBe(30_000);
    expect(act(r, 0, { type: 'move', move: mkMove(sq(7, 7), sq(7, 6)) }, 29_000)).toMatchObject({ ok: true });
    expect(checkTimeout(r, 29_000 + 30_001)).toBe(true);
    expect(r.result).toEqual({ kind: 'timeout', winner: 0 });
  });
  it('投了', () => {
    const r = setup();
    act(r, 1, { type: 'resign' }, 5);
    expect(r.result).toEqual({ kind: 'resign', winner: 0 });
  });
  it('同じトークンなら同じ席に戻れる', () => {
    const r = newRoom('ABCDEF', 'mini55', 'b30', 0);
    const a = join(r, null, 'あ', 0, () => 0.9, tok);
    if (!a.ok) throw new Error();
    r.seats[0].connected = false;
    expect(join(r, a.token, 'x', 5, () => 0.9, tok)).toMatchObject({ ok: true, seat: 0 });
    expect(Position.fromSfen(RULESETS.mini55.start, RULESETS.mini55).legalMoves().length).toBe(14);
  });
});
