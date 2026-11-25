import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/game';
import { Position, mkMove, DROP } from '../src/engine/position';
import { RULESETS } from '../src/engine/rules';
import { fromUsi, toUsi } from '../src/engine/usi';
import { clockText, gameIdOf, parseGame, playerLabel, startedText, statusText } from '../src/ui/lishogi';

const sq = (file: number, rank: number) => (rank - 1) * 9 + (9 - file);

describe('USI の指し手', () => {
  it('ふつうの手・成る手・打つ手を読み書きできる', () => {
    const g = new Game(RULESETS.standard);
    for (const u of ['7g7f', '3c3d', '8h2b+', '3a2b', 'B*4e']) {
      const m = fromUsi(g.pos, u);
      expect(m, u).not.toBeNull();
      expect(toUsi(g.pos, m!)).toBe(u);
      g.play(m!);
    }
    expect(g.record.map((r) => r.name)).toEqual(['▲7六歩', '△3四歩', '▲2二角成', '△同　銀', '▲4五角打']);
    expect(g.moves[0]).toBe(mkMove(sq(7, 7), sq(7, 6)));
    expect(g.moves[4]).toBe(mkMove(DROP, sq(4, 5), false, 6));
  });
  it('指せない手・形の違う手は null', () => {
    const p = Position.fromSfen(RULESETS.standard.start);
    for (const u of ['7g7e', 'P*5e', '7f7e', 'xx', '', '0a1b', '7g7f++']) expect(fromUsi(p, u), u).toBeNull();
  });
  it('手番の数がない SFEN（Lishogi の形）も読める', () => {
    const p = Position.fromSfen('lnsgkgsn1/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w -');
    expect(p.side).toBe(1);
    expect(fromUsi(p, '3c3d')).not.toBeNull();
  });
});

describe('Lishogi の対局', () => {
  it('URL や ID から対局の ID を取り出す', () => {
    expect(gameIdOf('https://lishogi.org/Hbj2QOao')).toBe('Hbj2QOao');
    expect(gameIdOf('https://lishogi.org/Hbj2QOao/gote')).toBe('Hbj2QOao');
    expect(gameIdOf('https://lishogi.org/Hbj2QOaoAbCd')).toBe('Hbj2QOao'); // 対局者用の 12 文字
    expect(gameIdOf('lishogi.org/Hbj2QOao#12')).toBe('Hbj2QOao');
    expect(gameIdOf(' Hbj2QOao ')).toBe('Hbj2QOao');
    expect(gameIdOf('https://example.com/Hbj2QOao')).toBeNull();
    expect(gameIdOf('abc')).toBeNull();
  });
  it('API の形を読む（名前・レーティング・持ち時間・勝ち負け）', () => {
    const g = parseGame({
      id: 'Hbj2QOao', rated: true, variant: 'standard', status: 'resign', winner: 'gote',
      players: { sente: { user: { name: 'apoipoi' }, rating: 1766 }, gote: { user: { name: 'kawasemi', title: 'BOT' }, rating: 1980 } },
      moves: '7g7f 3c3d', clock: { initial: 600, increment: 0, byoyomi: 30, periods: 1 },
    });
    expect(g.moves).toEqual(['7g7f', '3c3d']);
    expect(playerLabel(g.players.sente)).toBe('apoipoi（1766）');
    expect(playerLabel(g.players.gote)).toBe('BOT kawasemi（1980）');
    expect(statusText(g)).toBe('投了。後手の勝ち');
    expect(clockText(g)).toBe('10 分＋秒読み 30 秒');
  });
  it('手のない対局・コンピューター相手・対局中', () => {
    const g = parseGame({ id: 'AbCd1234', status: 'started', players: { sente: { aiLevel: 3 }, gote: { user: { name: 'x' } } } });
    expect(g.moves).toEqual([]);
    expect(g.players.sente.name).toBe('コンピューター（レベル 3）');
    expect(statusText(g)).toBe('対局中');
    expect(clockText(g)).toBe('');
    expect(startedText(g)).toBe('');
    expect(startedText({ ...g, createdAt: 0 }, 30_000)).toBe('いま始まった');
    expect(startedText({ ...g, createdAt: 0 }, 5 * 60_000)).toBe('5 分前に開始');
    expect(startedText({ ...g, createdAt: 0 }, 125 * 60_000)).toBe('2 時間前に開始');
  });
});
