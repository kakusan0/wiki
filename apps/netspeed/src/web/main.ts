import { Summary, Metric, WEEKDAYS, summarize, HourRow, Sample, local, byPlace, Spot } from '../shared/stats';
import { measure, netType } from './measure';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
let days = 14, metric: Metric = 'down', data: Summary | null = null;

const UNIT: Record<Metric, string> = { down: 'Mbps', up: 'Mbps', ping: 'ms' };
const NAME: Record<Metric, string> = { down: '下り', up: '上り', ping: '遅延' };
const fmt = (v: number | null | undefined, m: Metric = 'down') => (v === null || v === undefined ? '—' : `${v >= 100 || m === 'ping' ? Math.round(v) : v.toFixed(1)} ${UNIT[m]}`);
const hourRange = (h: number) => `${h}時台`;
const dark = () => matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light' || document.documentElement.dataset.theme === 'dark';
// 濃淡は 1 色（青）の段階：値が大きいほど濃い（暗い画面では明るい）
const RAMP = ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'];
const rampAt = (t: number) => { const r = dark() ? [...RAMP].reverse() : RAMP; return r[Math.max(0, Math.min(r.length - 1, Math.round(t * (r.length - 1))))]; };
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---- 入る・出る ----
async function api(path: string, init?: RequestInit) {
  const r = await fetch(import.meta.env.BASE_URL + path.replace(/^\//, ''), { credentials: 'same-origin', ...init }); // 公開先のパスの下の /api
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function start() {
  if (DEMO) { data = demo(); showDash(); return; }
  const me = await api('/api/me');
  if (me.status === 200) { showDash(); await load(); } else showLogin();
}
function showLogin() { $('login').hidden = false; $('dash').hidden = true; $('pw').focus(); }
function showDash() { $('login').hidden = true; $('dash').hidden = false; render(); }
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await api('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $<HTMLInputElement>('pw').value }) });
  const msg = $('loginMsg');
  if (r.status === 200) { msg.textContent = ''; showDash(); await load(); return; }
  if (r.status === 429) msg.textContent = `まちがいが続いたので、${Math.ceil((r.body.retryAfter ?? 900) / 60)} 分ほど待ってからもう一度どうぞ。`;
  else if (r.status === 503) msg.textContent = r.body.message ?? 'まだ設定が終わっていません。';
  else msg.textContent = `合言葉がちがいます（あと ${r.body.left ?? '?'} 回）。`;
});
$('logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); showLogin(); });

async function load() {
  if (DEMO) { data = demo(); render(); return; }
  const r = await api(`/api/summary?days=${days}`);
  if (r.status === 401) { showLogin(); return; }
  data = r.body as Summary;
  render();
}
document.querySelectorAll<HTMLButtonElement>('[data-days]').forEach((b) => b.addEventListener('click', () => {
  days = Number(b.dataset.days);
  document.querySelectorAll('[data-days]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  void load();
}));
document.querySelectorAll<HTMLButtonElement>('[data-metric]').forEach((b) => b.addEventListener('click', () => {
  metric = b.dataset.metric as Metric;
  document.querySelectorAll('[data-metric]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  render();
}));
setInterval(() => { if (!$('dash').hidden) void load(); }, 60_000);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());
let rz = 0; addEventListener('resize', () => { clearTimeout(rz); rz = window.setTimeout(render, 150); });

// ---- 描く ----
const tip = $('tip');
function showTip(e: { clientX: number; clientY: number }, html: string) {
  tip.innerHTML = html; tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, e.clientX + 12))}px`;
  tip.style.top = `${Math.max(8, e.clientY - h - 12)}px`;
}
const hideTip = () => { tip.hidden = true; };

function render() {
  if (!data) return;
  const d = data;
  // 状態：最後の測定から何分たったか
  const st = $('status');
  if (d.latest) {
    const ago = Math.max(0, Math.round((d.now - d.latest.ts) / 60));
    const ok = ago <= 5;
    st.innerHTML = `<span class="chip ${ok ? 'good' : ago <= 30 ? 'warning' : 'critical'}">${ok ? '✓ 記録中' : '⚠ 記録が止まっています'}</span>
      最新の測定：${ago === 0 ? 'たった今' : `${ago} 分前`}${ok ? '' : '（自宅の PC が動いているか確かめてください）'}${d.latest.colo ? `・測定先 ${d.latest.colo}` : ''}`;
  } else st.innerHTML = `<span class="chip warning">⚠ まだ記録がありません</span> 自宅の PC で測定を始めると、ここに出ます。`;
  // ベスト・ワースト
  const b = d.best[0], w = d.worst[0];
  $('bestHour').textContent = b ? hourRange(b.hour) : '—';
  $('bestSub').textContent = b ? `下り ${fmt(b.down)}（${d.days} 日間の中央値）` : 'データが集まると出ます';
  $('worstHour').textContent = w ? hourRange(w.hour) : '—';
  $('worstSub').textContent = w ? `下り ${fmt(w.down)}` : '';
  $('nowDown').textContent = d.latest ? fmt(d.latest.down) : '—';
  $('nowSub').textContent = d.latest ? `上り ${fmt(d.latest.up)}・遅延 ${fmt(d.latest.ping, 'ping')}` : '';
  const li = (list: { hour: number; down: number }[]) => list.map((x, i) => `<li><span class="no">${i + 1}</span><span class="h">${hourRange(x.hour)}</span><span class="v">${fmt(x.down)}</span></li>`).join('') || '<li class="muted">データが集まると出ます</li>';
  $('best').innerHTML = li(d.best); $('worst').innerHTML = li(d.worst);
  drawHeat(d); drawProfile(d); drawRecent(d); drawSpots(d);
  $('foot').textContent = `${d.days} 日間：測定 ${d.totals.samples.toLocaleString()} 回（失敗 ${d.totals.fails} 回）。時刻は日本時間。時間帯ごとの値は、日ごとの平均の中央値です。`;
}

function drawHeat(d: Summary) {
  const g = d.heat[metric];
  const vals = g.flat().filter((v): v is number => v !== null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const el0 = $('heat');
  const narrow = el0.clientWidth < 560; // スマホ：時刻を縦に並べる
  const GAP = 2;
  let s: string;
  const cell = (wd: number, h: number, x: number, y: number, w: number, hh: number) => {
    const v = g[wd][h];
    const fill = v === null ? css('--surface-2') : rampAt(hi > lo ? (v - lo) / (hi - lo) : 0.5);
    return `<rect class="cell" data-wd="${wd}" data-h="${h}" x="${x + GAP / 2}" y="${y + GAP / 2}" width="${w - GAP}" height="${hh - GAP}" rx="3" fill="${fill}"/>`;
  };
  if (!narrow) {
    const L = 26, T = 18, W = Math.max(640, el0.clientWidth), CW = (W - L) / 24, CH = 26, H = T + 7 * CH;
    s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="曜日と時刻ごとの${NAME[metric]}">`;
    for (let h = 0; h < 24; h += 3) s += `<text x="${L + h * CW + CW / 2}" y="12" text-anchor="middle">${h}時</text>`;
    for (let wd = 0; wd < 7; wd++) {
      s += `<text x="${L - 6}" y="${T + wd * CH + CH / 2 + 4}" text-anchor="end">${WEEKDAYS[wd]}</text>`;
      for (let h = 0; h < 24; h++) s += cell(wd, h, L + h * CW, T + wd * CH, CW, CH);
    }
  } else {
    const L = 34, T = 18, W = Math.max(300, el0.clientWidth), CW = (W - L) / 7, CH = 20, H = T + 24 * CH;
    s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="曜日と時刻ごとの${NAME[metric]}">`;
    for (let wd = 0; wd < 7; wd++) s += `<text x="${L + wd * CW + CW / 2}" y="12" text-anchor="middle">${WEEKDAYS[wd]}</text>`;
    for (let h = 0; h < 24; h++) {
      if (h % 3 === 0) s += `<text x="${L - 6}" y="${T + h * CH + CH / 2 + 4}" text-anchor="end">${h}時</text>`;
      for (let wd = 0; wd < 7; wd++) s += cell(wd, h, L + wd * CW, T + h * CH, CW, CH);
    }
  }
  s += '</svg>';
  const el = $('heat');
  el.innerHTML = s;
  el.querySelectorAll<SVGRectElement>('.cell').forEach((c) => {
    const wd = Number(c.dataset.wd), h = Number(c.dataset.h);
    const show = (e: PointerEvent) => showTip(e, `${WEEKDAYS[wd]}曜 ${h}時台<br><b>${NAME[metric]} ${fmt(g[wd][h], metric)}</b><br><span style="opacity:.7">測定 ${d.heatCount[wd][h]} 回</span>`);
    c.addEventListener('pointerenter', show); c.addEventListener('pointermove', show); c.addEventListener('pointerleave', hideTip);
    c.addEventListener('pointerdown', show);
  });
  const lowL = metric === 'ping' ? '遅延が小さい（よい）' : '遅い', highL = metric === 'ping' ? '遅延が大きい' : '速い';
  $('heatLegend').innerHTML = vals.length
    ? `<span>${lowL} ${fmt(lo, metric)}</span><span class="bar" style="background:linear-gradient(90deg, ${rampAt(0)}, ${rampAt(0.5)}, ${rampAt(1)})"></span><span>${fmt(hi, metric)} ${highL}</span><span class="muted">灰色はデータなし</span>`
    : '<span>データが集まると出ます</span>';
  // 表
  let t = `<table><thead><tr><th>${NAME[metric]}（${UNIT[metric]}）</th>${Array.from({ length: 24 }, (_, h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>`;
  for (let wd = 0; wd < 7; wd++) t += `<tr><th>${WEEKDAYS[wd]}</th>${g[wd].map((v) => `<td>${v === null ? '—' : Math.round(v)}</td>`).join('')}</tr>`;
  $('heatTable').innerHTML = t + '</tbody></table>';
}

/** 折れ線（1 本の縦軸）。series: [名前, 色, 値の並び] */
function lineChart(el: HTMLElement, xs: string[], series: { name: string; color: string; values: (number | null)[] }[], unit: string, opts: { ticks?: number[]; xLabel: (i: number) => string }) {
  const W = Math.max(300, el.clientWidth), H = W < 500 ? 200 : 230, L = 40, R = 10, T = 22, B = 26;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const max = Math.max(1, ...all) * 1.08;
  const X = (i: number) => L + (i / Math.max(1, xs.length - 1)) * (W - L - R);
  const Y = (v: number) => T + (1 - v / max) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${series.map((x) => x.name).join('と')}">`;
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k, y = Y(v);
    s += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="${css('--grid')}" stroke-width="1"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${Math.round(v)}</text>`;
  }
  s += `<text x="${L - 6}" y="10" text-anchor="end">${unit}</text>`;
  const tk = (opts.ticks ?? []).filter((_, k, a) => W >= 500 || k % 2 === 0 || k === a.length - 1);
  for (const i of tk) s += `<text x="${X(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === xs.length - 1 ? 'end' : 'middle'}">${opts.xLabel(i)}</text>`;
  for (const se of series) {
    let dpath = '', pen = false;
    se.values.forEach((v, i) => { if (v === null) { pen = false; return; } dpath += `${pen ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    s += `<path d="${dpath}" fill="none" stroke="${se.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  s += `<line class="crosshair" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
  s += `<rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg>`;
  el.innerHTML = s;
  const svg = el.querySelector('svg')!, cross = svg.querySelector('.crosshair')!, hit = svg.querySelector('.hit')!;
  const move = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(xs.length - 1, Math.round(((x - L) / (W - L - R)) * (xs.length - 1))));
    cross.setAttribute('x1', String(X(i))); cross.setAttribute('x2', String(X(i))); cross.setAttribute('visibility', 'visible');
    showTip(e, `${xs[i]}<br>${series.map((se) => `<span class="sw" style="display:inline-block;width:10px;height:3px;background:${se.color};vertical-align:middle;margin-right:4px"></span>${se.name} <b>${se.values[i] === null ? '—' : `${Math.round(se.values[i]!)} ${unit}`}</b>`).join('<br>')}`);
  };
  hit.addEventListener('pointermove', move as EventListener); hit.addEventListener('pointerdown', move as EventListener);
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
}

function drawProfile(d: Summary) {
  const today = d.daily.length ? d.daily[d.daily.length - 1] : null;
  const series = [{ name: `${d.days} 日間の中央値`, color: css('--series-1'), values: d.byHour.down }];
  if (today) series.push({ name: `今日（${today.date.slice(5).replace('-', '/')}）`, color: css('--series-2'), values: today.down });
  $('profileLegend').innerHTML = series.map((s) => `<span><span class="sw" style="background:${s.color}"></span>${s.name}</span>`).join('');
  lineChart($('profile'), Array.from({ length: 24 }, (_, h) => `${h}時台`), series, 'Mbps', { ticks: [0, 3, 6, 9, 12, 15, 18, 21, 23], xLabel: (i) => `${i}時` });
}

function drawRecent(d: Summary) {
  const el = $('recent');
  if (!d.recent.length) { el.innerHTML = '<p class="muted">直近 1 時間の測定はありません。</p>'; return; }
  const xs = d.recent.map((r) => { const t = local(r.ts, d.tzOffsetMin); const dt = new Date((r.ts + d.tzOffsetMin * 60) * 1000); return `${t.hour}:${String(dt.getUTCMinutes()).padStart(2, '0')}`; });
  const n = xs.length;
  lineChart(el, xs, [{ name: '下り', color: css('--series-1'), values: d.recent.map((r) => r.down) }], 'Mbps', { ticks: [0, Math.floor(n / 2), n - 1], xLabel: (i) => xs[i] });
}

// ---- この端末で測る ----
const PLACE_KEY = 'netspeed.place';
try { $<HTMLInputElement>('place').value = localStorage.getItem(PLACE_KEY) ?? ''; } catch { /* 保存できない端末 */ }
$('spotForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('spotMsg'), btn = $<HTMLButtonElement>('spotBtn');
  const place = $<HTMLInputElement>('place').value.trim();
  const net = netType();
  if (net === 'cellular' && !confirm('いまはモバイルデータ（携帯の回線）につながっています。30 MB ほど使いますが、測りますか？')) return;
  try { localStorage.setItem(PLACE_KEY, place); } catch { /* 保存できない端末 */ }
  btn.disabled = true; msg.className = 'spot-msg';
  try {
    const r = await measure((stage, detail) => { msg.textContent = `${stage}…${detail ? `（${detail}）` : ''}`; });
    const body = { device: 'phone', place: place || null, net, down: r.down, up: r.up, ping: r.ping, jitter: r.jitter };
    let saved: Spot | null = null;
    if (!DEMO) {
      const res = await api('/api/spot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 401) { showLogin(); return; }
      saved = res.status === 200 ? (res.body as Spot) : null;
    }
    const pc = data?.latest && data.now - data.latest.ts < 300 ? data.latest.down : null;
    const box = $('spotResult');
    box.hidden = false;
    box.innerHTML = `<div class="tile"><span class="label">下り</span><b class="value">${fmt(r.down)}</b></div>
      <div class="tile"><span class="label">上り</span><b class="value">${fmt(r.up)}</b></div>
      <div class="tile"><span class="label">遅延</span><b class="value">${fmt(r.ping, 'ping')}</b></div>
      <p class="cmp">${pc && r.down ? `同じころの PC（有線）は ${fmt(pc)}。この場所の Wi-Fi は有線の <b>${Math.round((r.down / pc) * 100)}%</b> です。` : '同じころの PC（有線）の記録がないので、比べられませんでした。'}${net === 'cellular' ? '（モバイルデータで測りました）' : ''}</p>`;
    msg.textContent = `${place || '場所なし'}で測りました（${(r.bytes / 1e6).toFixed(0)} MB 使用）。${saved || DEMO ? '記録しました。' : '記録できませんでした。'}`;
    if (!DEMO) await load();
  } catch (err) {
    msg.className = 'spot-msg warn';
    msg.textContent = `測れませんでした：${(err as Error).message}。Wi-Fi につながっているか確かめて、もう一度どうぞ。`;
  } finally { btn.disabled = false; }
});

function drawSpots(d: Summary) {
  const list = d.spots ?? [];
  const places = byPlace(list);
  $('placeList').innerHTML = places.map((p) => `<option value="${esc(p.place)}">`).join('');
  const max = Math.max(1, ...places.map((p) => p.down ?? 0));
  $('places').innerHTML = places.length
    ? places.map((p) => `<div class="place-row"><span class="name">${esc(p.place)}</span><span class="bar" style="width:${((p.down ?? 0) / max) * 100}%"></span><span class="v">${fmt(p.down)}${p.ratio ? `・有線の ${Math.round(p.ratio * 100)}%` : ''}（${p.n} 回）</span></div>`).join('')
    : '<p class="muted small">まだ測っていません。部屋ごとに「測る」を押すと、ここで比べられます。</p>';
  const rows = list.map((s) => {
    const t = local(s.ts, d.tzOffsetMin); const dt = new Date((s.ts + d.tzOffsetMin * 60) * 1000);
    return `<tr><td>${t.date.slice(5).replace('-', '/')} ${t.hour}:${String(dt.getUTCMinutes()).padStart(2, '0')}</td><td>${esc(s.place ?? '—')}</td><td>${s.net === 'cellular' ? '携帯' : s.net === 'wifi' ? 'Wi-Fi' : '—'}</td><td>${fmt(s.down)}</td><td>${fmt(s.up)}</td><td>${fmt(s.ping, 'ping')}</td><td>${s.pcDown ? fmt(s.pcDown) : '—'}</td></tr>`;
  }).join('');
  $('spotList').innerHTML = list.length ? `<table><thead><tr><th>日時</th><th>場所</th><th>回線</th><th>下り</th><th>上り</th><th>遅延</th><th>PC（有線）</th></tr></thead><tbody>${rows}</tbody></table>` : '';
}
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ---- 見本（?demo）：ログインなしで、作り物のデータを表示する ----
function demo(): Summary {
  const now = Math.floor(Date.now() / 1000);
  const rows: HourRow[] = [];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let hr = Math.floor((now - days * 86400) / 3600); hr <= Math.floor(now / 3600); hr++) {
    const { hour, wd } = local(hr * 3600, 540);
    const base = hour >= 20 && hour <= 23 ? 55 : hour >= 18 ? 140 : hour < 7 ? 430 : wd >= 5 ? 220 : 300;
    const down = base * (0.85 + rnd() * 0.3), ping = hour >= 20 ? 28 + rnd() * 12 : 8 + rnd() * 4;
    rows.push({ hour: hr, n: 60, fail: rnd() < 0.05 ? 1 : 0, down_sum: down * 60, down_n: 60, up_sum: down * 0.45 * 60, up_n: 60, ping_sum: ping * 60, ping_n: 60, loss_sum: 0, loss_n: 60, down_min: down * 0.7, down_max: down * 1.2 });
  }
  const recent: Sample[] = Array.from({ length: 60 }, (_, i) => ({ ts: now - (59 - i) * 60, kind: 'quick', down: 260 + rnd() * 80, up: 120, ping: 10, jitter: 1, loss: 0, colo: 'NRT' }));
  const sum = summarize(rows, recent[recent.length - 1], recent, now, 540, days);
  sum.spots = [['リビング', 280, 330], ['寝室', 95, 320], ['台所', 160, 300], ['リビング', 300, 340], ['寝室', 80, 310], ['ベランダ', 35, 330]].map(([place, down, pc], i) => ({ ts: now - i * 5400, device: 'phone', place: place as string, net: 'wifi', down: down as number, up: (down as number) * 0.4, ping: 14 + i, jitter: 3, pcDown: pc as number }));
  return sum;
}

void start();
