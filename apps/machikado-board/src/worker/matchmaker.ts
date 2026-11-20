// 相手探し（全体で 1 つ）。マップとモードごとに「いま人を集めている部屋」を 1 つ持ち、来た人をそこへ案内する
import { DurableObject } from 'cloudflare:workers';
import type { Mode } from '../game/state';
import { randomCode } from './logic';

export class MatchmakerDO extends DurableObject<Env> {
  async fetch(req: Request): Promise<Response> {
    const { mapId, mode } = await req.json<{ mapId: string; mode: Mode }>();
    const key = `open:${mapId}:${mode}`;
    const current = await this.ctx.storage.get<string>(key);
    if (current) {
      const st = await this.env.ROOM.get(this.env.ROOM.idFromName(current)).fetch('https://room/status');
      const s = await st.json<{ open: boolean }>();
      if (s.open) return Response.json({ code: current });
    }
    // 新しい部屋を作って、次の人もここへ案内する
    for (let i = 0; i < 5; i++) {
      const code = randomCode();
      const r = await this.env.ROOM.get(this.env.ROOM.idFromName(code)).fetch('https://room/init', {
        method: 'POST', body: JSON.stringify({ code, mapId, mode, isPrivate: false }),
      });
      if (r.ok) {
        await this.ctx.storage.put(key, code);
        return Response.json({ code });
      }
    }
    return Response.json({ error: '部屋を作れませんでした' }, { status: 503 });
  }
}
