// オンライン対戦：合言葉で部屋を作る・入る。局面と時計はサーバーが持ち、ここは表示と送信だけ
import { Game, type Result } from '../engine/game';
import type { Move } from '../engine/position';
import { RULESETS, type Ruleset } from '../engine/rules';
import type { RoomView, TimeRule } from '../worker/logic';
import { h } from './dom';

export interface OnlineSession {
  state(): { game: Game; you: 0 | 1; names: [string, string]; message: string; rematch: [boolean, boolean]; connected: [boolean, boolean] };
  send(m: Move): void;
  resign(): void;
  declare(): void;
  rematch(): void;
  leave(): void;
  clocks(): [string, string] | null;
}
export const onlineSession: { pendingCode: string | null } = { pendingCode: null };

interface Handlers {
  onStart: (o: OnlineSession) => void;
  onUpdate: (o: OnlineSession) => void;
  onTick: () => void;
  render: () => void;
}

const SEAT_KEY = 'shogi/online-v1'; // { code, token }
const NAME_KEY = 'shogi/name-v1';
const TIMES: { id: string; name: string }[] = [
  { id: 'b30', name: '秒読み 30 秒' },
  { id: 'm10b30', name: '10 分＋秒読み 30 秒' },
  { id: 'm5', name: '切れ負け 5 分' },
];
const RULE_NAMES: Record<Ruleset['id'], string> = { standard: '本将棋（9×9）', mini55: '5五将棋（5×5）', mini34: 'ミニ将棋（3×4）' };

const get = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const put = (k: string, v: unknown) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない */ } };

// 入口の画面の状態
const entry = { rules: 'standard' as Ruleset['id'], time: 'm10b30', code: '', error: '', busy: false, waiting: null as null | { code: string } };
let conn: Connection | null = null;

export function renderOnlineEntry(hd: Handlers): HTMLElement {
  if (onlineSession.pendingCode) {
    const code = onlineSession.pendingCode;
    onlineSession.pendingCode = null;
    history.replaceState(null, '', location.pathname);
    connect(code, hd);
  }
  const name = h('input', { class: 'input', id: 'online-name', maxlength: '10', placeholder: 'なまえ（10 文字まで）', value: get<string>(NAME_KEY) ?? '' }) as HTMLInputElement;
  const saveName = () => { put(NAME_KEY, name.value.trim() || null); return name.value.trim(); };

  if (entry.waiting) {
    const url = `${location.origin}${import.meta.env.BASE_URL}?room=${entry.waiting.code}`;
    return h('div', { class: 'online' },
      h('header', { class: 'top' }, h('button', { class: 'btn sm', onclick: () => { conn?.leave(); conn = null; entry.waiting = null; hd.render(); } }, '← もどる'), h('b', {}, 'オンライン対戦')),
      h('main', { class: 'panel online-wait' },
        h('h2', {}, '相手を待っています…'),
        h('p', {}, '合言葉を相手に伝えてください。'),
        h('p', { class: 'room-code', 'data-code': entry.waiting.code }, entry.waiting.code),
        h('div', { class: 'btns' },
          h('button', { class: 'btn', onclick: (e: Event) => { void navigator.clipboard?.writeText(url).then(() => { (e.target as HTMLElement).textContent = 'コピーしました'; }); } }, '招待 URL をコピー'),
          navigator.share ? h('button', { class: 'btn', onclick: () => { void navigator.share({ title: '将棋で対局しよう', url }).catch(() => {}); } }, '共有') : null),
        h('p', { class: 'note' }, '相手が入ると、振り駒で先手・後手を決めて始まります。'),
        entry.error ? h('p', { class: 'error', role: 'alert' }, entry.error) : null));
  }

  const saved = get<{ code: string; token: string }>(SEAT_KEY);
  const codeInput = h('input', { class: 'input code', id: 'join-code', maxlength: '6', placeholder: '合言葉（6 文字）', value: entry.code, autocapitalize: 'characters',
    oninput: (e: Event) => { entry.code = (e.target as HTMLInputElement).value.toUpperCase(); } }) as HTMLInputElement;
  return h('div', { class: 'online' },
    h('header', { class: 'top' }, h('button', { class: 'btn sm', onclick: () => { location.href = '/'; } }, '← もどる'), h('b', {}, 'オンライン対戦')),
    h('main', { class: 'online-entry' },
      h('section', { class: 'panel' },
        h('h2', {}, 'なまえ'), name),
      saved ? h('section', { class: 'panel' },
        h('h2', {}, '対局中の部屋'),
        h('p', {}, `合言葉 ${saved.code} の部屋に戻れます。`),
        h('button', { class: 'btn primary', onclick: () => connect(saved.code, hd, saveName()) }, '部屋に戻る')) : null,
      h('section', { class: 'panel' },
        h('h2', {}, '部屋を作る'),
        h('label', { class: 'field' }, '盤', h('select', { class: 'input', id: 'online-rules', onchange: (e: Event) => { entry.rules = (e.target as HTMLSelectElement).value as Ruleset['id']; } },
          (Object.keys(RULE_NAMES) as Ruleset['id'][]).map((id) => h('option', { value: id, selected: entry.rules === id }, RULE_NAMES[id])))),
        h('label', { class: 'field' }, '持ち時間', h('select', { class: 'input', id: 'online-time', onchange: (e: Event) => { entry.time = (e.target as HTMLSelectElement).value; } },
          TIMES.map((t) => h('option', { value: t.id, selected: entry.time === t.id }, t.name)))),
        h('button', { class: 'btn primary', id: 'create-room', disabled: entry.busy, onclick: async () => {
          entry.busy = true; entry.error = ''; hd.render();
          try {
            const r = await fetch(import.meta.env.BASE_URL + 'api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: entry.rules, time: entry.time }) });
            const b = await r.json() as { code?: string; error?: string };
            if (!r.ok || !b.code) throw new Error(b.error ?? '部屋を作れませんでした');
            entry.busy = false;
            connect(b.code, hd, saveName());
          } catch (e) { entry.busy = false; entry.error = (e as Error).message || 'つながりませんでした'; hd.render(); }
        } }, '部屋を作る')),
      h('section', { class: 'panel' },
        h('h2', {}, '合言葉で入る'),
        codeInput,
        h('button', { class: 'btn primary', id: 'join-room', onclick: () => {
          const c = entry.code.trim().toUpperCase();
          if (!/^[A-Z0-9]{6}$/.test(c)) { entry.error = '合言葉は 6 文字です'; hd.render(); return; }
          connect(c, hd, saveName());
        } }, '入る')),
      entry.error ? h('p', { class: 'error', role: 'alert' }, entry.error) : null,
      h('p', { class: 'note' }, '知り合いどうしで、合言葉を伝えあって対局します。通信が切れても、同じ端末ならこの画面から戻れます。')));
}

function connect(code: string, hd: Handlers, name = get<string>(NAME_KEY) ?? '') {
  conn?.leave();
  entry.error = '';
  conn = new Connection(code, name, hd);
}

// ---------- 接続 ----------
class Connection implements OnlineSession {
  private ws: WebSocket | null = null;
  private view: RoomView | null = null;
  private game: Game | null = null;
  private receivedAt = 0;
  private message = '';
  private closed = false;
  private retry = 0;
  private started = false;
  private tick: number | null = null;
  private lastResult: Result | null = null;

  constructor(private code: string, private name: string, private hd: Handlers) { this.open(); }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${import.meta.env.BASE_URL}api/rooms/${this.code}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      const saved = get<{ code: string; token: string }>(SEAT_KEY);
      ws.send(JSON.stringify({ t: 'hello', name: this.name, token: saved?.code === this.code ? saved.token : null }));
    };
    let heard = false;
    ws.onmessage = (e) => { heard = true; this.onMessage(JSON.parse(String(e.data))); };
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      if (!heard && !this.started && !entry.waiting) return this.fail('部屋が見つかりません。合言葉を確かめてください');
      // 始まる前に部屋が見つからない・満員のときは onMessage で closed にしてある。ほかは少し待ってつなぎ直す
      this.message = '通信が切れました。つなぎ直しています…';
      if (this.started) this.hd.onUpdate(this);
      const wait = Math.min(10_000, 500 * 2 ** this.retry++);
      setTimeout(() => { if (!this.closed) this.open(); }, wait);
    };
  }

  private fail(error: string) {
    this.closed = true;
    this.ws?.close();
    if (this.tick) clearInterval(this.tick);
    entry.waiting = null;
    entry.error = error;
    if (conn === this) conn = null;
    const saved = get<{ code: string }>(SEAT_KEY);
    if (saved?.code === this.code) put(SEAT_KEY, null);
    if (this.started) { this.message = error; this.hd.onUpdate(this); } else this.hd.render();
  }

  private onMessage(msg: { t: string; [k: string]: unknown }) {
    if (msg.t === 'welcome') {
      put(SEAT_KEY, { code: this.code, token: msg.token });
      return;
    }
    if (msg.t === 'error') {
      if (msg.fatal) return this.fail(String(msg.error));
      this.message = String(msg.error);
      if (this.started) this.hd.onUpdate(this);
      return;
    }
    if (msg.t !== 'state') return;
    const v = msg as unknown as RoomView;
    this.view = v;
    this.receivedAt = Date.now();
    this.game = Game.fromMoves(RULESETS[v.rules], RULESETS[v.rules].start, v.moves);
    if (v.result) this.game.result = v.result;
    // 対局の終わり・新しい対局で、メッセージを変える
    if (v.result && !this.lastResult) put(SEAT_KEY, null);
    if (!v.result && this.lastResult) { put(SEAT_KEY, { code: this.code, token: get<{ token: string }>(SEAT_KEY)?.token }); }
    this.lastResult = v.result;
    this.message = '';
    if (!v.connected[0] || !v.connected[1]) {
      if (!v.waiting && v.you != null && !v.connected[v.you === 0 ? 1 : 0] && !v.result) this.message = '相手の通信が切れています。戻ってくるのを待っています…';
    }
    if (v.result && (v.rematch[0] || v.rematch[1])) this.message = v.you != null && v.rematch[v.you] ? '相手の返事を待っています…' : '相手が「もう一局」を希望しています';
    if (v.waiting || v.you == null) {
      entry.waiting = { code: this.code };
      this.hd.render();
      return;
    }
    if (!this.tick) this.tick = window.setInterval(() => this.hd.onTick(), 250);
    if (!this.started) { this.started = true; entry.waiting = null; this.hd.onStart(this); } else this.hd.onUpdate(this);
  }

  state() {
    const v = this.view!;
    return { game: this.game!, you: v.you!, names: v.names, message: this.message, rematch: v.rematch, connected: v.connected };
  }
  private sendMsg(m: unknown) { try { this.ws?.send(JSON.stringify(m)); } catch { /* 切れている */ } }
  send(m: Move) { this.sendMsg({ t: 'move', move: m }); }
  resign() { this.sendMsg({ t: 'resign' }); }
  declare() { this.sendMsg({ t: 'declare' }); }
  rematch() { this.sendMsg({ t: 'rematch' }); }
  leave() {
    if (this.closed) return;
    this.closed = true;
    if (this.tick) clearInterval(this.tick);
    if (!this.started || this.view?.result) this.sendMsg({ t: 'leave' });
    this.ws?.close();
    if (conn === this) conn = null;
  }
  clocks(): [string, string] | null {
    const v = this.view;
    if (!v || v.waiting) return null;
    const side = this.game!.pos.side;
    const spent = v.result ? 0 : v.elapsed + (Date.now() - this.receivedAt);
    return [0, 1].map((s) => fmt(v.time, v.remain[s], s === side ? spent : 0)) as [string, string];
  }
}

function fmt(t: TimeRule, remain: number, spent: number): string {
  const left = remain - spent;
  if (left > 0 || t.byoyomi === 0) {
    const sec = Math.max(0, Math.ceil(left / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }
  const by = Math.max(0, Math.ceil((t.byoyomi + left) / 1000));
  return `秒読み ${by}`;
}
