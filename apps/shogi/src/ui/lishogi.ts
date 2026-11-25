// Lishogi（lishogi.org、無料でオープンソースの将棋サイト）の対局を読む。
// API は誰でも使え、ブラウザから直接呼べる（CORS で許されている）。ログインはいらない。
//  - 強い人：このアプリのサーバーの /api/lishogi/top（Lishogi の上位 100 人を 10 分覚えておく）
//  - いま対局中か：/api/users/status 、その人のいまの対局：/api/user/<id>/current-game
//  - 1 局の今の手：/game/export/<id>（対局中も手が進む。数秒ごとに読みにいく）

export const LISHOGI = 'https://lishogi.org';

export interface LishogiPlayer { name: string; rating: number | null; title: string | null; ai: number | null }
export interface LishogiGame {
  id: string;
  variant: string;
  status: string; // started・mate・resign・outoftime・draw など
  winner: 'sente' | 'gote' | null;
  rated: boolean;
  players: { sente: LishogiPlayer; gote: LishogiPlayer };
  initialSfen: string | null; // 駒落ちなど、平手でないときのはじめの局面
  moves: string[]; // USI
  clock: { initial: number; byoyomi: number; increment: number; periods: number } | null;
  lastMoveAt: number | null;
  createdAt: number | null;
}

// 429（使いすぎ）のときに投げる。しばらく待ってから読み直す
export class RateLimited extends Error {}

type RawPlayer = { user?: { name?: string; title?: string }; rating?: number; aiLevel?: number };
type Raw = {
  id: string; variant?: string; status?: string; winner?: string; rated?: boolean; initialSfen?: string; moves?: string;
  players?: { sente?: RawPlayer; gote?: RawPlayer }; clock?: { initial?: number; byoyomi?: number; increment?: number; periods?: number }; lastMoveAt?: number; createdAt?: number;
};

function player(r: RawPlayer | undefined): LishogiPlayer {
  const ai = typeof r?.aiLevel === 'number' ? r.aiLevel : null;
  return {
    name: r?.user?.name ?? (ai != null ? `コンピューター（レベル ${ai}）` : '名無し'),
    rating: typeof r?.rating === 'number' ? r.rating : null,
    title: r?.user?.title ?? null,
    ai,
  };
}

export function parseGame(r: Raw): LishogiGame {
  return {
    id: r.id,
    variant: r.variant ?? 'standard',
    status: r.status ?? 'started',
    winner: r.winner === 'sente' || r.winner === 'gote' ? r.winner : null,
    rated: !!r.rated,
    players: { sente: player(r.players?.sente), gote: player(r.players?.gote) },
    initialSfen: r.initialSfen ?? null,
    moves: (r.moves ?? '').split(/\s+/).filter(Boolean),
    clock: r.clock ? { initial: r.clock.initial ?? 0, byoyomi: r.clock.byoyomi ?? 0, increment: r.clock.increment ?? 0, periods: r.clock.periods ?? 0 } : null,
    lastMoveAt: typeof r.lastMoveAt === 'number' ? r.lastMoveAt : null,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : null,
  };
}

async function get(path: string, accept: string): Promise<Response> {
  const res = await fetch(LISHOGI + path, { headers: { Accept: accept }, cache: 'no-store' });
  if (res.status === 429) throw new RateLimited('Lishogi が混んでいます');
  if (!res.ok) throw new Error(res.status === 404 ? '対局が見つかりません' : `Lishogi から読めませんでした（${res.status}）`);
  return res;
}

// 強い人（Lishogi のリアルタイム戦のレーティング上位）。一覧はこのアプリのサーバーが代わりに読む
export interface TopPlayer { id: string; name: string; rating: number; title: string | null }
export interface StrongGame { game: LishogiGame; strong: TopPlayer[] }

export async function fetchTopPlayers(base = import.meta.env.BASE_URL): Promise<TopPlayer[]> {
  const res = await fetch(`${base}api/lishogi/top`);
  if (!res.ok) throw new Error(`強い人の一覧を読めませんでした（${res.status}）`);
  return ((await res.json()) as { players: TopPlayer[] }).players;
}

// いま対局中の人（一度に 100 人まで）
export async function playingIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const res = await get(`/api/users/status?ids=${ids.slice(0, 100).map(encodeURIComponent).join(',')}`, 'application/json');
  const list = (await res.json()) as { id: string; playing?: boolean }[];
  return new Set(list.filter((u) => u.playing).map((u) => u.id.toLowerCase()));
}

// その人のいまの対局（対局中でなければ、最後の対局）
export async function currentGame(userId: string): Promise<LishogiGame> {
  const res = await get(`/api/user/${encodeURIComponent(userId)}/current-game`, 'application/json');
  return parseGame((await res.json()) as Raw);
}

// 強い人が指している対局だけを集める（本将棋・対局中）。強い人のレーティングの高い順
export function collectStrongGames(players: TopPlayer[], games: LishogiGame[]): StrongGame[] {
  const byName = new Map(players.map((p) => [p.name.toLowerCase(), p]));
  const seen = new Set<string>();
  const out: StrongGame[] = [];
  for (const g of games) {
    if (seen.has(g.id) || g.variant !== 'standard' || g.status !== 'started') continue;
    seen.add(g.id);
    const strong = [g.players.sente, g.players.gote].map((p) => byName.get(p.name.toLowerCase())).filter((p): p is TopPlayer => !!p);
    if (strong.length) out.push({ game: g, strong });
  }
  const top = (x: StrongGame) => Math.max(...x.strong.map((p) => p.rating));
  return out.sort((a, b) => top(b) - top(a));
}

export async function strongLiveGames(players: TopPlayer[]): Promise<StrongGame[]> {
  const now = await playingIds(players.map((p) => p.id));
  const ids = players.filter((p) => now.has(p.id)).slice(0, 12).map((p) => p.id); // 読みすぎないよう 12 人まで
  const games = await Promise.all(ids.map((id) => currentGame(id).catch(() => null)));
  return collectStrongGames(players, games.filter((g): g is LishogiGame => !!g));
}

export async function fetchGame(id: string): Promise<LishogiGame> {
  const res = await get(`/game/export/${encodeURIComponent(id)}?clocks=false&evals=false`, 'application/json');
  return parseGame((await res.json()) as Raw);
}

// URL や ID から対局の ID（8 文字）を取り出す。例：https://lishogi.org/AbCd1234 、 https://lishogi.org/AbCd1234/gote
export function gameIdOf(input: string): string | null {
  const s = input.trim();
  const m = s.match(/lishogi\.org\/(?:game\/export\/)?([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?(?:[/?#].*)?$/) ?? s.match(/^([A-Za-z0-9]{8})(?:[A-Za-z0-9]{4})?$/);
  return m ? m[1] : null;
}

export function playerLabel(p: LishogiPlayer): string {
  return `${p.title ? `${p.title} ` : ''}${p.name}${p.rating != null ? `（${p.rating}）` : ''}`;
}

export function statusText(g: LishogiGame): string {
  const win = g.winner === 'sente' ? '先手の勝ち' : g.winner === 'gote' ? '後手の勝ち' : '';
  switch (g.status) {
    case 'started': case 'created': return '対局中';
    case 'mate': return `詰み。${win}`;
    case 'resign': return `投了。${win}`;
    case 'outoftime': case 'timeout': return `時間切れ。${win}`;
    case 'draw': return '引き分け';
    case 'repetition': return win ? `千日手。${win}` : '千日手で引き分け';
    case 'impasse27': return `入玉宣言。${win || '引き分け'}`;
    case 'perpetualCheck': return `連続王手の千日手。${win}`;
    case 'aborted': return '対局は中止されました';
    case 'noStart': return '対局は始まりませんでした';
    default: return win ? `終局。${win}` : '終局';
  }
}

// 始まってからの時間（一覧に出す。一覧の手数は少し前のものなので、手数のかわりに使う）
export function startedText(g: LishogiGame, now = Date.now()): string {
  if (g.createdAt == null) return '';
  const min = Math.max(0, Math.floor((now - g.createdAt) / 60000));
  return min < 1 ? 'いま始まった' : min < 60 ? `${min} 分前に開始` : `${Math.floor(min / 60)} 時間前に開始`;
}

export function clockText(g: LishogiGame): string {
  const c = g.clock;
  if (!c) return '';
  const parts = [c.initial ? `${Math.round(c.initial / 60)} 分` : '持ち時間なし'];
  if (c.byoyomi) parts.push(`秒読み ${c.byoyomi} 秒`);
  if (c.increment) parts.push(`1 手ごとに ${c.increment} 秒`);
  return parts.join('＋');
}
