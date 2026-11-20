// オンライン対戦の部屋の中身（Cloudflare に依存しない純粋な処理。テストしやすくするため分けている）
import { decide } from '../game/ai';
import { getMap, MAPS } from '../game/maps';
import type { Action, CpuLevel, GameState, Mode } from '../game/state';
import { actor, apply, newGame } from '../game/turn';
import { NG_WORDS } from './ngwords';

export const MAX_SEATS = 4;
export const TURN_MS = 30_000; // 1 回の判断の持ち時間
export const AUTO_START_MS = 30_000; // 2 人以上そろってから自動で始めるまで
export const ALONE_MS = 60_000; // 1 人で待ってから「CPU と始める」を出すまで
export const EMOTES = ['よろしく！', 'ナイス！', 'ありがとう', 'やられた〜', 'おしい！', 'がんばる！', 'おめでとう', 'またね'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CPU_NAMES = ['ミナト', 'サクラ', 'ホシノ', 'カエデ'];

export interface Seat {
  token: string;
  name: string;
  cpu: boolean; // 最初から CPU の席
  connected: boolean;
  joinedAt: number;
}

export interface Room {
  code: string;
  mapId: string;
  mode: Mode;
  isPrivate: boolean;
  createdAt: number;
  seats: Seat[];
  hostToken: string | null;
  game: GameState | null;
  version: number; // 状態が変わるたびに 1 増える
  moves: number; // ゲームの操作の回数（画面が演出するかの判断に使う）
  deadline: number | null; // いまの判断の締め切り（ミリ秒）
  last: { type: Action['type']; seat: number } | null; // 直前の操作（画面の演出用）
  endedAt: number | null;
  wakeAt: number | null; // サーバーが次に動く時刻（CPU・切断中・時間切れ・自動開始）
}

// ---------- 合言葉・トークン ----------
export function randomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(rand() * CODE_CHARS.length)];
  return s;
}
export const isCode = (s: string) => /^[A-HJ-NP-Z2-9]{6}$/.test(s);
export function randomToken(): string {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function newRoom(code: string, mapId: string, mode: Mode, isPrivate: boolean, now: number): Room {
  return {
    code, mapId: MAPS.some((m) => m.id === mapId) ? mapId : MAPS[0].id, mode: mode === 'easy' ? 'easy' : 'normal',
    isPrivate, createdAt: now, seats: [], hostToken: null, game: null, version: 0, moves: 0, deadline: null, last: null, endedAt: null, wakeAt: null,
  };
}

// ---------- 名前 ----------
// 1〜8 文字。制御文字・URL・NG ワードは使えない。使えないときは null
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '').trim();
  if (!s || [...s].length > 8) return null;
  if (/https?:|www\.|\.(com|net|jp|org|io)|@|[<>]/i.test(s)) return null;
  const flat = s.toLowerCase().replace(/[\s._\-・ー〜~]/g, '');
  if (NG_WORDS.some((w) => flat.includes(w))) return null;
  return s;
}

// ---------- 送りすぎの制限（1 秒に limit 回まで） ----------
export class RateLimiter {
  private hits: number[] = [];
  constructor(private limit = 5, private windowMs = 1000) {}
  allow(now: number): boolean {
    this.hits = this.hits.filter((t) => now - t < this.windowMs);
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
}

// ---------- 入室 ----------
export type JoinResult = { ok: true; seat: number; token: string } | { ok: false; error: string };

export function join(room: Room, token: string | null, name: unknown, now: number, makeToken = randomToken): JoinResult {
  // すでに席がある人（再接続）
  const mine = token ? room.seats.findIndex((s) => !s.cpu && s.token === token) : -1;
  if (mine >= 0) {
    room.seats[mine].connected = true;
    return { ok: true, seat: mine, token: room.seats[mine].token };
  }
  if (room.game || room.endedAt) return { ok: false, error: 'すでに始まっている部屋です' };
  if (room.seats.length >= MAX_SEATS) return { ok: false, error: '満員です' };
  const seat = room.seats.length;
  const t = makeToken();
  room.seats.push({ token: t, name: cleanName(name) ?? `プレイヤー${seat + 1}`, cpu: false, connected: true, joinedAt: now });
  if (!room.hostToken) room.hostToken = t;
  room.version++;
  return { ok: true, seat, token: t };
}

export function leaveLobby(room: Room, seat: number) {
  if (room.game) return;
  const [gone] = room.seats.splice(seat, 1);
  if (gone && room.hostToken === gone.token) room.hostToken = room.seats.find((s) => !s.cpu)?.token ?? null;
  room.version++;
}

const humans = (room: Room) => room.seats.filter((s) => !s.cpu);

// 自動で始めるか（相手探しの部屋）。始めるべきなら true
export function shouldAutoStart(room: Room, now: number): boolean {
  if (room.game || room.isPrivate) return false;
  const hs = humans(room);
  if (hs.length >= MAX_SEATS) return true;
  if (hs.length >= 2) return now - hs[1].joinedAt >= AUTO_START_MS;
  return false;
}
export function autoStartAt(room: Room): number | null {
  if (room.game || room.isPrivate) return null;
  const hs = humans(room);
  return hs.length >= 2 ? hs[1].joinedAt + AUTO_START_MS : null;
}

// 「始める」を押せるか：合言葉の部屋は部屋を作った人。相手探しの部屋は 1 人で 60 秒待った人
export function canRequestStart(room: Room, token: string, now: number): boolean {
  if (room.game) return false;
  if (room.isPrivate) return room.hostToken === token;
  const hs = humans(room);
  return hs.length === 1 && hs[0].token === token && now - hs[0].joinedAt >= ALONE_MS;
}

// 空いた席に CPU を入れて始める
export function start(room: Room, seed: number, now: number, maxRounds?: number) {
  let k = 0;
  while (room.seats.length < MAX_SEATS) {
    room.seats.push({ token: '', name: CPU_NAMES[k++ % CPU_NAMES.length], cpu: true, connected: true, joinedAt: now });
  }
  room.game = newGame({
    mapId: room.mapId, mode: room.mode, seed, maxRounds,
    players: room.seats.map((s) => ({ name: s.name, cpu: s.cpu ? ('normal' as CpuLevel) : null })),
  });
  room.version++;
  room.deadline = now + TURN_MS;
  room.last = null;
}

// ---------- 操作 ----------
export type ActResult = { ok: true } | { ok: false; error: string };

export function act(room: Room, seat: number, action: Action, now: number): ActResult {
  const s = room.game;
  if (!s || s.phase === 'over') return { ok: false, error: 'ゲームが進行していません' };
  if (seat !== actor(s)) return { ok: false, error: 'あなたの番ではありません' }; // 競売中は入札する人
  if (!isAction(action)) return { ok: false, error: '操作の形が正しくありません' };
  try {
    room.game = apply(s, action);
  } catch {
    return { ok: false, error: 'いまはできない操作です' };
  }
  afterChange(room, seat, action.type, now);
  return { ok: true };
}

// 席の人が動かない・いない・CPU のとき、サーバーが代わりに 1 手進める
export function autoStep(room: Room, now: number): boolean {
  const s = room.game;
  if (!s || s.phase === 'over') return false;
  const a = decide(s);
  room.game = apply(s, a);
  afterChange(room, actor(s), a.type, now);
  return true;
}

function afterChange(room: Room, seat: number, type: Action['type'], now: number) {
  room.version++;
  room.moves++;
  room.last = { type, seat };
  room.deadline = room.game!.phase === 'over' ? null : now + animationMs(room) + TURN_MS;
  if (room.game!.phase === 'over') room.endedAt = now;
}

// 画面の演出（サイコロとコマの移動）にかかる時間。CPU はこのあとに動く
export function animationMs(room: Room, fast = false): number {
  if (fast) return 5;
  const s = room.game;
  if (!s || !room.last) return 300;
  const moved = room.last.type === 'roll' || room.last.type === 'move' || room.last.type === 'skip';
  return 500 + (room.last.type === 'roll' ? 1450 : 0) + (moved ? Math.max(0, s.path.length - 1) * 170 : 0);
}

// 次にサーバーが動く時刻を決める。CPU と切断中の人は演出を待ってから、つながっている人は締め切りに動く
export function planWake(room: Room, now: number, fast = false): number | null {
  const s = room.game;
  let at: number | null;
  if (!s) at = autoStartAt(room);
  else if (s.phase === 'over') at = null;
  else {
    const seat = room.seats[actor(s)];
    const wait = animationMs(room, fast);
    if (seat.cpu) at = now + wait + (fast ? 0 : 450);
    else if (!seat.connected) at = now + wait + (fast ? 0 : 1200);
    else at = room.deadline;
  }
  room.wakeAt = at;
  return at;
}

// 時間になったときの処理。進めたら true
export function wake(room: Room, now: number, fast = false, maxRounds?: number, seed = 1): boolean {
  if (!room.game) {
    if (!shouldAutoStart(room, now)) return false;
    start(room, seed, now, maxRounds);
    return true;
  }
  if (room.game.phase === 'over' || room.wakeAt == null || now < room.wakeAt - 50) return false;
  void fast;
  return autoStep(room, now);
}

// ---------- 送る形 ----------
// サイコロの乱数と山札の順番は渡さない（先が読めてしまうため）
export function sanitize(s: GameState): GameState {
  return { ...s, rng: 0, deck: [] };
}

export interface RoomView {
  t: 'room';
  code: string;
  mapId: string;
  mode: Mode;
  isPrivate: boolean;
  version: number;
  moves: number;
  seats: { name: string; cpu: boolean; connected: boolean }[];
  you: number;
  host: boolean;
  canStart: boolean;
  autoStartIn: number | null;
  game: GameState | null;
  last: Room['last'];
  remainMs: number | null;
}

export function viewFor(room: Room, seat: number, now: number): RoomView {
  const me = room.seats[seat];
  const at = autoStartAt(room);
  return {
    t: 'room', code: room.code, mapId: room.mapId, mode: room.mode, isPrivate: room.isPrivate, version: room.version, moves: room.moves,
    seats: room.seats.map((s) => ({ name: s.name, cpu: s.cpu, connected: s.connected })),
    you: seat,
    host: !!me && room.hostToken === me.token,
    canStart: !!me && canRequestStart(room, me.token, now),
    autoStartIn: at != null ? Math.max(0, at - now) : null,
    game: room.game ? sanitize(room.game) : null,
    last: room.last,
    remainMs: room.deadline != null && room.game && !room.seats[actor(room.game)].cpu ? Math.max(0, room.deadline - now) : null,
  };
}

// ---------- 操作の形の確認（届いた JSON をそのまま信じない） ----------
const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000;
export function isAction(a: unknown): a is Action {
  if (!a || typeof a !== 'object') return false;
  const x = a as Record<string, unknown>;
  switch (x.type) {
    case 'roll': case 'buyShop': case 'buyout': case 'skip': case 'endTurn': case 'pass': return true;
    case 'auction': return int(x.sq);
    case 'bid': return x.raise === 10 || x.raise === 50 || x.raise === 100;
    case 'move': return int(x.to);
    case 'invest': return int(x.sq) && typeof x.amount === 'number' && Number.isFinite(x.amount) && x.amount > 0;
    case 'buyLot': return x.facility === 'yatai' || x.facility === 'ryogae';
    case 'buyStock': case 'sellStock': return int(x.street) && int(x.lots) && (x.lots as number) > 0;
    default: return false;
  }
}

export const mapName = (id: string) => getMap(id).name;
