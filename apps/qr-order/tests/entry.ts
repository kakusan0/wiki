// テスト用の入口：サイトと同じく /qr-order/ の下で動かす（サイトの入口 worker/index.ts と同じ振り分け）
import app from '../src/index';
import { strip, scopedAssets, fixResponse, type Fetcher } from '../../../worker/prefix';

const BASE = '/qr-order';
type E = Record<string, unknown> & { ASSETS: Fetcher };
const handler = app as unknown as { fetch(r: Request, e: unknown, c: ExecutionContext): Promise<Response>; scheduled(c: ScheduledController, e: unknown, x: ExecutionContext): Promise<void> };
// public/ がそのまま根に置かれているので、/qr-order を外して読む
const assets = (env: E): Fetcher => ({ fetch: (r) => env.ASSETS.fetch(strip(r, BASE)) });

export default {
  async fetch(req: Request, env: E, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return new Response('not found', { status: 404 });
    const a = scopedAssets(assets(env), BASE, false);
    if (req.method === 'GET' || req.method === 'HEAD') {
      const res = await a.fetch(strip(req, BASE));
      if (res.status !== 404) return res;
    }
    const res = await handler.fetch(strip(req, BASE), { ...env, ASSETS: a, BASE_PATH: BASE }, ctx);
    return fixResponse(res, BASE);
  },
  scheduled: (c: ScheduledController, env: E, ctx: ExecutionContext) => handler.scheduled(c, { ...env, BASE_PATH: BASE }, ctx),
};
