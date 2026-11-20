// サイトの入口の Worker：/<作品>/… を見て、作品の Worker（または画面のファイル）に渡す。
// 作品のサーバーのコードは、それぞれのリポジトリにあった形のまま使う（頭の /<作品> を外して渡す）。
import { strip, fixResponse, scopedAssets, type Fetcher } from './prefix';
import shogi, { RoomDO as ShogiRoom } from '../apps/shogi/src/worker/index';
import hanafuda, { RoomDO as HanafudaRoom } from '../apps/hanafuda/src/worker/index';
import board, { RoomDO as BoardRoom, MatchmakerDO as BoardMatchmaker } from '../apps/machikado-board/src/worker/index';
import netspeed from '../apps/netspeed/src/worker/index';
import truck from '../apps/truck/src/worker/index';
import qrOrder from '../apps/qr-order/src/index';

// Durable Objects：3 作品とも RoomDO という名前なので、作品ごとの名前で出す
export { ShogiRoom, HanafudaRoom, BoardRoom, BoardMatchmaker };

type AnyEnv = Record<string, unknown> & { ASSETS: Fetcher };
type Handler = { fetch(req: Request, env: never, ctx: ExecutionContext): Response | Promise<Response>; scheduled?(c: ScheduledController, env: never, ctx: ExecutionContext): unknown };

interface App {
  /** 作品の Worker。ないものは画面のファイルだけ */
  worker?: Handler;
  /** 作品が使う名前に付け替えた env */
  env?(env: AnyEnv): Record<string, unknown>;
  /** 見つからない画面を作品の index.html にするか（画面だけで動く作品） */
  spa: boolean;
  /** 先にファイルを探し、なければ作品の Worker に渡す（QR オーダーは元からこの順） */
  assetsFirst?: boolean;
}

const APPS: Record<string, App> = {
  wiki: { spa: false },
  'train-sim': { spa: true },
  'medal-pusher': { spa: true },
  truck: { worker: truck as Handler, spa: true, env: (e) => ({ DB: e.TRUCK_DB }) },
  shogi: { worker: shogi as Handler, spa: true, env: (e) => ({ ROOM: e.SHOGI_ROOM, API_LIMIT: e.SHOGI_LIMIT }) },
  hanafuda: { worker: hanafuda as Handler, spa: true, env: (e) => ({ ROOM: e.HANAFUDA_ROOM, API_LIMIT: e.HANAFUDA_LIMIT }) },
  'machikado-board': { worker: board as Handler, spa: true, env: (e) => ({ ROOM: e.BOARD_ROOM, MATCHMAKER: e.BOARD_MATCH, API_LIMIT: e.BOARD_LIMIT, FAST: e.BOARD_FAST, MAX_ROUNDS: e.BOARD_MAX_ROUNDS }) },
  netspeed: {
    worker: netspeed as Handler, spa: true,
    env: (e) => ({
      DB: e.NETSPEED_DB, TZ_OFFSET_MIN: e.NETSPEED_TZ_OFFSET_MIN, RETAIN_DAYS: e.NETSPEED_RETAIN_DAYS,
      INGEST_TOKEN: e.NETSPEED_INGEST_TOKEN, VIEW_PASSWORD: e.NETSPEED_VIEW_PASSWORD, SESSION_SECRET: e.NETSPEED_SESSION_SECRET,
    }),
  },
  // QR オーダーはシークレットの名前がほかとぶつからないので、そのまま渡す（DB だけ付け替える）
  'qr-order': { worker: qrOrder as unknown as Handler, spa: false, assetsFirst: true, env: (e) => ({ ...e, DB: e.QR_DB, BASE_PATH: '/qr-order' }) },
};
export const APP_IDS = Object.keys(APPS);

/** 作品ごとの env：作品の名前に付け替えたものと、作品のフォルダーだけを見る ASSETS */
function appEnv(id: string, env: AnyEnv): Record<string, unknown> {
  const app = APPS[id];
  return { ...(app.env ? app.env(env) : {}), ASSETS: scopedAssets(env.ASSETS, `/${id}`, app.spa) };
}

export default {
  async fetch(req: Request, env: AnyEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const seg = url.pathname.split('/')[1] ?? '';
    if (url.pathname === '/' || url.pathname === '') return Response.redirect(new URL('/wiki/', url).toString(), 302);
    const app = APPS[seg];
    if (!app) return env.ASSETS.fetch(req); // 404 のページなど
    const base = `/${seg}`;
    // /truck → /truck/（作品の中の相対のパスが正しく効くように）
    if (url.pathname === base) { url.pathname = `${base}/`; return Response.redirect(url.toString(), 301); }
    const e = appEnv(seg, env);
    const read = req.method === 'GET' || req.method === 'HEAD';
    if (!app.worker) return read ? (e.ASSETS as Fetcher).fetch(strip(req, base)) : new Response('method not allowed', { status: 405 });
    if (app.assetsFirst && read) {
      const file = await (e.ASSETS as Fetcher).fetch(strip(req, base));
      if (file.status !== 404) return file;
    }
    const res = await app.worker.fetch(strip(req, base), e as never, ctx);
    return fixResponse(res, base);
  },
  async scheduled(c: ScheduledController, env: AnyEnv, ctx: ExecutionContext): Promise<void> {
    // cron の書き方で、どの作品の定期の仕事かを決める（wrangler.jsonc の triggers と合わせる）
    if (c.cron === '17 18 * * *') await netspeed.scheduled?.(c, appEnv('netspeed', env) as never);
    else if (c.cron === '23 * * * *') await (qrOrder as unknown as Handler).scheduled?.(c, appEnv('qr-order', env) as never, ctx);
  },
};
