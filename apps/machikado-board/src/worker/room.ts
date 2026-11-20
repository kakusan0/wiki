// 部屋（合言葉ごとに 1 つ）。ゲームの進行はここが正で、端末は操作を送って結果を表示するだけ
import { DurableObject } from 'cloudflare:workers';
import type { Mode } from '../game/state';
import {
  EMOTES, RateLimiter, act, canRequestStart, join, leaveLobby, newRoom, planWake, shouldAutoStart, start, viewFor, wake,
  type Room,
} from './logic';

const IDLE_MS = 10 * 60_000; // だれもいなくなってから片付けるまで
interface Attachment { token: string; seat: number }

export class RoomDO extends DurableObject<Env> {
  private room: Room | null = null;
  private limits = new Map<WebSocket, RateLimiter>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.room = (await ctx.storage.get<Room>('room')) ?? null;
    });
  }

  private get fast() { return (this.env.FAST as string) === '1'; }
  private now() { return Date.now(); }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    // 部屋を作る（Worker・相手探しから呼ばれる）
    if (url.pathname === '/init' && req.method === 'POST') {
      if (this.room) return Response.json({ ok: false }, { status: 409 });
      const b = await req.json<{ code: string; mapId: string; mode: Mode; isPrivate: boolean }>();
      this.room = newRoom(b.code, b.mapId, b.mode, b.isPrivate, this.now());
      await this.save();
      await this.schedule();
      return Response.json({ ok: true });
    }
    // 相手探しから、まだ入れるかを聞かれる
    if (url.pathname === '/status') {
      const r = this.room;
      const open = !!r && !r.game && !r.endedAt && !r.isPrivate && r.seats.length < 4;
      return Response.json({ open, players: r?.seats.length ?? 0, mapId: r?.mapId, mode: r?.mode });
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
    if (!room || typeof raw !== 'string' || raw.length > 2000) return ws.close(1008, 'bad message');
    let lim = this.limits.get(ws);
    if (!lim) { lim = new RateLimiter(10, 1000); this.limits.set(ws, lim); }
    if (!lim.allow(this.now())) return ws.close(1008, '送信が多すぎます');
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return ws.close(1008, 'bad json'); }
    const me = ws.deserializeAttachment() as Attachment | null;
    const now = this.now();

    if (msg.t === 'hello') {
      if (me) return;
      const r = join(room, typeof msg.token === 'string' ? msg.token : null, msg.name, now);
      if (!r.ok) { this.send(ws, { t: 'error', error: r.error, fatal: true }); return ws.close(1000, r.error); }
      // 同じ席の古い接続は閉じる（別のタブなど）
      for (const other of this.ctx.getWebSockets()) {
        const a = other.deserializeAttachment() as Attachment | null;
        if (other !== ws && a?.token === r.token) { other.serializeAttachment(null); other.close(1000, '別の画面で入りました'); }
      }
      ws.serializeAttachment({ token: r.token, seat: r.seat } satisfies Attachment);
      this.send(ws, { t: 'welcome', token: r.token, seat: r.seat, code: room.code, emotes: EMOTES });
      room.version++;
      // 相手探しの部屋で 4 人そろったら、すぐ始める
      if (shouldAutoStart(room, now)) this.begin();
      return this.commit();
    }
    if (!me) return this.send(ws, { t: 'error', error: '先に hello を送ってください' });

    switch (msg.t) {
      case 'start':
        if (!canRequestStart(room, me.token, now)) return this.send(ws, { t: 'error', error: 'いまは始められません' });
        this.begin();
        return this.commit();
      case 'act': {
        const r = act(room, me.seat, msg.action as never, now);
        if (!r.ok) return this.send(ws, { t: 'error', error: r.error, version: room.version });
        return this.commit();
      }
      case 'emote': {
        const id = Number(msg.id);
        if (!Number.isInteger(id) || id < 0 || id >= EMOTES.length) return;
        return this.broadcastRaw({ t: 'emote', seat: me.seat, id });
      }
      case 'leave':
        if (!room.game) { leaveLobby(room, me.seat); this.reseat(); }
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
    const still = this.ctx.getWebSockets().some((o) => o !== ws && (o.deserializeAttachment() as Attachment | null)?.token === me.token);
    if (still) return;
    if (!room.game) {
      // 始まる前に抜けたら席を空ける
      leaveLobby(room, me.seat);
      this.reseat();
    } else {
      room.seats[me.seat].connected = false;
      room.version++;
    }
    await this.commit();
  }

  // 始まる前に抜けた人がいると席の番号がずれるので、接続に付けた番号を付け直す
  private reseat() {
    const room = this.room!;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a) continue;
      const seat = room.seats.findIndex((s) => s.token === a.token);
      if (seat >= 0 && seat !== a.seat) ws.serializeAttachment({ ...a, seat });
    }
  }

  private begin() {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] | 0;
    const rounds = this.env.MAX_ROUNDS ? Number(this.env.MAX_ROUNDS) : undefined;
    start(this.room!, seed, this.now(), rounds);
  }

  // 時間になったら：自動で始める・CPU や時間切れの人の代わりに動かす・片付ける
  async alarm() {
    const room = this.room;
    if (!room) return;
    const now = this.now();
    const idleSince = room.endedAt ?? room.createdAt;
    if (!this.hasConnected() && now - idleSince > IDLE_MS && (room.endedAt || !room.game || now - (room.deadline ?? 0) > IDLE_MS)) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] | 0;
    const rounds = this.env.MAX_ROUNDS ? Number(this.env.MAX_ROUNDS) : undefined;
    wake(room, now, this.fast, rounds, seed);
    await this.commit();
  }

  private hasConnected() { return this.room?.seats.some((s) => !s.cpu && s.connected) ?? false; }

  private async commit() {
    await this.save();
    this.broadcast();
    await this.schedule();
  }

  private async save() {
    if (this.room) await this.ctx.storage.put('room', this.room);
  }

  private async schedule() {
    const room = this.room;
    if (!room) return;
    const now = this.now();
    const at = planWake(room, now, this.fast);
    await this.save();
    const cleanup = now + IDLE_MS + 1000;
    await this.ctx.storage.setAlarm(at != null ? Math.min(at, cleanup) : cleanup);
  }

  private broadcast() {
    const room = this.room;
    if (!room) return;
    const now = this.now();
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a) this.send(ws, viewFor(room, a.seat, now));
    }
  }

  private broadcastRaw(msg: unknown) {
    for (const ws of this.ctx.getWebSockets()) if (ws.deserializeAttachment()) this.send(ws, msg);
  }

  private send(ws: WebSocket, msg: unknown) {
    try { ws.send(JSON.stringify(msg)); } catch { /* 切れている */ }
  }
}
