// 路線のデータ。ひかり野線（海辺の町から山あいの終点まで）は、ここで曲率と勾配から中心線を作る。
// ほかの路線（net/network.ts）もこの形の Route として持つ。
import { Path, interp, Frame } from './net/path';
export type { Frame } from './net/path';

export interface Station { name: string; kana: string; stop: number; arr: number; dep: number; side?: 'L' | 'R'; transfer?: string; }
export interface Limit { from: number; to: number; kmh: number; }
export type SignalKind = 'home' | 'start' | 'block' | 'interlock';
export interface Signal {
  s: number; kind: SignalKind; station?: number;
  /** 連動の信号：列車ごとの現示を返す（net/interlock.ts が設定する） */
  dyn?: (who: unknown, t: number) => 'G' | 'Y' | 'R';
  /** 青のかわりに出す「制限つきの進行」（分岐へ進むときなど） */
  caution?: boolean;
  /** 実物の信号機を、ほかの路線の信号機と共有している（その路線では描かない） */
  shared?: boolean;
}
export interface Crossing { s: number; }
export interface Whistle { s: number; }

export interface Route {
  id: string; name: string; kana: string; color: string; note: string;
  path: Path;
  stations: Station[];
  limits: Limit[];
  signals: Signal[];
  whistles: Whistle[];
  maxKmh: number;
  /** 走る線路（連動で使う）。書かなければ id と同じ */
  track?: string;
  /** 貨物列車（12ft コンテナを運ぶ。トラックのゲームとつながる） */
  freight?: boolean;
}

export const TRAIN_LEN = 40; // 2 両
export const TRACK_GAP = -4; // となりの線路（右側）
export const PLATFORM_LEN = 100; // 停止位置から後ろへ

// 時刻は「0 時からの秒」
export const T = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;

// ---- ひかり野線 ----
export const LENGTH = 5800;
export const STATIONS: Station[] = [
  { name: '潮見台', kana: 'しおみだい', stop: 260, arr: T(7, 0, 0), dep: T(7, 0, 45) },
  { name: '浜田', kana: 'はまだ', stop: 2150, arr: T(7, 3, 40), dep: T(7, 4, 10), transfer: 'さざなみ線・あおば線' },
  { name: '稲穂', kana: 'いなほ', stop: 3950, arr: T(7, 6, 50), dep: T(7, 7, 20) },
  { name: '山ノ口', kana: 'やまのくち', stop: 5650, arr: T(7, 10, 0), dep: T(7, 10, 0) },
];

// 曲率の制御点 [s, 1/R]（正＝左カーブ）
const CURV: [number, number][] = [
  [0, 0], [420, 0], [520, 1 / 800], [800, 1 / 800], [900, 0], [1200, 0], [1300, -1 / 700], [1650, -1 / 700],
  [1750, 0], [2400, 0], [2500, 1 / 900], [2800, 1 / 900], [2900, 0], [3450, 0], [3550, -1 / 1000],
  [3750, -1 / 1000], [3820, 0], [4100, 0], [4200, 1 / 650], [4500, 1 / 650], [4600, 0], [4800, 0],
  [4900, -1 / 600], [5200, -1 / 600], [5300, 0], [LENGTH + 400, 0],
];
// 勾配の制御点 [s, ‰]
const GRADE: [number, number][] = [
  [0, 0], [600, 0], [700, 3], [1600, 3], [1700, 0], [2300, 0], [2400, 6], [3000, 6], [3100, 0],
  [4100, 0], [4200, 18], [5450, 18], [5530, 0], [LENGTH + 400, 0],
];

export const LIMITS: Limit[] = [
  { from: 0, to: 520, kmh: 45 },
  { from: 1250, to: 1700, kmh: 75 },
  { from: 4150, to: 4650, kmh: 70 },
  { from: 4850, to: 5300, kmh: 65 },
  { from: 5450, to: LENGTH + 400, kmh: 45 },
];
export const MAX_KMH = 85;

/** 駅ごとの場内・出発信号を作る */
export function stationSignals(stations: Station[], homeDist = 520): Signal[] {
  const out: Signal[] = [];
  stations.forEach((st, i) => {
    if (i > 0) out.push({ s: st.stop - homeDist, kind: 'home', station: i });
    if (i < stations.length - 1) out.push({ s: st.stop + 25, kind: 'start', station: i });
  });
  return out;
}

export const SIGNALS: Signal[] = stationSignals(STATIONS);
for (const s of [1100, 3000, 4900]) SIGNALS.push({ s, kind: 'block' });
SIGNALS.sort((a, b) => a.s - b.s);

export const CROSSINGS: Crossing[] = [{ s: 1000 }, { s: 2920 }];
export const TUNNEL = { from: 4330, to: 4720 };
export const BRIDGE = { from: 3150, to: 3260, river: 3205 };
export const WHISTLES: Whistle[] = [
  ...CROSSINGS.map((c) => ({ s: c.s - 250 })),
  { s: TUNNEL.from - 200 },
];

/** 都市部（浜田のまわり）。平らな町がひろく続く */
export const CITY = { from: 1250, to: 2900 };
export type Zone = 'coast' | 'town' | 'paddy' | 'forest';
export function zoneAt(s: number): Zone {
  if (s < 480) return 'town';
  if (s < CITY.from) return 'coast';
  if (s < CITY.to) return 'town';
  if (s < 3820) return 'paddy';
  if (s < 4080) return 'town';
  if (s > 5480) return 'town';
  return 'forest';
}

export const MAIN = Path.integrate({ x: 0, y: 6, z: 0, th: 0 }, LENGTH + 400, (u) => interp(CURV, u), (u) => interp(GRADE, u) / 1000);

export const HIKARI: Route = {
  id: 'hikari', name: 'ひかり野線', kana: 'ひかりのせん', color: '#1f6fb4', note: '海辺の潮見台から、浜田の町、田んぼと川、トンネルを抜けて山あいの山ノ口へ',
  path: MAIN, stations: STATIONS, limits: LIMITS, signals: SIGNALS, whistles: WHISTLES, maxKmh: MAX_KMH,
};

// ---- ひかり野線を指す、これまでの名前（地形や町の作りで使う） ----
export function at(s: number, d = 0): Frame { return MAIN.at(s, d); }
export const railY = (s: number) => MAIN.at(s).y;
export const gradeAt = (s: number) => MAIN.gradeAt(s);
export const curvatureAt = (s: number) => MAIN.curvatureAt(s);
export function nearest(x: number, z: number): { s: number; d: number } { const r = MAIN.nearest(x, z); return { s: Math.max(0, Math.min(MAIN.length, r.s)), d: r.d }; }

export function limitAt(s: number, limits: Limit[] = LIMITS, max = MAX_KMH): number {
  let v = max;
  for (const l of limits) if (s >= l.from && s < l.to) v = Math.min(v, l.kmh);
  return v;
}

export function fmtTime(t: number): string {
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ---- 貨物列車：ひかり野線の線路を、潮見台（となりの潮見貨物駅）から山ノ口まで。途中の駅は通過 ----
const F_STATIONS: Station[] = [
  { ...STATIONS[0], name: '潮見台', arr: T(7, 0, 0), dep: T(7, 0, 45) },
  { ...STATIONS[STATIONS.length - 1], arr: T(7, 8, 0), dep: T(7, 8, 0) },
];
const F_SIGNALS: Signal[] = stationSignals(F_STATIONS);
for (const s of [1100, 2150 + 25, 3000, 3950 + 25, 4900]) F_SIGNALS.push({ s, kind: 'block' });
F_SIGNALS.sort((a, b) => a.s - b.s);
export const FREIGHT: Route = {
  id: 'freight', name: '貨物列車', kana: 'かもつれっしゃ', color: '#8a2747',
  note: '潮見貨物駅で待つ 12ft コンテナを積んで、途中の駅は通過して山ノ口へ。トラックのゲームとつながる',
  path: MAIN, stations: F_STATIONS, limits: LIMITS, signals: F_SIGNALS, whistles: WHISTLES, maxKmh: 75,
  track: 'hikari', freight: true,
};
