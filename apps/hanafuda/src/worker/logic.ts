// オンライン対戦の部屋（Cloudflare に依存しない純粋な処理）。山と手札はここだけが知っていて、各自には見えるぶんだけ送る
import { autoAction } from '../game/auto';
import { apply, newGame, type Action, type Player, type State } from '../game/koikoi';
import { viewOf, type View } from '../game/view';
import { DEFAULT_OPTIONS, type Options } from '../game/yaku';

export const TURN_MS = 30_000; // 1 手の持ち時間
export const NEXT_MS = 45_000; // 月の終わりに次へ進むまで

export interface Seat { token: string; name: string; connected: boolean }
export interface Room {
  code: string;
  opts: Options;
  seats: Seat[];
  sideOf: Player[]; // 席 → 0 か 1
  state: State | null;
  deadline: number | null;
  rematch: [boolean, boolean];
  version: number;
  createdAt: number;
  endedAt: number | null;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const randomCode = (rand: () => number = Math.random) => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)]).join('');
export const isCode = (s: string) => /^[A-HJ-NP-Z2-9]{6}$/.test(s);
export function randomToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').trim();
  if (!s || [...s].length > 10 || /https?:|www\.|[<>]/i.test(s)) return null;
  return s;
}

// 部屋を作る人が選べる設定だけを受け取る
export function cleanOptions(raw: unknown): Options | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (![3, 6, 12].includes(o.months as number)) return null;
  const b = (k: keyof Options) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (DEFAULT_OPTIONS[k] as boolean));
  return { months: o.months as number, sakeAsKasu: b('sakeAsKasu'), drinks: b('drinks'), double7: b('double7'), koikoiDouble: b('koikoiDouble') };
}

export function newRoom(code: string, opts: Options, now: number): Room {
  return { code, opts, seats: [], sideOf: [], state: null, deadline: null, rematch: [false, false], version: 0, createdAt: now, endedAt: null };
}

const seed = () => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] | 0; };

export type JoinResult = { ok: true; seat: number; token: string } | { ok: false; error: string };
export function join(r: Room, token: string | null, name: unknown, now: number, rand: () => number = Math.random, makeToken = randomToken, makeSeed = seed): JoinResult {
  const mine = token ? r.seats.findIndex((s) => s.token === token) : -1;
  if (mine >= 0) {
    r.seats[mine].connected = true;
    if (r.deadline != null) r.deadline = Math.max(r.deadline, now + 10_000); // 戻ってすぐ時間切れにならないように
    r.version++; return { ok: true, seat: mine, token: r.seats[mine].token }; }
  if (r.seats.length >= 2) return { ok: false, error: 'この部屋は満員です' };
  const t = makeToken();
  r.seats.push({ token: t, name: cleanName(name) ?? (r.seats.length ? 'あいて' : 'へやぬし'), connected: true });
  if (r.seats.length === 2) {
    r.sideOf = rand() < 0.5 ? [0, 1] : [1, 0];
    r.state = newGame(makeSeed(), r.opts);
    setDeadline(r, now);
  }
  r.version++;
  return { ok: true, seat: r.seats.length - 1, token: t };
}

export function leaveLobby(r: Room, seat: number) {
  if (r.state) return;
  r.seats.splice(seat, 1);
  r.version++;
}

function setDeadline(r: Room, now: number) {
  const s = r.state;
  r.deadline = !s || s.phase === 'over' ? null : now + (s.phase === 'roundEnd' ? NEXT_MS : TURN_MS);
  if (s?.phase === 'over') r.endedAt = now;
}

export type ActResult = { ok: true } | { ok: false; error: string };
export function act(r: Room, seat: number, a: unknown, now: number): ActResult {
  const s = r.state;
  if (!s) return { ok: false, error: '相手がまだ来ていません' };
  if (!isAction(a)) return { ok: false, error: '操作の形が正しくありません' };
  const p = r.sideOf[seat];
  const res = apply(s, p, a);
  if (!res.ok) return res;
  setDeadline(r, now);
  r.version++;
  return { ok: true };
}

function isAction(a: unknown): a is Action {
  if (!a || typeof a !== 'object') return false;
  const x = a as Record<string, unknown>;
  const int = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < 48;
  switch (x.type) {
    case 'play': return int(x.card) && (x.target === undefined || int(x.target));
    case 'pickDraw': return int(x.target);
    case 'koikoi': case 'stop': case 'next': return true;
    default: return false;
  }
}

// 時間切れ：代わりに手を指す（手番の人の、いちばん簡単な手）
export function checkTimeout(r: Room, now: number): boolean {
  const s = r.state;
  if (!s || r.deadline == null || now < r.deadline) return false;
  const a = autoAction(s);
  if (!a) return false;
  apply(s, s.turn, a);
  setDeadline(r, now);
  r.version++;
  return true;
}

export function rematch(r: Room, seat: number, now: number): ActResult {
  if (r.state?.phase !== 'over') return { ok: false, error: 'まだ対局中です' };
  r.rematch[seat] = true;
  if (r.rematch[0] && r.rematch[1]) {
    r.state = newGame(seed(), r.opts);
    r.rematch = [false, false];
    r.endedAt = null;
    setDeadline(r, now);
  }
  r.version++;
  return { ok: true };
}

export interface RoomView {
  t: 'state';
  code: string;
  opts: Options;
  waiting: boolean;
  you: Player | null;
  names: [string, string]; // 0・1 の名前
  connected: [boolean, boolean];
  view: View | null;
  remain: number | null; // 締め切りまで（ミリ秒）
  rematch: [boolean, boolean]; // 0・1 がもう一局を押したか
}

export function viewFor(r: Room, seat: number, now: number): RoomView {
  const names: [string, string] = ['先手', '後手'];
  const conn: [boolean, boolean] = [false, false];
  const rm: [boolean, boolean] = [false, false];
  r.seats.forEach((s, i) => { const p = r.sideOf[i]; if (p != null) { names[p] = s.name; conn[p] = s.connected; rm[p] = r.rematch[i]; } });
  const you = r.sideOf[seat] ?? null;
  return {
    t: 'state', code: r.code, opts: r.opts, waiting: !r.state, you, names, connected: conn,
    view: r.state && you != null ? viewOf(r.state, you) : null,
    remain: r.deadline != null ? Math.max(0, r.deadline - now) : null, rematch: rm,
  };
}

export class RateLimiter {
  private times: number[] = [];
  constructor(private max: number, private windowMs: number) {}
  allow(now: number): boolean {
    this.times = this.times.filter((t) => now - t < this.windowMs);
    if (this.times.length >= this.max) return false;
    this.times.push(now);
    return true;
  }
}
