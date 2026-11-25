// Worker の入口。/api/* だけを処理し、ほかは静的ファイル（画面）を返す
import { RULESETS } from '../engine/rules';
import { TIME_RULES, isCode, randomCode } from './logic';
import { TOP_TTL, topPlayers } from './lishogi-top';

export { RoomDO } from './room';

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function limited(req: Request, env: Env): Promise<boolean> {
  if (!env.API_LIMIT) return false;
  const ip = req.headers.get('CF-Connecting-IP') ?? 'local';
  const { success } = await env.API_LIMIT.limit({ key: ip });
  return !success;
}
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('Origin');
  return !origin || new URL(origin).host === new URL(req.url).host;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (!sameOrigin(req)) return json({ error: 'forbidden' }, 403);

    // Lishogi の強い人の一覧（観戦の画面で使う）
    if (url.pathname === '/api/lishogi/top' && req.method === 'GET') {
      try {
        const players = await topPlayers();
        return Response.json({ players }, { headers: { 'Cache-Control': `public, max-age=${TOP_TTL}` } });
      } catch {
        return json({ error: 'Lishogi から読めませんでした' }, 502);
      }
    }

    // 合言葉の部屋を作る
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      if (await limited(req, env)) return json({ error: '少し待ってからもう一度お試しください' }, 429);
      let b: { rules?: unknown; time?: unknown };
      try { b = await req.json(); } catch { return json({ error: '形が正しくありません' }, 400); }
      if (typeof b.rules !== 'string' || !(b.rules in RULESETS) || !TIME_RULES.some((t) => t.id === b.time)) return json({ error: '盤か持ち時間が正しくありません' }, 400);
      for (let i = 0; i < 5; i++) {
        const code = randomCode();
        const r = await env.ROOM.get(env.ROOM.idFromName(code)).fetch('https://room/init', { method: 'POST', body: JSON.stringify({ code, rules: b.rules, time: b.time }) });
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
