// Lishogi の強い人の一覧（リアルタイム戦のレーティング上位）。
// Lishogi のこの一覧はブラウザから直接は読めない（CORS がない）ので、サーバーが代わりに読み、10 分覚えておく
export const TOP_URL = 'https://lishogi.org/player/top/100/realTime';
export const TOP_TTL = 600; // 秒

export interface TopPlayer { id: string; name: string; rating: number; title: string | null }

// Lishogi の答え（{ users: [...] }）を、画面で使う形にする。読めないものは飛ばす
export function parseTop(raw: unknown): TopPlayer[] {
  const users = (raw as { users?: unknown })?.users;
  if (!Array.isArray(users)) return [];
  const out: TopPlayer[] = [];
  for (const u of users as { id?: unknown; username?: unknown; title?: unknown; perfs?: { realTime?: { rating?: unknown } } }[]) {
    const rating = u?.perfs?.realTime?.rating;
    if (typeof u?.id !== 'string' || !/^[a-z0-9_-]{1,40}$/i.test(u.id) || typeof rating !== 'number') continue;
    out.push({ id: u.id.toLowerCase(), name: typeof u.username === 'string' ? u.username.slice(0, 40) : u.id, rating, title: typeof u.title === 'string' ? u.title.slice(0, 8) : null });
  }
  return out;
}

let memo: { at: number; players: TopPlayer[] } | null = null;

export async function topPlayers(now = Date.now(), fetcher: typeof fetch = fetch): Promise<TopPlayer[]> {
  if (memo && now - memo.at < TOP_TTL * 1000) return memo.players;
  const res = await fetcher(TOP_URL, { headers: { Accept: 'application/json', 'User-Agent': 'machikado-shogi (watch top players)' } });
  if (!res.ok) {
    if (memo) return memo.players; // 読めなければ前のものを使う
    throw new Error(`lishogi ${res.status}`);
  }
  const players = parseTop(await res.json());
  if (!players.length && memo) return memo.players;
  memo = { at: now, players };
  return players;
}

export function resetTopMemo() { memo = null; }
