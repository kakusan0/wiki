// 花札 48 枚。札の番号 = 月(0〜11) × 4 + 月の中の番号(0〜3)
export type Kind = 'hikari' | 'tane' | 'tan' | 'kasu';
export interface Card {
  id: number;
  month: number; // 0 = 1 月
  kind: Kind;
  name: string; // 札の名前（例：松に鶴）
  tag?: 'akatan' | 'aotan' | 'rain' | 'sake' | 'boar' | 'deer' | 'butterfly' | 'curtain' | 'moon';
}

export const MONTHS = ['松', '梅', '桜', '藤', '菖蒲', '牡丹', '萩', '芒', '菊', '紅葉', '柳', '桐'];
export const MONTH_NAMES = ['1 月・松', '2 月・梅', '3 月・桜', '4 月・藤', '5 月・菖蒲', '6 月・牡丹', '7 月・萩', '8 月・芒', '9 月・菊', '10 月・紅葉', '11 月・柳', '12 月・桐'];
export const KIND_NAMES: Record<Kind, string> = { hikari: '光', tane: 'タネ', tan: '短冊', kasu: 'カス' };

type Def = [Kind, string, Card['tag']?];
const DEFS: Def[][] = [
  [['hikari', '松に鶴'], ['tan', '松に赤短', 'akatan'], ['kasu', '松'], ['kasu', '松']],
  [['tane', '梅に鶯'], ['tan', '梅に赤短', 'akatan'], ['kasu', '梅'], ['kasu', '梅']],
  [['hikari', '桜に幕', 'curtain'], ['tan', '桜に赤短', 'akatan'], ['kasu', '桜'], ['kasu', '桜']],
  [['tane', '藤に不如帰'], ['tan', '藤に短冊'], ['kasu', '藤'], ['kasu', '藤']],
  [['tane', '菖蒲に八橋'], ['tan', '菖蒲に短冊'], ['kasu', '菖蒲'], ['kasu', '菖蒲']],
  [['tane', '牡丹に蝶', 'butterfly'], ['tan', '牡丹に青短', 'aotan'], ['kasu', '牡丹'], ['kasu', '牡丹']],
  [['tane', '萩に猪', 'boar'], ['tan', '萩に短冊'], ['kasu', '萩'], ['kasu', '萩']],
  [['hikari', '芒に月', 'moon'], ['tane', '芒に雁'], ['kasu', '芒'], ['kasu', '芒']],
  [['tane', '菊に盃', 'sake'], ['tan', '菊に青短', 'aotan'], ['kasu', '菊'], ['kasu', '菊']],
  [['tane', '紅葉に鹿', 'deer'], ['tan', '紅葉に青短', 'aotan'], ['kasu', '紅葉'], ['kasu', '紅葉']],
  [['hikari', '柳に小野道風', 'rain'], ['tane', '柳に燕'], ['tan', '柳に短冊'], ['kasu', '柳に雷']],
  [['hikari', '桐に鳳凰'], ['kasu', '桐'], ['kasu', '桐'], ['kasu', '桐']],
];

export const CARDS: Card[] = DEFS.flatMap((defs, month) => defs.map(([kind, name, tag], k) => ({ id: month * 4 + k, month, kind, name, ...(tag ? { tag } : {}) })));
export const monthOf = (id: number) => id >> 2;
export const card = (id: number) => CARDS[id];
