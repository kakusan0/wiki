import { describe, expect, it, vi } from 'vitest';
import { act, checkTimeout, cleanOptions, join, newRoom, rematch, viewFor, NEXT_MS } from '../src/worker/logic';
import { DEFAULT_OPTIONS } from '../src/game/yaku';

let n = 0;
const tok = () => `t${++n}`;
const setup = () => {
  const r = newRoom('ABCDEF', { ...DEFAULT_OPTIONS, months: 3 }, 0);
  join(r, null, 'あ', 0, () => 0.1, tok, () => 42);
  join(r, null, 'い', 0, () => 0.1, tok, () => 42);
  return r;
};

describe('オンラインの部屋', () => {
  it('2 人そろうと始まり、3 人目は入れない', () => {
    const r = setup();
    expect(r.state).not.toBeNull();
    expect(join(r, null, 'う', 0, () => 0.1, tok)).toMatchObject({ ok: false });
  });
  it('相手の手札と山の中身は送らない', () => {
    const r = setup();
    const s = r.state!;
    for (const seat of [0, 1]) {
      const v = viewFor(r, seat, 0).view!;
      const me = r.sideOf[seat], opp = me === 0 ? 1 : 0;
      expect(v.hand).toEqual(s.hands[me]);
      expect(typeof v.oppHand).toBe('number');
      expect(typeof v.deck).toBe('number');
      const json = JSON.stringify(v);
      expect(json).not.toContain('"hands"');
      // 相手の手札の札が、自分の見え方のどこにも出てこない（場や取り札と重ならない札で確かめる）
      const visible = new Set([...v.hand, ...v.field, ...v.captured[0], ...v.captured[1]]);
      for (const c of s.hands[opp]) expect(visible.has(c)).toBe(false);
      expect(v.legal.length > 0).toBe(s.turn === me);
    }
  });
  it('手番以外の操作・形の正しくない操作は断る', () => {
    const r = setup();
    const s = r.state!;
    const turnSeat = r.sideOf.indexOf(s.turn);
    const other = 1 - turnSeat;
    expect(act(r, other, { type: 'play', card: s.hands[1 - s.turn][0] }, 1)).toMatchObject({ ok: false });
    expect(act(r, turnSeat, { type: 'hack' }, 1)).toMatchObject({ ok: false });
    expect(act(r, turnSeat, { type: 'play', card: 99 }, 1)).toMatchObject({ ok: false });
    const v = viewFor(r, turnSeat, 1).view!;
    expect(act(r, turnSeat, v.legal[0], 1)).toMatchObject({ ok: true });
  });
  it('時間切れでは代わりに指す・最後まで進む・もう一局', () => {
    const r = setup();
    let t = 0;
    for (let i = 0; i < 500 && r.state!.phase !== 'over'; i++) { t += NEXT_MS + 1000; expect(checkTimeout(r, t)).toBe(true); }
    expect(r.state!.phase).toBe('over');
    expect(r.state!.results).toHaveLength(3);
    expect(rematch(r, 0, t)).toMatchObject({ ok: true });
    expect(r.state!.phase).toBe('over');
    // もう一局の配り方は乱数で決まる。配った手で役ができてすぐ終わる配り方もあるので、種を決めておく
    const fixed = vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(a: T) => { (a as unknown as Uint32Array)[0] = 42; return a; });
    rematch(r, 1, t);
    fixed.mockRestore();
    expect(r.state!.round).toBe(1);
    expect(r.state!.results).toHaveLength(0);
  });
  it('設定の受け取り', () => {
    expect(cleanOptions({ months: 6 })).toMatchObject({ months: 6, drinks: true });
    expect(cleanOptions({ months: 5 })).toBeNull();
    expect(cleanOptions({ months: 3, drinks: false, evil: 1 })).toEqual({ ...DEFAULT_OPTIONS, months: 3, drinks: false });
  });
});
