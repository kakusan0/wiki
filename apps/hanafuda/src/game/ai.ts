// コンピューター：札の価値・役への近さ・相手への邪魔・場に残す危険を点にして選ぶ
import { CARDS, monthOf } from './cards';
import { apply, legalActions, matches, type Action, type Player, type State } from './koikoi';
import { basePoints, yakuOf } from './yaku';

export type Level = 'easy' | 'normal' | 'hard';
export const LEVEL_NAMES: Record<Level, string> = { easy: 'やさしい', normal: 'ふつう', hard: 'つよい' };

// 役ごとの「あと何枚」：[持っている枚数, 必要な枚数, 点]
function groups(cap: number[]): [number, number, number][] {
  const cs = cap.map((id) => CARDS[id]);
  const n = (f: (c: (typeof CARDS)[number]) => boolean) => cs.filter(f).length;
  const hasSake = n((c) => c.tag === 'sake');
  return [
    [n((c) => c.kind === 'hikari' && c.tag !== 'rain'), 3, 6],
    [n((c) => c.tag === 'boar' || c.tag === 'deer' || c.tag === 'butterfly'), 3, 5],
    [hasSake + n((c) => c.tag === 'curtain'), 2, 5],
    [hasSake + n((c) => c.tag === 'moon'), 2, 5],
    [n((c) => c.tag === 'akatan'), 3, 5],
    [n((c) => c.tag === 'aotan'), 3, 5],
    [n((c) => c.kind === 'tane'), 5, 1],
    [n((c) => c.kind === 'tan'), 5, 1],
    [n((c) => c.kind === 'kasu' || c.tag === 'sake'), 10, 1],
  ];
}

// 取った札の山の「見込み」：できた役の点 ＋ 近づいている役
export function potential(cap: number[]): number {
  let v = basePoints(yakuOf(cap)) * 12;
  for (const [have, need, pts] of groups(cap)) if (have < need) v += pts * (have / need) ** 2 * 3;
  return v + cap.length * 0.15;
}

// 相手が役まであと何枚か（0〜1。1 に近いほど危ない）
export function threat(cap: number[]): number {
  let t = 0;
  for (const [have, need, pts] of groups(cap)) if (have < need && pts >= 5) t = Math.max(t, have / need);
  return t;
}

const NOISE: Record<Level, number> = { easy: 6, normal: 1, hard: 0 };

// まだ見えていない札（相手の手札か山）
function unseen(s: State, p: Player): number[] {
  const seen = new Set([...s.hands[p], ...s.field, ...s.captured[0], ...s.captured[1]]);
  return Array.from({ length: 48 }, (_, i) => i).filter((i) => !seen.has(i));
}

function scoreAction(s: State, p: Player, a: Action, level: Level): number {
  const q: Player = p === 0 ? 1 : 0;
  const before = potential(s.captured[p]);
  const oppBefore = potential(s.captured[q]);
  // 山をめくる部分は運なので、出す札（またはめくった札）で取れる分だけを見る
  const card = a.type === 'play' ? a.card : s.pendingDraw ?? 0;
  const target = a.type === 'play' || a.type === 'pickDraw' ? a.target : undefined;
  const m = matches(s, card);
  let took: number[] = [];
  if (m.length === 1) took = [card, m[0]];
  else if (m.length === 2) took = [card, target!];
  else if (m.length === 3) took = [card, ...m];
  const capAfter = [...s.captured[p], ...took];
  let v = potential(capAfter) - before;
  if (level !== 'easy') {
    // 場に置く札は、相手に取られるかもしれない
    if (!took.length) {
      const un = unseen(s, p);
      const oppHand = s.hands[q].length;
      const mates = un.filter((c) => monthOf(c) === monthOf(card)).length;
      const prob = un.length ? Math.min(1, (mates * oppHand) / un.length) : 0;
      v -= prob * (potential([...s.captured[q], card]) - oppBefore) * 0.8;
      // 自分の手札に同じ月がもう 1 枚あれば、次に取り返せる
      if (s.hands[p].some((c) => c !== card && monthOf(c) === monthOf(card))) v += 1.5;
    }
    // 2 枚残っている月の 1 枚だけ取ると、残りを相手に取られやすい
    if (m.length === 2) v -= 0.3;
  }
  if (level === 'hard') {
    // 相手が欲しい札を先に取る
    for (const c of took) if (c !== card) v += (potential([...s.captured[q], c]) - oppBefore) * 0.6;
  }
  return v;
}

export function chooseAction(s: State, p: Player, level: Level, random: () => number = Math.random): Action {
  const acts = legalActions(s);
  if (s.phase === 'koikoi') return decideKoikoi(s, p, level, random) ? { type: 'koikoi' } : { type: 'stop' };
  if (acts.length === 1) return acts[0];
  let best = acts[0];
  let bestV = -Infinity;
  for (const a of acts) {
    const v = scoreAction(s, p, a, level) + (random() - 0.5) * 2 * NOISE[level];
    if (v > bestV) { bestV = v; best = a; }
  }
  return best;
}

// こいこいするか（true）、勝負するか（false）
export function decideKoikoi(s: State, p: Player, level: Level, random: () => number = Math.random): boolean {
  const q: Player = p === 0 ? 1 : 0;
  const base = basePoints(yakuOf(s.captured[p], s.opts));
  const myHand = s.hands[p].length;
  if (level === 'easy') return myHand >= 3 && random() < 0.4;
  const danger = threat(s.captured[q]);
  if (level === 'normal') return myHand >= 4 && danger < 0.67 && base < 7;
  // つよい：相手が役に近い・こちらがもう倍になる・残りが少ないなら勝負
  if (danger >= 0.66 || myHand <= 2) return false;
  if (s.opts.double7 && base >= 7) return false;
  // 最後の月で負けているなら、逆転を狙ってこいこい
  const last = s.round >= s.opts.months;
  const behind = s.scores[q] - s.scores[p];
  if (last && behind >= base * 2 && myHand >= 3) return true;
  return base <= 3 && myHand >= 4 && potential(s.captured[p]) - base * 12 > 6;
}

// 自動で 1 局（テスト・時間切れの代わりの手に使う）
export function autoPlay(s: State, levels: [Level, Level], random: () => number = Math.random): void {
  for (let guard = 0; guard < 10000 && s.phase !== 'over'; guard++) {
    const p = s.turn;
    const a = s.phase === 'roundEnd' ? ({ type: 'next' } as Action) : chooseAction(s, p, levels[p], random);
    const r = apply(s, p, a);
    if (!r.ok) throw new Error(r.error);
  }
}
