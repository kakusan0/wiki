// 強くした「つよい」と、前の「つよい」（tests/ai-before.ts）を戦わせる
import { describe, it, expect } from 'vitest';
import { decide } from '../src/game/ai';
import { decide as decideBefore } from './ai-before';
import { MAPS } from '../src/game/maps';
import { actor, apply, newGame } from '../src/game/turn';
import type { GameState } from '../src/game/state';

/** 新しい「つよい」2 人と前の「つよい」2 人で games 試合。席は試合ごとに入れ替える */
function headToHead(games: number, seed0 = 9100) {
  let newWins = 0, oldWins = 0;
  const forced = { new: 0, old: 0 };
  for (let g = 0; g < games; g++) {
    const newSeats = g % 2 === 0 ? [0, 2] : [1, 3];
    let s: GameState = newGame({
      mapId: MAPS[g % MAPS.length].id, mode: 'normal', seed: seed0 + g, maxRounds: 80,
      players: [0, 1, 2, 3].map((i) => ({ name: `P${i}`, cpu: 'hard' as const })),
    });
    let steps = 0;
    while (s.phase !== 'over') {
      const who = actor(s);
      const last = s.log[s.log.length - 1];
      s = apply(s, newSeats.includes(who) ? decide(s) : decideBefore(s));
      if (++steps > 30000) throw new Error(`game ${g} が終わらない`);
      // 増えた記録だけを見る（記録は 300 件までなので、前の最後の行の位置から）
      let i = s.log.length - 1;
      while (i >= 0 && !(last && s.log[i].round === last.round && s.log[i].text === last.text && s.log[i].player === last.player)) i--;
      for (const l of s.log.slice(i + 1)) if (l.text.includes('お金が足りないため') && l.player != null) forced[newSeats.includes(l.player) ? 'new' : 'old']++;
    }
    if (newSeats.includes(s.winner!)) newWins++; else oldWins++;
  }
  return { newWins, oldWins, forced };
}

describe('強くした「つよい」', () => {
  // 調整に使わなかった種で 200 試合。調整のときは 600 試合で 59〜60 % 勝った。下回ったら弱くなっている
  it('前の「つよい」に、55 % より多く勝つ（200 試合）', { timeout: 300_000 }, () => {
    const r = headToHead(200, 53000);
    console.log('新しい つよい と 前の つよい', r);
    expect(r.newWins / 200).toBeGreaterThan(0.55);
  });
});
