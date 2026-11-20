// オンライン対戦：合言葉で部屋を作る・入る。山と手札はサーバーが持ち、ここは表示と送信だけ
import type { Action, Player } from '../game/koikoi';
import type { View } from '../game/view';
import type { Options } from '../game/yaku';
import type { RoomView } from '../worker/logic';
import { h } from './dom';
import type { Driver } from '../main';

export interface OnlineDriver extends Driver { mode: 'online' }
export const onlineState: { pendingCode: string | null } = { pendingCode: null };

interface Hooks {
  render: () => void;
  back: () => void;
  start: (make: (onView: (v: View) => void) => OnlineDriver) => void;
  opts: () => Options;
}

const SEAT_KEY = 'hanafuda/online-v1';
const NAME_KEY = 'hanafuda/name-v1';
const EMOTES = ['よし！', 'こいこい！', 'まいった', 'おみごと'];
const get = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const put = (k: string, v: unknown) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない */ } };

const entry = { code: '', error: '', busy: false, waiting: null as null | { code: string } };
let conn: Connection | null = null;

export function onlineEntry(hk: Hooks): HTMLElement {
  if (onlineState.pendingCode) {
    const code = onlineState.pendingCode;
    onlineState.pendingCode = null;
    history.replaceState(null, '', location.pathname + location.search.replace(/[?&]room=[^&]*/, '').replace(/^&/, '?'));
    connect(code, hk);
  }
  const name = h('input', { class: 'input', id: 'online-name', maxlength: '10', placeholder: 'なまえ（10 文字まで）', value: get<string>(NAME_KEY) ?? '' }) as HTMLInputElement;
  const saveName = () => { put(NAME_KEY, name.value.trim() || null); return name.value.trim(); };
  const top = (onBack: () => void) => h('header', { class: 'hud-top static' }, h('button', { class: 'btn sm ghost', onclick: onBack }, '← もどる'), h('b', {}, 'オンライン対戦'));

  if (entry.waiting) {
    const url = `${location.origin}${import.meta.env.BASE_URL}?room=${entry.waiting.code}`;
    return h('div', { class: 'title online' },
      top(() => { conn?.leave(); conn = null; entry.waiting = null; hk.render(); }),
      h('main', { class: 'title-main' },
        h('section', { class: 'panel center' },
          h('h2', {}, '相手を待っています…'),
          h('p', {}, '合言葉を相手に伝えてください。'),
          h('p', { class: 'room-code', 'data-code': entry.waiting.code }, entry.waiting.code),
          h('div', { class: 'btns' },
            h('button', { class: 'btn', onclick: (e: Event) => { void navigator.clipboard?.writeText(url).then(() => { (e.target as HTMLElement).textContent = 'コピーしました'; }); } }, '招待 URL をコピー'),
            'share' in navigator ? h('button', { class: 'btn', onclick: () => { void navigator.share({ title: '花札で勝負しよう', url }).catch(() => {}); } }, '共有') : null),
          h('p', { class: 'note' }, '相手が入ると、すぐに始まります。'),
          entry.error ? h('p', { class: 'error', role: 'alert' }, entry.error) : null)));
  }

  const saved = get<{ code: string; token: string }>(SEAT_KEY);
  const o = hk.opts();
  return h('div', { class: 'title online' },
    top(hk.back),
    h('main', { class: 'title-main' },
      h('section', { class: 'panel' }, h('h2', {}, 'なまえ'), name),
      saved ? h('section', { class: 'panel' },
        h('h2', {}, '対戦中の部屋'),
        h('p', {}, `合言葉 ${saved.code} の部屋に戻れます。`),
        h('button', { class: 'btn primary', onclick: () => connect(saved.code, hk, saveName()) }, '部屋に戻る')) : null,
      h('section', { class: 'panel' },
        h('h2', {}, '部屋を作る'),
        h('p', { class: 'note' }, `${o.months} か月勝負。役の決まりはタイトル画面の設定のとおりです。`),
        h('button', { class: 'btn big primary', id: 'create-room', disabled: entry.busy, onclick: async () => {
          entry.busy = true; entry.error = ''; hk.render();
          try {
            const r = await fetch(import.meta.env.BASE_URL + 'api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(hk.opts()) });
            const b = await r.json() as { code?: string; error?: string };
            if (!r.ok || !b.code) throw new Error(b.error ?? '部屋を作れませんでした');
            entry.busy = false;
            connect(b.code, hk, saveName());
          } catch (e) { entry.busy = false; entry.error = (e as Error).message || 'つながりませんでした'; hk.render(); }
        } }, '部屋を作る')),
      h('section', { class: 'panel' },
        h('h2', {}, '合言葉で入る'),
        h('input', { class: 'input code', id: 'join-code', maxlength: '6', placeholder: '合言葉（6 文字）', value: entry.code, autocapitalize: 'characters', oninput: (e: Event) => { entry.code = (e.target as HTMLInputElement).value.toUpperCase(); } }),
        h('button', { class: 'btn big primary', id: 'join-room', onclick: () => {
          const c = entry.code.trim().toUpperCase();
          if (!/^[A-Z0-9]{6}$/.test(c)) { entry.error = '合言葉は 6 文字です'; hk.render(); return; }
          connect(c, hk, saveName());
        } }, '入る')),
      entry.error ? h('p', { class: 'error', role: 'alert' }, entry.error) : null,
      h('p', { class: 'note' }, '知り合いどうしで合言葉を伝えあって対戦します。1 手の持ち時間は 30 秒。通信が切れても、同じ端末ならこの画面から戻れます。')));
}

function connect(code: string, hk: Hooks, name = get<string>(NAME_KEY) ?? '') {
  conn?.leave();
  entry.error = '';
  conn = new Connection(code, name, hk);
}

class Connection implements OnlineDriver {
  readonly mode = 'online' as const;
  me: Player = 0;
  names: [string, string] = ['先手', '後手'];
  private ws: WebSocket | null = null;
  private room: RoomView | null = null;
  private receivedAt = 0;
  private closed = false;
  private retry = 0;
  private started = false;
  private onView: ((v: View) => void) | null = null;
  private timer: number | null = null;
  private note = '';

  constructor(private code: string, private name: string, private hk: Hooks) { this.open(); }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${import.meta.env.BASE_URL}api/rooms/${this.code}/ws`);
    this.ws = ws;
    let heard = false;
    ws.onopen = () => {
      this.retry = 0;
      const saved = get<{ code: string; token: string }>(SEAT_KEY);
      ws.send(JSON.stringify({ t: 'hello', name: this.name, token: saved?.code === this.code ? saved.token : null }));
    };
    ws.onmessage = (e) => { heard = true; this.onMessage(JSON.parse(String(e.data))); };
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      if (!heard && !this.started && !entry.waiting) return this.fail('部屋が見つかりません。合言葉を確かめてください');
      this.note = '通信が切れました。つなぎ直しています…';
      setTimeout(() => { if (!this.closed) this.open(); }, Math.min(10_000, 500 * 2 ** this.retry++));
    };
  }

  private fail(error: string) {
    this.closed = true;
    this.ws?.close();
    entry.waiting = null;
    entry.error = error;
    if (conn === this) conn = null;
    if (get<{ code: string }>(SEAT_KEY)?.code === this.code) put(SEAT_KEY, null);
    if (!this.started) this.hk.render(); else this.note = error;
  }

  private onMessage(msg: { t: string; [k: string]: unknown }) {
    if (msg.t === 'welcome') { put(SEAT_KEY, { code: this.code, token: msg.token }); return; }
    if (msg.t === 'error') { if (msg.fatal) return this.fail(String(msg.error)); this.note = String(msg.error); return; }
    if (msg.t === 'emote') return this.bubble(msg.side as Player, Number(msg.id));
    if (msg.t !== 'state') return;
    const r = msg as unknown as RoomView;
    this.room = r;
    this.receivedAt = Date.now();
    this.note = '';
    if (r.waiting || !r.view || r.you == null) {
      entry.waiting = { code: this.code };
      this.hk.render();
      return;
    }
    this.me = r.you;
    this.names = r.names;
    if (r.view.phase === 'over' && !r.rematch[0] && !r.rematch[1]) put(SEAT_KEY, null);
    else put(SEAT_KEY, { code: this.code, token: get<{ token: string }>(SEAT_KEY)?.token });
    if (!this.started) {
      this.started = true;
      entry.waiting = null;
      this.hk.start((onView) => { this.onView = onView; return this; });
      this.timer = window.setInterval(() => { const el = document.querySelector('.hud-top .net'); if (el) el.textContent = this.status(); }, 500);
    }
    this.onView?.(r.view);
  }

  status(): string {
    const r = this.room;
    if (this.note) return this.note;
    if (!r?.view) return '';
    const opp = this.me === 0 ? 1 : 0;
    if (!r.connected[opp]) return '相手の通信が切れています';
    if (r.view.phase === 'over') return r.rematch[opp] ? '相手が「もう一局」を希望しています' : '';
    if (r.remain == null) return '';
    const left = Math.max(0, Math.ceil((r.remain - (Date.now() - this.receivedAt)) / 1000));
    const mine = r.view.turn === this.me || r.view.phase === 'roundEnd';
    return `${mine ? 'あなた' : '相手'}：のこり ${left} 秒`;
  }

  private bubble(side: Player, id: number) {
    const el = h('div', { class: `bubble ${side === this.me ? 'me' : 'opp'}` }, EMOTES[id] ?? '');
    document.querySelector('.game')?.append(el);
    setTimeout(() => el.remove(), 2200);
  }

  private sendMsg(m: unknown) { try { this.ws?.send(JSON.stringify(m)); } catch { /* 切れている */ } }
  send(a: Action) { this.sendMsg({ t: 'act', action: a }); }
  shown() {}
  emote(n: number) { this.sendMsg({ t: 'emote', id: n }); }
  rematch() { this.sendMsg({ t: 'rematch' }); }
  leave() {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    if (!this.started || this.room?.view?.phase === 'over') this.sendMsg({ t: 'leave' });
    this.ws?.close();
    if (conn === this) conn = null;
  }
}
