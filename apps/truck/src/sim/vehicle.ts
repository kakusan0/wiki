// トラックの動き（上から見た 2 次元）。
// 向き h は「前が (cos h, -sin h)」。three.js の rotation.y = h にそのまま使える（左へ曲がると h が増える）。
// 位置 (x, z) はトラクター（または単車）の後ろの車軸の真ん中。
// トレーラーは、連結点（キングピン）に引かれて、車軸が横すべりしないように付いてくる。

export interface TruckSpec {
  kind: 'semi' | 'rigid';
  wheelbase: number;   // 前の車軸からうしろの車軸まで（m）
  front: number;       // うしろの車軸から車体の先まで（m）
  rear: number;        // うしろの車軸から車体のうしろまで（m）。semi はトラクターのみ
  width: number;
  hitch: number;       // うしろの車軸から連結点まで（前が正）
  trailerLen: number;  // 連結点からトレーラーの車軸の真ん中まで
  trailerFront: number; // 連結点からトレーラーの先まで
  trailerRear: number;  // トレーラーの車軸からトレーラーのうしろまで
  maxSteer: number;    // 前輪の切れ角の上限（rad）
  mass: number;        // 空のときの重さ（kg）
  power: number;       // エンジンの出力（W）
  maxForce: number;    // 低い速度での駆動力の上限（N）
  brakeForce: number;  // ブレーキの力の上限（N）
}

export const SEMI_40: TruckSpec = {
  kind: 'semi', wheelbase: 3.9, front: 5.4, rear: 1.0, width: 2.49,
  hitch: 0.25, trailerLen: 9.4, trailerFront: 1.6, trailerRear: 2.6,
  maxSteer: 0.62, mass: 13000, power: 290000, maxForce: 52000, brakeForce: 180000,
};

export const RIGID_12FT: TruckSpec = {
  kind: 'rigid', wheelbase: 6.6, front: 7.75, rear: 2.05, width: 2.49,
  hitch: 0, trailerLen: 0, trailerFront: 0, trailerRear: 0,
  maxSteer: 0.6, mass: 11000, power: 280000, maxForce: 48000, brakeForce: 170000,
};

export interface TruckState {
  x: number; z: number; h: number;
  tx: number; tz: number; th: number; // トレーラーの車軸の真ん中と向き
  v: number;        // 前向きが正（m/s）
  steer: number;    // 前輪の切れ角（rad、右が正）
  cargo: number;    // 積んでいる重さ（kg）
  odo: number;      // 進んだ道のり（車輪の回転に使う）
  jackknife: boolean;
}

export interface Controls {
  throttle: number; // 0〜1
  brake: number;    // 0〜1
  steer: number;    // -1（左）〜 1（右）
  reverse: boolean;
}

export const JACKKNIFE = 75 * Math.PI / 180;
const G = 9.81;
const MAX_DECEL = 7.0;      // タイヤが滑らない範囲のブレーキ
const REVERSE_MAX = 2.5;    // 後退は時速 9 km まで
const STEER_RATE = 1.4;     // 前輪を切る速さ（rad/s）

export function fwd(h: number): [number, number] { return [Math.cos(h), -Math.sin(h)]; }
export function wrap(a: number): number { return Math.atan2(Math.sin(a), Math.cos(a)); }

export function createState(spec: TruckSpec, x = 0, z = 0, h = 0, cargo = 0): TruckState {
  const [fx, fz] = fwd(h);
  const kx = x + fx * spec.hitch, kz = z + fz * spec.hitch;
  return {
    x, z, h, v: 0, steer: 0, cargo, odo: 0, jackknife: false,
    tx: kx - fx * spec.trailerLen, tz: kz - fz * spec.trailerLen, th: h,
  };
}

export function totalMass(spec: TruckSpec, s: TruckState): number { return spec.mass + s.cargo; }

/** 速いほどハンドルの効きを弱める（高い速度で急に曲がらないように） */
export function steerLimit(spec: TruckSpec, v: number): number {
  const k = Math.abs(v) / 11;
  return spec.maxSteer / (1 + k * k);
}

/** 曲がるときのトレーラーの折れ角（トラクターの向き − トレーラーの向き） */
export function articulation(s: TruckState): number { return wrap(s.h - s.th); }

export function step(spec: TruckSpec, s: TruckState, c: Controls, dt: number): void {
  const m = totalMass(spec, s);
  // ---- 前後の動き ----
  if (!s.jackknife) {
    const dir = c.reverse ? -1 : 1;
    const va = Math.abs(s.v);
    let drive = c.throttle * Math.min(spec.maxForce, spec.power / Math.max(va, 1));
    if (c.reverse && va > REVERSE_MAX) drive = 0;
    s.v += dir * drive / m * dt;
  }
  const resist = 0.008 * m * G + 0.5 * 1.2 * 6.5 * s.v * s.v;
  const brakeDecel = Math.min(MAX_DECEL, c.brake * spec.brakeForce / m);
  const slow = (resist / m + brakeDecel + (s.jackknife ? MAX_DECEL : 0)) * dt;
  if (Math.abs(s.v) <= slow) s.v = 0; else s.v -= Math.sign(s.v) * slow;

  // ---- ハンドル ----
  const lim = steerLimit(spec, s.v);
  const want = Math.max(-1, Math.min(1, c.steer)) * lim;
  const d = want - s.steer;
  s.steer += Math.sign(d) * Math.min(Math.abs(d), STEER_RATE * dt);

  // ---- 位置と向き（自転車のモデル） ----
  const dist = s.v * dt;
  s.odo += dist;
  s.h = wrap(s.h - dist / spec.wheelbase * Math.tan(s.steer));
  const [fx, fz] = fwd(s.h);
  s.x += fx * dist; s.z += fz * dist;

  if (spec.kind === 'semi') {
    // トレーラーの車軸は、連結点との距離を保ったまま、軸の向きにだけ動く
    const kx = s.x + fx * spec.hitch, kz = s.z + fz * spec.hitch;
    let dx = kx - s.tx, dz = kz - s.tz;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    s.tx = kx - dx * spec.trailerLen; s.tz = kz - dz * spec.trailerLen;
    s.th = Math.atan2(-dz, dx);
    if (Math.abs(articulation(s)) > JACKKNIFE) s.jackknife = true;
  } else {
    s.tx = s.x; s.tz = s.z; s.th = s.h;
  }
}

/** 車体の四隅（当たり判定と描画の目安）。semi はトラクターとトレーラーの 2 つの長方形 */
export interface Box { cx: number; cz: number; h: number; len: number; wid: number; off?: boolean; }
export function bodies(spec: TruckSpec, s: TruckState): Box[] {
  const [fx, fz] = fwd(s.h);
  const lenT = spec.front + spec.rear;
  const off = (spec.front - spec.rear) / 2;
  const out: Box[] = [{ cx: s.x + fx * off, cz: s.z + fz * off, h: s.h, len: lenT, wid: spec.width }];
  if (spec.kind === 'semi') {
    const [gx, gz] = fwd(s.th);
    const lenR = spec.trailerFront + spec.trailerLen + spec.trailerRear;
    const offR = (spec.trailerFront + spec.trailerLen) - lenR / 2; // 車軸から見た中心（前が正）
    out.push({ cx: s.tx + gx * offR, cz: s.tz + gz * offR, h: s.th, len: lenR, wid: spec.width });
  }
  return out;
}

/** 荷台（コンテナを載せる所）の中心と向き。semi はトレーラー、単車は荷台 */
export function cargoPose(spec: TruckSpec, s: TruckState): { x: number; z: number; h: number } {
  if (spec.kind === 'semi') {
    const b = bodies(spec, s)[1];
    return { x: b.cx, z: b.cz, h: b.h };
  }
  const [fx, fz] = fwd(s.h);
  const c = (spec.front - 2.4 - spec.rear) / 2; // 荷台の真ん中（運転台のうしろから車体のうしろまで）
  return { x: s.x + fx * c, z: s.z + fz * c, h: s.h };
}
