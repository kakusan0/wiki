// オンライン対局の部屋の中身（Cloudflare に依存しない純粋な処理）
import { Game, type Result } from '../engine/game';
import type { Move } from '../engine/position';
import { RULESETS, type Ruleset } from '../engine/rules';

export interface TimeRule { id: string; name: string; main: number; byoyomi: number }
export const TIME_RULES: TimeRule[] = [
  { id: 'b30', name: '秒読み 30 秒', main: 0, byoyomi: 30_000 },
  { id: 'm10b30', name: '10 分＋秒読み 30 秒', main: 600_000, byoyomi: 30_000 },
  { id: 'm5', name: '切れ負け 5 分', main: 300_000, byoyomi: 0 },
];

export interface Seat { token: string; name: string; connected: boolean }
export interface Room {
  code: string;
  rules: Ruleset['id'];
  time: TimeRule;
  seats: Seat[]; // 0 = 部屋を作った人
  sideOf: (0 | 1)[]; // 席 → 先手(0)・後手(1)
  moves: Move[];
  result: Result | null;
  remain: [number, number]; // 先手・後手の残りの持ち時間（ミリ秒）
  turnStart: number | null; // いまの手番が始まった時刻
  version: number;
  createdAt: number;
  endedAt: number | null;
  rematch?: [boolean, boolean];
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

export function newRoom(code: string, rules: string, timeId: string, now: number): Room {
  const time = TIME_RULES.find((t) => t.id === timeId) ?? TIME_RULES[0];
  return {
    code, rules: (rules in RULESETS ? rules : 'standard') as Ruleset['id'], time, seats: [], sideOf: [], moves: [], result: null,
    remain: [time.main, time.main], turnStart: null, version: 0, createdAt: now, endedAt: null,
  };
}

export const gameOf = (r: Room) => Game.fromMoves(RULESETS[r.rules], RULESETS[r.rules].start, r.moves);
const started = (r: Room) => r.seats.length === 2 && r.sideOf.length === 2;

export type JoinResult = { ok: true; seat: number; token: string } | { ok: false; error: string };
export function join(r: Room, token: string | null, name: unknown, now: number, rand: () => number = Math.random, makeToken = randomToken): JoinResult {
  const mine = token ? r.seats.findIndex((s) => s.token === token) : -1;
  if (mine >= 0) { r.seats[mine].connected = true; r.version++; return { ok: true, seat: mine, token: r.seats[mine].token }; }
  if (r.seats.length >= 2) return { ok: false, error: 'この部屋は満員です' };
  const t = makeToken();
  r.seats.push({ token: t, name: cleanName(name) ?? (r.seats.length ? '相手' : 'あなた'), connected: true });
  if (r.seats.length === 2) {
    // 振り駒：先手・後手をランダムに決めて開始
    const first = rand() < 0.5 ? 0 : 1;
    r.sideOf = first === 0 ? [0, 1] : [1, 0];
    r.turnStart = now;
  }
  r.version++;
  return { ok: true, seat: r.seats.length - 1, token: t };
}

// いまの手番の人の締め切り（これを過ぎたら時間切れ）
export function deadline(r: Room): number | null {
  if (!started(r) || r.result || r.turnStart == null) return null;
  const side = gameOf(r).pos.side;
  return r.turnStart + r.remain[side] + r.time.byoyomi;
}

export function checkTimeout(r: Room, now: number): boolean {
  const d = deadline(r);
  if (d == null || now <= d) return false;
  const g = gameOf(r);
  g.timeout(g.pos.side);
  r.result = g.result;
  r.endedAt = now;
  r.version++;
  return true;
}

export type ActResult = { ok: true } | { ok: false; error: string };
export function act(r: Room, seat: number, msg: { type: string; move?: unknown }, now: number): ActResult {
  if (!started(r)) return { ok: false, error: '相手がまだ来ていません' };
  if (r.result) return { ok: false, error: '対局は終わっています' };
  if (checkTimeout(r, now)) return { ok: false, error: '時間切れです' };
  const g = gameOf(r);
  const side = r.sideOf[seat];
  if (msg.type === 'resign') {
    g.resign(side);
    r.result = g.result; r.endedAt = now; r.version++;
    return { ok: true };
  }
  if (g.pos.side !== side) return { ok: false, error: 'あなたの番ではありません' };
  if (msg.type === 'declare') {
    r.result = g.declare(); r.endedAt = now; r.version++;
    return { ok: true };
  }
  if (msg.type !== 'move' || typeof msg.move !== 'number' || !Number.isInteger(msg.move)) return { ok: false, error: '操作の形が正しくありません' };
  const m = msg.move as Move;
  if (!g.pos.isLegal(m)) return { ok: false, error: '指せない手です' };
  // 時計：持ち時間から引き、使い切ったら秒読み
  const used = now - (r.turnStart ?? now);
  r.remain[side] = Math.max(0, r.remain[side] - used);
  g.play(m);
  r.moves.push(m);
  r.result = g.result;
  if (r.result) r.endedAt = now;
  r.turnStart = now;
  r.version++;
  return { ok: true };
}

export interface RoomView {
  t: 'state';
  code: string;
  rules: Ruleset['id'];
  time: TimeRule;
  moves: Move[];
  result: Result | null;
  you: 0 | 1 | null; // 自分の側（始まる前は null）
  names: [string, string]; // 先手・後手の名前
  waiting: boolean;
  connected: [boolean, boolean];
  remain: [number, number];
  elapsed: number; // いまの手番が始まってからの時間
  rematch: [boolean, boolean]; // 先手・後手が「もう一局」を押したか
}

export function viewFor(r: Room, seat: number, now: number): RoomView {
  const names: [string, string] = ['先手', '後手'];
  const conn: [boolean, boolean] = [false, false];
  r.seats.forEach((s, i) => { const side = r.sideOf[i]; if (side != null) { names[side] = s.name; conn[side] = s.connected; } });
  return {
    t: 'state', code: r.code, rules: r.rules, time: r.time, moves: r.moves, result: r.result,
    you: r.sideOf[seat] ?? null, names, waiting: !started(r), connected: conn,
    remain: [...r.remain] as [number, number], elapsed: r.turnStart != null && !r.result ? now - r.turnStart : 0,
    rematch: [0, 1].map((side) => { const seat = r.sideOf.indexOf(side as 0 | 1); return seat >= 0 && !!r.rematch?.[seat]; }) as [boolean, boolean],
  };
}

// 始まる前に抜けた人の席を空ける
export function leaveLobby(r: Room, seat: number): void {
  if (started(r)) return;
  r.seats.splice(seat, 1);
  r.version++;
}

// 終わったあと、2 人とも「もう一局」を押したら先後を入れ替えて始め直す
export function rematch(r: Room, seat: number, now: number): ActResult {
  if (!r.result) return { ok: false, error: 'まだ対局中です' };
  r.rematch ??= [false, false];
  r.rematch[seat] = true;
  if (r.rematch[0] && r.rematch[1]) {
    r.sideOf = [r.sideOf[1], r.sideOf[0]];
    r.moves = []; r.result = null; r.endedAt = null; r.rematch = undefined;
    r.remain = [r.time.main, r.time.main];
    r.turnStart = now;
  }
  r.version++;
  return { ok: true };
}

// 送信が多すぎる接続を止める
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
