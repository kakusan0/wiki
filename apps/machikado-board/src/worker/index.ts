// Worker の入口。/api/* だけを処理し、ほかは静的ファイル（ゲームの画面）を返す
import { MAPS } from '../game/maps';
import { isCode, randomCode } from './logic';

export { MatchmakerDO } from './matchmaker';
export { RoomDO } from './room';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function readOptions(req: Request): Promise<{ mapId: string; mode: 'easy' | 'normal' } | null> {
  try {
    const b = await req.json<{ mapId?: unknown; mode?: unknown }>();
    const mapId = MAPS.some((m) => m.id === b.mapId) ? (b.mapId as string) : null;
    const mode = b.mode === 'easy' || b.mode === 'normal' ? b.mode : null;
    return mapId && mode ? { mapId, mode } : null;
  } catch {
    return null;
  }
}

// 同じ IP から短い間に何度も部屋を作る・探すのを防ぐ
async function limited(req: Request, env: Env): Promise<boolean> {
  if (!env.API_LIMIT) return false;
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  const { success } = await env.API_LIMIT.limit({ key: ip });
  return !success;
}

// よそのサイトから勝手に呼ばれないよう、同じサイトからの呼び出しだけ受け付ける
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('Origin');
  return !origin || new URL(origin).host === new URL(req.url).host;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);

    // 相手を探す
    if (url.pathname === '/api/match' && req.method === 'POST') {
      if (await limited(req, env)) return json({ error: '少し待ってからもう一度お試しください' }, 429);
      const o = await readOptions(req);
      if (!o) return json({ error: 'マップかモードが正しくありません' }, 400);
      const mm = env.MATCHMAKER.get(env.MATCHMAKER.idFromName('global'));
      const r = await mm.fetch('https://mm/match', { method: 'POST', body: JSON.stringify(o) });
      return json(await r.json(), r.status);
    }

    // 合言葉の部屋を作る
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      if (await limited(req, env)) return json({ error: '少し待ってからもう一度お試しください' }, 429);
      const o = await readOptions(req);
      if (!o) return json({ error: 'マップかモードが正しくありません' }, 400);
      for (let i = 0; i < 5; i++) {
        const code = randomCode();
        const r = await env.ROOM.get(env.ROOM.idFromName(code)).fetch('https://room/init', {
          method: 'POST', body: JSON.stringify({ code, ...o, isPrivate: true }),
        });
        if (r.ok) return json({ code });
      }
      return json({ error: '部屋を作れませんでした' }, 503);
    }

    // 部屋に入る（WebSocket）
    const m = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]{6})\/ws$/);
    if (m && isCode(m[1])) {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ error: 'websocket only' }, 426);
      return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(new Request('https://room/ws', req));
    }
    return json({ error: 'not found' }, 404);
  },
} satisfies ExportedHandler<Env>;
