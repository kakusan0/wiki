// Cloudflare Worker の入口：/api/* は荷物の記録置き場、ほかはビルドした画面をそのまま配信する
import { handle, type Env } from './link';

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
};
