// ブラウザ（スマホ）から speed.cloudflare.com で測る
// 下りは小さい順に大きくして、1 回が 1.5 秒を超えたらそこで止める（遅い回線や携帯の回線でデータを使いすぎない）

export interface Result { down: number | null; up: number | null; ping: number | null; jitter: number | null; bytes: number; }
type Progress = (stage: string, detail?: string) => void;

const BASE = new URLSearchParams(location.search).get('speedBase') ?? 'https://speed.cloudflare.com';
const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };

async function downOnce(bytes: number): Promise<{ mbps: number | null; secs: number; got: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/__down?bytes=${bytes}&r=${Math.random()}`, { cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`下り ${res.status}`);
  const reader = res.body.getReader();
  let first = 0, total = 0, tFirst = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!tFirst) { tFirst = performance.now(); first = value.length; }
    total += value.length;
  }
  const t1 = performance.now();
  const dur = (t1 - tFirst) / 1000;
  return { mbps: total - first > 50000 && dur > 0 ? ((total - first) * 8) / dur / 1e6 : null, secs: (t1 - t0) / 1000, got: total };
}

async function upOnce(bytes: number, rttMs: number): Promise<{ mbps: number; secs: number }> {
  const body = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i += 65536) crypto.getRandomValues(body.subarray(i, Math.min(bytes, i + 65536)));
  const t0 = performance.now();
  const res = await fetch(`${BASE}/__up?r=${Math.random()}`, { method: 'POST', body, cache: 'no-store' });
  await res.arrayBuffer();
  const secs = (performance.now() - t0) / 1000;
  if (!res.ok) throw new Error(`上り ${res.status}`);
  return { mbps: (bytes * 8) / Math.max(0.001, secs - rttMs / 1000) / 1e6, secs };
}

export async function measure(progress: Progress): Promise<Result> {
  let bytes = 0;
  // 遅延：小さな問い合わせを 6 回（1 回目は接続の準備が入るので除く）
  progress('遅延を測っています');
  const rtts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t0 = performance.now();
    const r = await fetch(`${BASE}/__down?bytes=0&r=${Math.random()}`, { cache: 'no-store' });
    await r.arrayBuffer();
    if (i > 0) rtts.push(performance.now() - t0);
  }
  const ping = med(rtts);
  let jitter: number | null = null;
  if (rtts.length > 1) { let d = 0; for (let i = 1; i < rtts.length; i++) d += Math.abs(rtts[i] - rtts[i - 1]); jitter = d / (rtts.length - 1); }

  // 下り：1 MB → 5 MB → 25 MB
  const downs: number[] = [];
  for (const size of [1e6, 5e6, 25e6]) {
    progress('下りを測っています', `${size / 1e6} MB`);
    const r = await downOnce(size);
    bytes += r.got;
    if (r.mbps !== null) downs.push(r.mbps);
    if (r.secs > 1.5) break;
  }
  // 上り：1 MB → 5 MB
  const ups: number[] = [];
  for (const size of [1e6, 5e6]) {
    progress('上りを測っています', `${size / 1e6} MB`);
    const r = await upOnce(size, ping ?? 0);
    bytes += size;
    ups.push(r.mbps);
    if (r.secs > 1.5) break;
  }
  // 大きい方の測定ほど正確なので、最後の 2 回の大きい方
  const pick = (xs: number[]) => (xs.length ? Math.max(...xs.slice(-2)) : null);
  return { down: pick(downs), up: pick(ups), ping, jitter, bytes };
}

/** 回線の種類（Android の Chrome だけが教えてくれる） */
export function netType(): 'wifi' | 'cellular' | 'ethernet' | null {
  const c = (navigator as unknown as { connection?: { type?: string } }).connection;
  const t = c?.type;
  return t === 'wifi' || t === 'cellular' || t === 'ethernet' ? t : null;
}
