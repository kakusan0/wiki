// トラックとひかり野線（train-sim）をつなぐ、荷物の記録置き場。
// 「連携コード」ごとに、12ft コンテナがどこにいるかを記録する。
//   factory（工場）→ truck（トラックの荷台）→ station（潮見貨物駅）→ 貨物列車で山ノ口へ → delivered
//   帰りの列車が持ち帰った分：station → truck → delivered（町の届け先）
// D1 の形だけに頼るので、テストではふつうの SQLite で同じ SQL を動かせる。

export interface Stmt { bind(...v: unknown[]): Stmt; run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results: T[] }>; }
export interface DB { prepare(sql: string): Stmt; batch(stmts: Stmt[]): Promise<unknown[]>; }
export interface Env { DB?: DB; ASSETS?: { fetch(req: Request): Promise<Response> }; }

export type Place = 'truck' | 'station' | 'delivered';
export interface BoxRow { id: number; num: string; contents: string; weight: number; at: Place; dest: string; updated: number; }

export const MOUNTAIN = '山ノ口';
export const TRAIN_CAP = 5;       // 貨物列車に積める数（コンテナ貨車 1 両ぶん）
export const MAX_BOXES = 300;     // 1 つのコードで持てる数（使いすぎを防ぐ）
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 見まちがえやすい 0 O 1 I は使わない
export const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
const RATE = { link: 10, call: 240, window: 600 };     // 10 分あたり：コードを作る回数（場所ごと）、呼び出しの回数（コードごと）

// 町の届け先（トラックのゲームの PLACES と同じ名前）
export const TOWN_DESTS = ['ミドリ物流センター', '潮見精機 第二工場'];
const OUT_GOODS: [string, number][] = [['精密部品', 4200], ['機械部品', 4800], ['日用品', 2600], ['家具', 2100]];
const IN_GOODS: [string, number][] = [['木材', 4600], ['米', 4800], ['野菜', 3200], ['山の水', 4900], ['紙製品', 2900]];

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS links (code TEXT PRIMARY KEY, created INTEGER NOT NULL, calls INTEGER NOT NULL DEFAULT 0, win INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS boxes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, num TEXT NOT NULL, contents TEXT NOT NULL, weight INTEGER NOT NULL, at TEXT NOT NULL, dest TEXT NOT NULL, updated INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS boxes_code_at ON boxes (code, at)`,
  `CREATE TABLE IF NOT EXISTS throttle (key TEXT PRIMARY KEY, n INTEGER NOT NULL, win INTEGER NOT NULL)`,
];
const ready = new WeakSet<object>();
export async function ensureSchema(db: DB) {
  if (ready.has(db)) return;
  await db.batch(SCHEMA.map((q) => db.prepare(q)));
  ready.add(db);
}

type Rand = () => number;
function newCode(r: Rand): string { let s = ''; for (let i = 0; i < 8; i++) s += CODE_CHARS[Math.floor(r() * CODE_CHARS.length)]; return s; }
function boxNum(r: Rand): string { return `${19 + Math.floor(r() * 2)}D-${String(10000 + Math.floor(r() * 89999))}`; }
function pick<T>(a: T[], r: Rand): T { return a[Math.floor(r() * a.length)]; }

/** 回数の上限：10 分ごとに数え直す。超えたら false */
async function allow(db: DB, key: string, limit: number, now: number): Promise<boolean> {
  const win = Math.floor(now / RATE.window);
  const t = await db.prepare('SELECT n, win FROM throttle WHERE key = ?1').bind(key).first<{ n: number; win: number }>();
  const n = t && t.win === win ? t.n + 1 : 1;
  await db.prepare('INSERT INTO throttle (key, n, win) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET n = excluded.n, win = excluded.win').bind(key, n, win).run();
  return n <= limit;
}

export async function createLink(db: DB, now: number, r: Rand = Math.random): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = newCode(r);
    const exists = await db.prepare('SELECT 1 AS x FROM links WHERE code = ?1').bind(code).first();
    if (exists) continue;
    await db.prepare('INSERT INTO links (code, created) VALUES (?1, ?2)').bind(code, now).run();
    return code;
  }
  throw new Error('code');
}

export async function hasLink(db: DB, code: string): Promise<boolean> {
  return CODE_RE.test(code) && !!(await db.prepare('SELECT 1 AS x FROM links WHERE code = ?1').bind(code).first());
}

export async function listBoxes(db: DB, code: string, at: Place, outbound?: boolean): Promise<BoxRow[]> {
  const extra = outbound === undefined ? '' : outbound ? ' AND dest = ?3' : ' AND dest <> ?3';
  const q = db.prepare(`SELECT id, num, contents, weight, at, dest, updated FROM boxes WHERE code = ?1 AND at = ?2${extra} ORDER BY id LIMIT 50`);
  return (await (outbound === undefined ? q.bind(code, at) : q.bind(code, at, MOUNTAIN)).all<BoxRow>()).results;
}

export async function counts(db: DB, code: string): Promise<Record<string, number>> {
  const rows = (await db.prepare(`SELECT at, dest = ?2 AS out, COUNT(*) AS n FROM boxes WHERE code = ?1 AND at <> 'delivered' GROUP BY at, out`).bind(code, MOUNTAIN).all<{ at: string; out: number; n: number }>()).results;
  const c: Record<string, number> = { stationOut: 0, stationIn: 0, truck: 0 };
  for (const r of rows) {
    if (r.at === 'station') c[r.out ? 'stationOut' : 'stationIn'] += r.n;
    else if (r.at === 'truck') c.truck += r.n;
  }
  return c;
}

/** 工場で積む：山ノ口あての新しいコンテナを、トラックの荷台に作る */
export async function factoryLoad(db: DB, code: string, n: number, now: number, r: Rand = Math.random): Promise<BoxRow[]> {
  const total = (await db.prepare('SELECT COUNT(*) AS n FROM boxes WHERE code = ?1').bind(code).first<{ n: number }>())?.n ?? 0;
  n = Math.max(0, Math.min(n, 5, MAX_BOXES - total));
  const stmts: Stmt[] = [];
  for (let i = 0; i < n; i++) {
    const [g, w] = pick(OUT_GOODS, r);
    stmts.push(db.prepare("INSERT INTO boxes (code, num, contents, weight, at, dest, updated) VALUES (?1, ?2, ?3, ?4, 'truck', ?5, ?6)").bind(code, boxNum(r), g, w + Math.floor(r() * 400), MOUNTAIN, now));
  }
  if (stmts.length) await db.batch(stmts);
  return listBoxes(db, code, 'truck');
}

/** コンテナを動かす。決まった動きだけで、いまの場所が合っているものだけ動く（二重に動かさない） */
const MOVES: [Place, Place][] = [['station', 'truck'], ['truck', 'station'], ['truck', 'delivered']];
export async function move(db: DB, code: string, ids: number[], from: Place, to: Place, now: number): Promise<number> {
  if (!MOVES.some(([a, b]) => a === from && b === to)) return -1;
  ids = ids.filter((x) => Number.isInteger(x) && x > 0).slice(0, 10);
  if (!ids.length) return 0;
  const marks = ids.map((_, i) => `?${i + 5}`).join(',');
  const res = await db.prepare(`UPDATE boxes SET at = ?3, updated = ?4 WHERE code = ?1 AND at = ?2 AND id IN (${marks})`).bind(code, from, to, now, ...ids).run();
  return changes(res);
}
function changes(res: unknown): number {
  const r = res as { meta?: { changes?: number }; changes?: number | bigint };
  return Number(r?.meta?.changes ?? r?.changes ?? 0);
}

/** 貨物列車が山ノ口に着いた：駅で待っていた山ノ口あてを届け、帰りの列車が町あてのコンテナを駅に持ち帰る */
export async function trainRun(db: DB, code: string, now: number, r: Rand = Math.random): Promise<{ carried: BoxRow[]; arrived: BoxRow[] }> {
  const carried = (await listBoxes(db, code, 'station', true)).slice(0, TRAIN_CAP);
  const stmts: Stmt[] = [];
  if (carried.length) {
    const marks = carried.map((_, i) => `?${i + 3}`).join(',');
    stmts.push(db.prepare(`UPDATE boxes SET at = 'delivered', updated = ?2 WHERE code = ?1 AND at = 'station' AND id IN (${marks})`).bind(code, now, ...carried.map((b) => b.id)));
  }
  const total = (await db.prepare('SELECT COUNT(*) AS n FROM boxes WHERE code = ?1').bind(code).first<{ n: number }>())?.n ?? 0;
  const waiting = (await counts(db, code)).stationIn;
  const n = Math.max(0, Math.min(3 + Math.floor(r() * 3), MAX_BOXES - total, 12 - waiting));
  const before = (await db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM boxes').first<{ m: number }>())?.m ?? 0;
  for (let i = 0; i < n; i++) {
    const [g, w] = pick(IN_GOODS, r);
    stmts.push(db.prepare("INSERT INTO boxes (code, num, contents, weight, at, dest, updated) VALUES (?1, ?2, ?3, ?4, 'station', ?5, ?6)").bind(code, boxNum(r), g, w + Math.floor(r() * 400), pick(TOWN_DESTS, r), now));
  }
  if (stmts.length) await db.batch(stmts);
  const arrived = (await db.prepare(`SELECT id, num, contents, weight, at, dest, updated FROM boxes WHERE code = ?1 AND id > ?2 ORDER BY id`).bind(code, before).all<BoxRow>()).results;
  return { carried: carried.map((b) => ({ ...b, at: 'delivered' })), arrived };
}

// ---- 入口 ----
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS } });
const isPlace = (x: unknown): x is Place => x === 'truck' || x === 'station' || x === 'delivered';

export async function handle(req: Request, env: Env, now = Math.floor(Date.now() / 1000)): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  if (!path.startsWith('/api/')) return env.ASSETS ? env.ASSETS.fetch(req) : new Response('not found', { status: 404 });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const db = env.DB;
  if (!db) return json({ error: 'not-configured', message: '記録置き場（D1）がまだ設定されていません' }, 503);
  await ensureSchema(db);

  if (path === '/api/link' && req.method === 'POST') {
    const ip = req.headers.get('cf-connecting-ip') ?? 'local';
    if (!(await allow(db, `link:${ip}`, RATE.link, now))) return json({ error: 'too-many' }, 429);
    return json({ code: await createLink(db, now) });
  }

  // ここから先は連携コードが要る
  let body: Record<string, unknown> = {};
  if (req.method === 'POST') { try { body = (await req.json()) as Record<string, unknown>; } catch { return json({ error: 'bad-json' }, 400); } }
  const code = String(req.method === 'GET' ? url.searchParams.get('code') ?? '' : body.code ?? '').toUpperCase();
  if (!(await hasLink(db, code))) return json({ error: 'unknown-code' }, 404);
  if (!(await allow(db, `call:${code}`, RATE.call, now))) return json({ error: 'too-many' }, 429);

  if (path === '/api/link' && req.method === 'GET') return json({ code, counts: await counts(db, code) });
  if (path === '/api/boxes' && req.method === 'GET') {
    const at = url.searchParams.get('at');
    if (!isPlace(at)) return json({ error: 'bad-at' }, 400);
    const dir = url.searchParams.get('dir');
    return json({ boxes: await listBoxes(db, code, at, dir === 'out' ? true : dir === 'in' ? false : undefined) });
  }
  if (path === '/api/boxes/move' && req.method === 'POST') {
    const { ids, from, to } = body;
    if (!Array.isArray(ids) || !isPlace(from) || !isPlace(to)) return json({ error: 'bad-request' }, 400);
    const n = await move(db, code, ids as number[], from, to, now);
    if (n < 0) return json({ error: 'bad-move' }, 400);
    return json({ moved: n });
  }
  if (path === '/api/factory/load' && req.method === 'POST') {
    const n = Number(body.n ?? 2);
    if (!Number.isInteger(n) || n < 1 || n > 5) return json({ error: 'bad-n' }, 400);
    return json({ boxes: await factoryLoad(db, code, n, now) });
  }
  if (path === '/api/train/run' && req.method === 'POST') return json(await trainRun(db, code, now));
  return json({ error: 'not-found' }, 404);
}
