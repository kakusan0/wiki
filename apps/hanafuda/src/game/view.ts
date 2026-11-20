// 1 人ぶんの見え方。相手の手札と山の中身は入れない（オンラインでも、コンピューター対戦でも同じものを使う）
import { legalActions, type Action, type Ev, type Phase, type Player, type RoundResult, type State } from './koikoi';
import type { Options } from './yaku';

export interface View {
  me: Player;
  opts: Options;
  round: number;
  dealer: Player;
  turn: Player;
  phase: Phase;
  hand: number[];
  oppHand: number; // 枚数だけ
  field: number[];
  deck: number; // 枚数だけ
  captured: [number[], number[]];
  pendingDraw: number | null;
  koikoi: [number, number];
  scores: [number, number];
  results: RoundResult[];
  events: Ev[];
  seq: number;
  legal: Action[]; // 自分の番のときに選べる操作
}

export function viewOf(s: State, me: Player): View {
  const opp: Player = me === 0 ? 1 : 0;
  const mine = s.turn === me || s.phase === 'roundEnd';
  return {
    me, opts: s.opts, round: s.round, dealer: s.dealer, turn: s.turn, phase: s.phase,
    hand: [...s.hands[me]], oppHand: s.hands[opp].length, field: [...s.field], deck: s.deck.length,
    captured: [[...s.captured[0]], [...s.captured[1]]], pendingDraw: s.pendingDraw, koikoi: [...s.koikoi] as [number, number],
    scores: [...s.scores] as [number, number], results: s.results, events: s.events, seq: s.seq,
    legal: mine && s.phase !== 'over' ? legalActions(s) : [],
  };
}
