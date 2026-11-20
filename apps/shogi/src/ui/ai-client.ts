// Web Worker のコンピューターに考えてもらう
import type { Level } from '../engine/ai';
import type { Move } from '../engine/position';
import type { Ruleset } from '../engine/rules';

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (r: { move: Move | null; score: number }) => void>();

export function askMove(sfen: string, rules: Ruleset['id'], level: Level, hint = false): Promise<{ move: Move | null; score: number }> {
  if (!worker) {
    worker = new Worker(new URL('../engine/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const f = waiting.get(e.data.id); waiting.delete(e.data.id); f?.(e.data); };
  }
  const id = ++seq;
  return new Promise((resolve) => { waiting.set(id, resolve); worker!.postMessage({ id, sfen, rules, level, hint }); });
}

// 考えている途中の手を捨てる（待った・やめるとき）
export function cancelThinking() {
  worker?.terminate();
  worker = null;
  for (const f of waiting.values()) f({ move: null, score: 0 });
  waiting.clear();
}
