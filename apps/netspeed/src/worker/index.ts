import { handle, cleanup, ensureSchema, Env } from './app';

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env);
  },
  async scheduled(_c: unknown, env: Env): Promise<void> {
    await ensureSchema(env.DB);
    await cleanup(env.DB, Math.floor(Date.now() / 1000), Number(env.RETAIN_DAYS ?? 90));
  },
};
