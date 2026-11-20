// 集計（Worker と画面とテストで共通）。時間帯ごとの速さを、1 時間ごとのまとめから出す。

export type Kind = 'quick' | 'full';
export interface Sample { ts: number; kind: Kind; down: number | null; up: number | null; ping: number | null; jitter: number | null; loss: number | null; colo?: string | null; }
export interface HourRow { hour: number; n: number; fail: number; down_sum: number; down_n: number; up_sum: number; up_n: number; ping_sum: number; ping_n: number; loss_sum: number; loss_n: number; down_min: number | null; down_max: number | null; }

export type Metric = 'down' | 'up' | 'ping';
export type Grid = (number | null)[][]; // [曜日 0=月 … 6=日][時 0〜23]

/** ボタンで測った記録（スマホなど）。pcDown は同じころの PC（有線）の下り */
export interface Spot { ts: number; device: string; place: string | null; net: string | null; down: number | null; up: number | null; ping: number | null; jitter: number | null; pcDown?: number | null; }

export function validSpot(x: unknown, now: number): Spot | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const num = (v: unknown, max: number): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : null;
  };
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max) || null : null);
  const device = text(o.device, 20) ?? 'phone';
  const net = o.net === 'wifi' || o.net === 'cellular' || o.net === 'ethernet' ? o.net : null;
  const down = num(o.down, 100000);
  if (down === null) return null;
  return { ts: now, device, place: text(o.place, 20), net, down, up: num(o.up, 100000), ping: num(o.ping, 60000), jitter: num(o.jitter, 60000) };
}

/** 場所ごとのまとめ（中央値） */
export function byPlace(spots: Spot[]) {
  const m = new Map<string, Spot[]>();
  for (const s of spots) { const k = s.place ?? '場所なし'; if (!m.has(k)) m.set(k, []); m.get(k)!.push(s); }
  return [...m.entries()].map(([place, list]) => {
    const pairs = list.filter((s) => s.down !== null && s.pcDown);
    return {
      place, n: list.length,
      down: median(list.map((s) => s.down!).filter((v) => v !== null)),
      ratio: pairs.length ? median(pairs.map((s) => s.down! / s.pcDown!)) : null,
    };
  }).sort((a, b) => (b.down ?? 0) - (a.down ?? 0));
}

export interface Summary {
  now: number;
  tzOffsetMin: number;
  days: number;
  latest: Sample | null;
  heat: Record<Metric, Grid>;
  heatCount: number[][];
  byHour: Record<Metric, (number | null)[]>;
  best: { hour: number; down: number }[];
  worst: { hour: number; down: number }[];
  daily: { date: string; down: (number | null)[] }[];
  recent: Sample[];
  totals: { samples: number; fails: number; hours: number };
  spots: Spot[];
}

/** 入ってきた測定を確かめる。おかしなものは null */
export function validSample(x: unknown, now: number): Sample | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const ts = Number(o.ts);
  if (!Number.isInteger(ts) || ts < now - 30 * 86400 || ts > now + 300) return null;
  const kind = o.kind === 'full' ? 'full' : o.kind === 'quick' ? 'quick' : null;
  if (!kind) return null;
  const num = (v: unknown, max: number): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 1000) / 1000 : null;
  };
  const colo = typeof o.colo === 'string' && /^[A-Za-z]{2,8}$/.test(o.colo) ? o.colo.toUpperCase() : null;
  return { ts, kind, down: num(o.down, 100000), up: num(o.up, 100000), ping: num(o.ping, 60000), jitter: num(o.jitter, 60000), loss: num(o.loss, 1), colo };
}

/** UNIX 秒 → その地域の曜日（0=月）・時・日付 */
export function local(ts: number, tzOffsetMin: number) {
  const d = new Date((ts + tzOffsetMin * 60) * 1000);
  const wd = (d.getUTCDay() + 6) % 7;
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  return { wd, hour: d.getUTCHours(), date };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const avg = (sum: number, n: number) => (n > 0 ? sum / n : null);
const round = (v: number | null, d = 1) => (v === null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** 1 時間ごとのまとめから、画面に出すものを作る */
export function summarize(rows: HourRow[], latest: Sample | null, recent: Sample[], now: number, tzOffsetMin: number, days: number): Summary {
  const metrics: Metric[] = ['down', 'up', 'ping'];
  const cells: Record<Metric, number[][][]> = { down: grid(() => []), up: grid(() => []), ping: grid(() => []) };
  const hourCells: Record<Metric, number[][]> = { down: [], up: [], ping: [] };
  for (const m of metrics) for (let h = 0; h < 24; h++) hourCells[m].push([]);
  const heatCount = grid(() => 0);
  const dailyMap = new Map<string, (number | null)[]>();
  let samples = 0, fails = 0;
  for (const r of rows) {
    const { wd, hour, date } = local(r.hour * 3600, tzOffsetMin);
    samples += r.n; fails += r.fail;
    const v: Record<Metric, number | null> = { down: avg(r.down_sum, r.down_n), up: avg(r.up_sum, r.up_n), ping: avg(r.ping_sum, r.ping_n) };
    for (const m of metrics) {
      const x = v[m];
      if (x === null) continue;
      cells[m][wd][hour].push(x);
      hourCells[m][hour].push(x);
    }
    heatCount[wd][hour] += r.n;
    if (!dailyMap.has(date)) dailyMap.set(date, Array(24).fill(null));
    dailyMap.get(date)![hour] = round(v.down);
  }
  // 時間帯ごとの値は、日ごとの平均の中央値（たまたまの 1 回に引っぱられないように）
  const heat = {} as Record<Metric, Grid>;
  const byHour = {} as Record<Metric, (number | null)[]>;
  for (const m of metrics) {
    heat[m] = cells[m].map((row) => row.map((xs) => round(median(xs))));
    byHour[m] = hourCells[m].map((xs) => round(median(xs)));
  }
  const ranked = byHour.down.map((down, hour) => ({ hour, down })).filter((x): x is { hour: number; down: number } => x.down !== null);
  const best = [...ranked].sort((a, b) => b.down - a.down).slice(0, 3);
  const worst = [...ranked].sort((a, b) => a.down - b.down).slice(0, 3);
  const daily = [...dailyMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-7).map(([date, down]) => ({ date, down }));
  return { now, tzOffsetMin, days, latest, heat, heatCount, byHour, best, worst, daily, recent, totals: { samples, fails, hours: rows.length }, spots: [] };
}

function grid<T>(f: () => T): T[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, f));
}

export const HOUR_LABEL = (h: number) => `${h}時`;
export const WEEKDAYS = ['月', '火', '水', '木', '金', '土', '日'];
