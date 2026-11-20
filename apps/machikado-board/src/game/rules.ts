// ルールの計算（状態を変えない関数だけ）
import { getMap } from './maps';
import type { GameState } from './state';

export const STOCK_LOT = 10; // 売買の単位
export const MAX_SHARES = 500; // 1 人が 1 つの通りで持てる上限
export const DEMAND_MIN = 0.5;
export const DEMAND_MAX = 1.8;
export const DEMAND_STEP = 1.02; // 10 株ごとに ±2%
export const DEMAND_DECAY = 0.15; // 毎ラウンド 1 倍へ 15% 戻る
export const BUYOUT_MULT = 4;
export const BUYOUT_OWNER_SHARE = 0.7;
export const LIQUIDATE_RATE = 0.75;
export const FEE_RATES = [0.15, 0.25, 0.35, 0.5]; // 同じ通りの所有数 1〜4（それ以上は 4 と同じ）
export const MONOPOLY_BONUS = 0.1;
export const TOP_HOLDER_MIN = 50;
export const TOP_HOLDER_RATE = 0.1;
export const EASY_FEE_RATE = 0.2;

export const salary = (level: number) => 200 + level * 60;

export function streetSquares(state: GameState, street: number): number[] {
  return getMap(state.mapId).squares.filter((s) => s.kind === 'shop' && s.street === street).map((s) => s.id);
}

export function ownedInStreet(state: GameState, street: number, pid: number): number {
  return streetSquares(state, street).filter((id) => state.props[id]?.owner === pid).length;
}

export function isMonopoly(state: GameState, street: number, pid: number): boolean {
  const sq = streetSquares(state, street);
  return sq.length > 0 && sq.every((id) => state.props[id]?.owner === pid);
}

// かんたんモード：つながったマスに同じ持ち主の店が 1 軒なら ×1.5、2 軒以上なら ×2
export function adjacencyMult(state: GameState, sq: number): number {
  const map = getMap(state.mapId);
  const owner = state.props[sq]?.owner;
  if (owner == null) return 1;
  const k = map.links[sq].filter((j) => map.squares[j].kind === 'shop' && state.props[j]?.owner === owner).length;
  return k >= 2 ? 2 : k === 1 ? 1.5 : 1;
}

export function feeRate(state: GameState, sq: number): number {
  const s = getMap(state.mapId).squares[sq];
  const p = state.props[sq];
  if (!p || p.owner == null || s.kind !== 'shop') return 0;
  if (state.mode === 'easy') return EASY_FEE_RATE * adjacencyMult(state, sq);
  const k = ownedInStreet(state, s.street!, p.owner);
  const r = FEE_RATES[Math.min(k, FEE_RATES.length) - 1];
  return r + (isMonopoly(state, s.street!, p.owner) ? MONOPOLY_BONUS : 0);
}

// 空き地の施設の利用料
export function lotFee(state: GameState, sq: number): number {
  const p = state.props[sq];
  if (!p || p.owner == null) return 0;
  if (p.facility === 'yatai') {
    const shops = state.props.filter((x, i) => x?.owner === p.owner && getMap(state.mapId).squares[i].kind === 'shop').length;
    return 40 + 15 * shops;
  }
  return 30; // 両替所の手数料
}

export function fee(state: GameState, sq: number): number {
  const s = getMap(state.mapId).squares[sq];
  const p = state.props[sq];
  if (!p || p.owner == null || state.players[p.owner].closed) return 0;
  if (s.kind === 'lot') return lotFee(state, sq);
  return Math.round(p.value * feeRate(state, sq));
}

export function investCap(state: GameState, sq: number): number {
  const s = getMap(state.mapId).squares[sq];
  const p = state.props[sq];
  if (!p || p.owner == null || s.kind !== 'shop' || state.mode === 'easy') return 0;
  if (isMonopoly(state, s.street!, p.owner)) return s.base! * 3;
  return Math.round(s.base! * (1 + 0.5 * ownedInStreet(state, s.street!, p.owner)));
}

// あと何 G 増資できるか（上限 − いまの価値）。持ち主のいないお店は 0
export function investRoom(state: GameState, sq: number): number {
  const p = state.props[sq];
  if (!p || p.owner == null) return 0;
  return Math.max(0, investCap(state, sq) - p.value);
}

// 通り全体の増資の余地（お店ごとの余地の合計）
export function streetInvestRoom(state: GameState, street: number): number {
  return streetSquares(state, street).reduce((a, id) => a + investRoom(state, id), 0);
}

export function streetValue(state: GameState, street: number): number {
  return streetSquares(state, street).reduce((a, id) => a + (state.props[id]?.value ?? 0), 0);
}

export function stockPrice(state: GameState, street: number): number {
  return Math.max(1, Math.round((10 + streetValue(state, street) / 40) * state.demand[street]));
}

// 買うときの合計（1 単位ごとに株価が上がる）と、買ったあとの需給
export function buyQuote(state: GameState, street: number, lots: number): { cost: number; demand: number } {
  let d = state.demand[street];
  let cost = 0;
  const base = 10 + streetValue(state, street) / 40;
  for (let i = 0; i < lots; i++) {
    cost += Math.max(1, Math.round(base * d)) * STOCK_LOT;
    d = Math.min(DEMAND_MAX, d * DEMAND_STEP);
  }
  return { cost, demand: d };
}

// 売るときは先に株価が下がる（買ってすぐ売っても得をしない）
export function sellQuote(state: GameState, street: number, lots: number): { gain: number; demand: number } {
  let d = state.demand[street];
  let gain = 0;
  const base = 10 + streetValue(state, street) / 40;
  for (let i = 0; i < lots; i++) {
    d = Math.max(DEMAND_MIN, d / DEMAND_STEP);
    gain += Math.max(1, Math.round(base * d)) * STOCK_LOT;
  }
  return { gain, demand: d };
}

// 持っている株をいま全部売ったときに入るお金（売るたびに株価が下がる分も含める）
export function sellableCash(state: GameState, pid: number): number {
  const p = state.players[pid];
  if (state.mode !== 'normal') return 0;
  return p.shares.reduce((a, n, st) => a + (n > 0 ? sellQuote(state, st, n / STOCK_LOT).gain : 0), 0);
}

export function shopAssets(state: GameState, pid: number): number {
  return state.props.reduce((a, p) => a + (p?.owner === pid ? p.value : 0), 0);
}

export function stockAssets(state: GameState, pid: number): number {
  return state.players[pid].shares.reduce((a, n, st) => a + n * stockPrice(state, st), 0);
}

export function netWorth(state: GameState, pid: number): number {
  const pl = state.players[pid];
  if (pl.bankrupt) return 0;
  return pl.cash + shopAssets(state, pid) + stockAssets(state, pid);
}

// 筆頭株主（50 株以上で単独 1 位）。いなければ null
export function topHolder(state: GameState, street: number): number | null {
  let best: number | null = null;
  let max = 0;
  let tie = false;
  for (const p of state.players) {
    const n = p.shares[street];
    if (n > max) { max = n; best = p.id; tie = false; } else if (n === max && n > 0) tie = true;
  }
  return max >= TOP_HOLDER_MIN && !tie ? best : null;
}

// 1 回の利用料で配当：2 株につき 1G
export const dividendFor = (shares: number) => Math.floor(shares / 2);

export function canBuyout(state: GameState, sq: number, pid: number): boolean {
  const s = getMap(state.mapId).squares[sq];
  const p = state.props[sq];
  if (state.mode !== 'normal' || s.kind !== 'shop' || !p || p.owner == null || p.owner === pid) return false;
  if (isMonopoly(state, s.street!, p.owner)) return false; // 独占した通りの店は買収できない
  return state.players[pid].cash >= p.value * BUYOUT_MULT;
}
