// こいこいの進行。状態はただのデータ（JSON にできる）で、apply で 1 つずつ操作を進める
import { CARDS, monthOf } from './cards';
import { DEFAULT_OPTIONS, basePoints, finalPoints, yakuOf, type Options, type Yaku } from './yaku';

export type Player = 0 | 1;
export type Phase = 'play' | 'drawChoose' | 'koikoi' | 'roundEnd' | 'over';

export type Action =
  | { type: 'play'; card: number; target?: number } // 手札を出す（場に同じ月が 2 枚なら target で選ぶ）
  | { type: 'pickDraw'; target: number } // めくった札で取る札を選ぶ
  | { type: 'koikoi' }
  | { type: 'stop' }
  | { type: 'next' }; // 次の月へ

export type Ev =
  | { k: 'deal'; round: number; dealer: Player }
  | { k: 'play'; p: Player; card: number; took: number[] } // took が空なら場に置いた
  | { k: 'draw'; p: Player; card: number; took: number[]; choosing?: boolean }
  | { k: 'yaku'; p: Player; yaku: Yaku[]; base: number }
  | { k: 'koikoi'; p: Player; count: number }
  | { k: 'end'; result: RoundResult };

export interface RoundResult {
  winner: Player | null;
  reason: 'stop' | 'teshi' | 'kuttsuki' | 'exhausted';
  base: number;
  points: number;
  yaku: Yaku[];
  doubles: string[];
}

export interface State {
  opts: Options;
  rng: number;
  round: number; // 1 から
  dealer: Player;
  turn: Player;
  phase: Phase;
  hands: [number[], number[]];
  field: number[];
  deck: number[];
  captured: [number[], number[]];
  pendingDraw: number | null;
  koikoi: [number, number];
  lastBase: [number, number]; // こいこいを選んだときの点（これより増えたら、また選べる）
  scores: [number, number];
  results: RoundResult[];
  events: Ev[]; // この月の出来事（画面の演出用）
  seq: number; // 操作の通し番号
}

// 乱数（mulberry32）。状態を数で持つ
export function rand(s: State): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function newGame(seed: number, opts: Partial<Options> = {}, firstDealer?: Player): State {
  const s: State = {
    opts: { ...DEFAULT_OPTIONS, ...opts }, rng: seed | 0, round: 1, dealer: 0, turn: 0, phase: 'play',
    hands: [[], []], field: [], deck: [], captured: [[], []], pendingDraw: null, koikoi: [0, 0], lastBase: [0, 0],
    scores: [0, 0], results: [], events: [], seq: 0,
  };
  s.dealer = firstDealer ?? (rand(s) < 0.5 ? 0 : 1);
  deal(s);
  return s;
}

const byMonth = (cards: number[]) => {
  const m = new Array(12).fill(0);
  for (const c of cards) m[monthOf(c)]++;
  return m as number[];
};

function deal(s: State) {
  for (;;) {
    const deck = Array.from({ length: 48 }, (_, i) => i);
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand(s) * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const field = deck.splice(0, 8);
    // 場に同じ月が 4 枚そろったら配り直し
    if (byMonth(field).some((n) => n === 4)) continue;
    const other: Player = s.dealer === 0 ? 1 : 0;
    s.hands = [[], []];
    s.hands[s.dealer] = deck.splice(0, 8).sort((a, b) => a - b);
    s.hands[other] = deck.splice(0, 8).sort((a, b) => a - b);
    s.field = field;
    s.deck = deck;
    break;
  }
  s.captured = [[], []];
  s.pendingDraw = null;
  s.koikoi = [0, 0];
  s.lastBase = [0, 0];
  s.turn = s.dealer;
  s.phase = 'play';
  s.events = [{ k: 'deal', round: s.round, dealer: s.dealer }];
  // 手四（同じ月 4 枚）・くっつき（同じ月 2 枚が 4 組）はすぐ 6 点で上がり（親から調べる）
  for (const p of [s.dealer, s.dealer === 0 ? 1 : 0] as Player[]) {
    const m = byMonth(s.hands[p]);
    if (m.some((n) => n === 4)) return endRound(s, p, 'teshi', 6, []);
    if (m.filter((n) => n === 2).length === 4) return endRound(s, p, 'kuttsuki', 6, []);
  }
}

// 場の札のうち、この札と同じ月のもの
export const matches = (s: State, card: number) => s.field.filter((f) => monthOf(f) === monthOf(card));

// 取る札を決める。同じ月が 2 枚なら target が要る
function take(s: State, p: Player, card: number, target?: number): number[] | null {
  const m = matches(s, card);
  let took: number[];
  if (m.length === 0) { s.field.push(card); return []; }
  if (m.length === 2) {
    if (target == null || !m.includes(target)) return null;
    took = [card, target];
  } else took = [card, ...m]; // 1 枚、または 3 枚まとめて
  s.field = s.field.filter((f) => !took.includes(f));
  s.captured[p].push(...took);
  return took;
}

export type Result = { ok: true } | { ok: false; error: string };
const err = (error: string): Result => ({ ok: false, error });

export function apply(s: State, p: Player, a: Action): Result {
  if (a.type === 'next') {
    if (s.phase !== 'roundEnd') return err('いまは次へ進めません');
    if (s.round >= s.opts.months) { s.phase = 'over'; s.seq++; return { ok: true }; }
    s.round++;
    const last = s.results.at(-1);
    if (last?.winner != null) s.dealer = last.winner; // 勝った人が次の親
    deal(s);
    s.seq++;
    return { ok: true };
  }
  if (s.turn !== p) return err('あなたの番ではありません');
  switch (a.type) {
    case 'play': {
      if (s.phase !== 'play') return err('いまは札を出せません');
      if (!s.hands[p].includes(a.card)) return err('その札は手札にありません');
      const m = matches(s, a.card);
      if (m.length === 2 && (a.target == null || !m.includes(a.target))) return err('取る札を選んでください');
      s.hands[p] = s.hands[p].filter((c) => c !== a.card);
      const took = take(s, p, a.card, a.target)!;
      s.events.push({ k: 'play', p, card: a.card, took });
      drawStep(s, p);
      break;
    }
    case 'pickDraw': {
      if (s.phase !== 'drawChoose' || s.pendingDraw == null) return err('いまは選べません');
      const took = take(s, p, s.pendingDraw, a.target);
      if (!took) return err('その札は取れません');
      s.events.push({ k: 'draw', p, card: s.pendingDraw, took });
      s.pendingDraw = null;
      afterTurn(s, p);
      break;
    }
    case 'koikoi': {
      if (s.phase !== 'koikoi') return err('いまはこいこいできません');
      s.koikoi[p]++;
      s.lastBase[p] = basePoints(yakuOf(s.captured[p], s.opts));
      s.events.push({ k: 'koikoi', p, count: s.koikoi[p] });
      // 手札がもうなければ、こいこいはできない（勝負になる）
      nextTurn(s, p);
      break;
    }
    case 'stop': {
      if (s.phase !== 'koikoi') return err('いまは上がれません');
      const ys = yakuOf(s.captured[p], s.opts);
      endRound(s, p, 'stop', basePoints(ys), ys);
      break;
    }
  }
  s.seq++;
  return { ok: true };
}

// 山から 1 枚めくる
function drawStep(s: State, p: Player) {
  const card = s.deck.shift()!;
  const m = matches(s, card);
  if (m.length === 2) {
    s.pendingDraw = card;
    s.phase = 'drawChoose';
    s.events.push({ k: 'draw', p, card, took: [], choosing: true });
    return;
  }
  const took = take(s, p, card)!;
  s.events.push({ k: 'draw', p, card, took });
  afterTurn(s, p);
}

function afterTurn(s: State, p: Player) {
  const ys = yakuOf(s.captured[p], s.opts);
  const base = basePoints(ys);
  if (base > s.lastBase[p]) {
    s.events.push({ k: 'yaku', p, yaku: ys, base });
    // 手札がなくなっていれば、そのまま上がり
    if (s.hands[p].length === 0) return endRound(s, p, 'stop', base, ys);
    s.phase = 'koikoi';
    return;
  }
  nextTurn(s, p);
}

function nextTurn(s: State, p: Player) {
  const q: Player = p === 0 ? 1 : 0;
  if (s.hands[0].length === 0 && s.hands[1].length === 0) return endRound(s, null, 'exhausted', 0, []);
  s.turn = q;
  s.phase = 'play';
}

function endRound(s: State, winner: Player | null, reason: RoundResult['reason'], base: number, yaku: Yaku[]) {
  let points = 0;
  let doubles: string[] = [];
  if (winner != null) {
    if (reason === 'stop') ({ points, doubles } = finalPoints(base, s.koikoi[winner === 0 ? 1 : 0], s.opts));
    else points = base;
    s.scores[winner] += points;
  }
  const result: RoundResult = { winner, reason, base, points, yaku, doubles };
  s.results.push(result);
  s.events.push({ k: 'end', result });
  s.phase = 'roundEnd';
}

// いまの手番の人が選べる操作
export function legalActions(s: State): Action[] {
  switch (s.phase) {
    case 'play':
      return s.hands[s.turn].flatMap((c) => {
        const m = matches(s, c);
        return m.length === 2 ? m.map((t) => ({ type: 'play', card: c, target: t }) as Action) : [{ type: 'play', card: c } as Action];
      });
    case 'drawChoose': return matches(s, s.pendingDraw!).map((t) => ({ type: 'pickDraw', target: t }));
    case 'koikoi': return [{ type: 'koikoi' }, { type: 'stop' }];
    case 'roundEnd': return [{ type: 'next' }];
    default: return [];
  }
}

export const winnerOf = (s: State): Player | null => (s.scores[0] === s.scores[1] ? null : s.scores[0] > s.scores[1] ? 0 : 1);
export const totalCards = (s: State) => s.hands[0].length + s.hands[1].length + s.field.length + s.deck.length + s.captured[0].length + s.captured[1].length + (s.pendingDraw != null ? 1 : 0);
export { CARDS };
