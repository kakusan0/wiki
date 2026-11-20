// 港町（トラックの世界）を、ひかり野線の世界のどこに置くか。
// トラックのプログラムは、港町の中の座標（「港の座標」）で動く。世界の座標 = 港の座標 + OFFSET。
// ・港町は潮見台の北。臨港道路（港の座標で z = 0 の東西の道）は、s 600 の踏切で線路を渡る
// ・港町の地面の高さは、そこの線路の路盤の高さ（レール面 − 0.8 m）にそろえる
import { at } from '../train/route';

/** 臨港道路が線路を渡る踏切の位置（ひかり野線の s） */
export const CROSS_S = 600;
/** 港の座標で、踏切のある所（臨港道路の上） */
export const CROSS_LOCAL = { x: 300, z: 0 };
const c0 = at(CROSS_S);
/** 港町の地面の高さ（世界の y）。レール面より 0.8 m 下（路盤の高さ） */
export const PORT_Y = c0.y - 0.8;
/** 世界の座標 = 港の座標 + OFFSET */
export const OFFSET = { x: c0.x - CROSS_LOCAL.x, y: PORT_Y, z: c0.z - CROSS_LOCAL.z };

export const toWorld = (x: number, z: number) => ({ x: x + OFFSET.x, z: z + OFFSET.z });
export const toLocal = (x: number, z: number) => ({ x: x - OFFSET.x, z: z - OFFSET.z });

/** 複線の真ん中（左の線路が d = 0、右の線路が d = −4） */
export const TRACK_MID = -2;

const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
interface Rect { x0: number; x1: number; z0: number; z1: number; }
/** 四角の中で 1、外へ fall m で 0 になる重み（港の座標） */
function rectW(r: Rect, x: number, z: number, fall: number): number {
  const dx = Math.max(r.x0 - x, x - r.x1, 0), dz = Math.max(r.z0 - z, z - r.z1, 0);
  return 1 - smooth(0, fall, Math.hypot(dx, dz));
}

/** 港町の陸（港の座標）。線路の西側は、港の積み込み場と貨物駅のまわりだけ（潮見台の西の町は残す） */
export const LAND: Rect = { x0: -46, x1: 1700, z0: -680, z1: 1240 };
const WEST_NORTH: Rect = { x0: -46, x1: 400, z0: -680, z1: 100 };   // 積み込み場と、その北
const STATION_LOT: Rect = { x0: 120, x1: 400, z0: 760, z1: 1000 };  // 潮見貨物駅
/** 港の前の海（港の座標）：岸壁（x = −46）より西 */
export const SEA: Rect = { x0: -1600, x1: -47, z0: -1100, z1: 160 };

/**
 * 港町の陸の重み（0〜1）。世界の座標と、線路からの横の位置 d（左が正）を受け取る。
 * 線路の東側（d < 真ん中 − 12 m）は港町の範囲の中ぜんぶ、西側は積み込み場と貨物駅のまわりだけ。
 */
export function portLand(wx: number, wz: number, d: number): number {
  const { x, z } = toLocal(wx, wz);
  const all = rectW(LAND, x, z, 70);
  if (all <= 0) return 0;
  const east = 1 - smooth(TRACK_MID - 14, TRACK_MID + 6, d); // 線路の東（右）側で 1
  const west = Math.max(rectW(WEST_NORTH, x, z, 70), rectW(STATION_LOT, x, z, 50));
  return all * Math.max(east, west);
}
/** 港の前の海の重み（0〜1） */
export function portSea(wx: number, wz: number): number {
  const { x, z } = toLocal(wx, wz);
  return rectW(SEA, x, z, 90);
}
/** 世界の座標が港町の中か（建物や木を置かない所） */
export function inPort(wx: number, wz: number, d: number): boolean {
  return portLand(wx, wz, d) > 0.02 || portSea(wx, wz) > 0.02;
}

// ---- 港町の中の線路（港の座標） ----
export interface RailPt { s: number; x: number; z: number; dx: number; dz: number; }
/** 複線の真ん中の線を、港の座標で s0〜s1 まで step m ごとに */
export function railLocal(s0 = -300, s1 = 1900, step = 10): RailPt[] {
  const out: RailPt[] = [];
  for (let s = s0; s <= s1 + 1e-6; s += step) {
    const f = at(s, TRACK_MID);
    out.push({ s, x: f.x - OFFSET.x, z: f.z - OFFSET.z, dx: f.dx, dz: f.dz });
  }
  return out;
}
/** 港の座標の点から、線路（複線の真ん中）までの距離と、そこの s */
export function railDist(x: number, z: number, pts: RailPt[] = RAIL): { d: number; s: number } {
  let best = { d: Infinity, s: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const vx = b.x - a.x, vz = b.z - a.z, L2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / L2));
    const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
    if (d < best.d) best = { d, s: a.s + (b.s - a.s) * t };
  }
  return best;
}
export const RAIL = railLocal();

// ---- 踏切の道の高さ ----
/** 踏切の板（レール面の高さ）の、港町の地面からの高さ */
export const DECK_H = 0.8;
/** 臨港道路が踏切を渡る所で、地面から持ち上げる高さ（線路の 5 m 以内は平ら、14 m で 0） */
export function roadLift(x: number, z: number): number {
  if (Math.abs(z - CROSS_LOCAL.z) > 12 || Math.abs(x - CROSS_LOCAL.x) > 40) return 0;
  const r = railDist(x, z);
  return DECK_H * (1 - smooth(5, 14, r.d));
}
