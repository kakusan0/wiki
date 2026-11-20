// 役の判定と点数
import { CARDS } from './cards';

export interface Options {
  months: number; // 何か月（何回）遊ぶか
  sakeAsKasu: boolean; // 菊に盃をカスにも数える
  drinks: boolean; // 花見で一杯・月見で一杯を使う
  double7: boolean; // 7 点以上は倍
  koikoiDouble: boolean; // こいこいした相手から上がると倍
}
export const DEFAULT_OPTIONS: Options = { months: 6, sakeAsKasu: true, drinks: true, double7: true, koikoiDouble: true };

export interface Yaku { id: string; name: string; points: number; cards: number[] }

export function yakuOf(captured: number[], o: Options = DEFAULT_OPTIONS): Yaku[] {
  const cs = captured.map((id) => CARDS[id]);
  const ids = (f: (c: (typeof cs)[number]) => boolean) => cs.filter(f).map((c) => c.id);
  const has = (tag: string) => cs.some((c) => c.tag === tag);
  const out: Yaku[] = [];

  const hikari = ids((c) => c.kind === 'hikari');
  const rain = has('rain');
  if (hikari.length === 5) out.push({ id: 'goko', name: '五光', points: 10, cards: hikari });
  else if (hikari.length === 4 && !rain) out.push({ id: 'shiko', name: '四光', points: 8, cards: hikari });
  else if (hikari.length === 4) out.push({ id: 'ameshiko', name: '雨四光', points: 7, cards: hikari });
  else if (hikari.length === 3 && !rain) out.push({ id: 'sanko', name: '三光', points: 5, cards: hikari });

  if (has('boar') && has('deer') && has('butterfly')) out.push({ id: 'inoshikacho', name: '猪鹿蝶', points: 5, cards: ids((c) => c.tag === 'boar' || c.tag === 'deer' || c.tag === 'butterfly') });
  if (o.drinks && has('sake')) {
    if (has('curtain')) out.push({ id: 'hanami', name: '花見で一杯', points: 5, cards: ids((c) => c.tag === 'curtain' || c.tag === 'sake') });
    if (has('moon')) out.push({ id: 'tsukimi', name: '月見で一杯', points: 5, cards: ids((c) => c.tag === 'moon' || c.tag === 'sake') });
  }

  const aka = ids((c) => c.tag === 'akatan');
  const ao = ids((c) => c.tag === 'aotan');
  if (aka.length === 3 && ao.length === 3) out.push({ id: 'akaao', name: '赤短・青短', points: 10, cards: [...aka, ...ao] });
  else {
    if (aka.length === 3) out.push({ id: 'akatan', name: '赤短', points: 5, cards: aka });
    if (ao.length === 3) out.push({ id: 'aotan', name: '青短', points: 5, cards: ao });
  }

  const tane = ids((c) => c.kind === 'tane');
  if (tane.length >= 5) out.push({ id: 'tane', name: 'タネ', points: tane.length - 4, cards: tane });
  const tan = ids((c) => c.kind === 'tan');
  if (tan.length >= 5) out.push({ id: 'tan', name: 'タン', points: tan.length - 4, cards: tan });
  const kasu = ids((c) => c.kind === 'kasu' || (o.sakeAsKasu && c.tag === 'sake'));
  if (kasu.length >= 10) out.push({ id: 'kasu', name: 'カス', points: kasu.length - 9, cards: kasu });
  return out;
}

export const basePoints = (ys: Yaku[]) => ys.reduce((a, y) => a + y.points, 0);

// 上がったときの点数（倍の決まりを含む）
export function finalPoints(base: number, opponentKoikoi: number, o: Options): { points: number; doubles: string[] } {
  let p = base;
  const doubles: string[] = [];
  if (o.double7 && base >= 7) { p *= 2; doubles.push('7 点以上で倍'); }
  if (o.koikoiDouble && opponentKoikoi > 0) { p *= 2; doubles.push('こいこい返しで倍'); }
  return { points: p, doubles };
}
