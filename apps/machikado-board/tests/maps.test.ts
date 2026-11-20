import { describe, expect, it } from 'vitest';
import { MAPS, arrow, forwardOptions, landingAfter, landingByDice, parseMap, validateMap, validateMaps } from '../src/game/maps';

// 正しい最小の盤（7×7・近道 1 本）を土台に、1 か所ずつ壊して確認する
const OK = [
  'B00a011',
  'C..2..1',
  '4..2..b',
  '4..P..1',
  'c..2..3',
  'P..C..3',
  '44dLC33',
];
const BASE = [100, 120, 140, 180, 220];
const set = (rows: string[], x: number, y: number, ch: string) =>
  rows.map((r, i) => (i === y ? r.slice(0, x) + ch + r.slice(x + 1) : r));
const check = (rows = OK, o: { target?: number; cash?: number; base?: number[]; id?: string } = {}) => {
  const { map, errors } = parseMap(o.id ?? 'test', 'テスト', o.target ?? 4000, o.cash ?? 1200, rows, o.base ?? BASE);
  return [...errors, ...validateMap(map)].join('\n');
};

describe('収録マップ', () => {
  it('すべて確認を通る', () => {
    for (const m of MAPS) expect(validateMap(m)).toEqual([]);
    expect(validateMaps(MAPS)).toEqual([]);
  });
  it('どのマップにも分かれ道がある', () => {
    for (const m of MAPS) expect(m.links.filter((l) => l.length >= 3).length).toBeGreaterThan(0);
  });
  it('つながりは両方向', () => {
    for (const m of MAPS) m.links.forEach((l, a) => l.forEach((b) => expect(m.links[b]).toContain(a)));
  });
});

describe('進む方向', () => {
  const m = MAPS[0];
  it('来た方向は選べない', () => {
    const fork = m.squares.findIndex((_, i) => m.links[i].length === 3);
    const back = m.links[fork][0];
    expect(forwardOptions(m, fork, back)).not.toContain(back);
    expect(forwardOptions(m, fork, back)).toHaveLength(2);
    expect(forwardOptions(m, fork, null)).toHaveLength(3);
  });
  it('矢印', () => {
    expect(arrow(m, 0, 1)).toBe('→');
    expect(arrow(m, 1, 0)).toBe('←');
    expect(arrow(m, 0, 7)).toBe('↓');
  });
});

describe('マップの確認', () => {
  it('土台の盤は問題なし', () => expect(check()).toBe(''));
  it('行の長さ', () => expect(check([...OK.slice(0, 6), '44dLC3'])).toMatch('行の長さ'));
  it('使えない記号', () => expect(check(set(OK, 1, 0, 'X'))).toMatch('記号「X」'));
  it('存在しない通り番号', () => expect(check(set(OK, 1, 0, '9'))).toMatch('記号「9」'));
  it('行き止まり', () => expect(check([...OK, '.....3.'])).toMatch('行き止まり'));
  it('つながっていないマス', () => expect(check(set(set(OK, 1, 3, 'C'), 1, 2, '.'))).toMatch(/つながっていない|行き止まり/));
  it('2×2 のかたまり', () => expect(check(set(OK, 1, 1, '0'))).toMatch('2×2'));
  it('分かれ道がない', () => expect(check(OK.map((r, y) => (y > 0 && y < 6 ? set([r], 3, 0, '.')[0] : r)))).toMatch('分かれ道'));
  it('銀行が 2 つ', () => expect(check(set(OK, 0, 5, 'B'))).toMatch('銀行はちょうど 1 つ'));
  it('スタンプが重なる', () => expect(check(set(OK, 6, 2, 'a'))).toMatch('花のスタンプは 1 つ必要'));
  it('お店が多すぎる通り', () => expect(check(set(OK, 3, 3, '2').map((r, y) => (y === 5 ? set([r], 3, 0, '2')[0] : r)))).toMatch(/もりの通りのお店は/));
  it('通りが離れすぎ', () => expect(check(set(set(OK, 2, 6, '0'), 4, 0, 'd'))).toMatch('離れすぎ'));
  it('同じ特殊マスが並ぶ', () => expect(check(set(OK, 3, 4, 'P'))).toMatch('同じ特殊マス'));
  it('チャンスがない', () => expect(check(OK.map((r) => r.replaceAll('C', 'L')))).toMatch('チャンスマス'));
  it('初期資金が少ない', () => expect(check(OK, { cash: 200 })).toMatch('初期資金'));
  it('目標が低すぎる', () => expect(check(OK, { target: 2000 })).toMatch('目標'));
  it('価格が 0 以下', () => expect(check(OK, { base: [0, 120, 140, 180, 220] })).toMatch('価格が正しくありません'));
  it('id の形式', () => expect(check(OK, { id: 'Bad Id' })).toMatch('id'));
  it('id の重なり', () => expect(validateMaps([MAPS[0], MAPS[0]])).toHaveLength(1));
});

describe('サイコロで止まる候補', () => {
  const m = MAPS[0]; // ちいさな四つ角
  it('はじめの銀行からは、1 の目で左右どちらにも止まりうる', () => {
    const c = landingByDice(m, 0, null);
    expect(c.get(1)).toEqual([1]);
    expect(c.get(7)).toEqual([1]);
  });
  it('分かれ道の先は全部の方向を数え、後ろへは戻らない', () => {
    // パン工房（1）から銀行（0）を背にして進む：2 → 3（分かれ道）→ 4 か 下
    const c = landingByDice(m, 1, 0);
    expect(c.get(2)).toEqual([1]);
    expect(c.get(3)).toEqual([2]);
    const after3 = [...c.entries()].filter(([, ds]) => ds.includes(3)).map(([sq]) => sq);
    expect(after3).toHaveLength(2);
    expect(c.has(0)).toBe(false); // 戻る方向の銀行には止まらない（6 歩以内では一周しない）
  });
  it('n 歩ちょうどで止まるマスの数', () => {
    expect(landingAfter(m, 0, null, 0)).toEqual(new Set([0]));
    expect(landingAfter(m, 0, null, 2).size).toBe(2);
  });
});
