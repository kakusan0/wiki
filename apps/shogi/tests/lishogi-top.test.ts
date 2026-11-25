import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectStrongGames, parseGame, type TopPlayer } from '../src/ui/lishogi';
import { TOP_URL, parseTop, resetTopMemo, topPlayers } from '../src/worker/lishogi-top';

const raw = { users: [
  { id: 'beniiro', username: 'Beniiro', perfs: { realTime: { rating: 2563 } } },
  { id: 'peepee', username: 'PEEPEE', title: 'BOT', perfs: { realTime: { rating: 2315 } } },
  { id: 'bad id!', username: 'x', perfs: { realTime: { rating: 1 } } }, // 読めない ID は飛ばす
  { id: 'norating', username: 'y', perfs: {} },
] };

describe('強い人の一覧（サーバー）', () => {
  beforeEach(() => resetTopMemo());
  it('Lishogi の答えを読む', () => {
    expect(parseTop(raw)).toEqual([
      { id: 'beniiro', name: 'Beniiro', rating: 2563, title: null },
      { id: 'peepee', name: 'PEEPEE', rating: 2315, title: 'BOT' },
    ]);
    expect(parseTop(null)).toEqual([]);
    expect(parseTop({ users: 'x' })).toEqual([]);
  });
  it('10 分は覚えておき、読めないときは前のものを使う', async () => {
    const f = vi.fn(async () => Response.json(raw));
    expect(await topPlayers(0, f as unknown as typeof fetch)).toHaveLength(2);
    expect(f).toHaveBeenCalledWith(TOP_URL, expect.anything());
    await topPlayers(599_000, f as unknown as typeof fetch);
    expect(f).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => new Response('', { status: 503 }));
    expect(await topPlayers(601_000, down as unknown as typeof fetch)).toHaveLength(2);
    expect(down).toHaveBeenCalledTimes(1);
  });
  it('はじめから読めなければエラー', async () => {
    const down = vi.fn(async () => new Response('', { status: 429 }));
    await expect(topPlayers(0, down as unknown as typeof fetch)).rejects.toThrow('429');
  });
});

describe('強い人の対局だけを集める', () => {
  const players: TopPlayer[] = [{ id: 'beniiro', name: 'Beniiro', rating: 2563, title: null }, { id: 'wakao', name: 'Wakao', rating: 2241, title: null }];
  const game = (id: string, sente: string, gote: string, extra: Record<string, unknown> = {}) =>
    parseGame({ id, status: 'started', variant: 'standard', players: { sente: { user: { name: sente } }, gote: { user: { name: gote } } }, ...extra });
  it('強い人の対局だけ・本将棋の対局中だけ・同じ対局は 1 つ・強い人のレーティングの高い順', () => {
    const list = collectStrongGames(players, [
      game('g1', 'someone', 'wakao'),
      game('g2', 'beniiro', 'other'),
      game('g2', 'beniiro', 'other'),
      game('g3', 'a', 'b'),
      game('g4', 'Wakao', 'x', { status: 'resign' }),
      game('g5', 'Beniiro', 'x', { variant: 'minishogi' }),
    ]);
    expect(list.map((x) => x.game.id)).toEqual(['g2', 'g1']);
    expect(list[1].strong.map((p) => p.name)).toEqual(['Wakao']);
  });
});
