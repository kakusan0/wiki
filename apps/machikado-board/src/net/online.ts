// オンライン対戦の接続。切れたら自動でつなぎ直し、同じ席に戻る
import type { Action, CpuLevel, Mode } from '../game/state';

export type { RoomView } from '../worker/logic';
import type { RoomView } from '../worker/logic';

export interface OnlineHandlers {
  onView(v: RoomView): void;
  onEmote(seat: number, id: number): void;
  onError(msg: string, fatal: boolean): void;
  onStatus(s: 'connecting' | 'open' | 'closed'): void;
}

const KEY = 'machikado-board/online-v1';
interface Saved { code: string; token: string }

export function savedSession(): Saved | null {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
}
function saveSession(s: Saved | null) {
  try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* 保存できなくても遊べる */ }
}

async function post(path: string, body: unknown): Promise<{ code?: string; error?: string }> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await r.json();
  } catch {
    return { error: 'サーバーにつながりません' };
  }
}
// cpu：空いた席に入る CPU の強さ
export const findMatch = (mapId: string, mode: Mode, cpu: CpuLevel) => post(import.meta.env.BASE_URL + 'api/match', { mapId, mode, cpu });
export const createRoom = (mapId: string, mode: Mode, cpu: CpuLevel) => post(import.meta.env.BASE_URL + 'api/rooms', { mapId, mode, cpu });

export class OnlineClient {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private retry = 0;
  private ping: number | undefined;
  emotes: string[] = [];

  constructor(public code: string, private name: string, private h: OnlineHandlers) {}

  connect() {
    this.closedByUser = false;
    this.h.onStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${import.meta.env.BASE_URL}api/rooms/${this.code}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const saved = savedSession();
      ws.send(JSON.stringify({ t: 'hello', name: this.name, token: saved?.code === this.code ? saved.token : null }));
      this.h.onStatus('open');
      window.clearInterval(this.ping);
      this.ping = window.setInterval(() => this.raw({ t: 'ping' }), 25_000);
    };
    ws.onmessage = (e) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.t === 'welcome') {
        saveSession({ code: this.code, token: String(m.token) });
        this.emotes = (m.emotes as string[]) ?? [];
      } else if (m.t === 'room') this.h.onView(m as unknown as RoomView);
      else if (m.t === 'emote') this.h.onEmote(Number(m.seat), Number(m.id));
      else if (m.t === 'error') {
        if (m.fatal) { this.closedByUser = true; saveSession(null); }
        this.h.onError(String(m.error), !!m.fatal);
      }
    };
    ws.onclose = () => {
      window.clearInterval(this.ping);
      if (this.ws !== ws) return;
      this.h.onStatus('closed');
      if (this.closedByUser) return;
      // つなぎ直す（だんだん間をあける）
      const wait = Math.min(10_000, 500 * 2 ** this.retry++);
      window.setTimeout(() => { if (!this.closedByUser) this.connect(); }, wait);
    };
  }

  private raw(m: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }
  act(action: Action) { this.raw({ t: 'act', action }); }
  start() { this.raw({ t: 'start' }); }
  emote(id: number) { this.raw({ t: 'emote', id }); }

  leave() {
    this.closedByUser = true;
    this.raw({ t: 'leave' });
    saveSession(null);
    window.clearInterval(this.ping);
    this.ws?.close();
    this.ws = null;
  }
}
