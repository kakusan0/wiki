import { describe, expect, it } from 'vitest';
import { CARDS } from '../src/game/cards';
import { apply, legalActions, newGame, totalCards, type State } from '../src/game/koikoi';
import { autoPlay } from '../src/game/ai';
import { DEFAULT_OPTIONS, basePoints, finalPoints, yakuOf } from '../src/game/yaku';

const id = (name: string, nth = 0) => CARDS.filter((c) => c.name === name)[nth].id;
const names = (ys: { name: string }[]) => ys.map((y) => y.name).sort();

describe('札', () => {
  it('48 枚・12 か月 4 枚ずつ・光 5 タネ 9 短冊 10 カス 24', () => {
    expect(CARDS).toHaveLength(48);
    const count = (k: string) => CARDS.filter((c) => c.kind === k).length;
    expect([count('hikari'), count('tane'), count('tan'), count('kasu')]).toEqual([5, 9, 10, 24]);
    for (let m = 0; m < 12; m++) expect(CARDS.filter((c) => c.month === m)).toHaveLength(4);
  });
});

describe('役', () => {
  const hik = ['松に鶴', '桜に幕', '芒に月', '桐に鳳凰'].map((n) => id(n));
  const rain = id('柳に小野道風');
  it('光の役', () => {
    expect(names(yakuOf(hik.slice(0, 3)))).toEqual(['三光']);
    expect(names(yakuOf([...hik.slice(0, 2), rain]))).toEqual([]);
    expect(names(yakuOf(hik))).toEqual(['四光']);
    expect(names(yakuOf([...hik.slice(0, 3), rain]))).toEqual(['雨四光']);
    expect(basePoints(yakuOf([...hik, rain]))).toBe(10);
  });
  it('猪鹿蝶・一杯・赤短・青短・タネ・タン・カス', () => {
    expect(names(yakuOf([id('萩に猪'), id('紅葉に鹿'), id('牡丹に蝶')]))).toEqual(['猪鹿蝶']);
    expect(names(yakuOf([id('桜に幕'), id('菊に盃')]))).toEqual(['花見で一杯']);
    expect(yakuOf([id('桜に幕'), id('菊に盃')], { ...DEFAULT_OPTIONS, drinks: false })).toEqual([]);
    expect(names(yakuOf([id('芒に月'), id('菊に盃'), id('桜に幕')]))).toEqual(['月見で一杯', '花見で一杯']);
    const aka = ['松に赤短', '梅に赤短', '桜に赤短'].map((n) => id(n));
    const ao = ['牡丹に青短', '菊に青短', '紅葉に青短'].map((n) => id(n));
    expect(names(yakuOf(aka))).toEqual(['赤短']);
    // 6 枚の短冊：赤短・青短の重複（10 点）＋タン（2 点）
    expect(yakuOf([...aka, ...ao]).map((y) => [y.name, y.points])).toEqual([['赤短・青短', 10], ['タン', 2]]);
    const tane = CARDS.filter((c) => c.kind === 'tane').slice(0, 6).map((c) => c.id);
    expect(yakuOf(tane).find((y) => y.name === 'タネ')?.points).toBe(2);
    const kasu = CARDS.filter((c) => c.kind === 'kasu').slice(0, 9).map((c) => c.id);
    expect(yakuOf(kasu)).toEqual([]);
    expect(yakuOf([...kasu, id('菊に盃')]).some((y) => y.name === 'カス')).toBe(true); // 盃はカスにも
    expect(yakuOf([...kasu, id('菊に盃')], { ...DEFAULT_OPTIONS, sakeAsKasu: false }).some((y) => y.name === 'カス')).toBe(false);
  });
  it('倍の決まり', () => {
    expect(finalPoints(6, 0, DEFAULT_OPTIONS).points).toBe(6);
    expect(finalPoints(7, 0, DEFAULT_OPTIONS).points).toBe(14);
    expect(finalPoints(5, 1, DEFAULT_OPTIONS).points).toBe(10);
    expect(finalPoints(8, 2, DEFAULT_OPTIONS).points).toBe(32);
  });
});

// 場・手札を決めた状態を作る
function fixed(field: number[], h0: number[], h1: number[], deck: number[]): State {
  const s = newGame(1, {}, 0);
  Object.assign(s, { field, hands: [h0, h1], deck, captured: [[], []], phase: 'play', turn: 0, events: [], koikoi: [0, 0], lastBase: [0, 0] });
  return s;
}

describe('進行', () => {
  it('配る：手札 8・場 8・山 24。場に同じ月 4 枚はない', () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = newGame(seed);
      if (s.phase === 'roundEnd') continue; // 手四・くっつき
      expect([s.hands[0].length, s.hands[1].length, s.field.length, s.deck.length]).toEqual([8, 8, 8, 24]);
      const m = new Array(12).fill(0);
      for (const c of s.field) m[c >> 2]++;
      expect(Math.max(...m)).toBeLessThan(4);
    }
  });
  it('合わせ方：0 枚は場へ・1 枚は取る・2 枚は選ぶ・3 枚はまとめて', () => {
    // 1 月(0-3) 2 月(4-7) 3 月(8-11)
    const s = fixed([1, 4, 5, 8, 9, 10], [0, 7, 11, 20], [21, 22, 23, 24], [40, 44, 45, 46]);
    expect(apply(s, 0, { type: 'play', card: 7 })).toMatchObject({ ok: false }); // 2 枚あるのに選ばない
    expect(legalActions(s).filter((a) => a.type === 'play' && a.card === 7)).toHaveLength(2);
    expect(apply(s, 0, { type: 'play', card: 7, target: 5 }).ok).toBe(true);
    expect(s.captured[0]).toEqual([7, 5]);
    expect(s.field).toContain(40); // めくった 40 は場へ
    expect(apply(s, 1, { type: 'play', card: 21 }).ok).toBe(true); // 6 月：場になし → 場に置く
    expect(s.field).toContain(21);
    apply(s, 0, { type: 'play', card: 11 }); // 3 月：場に 3 枚 → 4 枚まとめて
    expect(s.captured[0]).toEqual(expect.arrayContaining([8, 9, 10, 11]));
  });
  it('役ができたら、こいこいか勝負。こいこい返しで倍', () => {
    // 先手は光 2 枚を持っていて、3 枚目を取ると三光
    const s = fixed([8, 28], [11, 31, 13], [2, 3, 14], [44, 45, 46, 47]); // 場：桜に幕・芒に月
    s.captured = [[0], []]; // 松に鶴
    apply(s, 0, { type: 'play', card: 11 }); // 桜：幕を取る → 光 2 枚
    expect(s.phase).toBe('play');
    apply(s, 1, { type: 'play', card: 2 });
    apply(s, 0, { type: 'play', card: 31 }); // 芒：月を取る → 三光
    expect(s.phase).toBe('koikoi');
    apply(s, 0, { type: 'koikoi' });
    expect(s.koikoi[0]).toBe(1);
    expect(s.turn).toBe(1);
  });
  it('自動対局：札はいつも 48 枚・点の合計が合う・最後まで進む', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = newGame(seed, { months: 12 });
      let r = seed;
      const random = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
      autoPlay(s, ['normal', 'hard'], random);
      expect(s.phase).toBe('over');
      expect(s.results).toHaveLength(12);
      expect(totalCards(s)).toBe(48);
      const sum = [0, 1].map((p) => s.results.filter((x) => x.winner === p).reduce((a, x) => a + x.points, 0));
      expect(sum).toEqual(s.scores);
    }
  });
});
