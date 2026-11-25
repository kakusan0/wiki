// 対局の解析を画面と別の処理（Web Worker）で動かす。1 局面ごとに結果を送る
import { analyzeGame } from './analysis';
import type { Move } from './position';
import { RULESETS, type Ruleset } from './rules';

self.onmessage = (e: MessageEvent<{ sfen: string; rules: Ruleset['id']; moves: Move[]; timeMs: number; from?: number }>) => {
  const { sfen, rules, moves, timeMs, from = 0 } = e.data;
  analyzeGame(RULESETS[rules], sfen, moves, timeMs, (k, ev) => { (self as unknown as Worker).postMessage({ k, ev }); }, from);
  (self as unknown as Worker).postMessage({ done: true });
};
