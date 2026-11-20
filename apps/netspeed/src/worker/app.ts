// 受け口と集計の中身。D1 の形だけに頼るので、テストではふつうの SQLite で同じ SQL を動かせる。
import { validSample, validSpot, summarize, Sample, HourRow, Summary, Spot } from '../shared/stats';

export interface Stmt { bind(...v: unknown[]): Stmt; run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }>; }
export interface DB { prepare(sql: string): Stmt; batch(stmts: Stmt[]): Promise<unknown[]>; }
export interface Env {
  DB: DB;
  ASSETS?: { fetch(req: Request): Promise<Response> };
  INGEST_TOKEN?: string;
  VIEW_PASSWORD?: string;
  SESSION_SECRET?: string;
  TZ_OFFSET_MIN?: string;
  RETAIN_DAYS?: string;
}

const COOKIE = 'ns_s';
const SESSION_DAYS = 30;
const MAX_BATCH = 500;

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });

// ---- 記録 ----
const UPSERT_HOUR = `INSERT INTO hourly (hour, n, fail, down_sum, down_n, up_sum, up_n, ping_sum, ping_n, loss_sum, loss_n, down_min, down_max)
SELECT ?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11 WHERE NOT EXISTS (SELECT 1 FROM samples WHERE ts = ?12)
ON CONFLICT(hour) DO UPDATE SET
  n = n + 1, fail = fail + excluded.fail,
  down_sum = down_sum + excluded.down_sum, down_n = down_n + excluded.down_n,
  up_sum = up_sum + excluded.up_sum, up_n = up_n + excluded.up_n,
  ping_sum = ping_sum + excluded.ping_sum, ping_n = ping_n + excluded.ping_n,
  loss_sum = loss_sum + excluded.loss_sum, loss_n = loss_n + excluded.loss_n,
  down_min = CASE WHEN excluded.down_min IS NULL THEN down_min WHEN down_min IS NULL OR excluded.down_min < down_min THEN excluded.down_min ELSE down_min END,
  down_max = CASE WHEN excluded.down_max IS NULL THEN down_max WHEN down_max IS NULL OR excluded.down_max > down_max THEN excluded.down_max ELSE down_max END`;
const INSERT_SAMPLE = 'INSERT OR IGNORE INTO samples (ts, kind, down, up, ping, jitter, loss, colo) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)';

/** 測定をまとめて記録する（同じ時刻のものは 1 回だけ数える） */
export async function ingest(db: DB, raw: unknown[], now: number): Promise<{ accepted: number; rejected: number }> {
  const ok: Sample[] = [];
  for (const x of raw.slice(0, MAX_BATCH)) { const s = validSample(x, now); if (s) ok.push(s); }
  const stmts: Stmt[] = [];
  for (const s of ok) {
    const n = (v: number | null) => (v === null ? [0, 0] : [v, 1]);
    const [ds, dn] = n(s.down), [us, un] = n(s.up), [ps, pn] = n(s.ping), [ls, ln] = n(s.loss);
    stmts.push(db.prepare(UPSERT_HOUR).bind(Math.floor(s.ts / 3600), s.down === null ? 1 : 0, ds, dn, us, un, ps, pn, ls, ln, s.down, s.ts));
    stmts.push(db.prepare(INSERT_SAMPLE).bind(s.ts, s.kind, s.down, s.up, s.ping, s.jitter, s.loss, s.colo ?? null));
  }
  if (stmts.length) await db.batch(stmts);
  return { accepted: ok.length, rejected: Math.min(raw.length, MAX_BATCH) - ok.length + Math.max(0, raw.length - MAX_BATCH) };
}

/** 画面のための集計（1 時間ごとのまとめと、最近の 1 時間だけを読む） */
export async function summary(db: DB, now: number, tzOffsetMin: number, days: number): Promise<Summary> {
  const fromHour = Math.floor((now - days * 86400) / 3600);
  const rows = (await db.prepare('SELECT * FROM hourly WHERE hour >= ?1 ORDER BY hour').bind(fromHour).all<HourRow>()).results;
  const latest = await db.prepare('SELECT * FROM samples ORDER BY ts DESC LIMIT 1').first<Sample>();
  const recent = (await db.prepare('SELECT * FROM samples WHERE ts >= ?1 ORDER BY ts').bind(now - 3600).all<Sample>()).results;
  const s = summarize(rows, latest, recent, now, tzOffsetMin, days);
  // ボタンで測った記録と、同じころ（前 2 分〜後 1 分）の PC の下り
  s.spots = (await db.prepare(`SELECT p.*, (SELECT down FROM samples WHERE ts BETWEEN p.ts - 120 AND p.ts + 60 ORDER BY ABS(ts - p.ts) LIMIT 1) AS pcDown
    FROM spots p WHERE p.ts >= ?1 ORDER BY p.ts DESC LIMIT 100`).bind(now - days * 86400).all<Spot>()).results;
  return s;
}

/** ボタンで測った記録を残す（ログインしている端末から） */
export async function addSpot(db: DB, raw: unknown, now: number): Promise<Spot | null> {
  const s = validSpot(raw, now);
  if (!s) return null;
  // 同じ秒に 2 回押されたら、1 秒ずらす
  let ts = now;
  for (let i = 0; i < 5; i++) {
    const r = await db.prepare('INSERT OR IGNORE INTO spots (ts, device, place, net, down, up, ping, jitter) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
      .bind(ts, s.device, s.place, s.net, s.down, s.up, s.ping, s.jitter).run() as { meta?: { changes?: number }; changes?: number };
    if ((r?.meta?.changes ?? r?.changes ?? 1) > 0) return { ...s, ts };
    ts++;
  }
  return null;
}

/** 古い記録を消す */
export async function cleanup(db: DB, now: number, retainDays: number) {
  await db.batch([
    db.prepare('DELETE FROM samples WHERE ts < ?1').bind(now - retainDays * 86400),
    db.prepare('DELETE FROM hourly WHERE hour < ?1').bind(Math.floor((now - 400 * 86400) / 3600)),
    db.prepare('DELETE FROM throttle WHERE until < ?1 AND fails = 0').bind(now),
    db.prepare('DELETE FROM spots WHERE ts < ?1').bind(now - 400 * 86400),
  ]);
}

// ---- 合言葉と鍵 ----
const enc = new TextEncoder();
function b64url(buf: ArrayBuffer) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function hmac(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
/** 長さが同じでも違っても、比べる時間が中身で変わらないように */
export async function safeEqual(a: string, b: string) {
  const k = 'compare';
  const [x, y] = await Promise.all([hmac(k, a), hmac(k, b)]);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
export async function makeSession(secret: string, now: number) {
  const exp = now + SESSION_DAYS * 86400;
  return `${exp}.${await hmac(secret, `ns:${exp}`)}`;
}
export async function checkSession(secret: string, value: string | null, now: number) {
  if (!value) return false;
  const [exp, sig] = value.split('.');
  if (!exp || !sig || !(Number(exp) > now)) return false;
  return safeEqual(sig, await hmac(secret, `ns:${exp}`));
}
const cookieOf = (req: Request, name: string) => {
  const c = req.headers.get('cookie') ?? '';
  for (const part of c.split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return v.join('='); }
  return null;
};

// ---- 表の用意：デプロイのコマンドに頼らず、最初のリクエストで作る（あれば何もしない） ----
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS samples (ts INTEGER PRIMARY KEY, kind TEXT NOT NULL, down REAL, up REAL, ping REAL, jitter REAL, loss REAL, colo TEXT)`,
  `CREATE TABLE IF NOT EXISTS hourly (hour INTEGER PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, fail INTEGER NOT NULL DEFAULT 0,
    down_sum REAL NOT NULL DEFAULT 0, down_n INTEGER NOT NULL DEFAULT 0, up_sum REAL NOT NULL DEFAULT 0, up_n INTEGER NOT NULL DEFAULT 0,
    ping_sum REAL NOT NULL DEFAULT 0, ping_n INTEGER NOT NULL DEFAULT 0, loss_sum REAL NOT NULL DEFAULT 0, loss_n INTEGER NOT NULL DEFAULT 0,
    down_min REAL, down_max REAL)`,
  `CREATE TABLE IF NOT EXISTS throttle (ip TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, until INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS spots (ts INTEGER PRIMARY KEY, device TEXT NOT NULL, place TEXT, net TEXT, down REAL, up REAL, ping REAL, jitter REAL)`,
];
const ready = new WeakSet<object>();
export async function ensureSchema(db: DB) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((q) => db.prepare(q)));
  ready.add(db);
}

// ---- 入口 ----
export async function handle(req: Request, env: Env, now = Math.floor(Date.now() / 1000)): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(req) : new Response('not found', { status: 404 });
  await ensureSchema(env.DB);
  const secret = env.SESSION_SECRET ?? '';
  if (!secret || !env.VIEW_PASSWORD || !env.INGEST_TOKEN) return json({ error: 'not-configured', message: 'シークレット（INGEST_TOKEN・VIEW_PASSWORD・SESSION_SECRET）が設定されていません' }, 503);

  if (path === '/api/ingest' && req.method === 'POST') {
    const auth = req.headers.get('authorization') ?? '';
    if (!auth.startsWith('Bearer ') || !(await safeEqual(auth.slice(7), env.INGEST_TOKEN))) return json({ error: 'unauthorized' }, 401);
    let body: unknown;
    try { body = await req.json(); } catch { return json({ error: 'bad-json' }, 400); }
    const list = Array.isArray((body as { samples?: unknown[] })?.samples) ? (body as { samples: unknown[] }).samples : [body];
    return json(await ingest(env.DB, list, now));
  }

  if (path === '/api/login' && req.method === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    const t = await env.DB.prepare('SELECT fails, until FROM throttle WHERE ip = ?1').bind(ip).first<{ fails: number; until: number }>();
    if (t && t.until > now) return json({ error: 'locked', retryAfter: t.until - now }, 429, { 'retry-after': String(t.until - now) });
    let pw = '';
    try { pw = String(((await req.json()) as { password?: unknown }).password ?? ''); } catch { /* 空のまま */ }
    if (!(await safeEqual(pw, env.VIEW_PASSWORD))) {
      const fails = (t?.fails ?? 0) + 1;
      const lock = fails >= 5;
      await env.DB.prepare('INSERT INTO throttle (ip, fails, until) VALUES (?1, ?2, ?3) ON CONFLICT(ip) DO UPDATE SET fails = excluded.fails, until = excluded.until')
        .bind(ip, lock ? 0 : fails, lock ? now + 900 : 0).run();
      return json({ error: 'wrong', left: lock ? 0 : 5 - fails }, lock ? 429 : 401);
    }
    if (t) await env.DB.prepare('DELETE FROM throttle WHERE ip = ?1').bind(ip).run();
    const v = await makeSession(secret, now);
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` });
  }
  if (path === '/api/logout' && req.method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` });
  }

  const authed = await checkSession(secret, cookieOf(req, COOKIE), now);
  if (path === '/api/me') return json({ ok: authed }, authed ? 200 : 401);
  if (path === '/api/spot' && req.method === 'POST') {
    if (!authed) return json({ error: 'login' }, 401);
    let body: unknown;
    try { body = await req.json(); } catch { return json({ error: 'bad-json' }, 400); }
    const saved = await addSpot(env.DB, body, now);
    return saved ? json(saved) : json({ error: 'bad-spot' }, 400);
  }
  if (path === '/api/summary' && req.method === 'GET') {
    if (!authed) return json({ error: 'login' }, 401);
    const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') ?? 14) || 14));
    return json(await summary(env.DB, now, Number(env.TZ_OFFSET_MIN ?? 540), days));
  }
  return json({ error: 'not-found' }, 404);
}
