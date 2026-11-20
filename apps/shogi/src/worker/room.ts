// 部屋（合言葉ごとに 1 つ）。局面と時計はここが正で、端末は手を送って結果を表示するだけ
import { DurableObject } from 'cloudflare:workers';
import { RateLimiter, act, checkTimeout, deadline, join, leaveLobby, newRoom, rematch, viewFor, type Room } from './logic';

const IDLE_MS = 15 * 60_000; // だれもいなくなってから片付けるまで
interface Attachment { token: string; seat: number }

export class RoomDO extends DurableObject<Env> {
  private room: Room | null = null;
  private limits = new Map<WebSocket, RateLimiter>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => { this.room = (await ctx.storage.get<Room>('room')) ?? null; });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/init' && req.method === 'POST') {
      if (this.room) return Response.json({ ok: false }, { status: 409 });
      const b = await req.json<{ code: string; rules: string; time: string }>();
      this.room = newRoom(b.code, b.rules, b.time, Date.now());
      await this.commit();
      return Response.json({ ok: true });
    }
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
      if (!this.room) return new Response('部屋が見つかりません', { status: 404 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const room = this.room;
    if (!room || typeof raw !== 'string' || raw.length > 1000) return ws.close(1008, 'bad message');
    let lim = this.limits.get(ws);
    if (!lim) { lim = new RateLimiter(10, 1000); this.limits.set(ws, lim); }
    if (!lim.allow(Date.now())) return ws.close(1008, '送信が多すぎます');
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return ws.close(1008, 'bad json'); }
    const me = ws.deserializeAttachment() as Attachment | null;
    const now = Date.now();

    if (msg.t === 'hello') {
      if (me) return;
      const r = join(room, typeof msg.token === 'string' ? msg.token : null, msg.name, now);
      if (!r.ok) { this.send(ws, { t: 'error', error: r.error, fatal: true }); return ws.close(1000, r.error); }
      for (const other of this.ctx.getWebSockets()) {
        const a = other.deserializeAttachment() as Attachment | null;
        if (other !== ws && a?.token === r.token) { other.serializeAttachment(null); other.close(1000, '別の画面で入りました'); }
      }
      ws.serializeAttachment({ token: r.token, seat: r.seat } satisfies Attachment);
      this.send(ws, { t: 'welcome', token: r.token, code: room.code });
      return this.commit();
    }
    if (!me) return this.send(ws, { t: 'error', error: '先に hello を送ってください' });

    switch (msg.t) {
      case 'move': case 'resign': case 'declare': {
        const r = act(room, me.seat, { type: msg.t, move: msg.move }, now);
        if (!r.ok) this.send(ws, { t: 'error', error: r.error });
        return this.commit();
      }
      case 'rematch': {
        const r = rematch(room, me.seat, now);
        if (!r.ok) return this.send(ws, { t: 'error', error: r.error });
        return this.commit();
      }
      case 'leave':
        if (room.sideOf.length < 2) { leaveLobby(room, me.seat); this.reseat(); }
        ws.serializeAttachment(null);
        ws.close(1000, 'bye');
        return this.commit();
      case 'ping':
        return this.send(ws, { t: 'pong' });
    }
  }

  async webSocketClose(ws: WebSocket) { await this.disconnected(ws); }
  async webSocketError(ws: WebSocket) { await this.disconnected(ws); }

  private async disconnected(ws: WebSocket) {
    this.limits.delete(ws);
    const me = ws.deserializeAttachment() as Attachment | null;
    const room = this.room;
    if (!me || !room) return;
    if (this.ctx.getWebSockets().some((o) => o !== ws && (o.deserializeAttachment() as Attachment | null)?.token === me.token)) return;
    if (room.sideOf.length < 2) { leaveLobby(room, me.seat); this.reseat(); }
    else if (room.seats[me.seat]) { room.seats[me.seat].connected = false; room.version++; }
    await this.commit();
  }

  private reseat() {
    const room = this.room!;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a) continue;
      const seat = room.seats.findIndex((s) => s.token === a.token);
      if (seat >= 0 && seat !== a.seat) ws.serializeAttachment({ ...a, seat });
    }
  }

  // 時間切れの判定と、だれもいない部屋の片付け
  async alarm() {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    const anyone = room.seats.some((s) => s.connected);
    const idleSince = room.endedAt ?? room.createdAt;
    if (!anyone && now - idleSince > IDLE_MS && (room.result || room.sideOf.length < 2)) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    checkTimeout(room, now);
    await this.commit();
  }

  private async commit() {
    const room = this.room;
    if (!room) return;
    await this.ctx.storage.put('room', room);
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a) this.send(ws, viewFor(room, a.seat, now));
    }
    const d = deadline(room);
    const cleanup = now + IDLE_MS + 1000;
    await this.ctx.storage.setAlarm(d != null ? Math.min(d + 50, cleanup) : cleanup);
  }

  private send(ws: WebSocket, msg: unknown) {
    try { ws.send(JSON.stringify(msg)); } catch { /* 切れている */ }
  }
}
