// コンピューターの思考を画面と別の処理（Web Worker）で動かす
import { think, search, type Level } from './ai';
import { Position } from './position';
import { RULESETS, type Ruleset } from './rules';

self.onmessage = (e: MessageEvent<{ id: number; sfen: string; rules: Ruleset['id']; level: Level; hint?: boolean }>) => {
  const { id, sfen, rules, level, hint } = e.data;
  const p = Position.fromSfen(sfen, RULESETS[rules]);
  const r = hint ? search(p, { level: 'advanced', timeMs: 1500 }) : think(p, level);
  (self as unknown as Worker).postMessage({ id, move: r.move, score: r.score, depth: r.depth });
};
