// 時間切れのときに代わりに選ぶ手（いちばん簡単なもの。こいこいの場面では勝負する）
import { legalActions, type Action, type State } from './koikoi';

export function autoAction(s: State): Action | null {
  if (s.phase === 'koikoi') return { type: 'stop' };
  if (s.phase === 'roundEnd') return { type: 'next' };
  return legalActions(s)[0] ?? null;
}
