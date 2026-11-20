import { describe, expect, it } from 'vitest';
import { autoPlay, decideKoikoi } from '../src/game/ai';
import { newGame } from '../src/game/koikoi';

const lcg = (seed: number) => { let r = seed; return () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648); };

describe('コンピューター', () => {
  it('つよいは、やさしいより多く勝つ', () => {
    let hard = 0, easy = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const side = seed % 2;
      const s = newGame(seed, { months: 6 });
      autoPlay(s, side === 0 ? ['hard', 'easy'] : ['easy', 'hard'], lcg(seed));
      const hs = s.scores[side], es = s.scores[1 - side];
      if (hs > es) hard++; else if (es > hs) easy++;
    }
    expect(hard).toBeGreaterThan(easy * 1.5);
  });
  it('相手が役に近いと勝負する', () => {
    const s = newGame(3, {}, 0);
    s.captured = [[0, 8], [36 + 0, 24 + 0, 20 + 0]]; // 相手：盃・猪・蝶（猪鹿蝶まで鹿だけ）
    s.captured[0] = [0, 8, 28]; // 自分：三光
    s.phase = 'koikoi';
    expect(decideKoikoi(s, 0, 'hard')).toBe(false);
  });
});
