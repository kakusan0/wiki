// Web Worker に一局ぶんの解析を頼む。やめるときは stop() で処理ごと止める
import type { PlyEval } from '../engine/analysis';
import type { Move } from '../engine/position';
import type { Ruleset } from '../engine/rules';

export interface AnalysisJob { stop: () => void }

export function startAnalysis(sfen: string, rules: Ruleset['id'], moves: Move[], timeMs: number, onPly: (k: number, e: PlyEval) => void, onDone: () => void, from = 0): AnalysisJob {
  const worker = new Worker(new URL('../engine/analysis-worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    if (e.data.done) { worker.terminate(); onDone(); return; }
    onPly(e.data.k, e.data.ev);
  };
  worker.postMessage({ sfen, rules, moves, timeMs, from });
  return { stop: () => worker.terminate() };
}
