// 路線網：ひかり野線・あおば線・さざなみ線
// - あおば線：青葉から来て、浜田の手前でひかり野線と同じ高さで十字に交わる（平面交差）。
//   浜田は島式ホームの右側に着き、その先の分岐器でひかり野線の左の線路に合流して稲穂まで乗り入れる。
// - さざなみ線：全線が高架の複線。浜田のホームの真上でひかり野線とあおば線をまたぐ（立体交差）。
import { Path, intersect, Pose } from './path';
import { MAIN, HIKARI, FREIGHT, Route, Station, Signal, T, stationSignals, TRACK_GAP } from '../route';

// ---- あおば線の線路 ----
/** 浜田の島式ホームの右側を通る線（ひかり野線の左 13 m） */
export const AOBA_D = 13;
export const AOBA_PAR_FROM = 1960; // ここからひかり野線と平行
export const AOBA_DIV_FROM = 2190; // ここから合流の曲線
export const AOBA_MERGE = 2330; // ひかり野線の線路と一つになる所

/** ひかり野線にそった線（横ずれ d(s)）から中心線を作る */
function alongMain(s0: number, s1: number, d: (s: number) => number): Path {
  const pts: { x: number; y: number; z: number }[] = [];
  for (let s = s0; s <= s1 + 1e-6; s += 0.5) { const f = MAIN.at(s, d(s)); pts.push({ x: f.x, y: f.y, z: f.z }); }
  // 長さをはかって 1 m ごとに取り直す
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const len = cum[cum.length - 1];
  const n = Math.floor(len) + 1;
  const p = new Path(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    while (j < cum.length - 2 && cum[j + 1] < i) j++;
    const f = (i - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    p.PX[i] = pts[j].x + (pts[j + 1].x - pts[j].x) * f;
    p.PZ[i] = pts[j].z + (pts[j + 1].z - pts[j].z) * f;
    p.PY[i] = pts[j].y + (pts[j + 1].y - pts[j].y) * f;
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = p.PX[b] - p.PX[a], dz = p.PZ[b] - p.PZ[a];
    p.TH[i] = Math.atan2(dx, -dz);
  }
  // 向きを連続に（±π をまたがない）し、曲率と勾配を差分で
  const mainTh = MAIN.at(s0).th;
  for (let i = 0; i < n; i++) { while (p.TH[i] - mainTh > Math.PI) p.TH[i] -= 2 * Math.PI; while (p.TH[i] - mainTh < -Math.PI) p.TH[i] += 2 * Math.PI; }
  for (let i = 0; i < n - 1; i++) { p.K[i] = -(p.TH[i + 1] - p.TH[i]); p.G[i] = p.PY[i + 1] - p.PY[i]; }
  return p;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const aobaPar = alongMain(AOBA_PAR_FROM, AOBA_MERGE, (s) => AOBA_D * (1 - smooth(AOBA_DIV_FROM, AOBA_MERGE, s)));
// 青葉からの区間：平行区間の始まりで終わるよう、逆向きに積分する（u は終点からの距離、曲率は進む向きでの値）
const parStart: Pose = aobaPar.pose(0);
const AOBA_K: [number, number][] = [[0, 0], [25, 0], [25, -1 / 190], [160, -1 / 190], [160, 0], [380, 0], [380, 1 / 300], [590, 1 / 300], [590, 0], [760, 0]];
const kAt = (u: number) => { for (let i = AOBA_K.length - 1; i >= 0; i--) if (u >= AOBA_K[i][0]) return AOBA_K[i][1]; return 0; };
const aobaApp = Path.integrateTo(parStart, 760, kAt, () => 0);
/** あおば線だけの線路（青葉 → 合流点） */
export const AOBA_TRACK = Path.concat(aobaApp, aobaPar);
export const AOBA_OWN = AOBA_TRACK.length;
/** あおば線の運転経路（青葉 → 合流 → ひかり野線で稲穂へ） */
/** 合流点（ひかり野線の s）。あおば線の線路の終わりに一番近い所 */
export const MERGE_S = (() => { const e = AOBA_TRACK.at(AOBA_OWN); return MAIN.nearest(e.x, e.z, 1).s; })();
const AOBA_PATH = Path.concat(AOBA_TRACK, MAIN, MERGE_S, 4100);
/** あおば線の s → ひかり野線の s（合流の後だけ） */
export const aobaToMain = (s: number) => (s >= AOBA_OWN ? MERGE_S + (s - AOBA_OWN) : null);
export const mainToAoba = (s: number) => AOBA_OWN + (s - MERGE_S);

// ---- さざなみ線（高架）----
export const SAZA_Y = 18.6; // レール面の高さ
export const SAZA_CROSS_MAIN = 2110; // 浜田のホームの真上で交わる
const crossPose = MAIN.pose(SAZA_CROSS_MAIN);
const sazaCross: Pose = { x: crossPose.x, y: SAZA_Y, z: crossPose.z, th: crossPose.th - Math.PI / 2 }; // 西へ向かう
// 交差点から東へ（逆向き）：東浜から北へ来て、左へ曲がって西へ
const SAZA_K_BACK: [number, number][] = [[0, 0], [130, 0], [130, 1 / 210], [460, 1 / 210], [460, 0], [900, 0]];
const SAZA_K_FWD: [number, number][] = [[0, 0], [130, 0], [130, -1 / 210], [460, -1 / 210], [460, 0], [900, 0]];
const step = (tab: [number, number][]) => (u: number) => { for (let i = tab.length - 1; i >= 0; i--) if (u >= tab[i][0]) return tab[i][1]; return 0; };
const sazaEast = Path.integrateTo(sazaCross, 860, step(SAZA_K_BACK), () => 0);
const sazaWest = Path.integrate(sazaCross, 860, step(SAZA_K_FWD), () => 0);
export const SAZA_TRACK = Path.concat(sazaEast, sazaWest);
export const SAZA_CROSS = sazaEast.length; // 交差点の s

// ---- 駅と時刻表 ----
const nearOn = (p: Path, mainS: number, d: number) => { const f = MAIN.at(mainS, d); return p.nearest(f.x, f.z, 2).s; };
const aobaHamada = Math.round(nearOn(AOBA_TRACK, 2150, AOBA_D) * 10) / 10;
export const AOBA_STATIONS: Station[] = [
  { name: '青葉', kana: 'あおば', stop: 140, arr: T(7, 0, 0), dep: T(7, 1, 0) },
  { name: '浜田', kana: 'はまだ', stop: aobaHamada, arr: T(7, 3, 0), dep: T(7, 5, 0), side: 'R', transfer: 'ひかり野線・さざなみ線' },
  { name: '稲穂', kana: 'いなほ', stop: mainToAoba(3950), arr: T(7, 8, 20), dep: T(7, 8, 20) },
];
export const SAZA_STATIONS: Station[] = [
  { name: '東浜', kana: 'ひがしはま', stop: 200, arr: T(7, 0, 0), dep: T(7, 0, 50) },
  { name: '浜田', kana: 'はまだ', stop: SAZA_CROSS + 50, arr: T(7, 2, 10), dep: T(7, 2, 50), transfer: 'ひかり野線・あおば線' },
  { name: '西浜', kana: 'にしはま', stop: SAZA_TRACK.length - 150, arr: T(7, 4, 30), dep: T(7, 4, 30) },
];

// ---- 衝突点 ----
/** あおば線とひかり野線の平面交差（左の線路・右の線路） */
export const DIAMOND = (() => {
  const a0 = intersect(AOBA_TRACK, MAIN, 0, 0, [0, AOBA_TRACK.length - 50], [1500, 2100]);
  const a4 = intersect(AOBA_TRACK, MAIN, 0, TRACK_GAP, [0, AOBA_TRACK.length - 50], [1500, 2100]);
  if (!a0 || !a4) throw new Error('あおば線がひかり野線と交わらない');
  return { aoba: [Math.min(a0.sa, a4.sa), Math.max(a0.sa, a4.sa)] as [number, number], main0: a0.sb, main4: a4.sb, angle: a0.angle };
})();

export interface Zone { id: string; ranges: Partial<Record<'hikari' | 'aoba' | 'saza' | 'main4', [number, number]>>; }
/** 列車が入ると、ほかの列車は手前で止まる区間（経路ごとの s の範囲） */
export const ZONES: Zone[] = [
  { id: 'diamond', ranges: { hikari: [DIAMOND.main0 - 12, DIAMOND.main0 + 12], aoba: [DIAMOND.aoba[0] - 12, DIAMOND.aoba[1] + 12], main4: [DIAMOND.main4 - 12, DIAMOND.main4 + 12] } },
  // 合流から稲穂のホームの先までは同じ線路：1 本ずつ通す（先の列車が稲穂を出るまで、後の列車は合流の手前で待つ）
  { id: 'merge', ranges: { hikari: [AOBA_DIV_FROM + 20, 3962], aoba: [nearOn(AOBA_TRACK, AOBA_DIV_FROM + 20, AOBA_D), mainToAoba(3962)] } },
];

// ---- 経路 ----
function aobaSignals(): Signal[] {
  const sig = stationSignals(AOBA_STATIONS, 380);
  // 平面交差の手前の信号（連動）
  sig.push({ s: DIAMOND.aoba[0] - 230, kind: 'interlock' });
  // 浜田の出発信号は、分岐（合流）へ進むので「制限 35」
  for (const s of sig) if (s.kind === 'start' && s.station === 1) s.caution = true;
  // 合流の後はひかり野線の信号を使う（実物は共有）
  sig.push({ s: mainToAoba(3000), kind: 'block', shared: true });
  for (const s of sig) if (s.kind === 'home' && s.station === 2) s.shared = true;
  return sig.sort((a, b) => a.s - b.s);
}
export const AOBA: Route = {
  id: 'aoba', name: 'あおば線', kana: 'あおばせん', color: '#2f9e5a', note: '青葉の住宅地から、ひかり野線と十字に交わって浜田へ。分岐器で合流して稲穂まで',
  path: AOBA_PATH, stations: AOBA_STATIONS,
  limits: [
    { from: 0, to: 200, kmh: 45 },
    { from: DIAMOND.aoba[0] - 120, to: DIAMOND.aoba[1] + 30, kmh: 45 }, // 平面交差
    { from: nearOn(AOBA_TRACK, AOBA_DIV_FROM, AOBA_D), to: AOBA_OWN + 10, kmh: 35 }, // 分岐器
    { from: mainToAoba(3450), to: mainToAoba(4100), kmh: 45 },
  ],
  signals: aobaSignals(), whistles: [{ s: DIAMOND.aoba[0] - 260 }], maxKmh: 75,
};
export const SAZANAMI: Route = {
  id: 'saza', name: 'さざなみ線', kana: 'さざなみせん', color: '#2bb3d9', note: '町の上を走る高架線。浜田のホームの真上で、ひかり野線とあおば線をまたぐ',
  path: SAZA_TRACK, stations: SAZA_STATIONS,
  limits: [{ from: 380, to: 760, kmh: 65 }, { from: SAZA_CROSS + 170, to: SAZA_CROSS + 520, kmh: 65 }],
  signals: stationSignals(SAZA_STATIONS, 400), whistles: [], maxKmh: 80,
};
export const ROUTES: Route[] = [HIKARI, AOBA, SAZANAMI];
/** はじめの画面で選べる路線（ほかの路線の列車は ROUTES だけが走る） */
export const PLAYABLE: Route[] = [...ROUTES, FREIGHT];
export const routeById = (id: string) => PLAYABLE.find((r) => r.id === id) ?? HIKARI;
