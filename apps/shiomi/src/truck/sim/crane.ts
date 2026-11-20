// 門型クレーンの吊り具の動き。
// 位置はレーンの座標（along = レーンの前方向、lateral = 右）で考える。
// 吊り点（台車）を動かすと、吊ったコンテナが振り子のように揺れる。
// 揺れを抑えて、シャーシの真上にぴたりと下ろし、ロックする。

export const CRANE_TOL = { along: 0.15, lateral: 0.15, yaw: 2 * Math.PI / 180 };
export const SAFE_LAND = 0.3;   // これより速く下ろすと、ぶつけたことになる（m/s）
const G = 9.81;
const MAX_V = 1.2;      // 台車と門型の速さの上限（m/s）
const ACC = 0.9;        // 速さの変わり方（m/s²）。急に動かすほど揺れる
const HOIST_V = 0.6;    // 巻き上げ・巻き下げの速さの上限（m/s）
const SKEW_V = 2 * Math.PI / 180; // 吊り具を回す速さ（rad/s）
const DAMP = 0.32;      // 揺れの自然な収まり
const TOP = 15;         // 吊り点の高さ（シャーシの荷台から）
export const MAX_H = 8; // コンテナの底を上げられる高さ（荷台から）

export interface CraneInput { along: number; lateral: number; hoist: number; skew: number; } // それぞれ -1〜1
export interface Chassis { along: number; lateral: number; yaw: number; } // レーンから見たシャーシの位置

export class Crane {
  // 吊り点（台車）の位置と速さ
  ga = 0; gl = 0; va = 0; vl = 0;
  // 揺れ（吊り点からのずれ）と、その速さ
  sa = 0; sl = 0; wa = 0; wl = 0;
  h = 6;        // コンテナの底の、荷台からの高さ
  vh = 0;
  skew = 0;     // 吊り具の向き（右が正）
  landed = false;
  locked = false;
  blocked = false; // ずれたまま下ろそうとして、荷台の端に当たっている
  bumps = 0;       // 強く下ろしてぶつけた回数

  constructor(startAlong = 0, startLateral = 0, h = 6) { this.ga = startAlong; this.gl = startLateral; this.h = h; }

  /** コンテナの位置（揺れを含む） */
  get along() { return this.ga + this.sa; }
  get lateral() { return this.gl + this.sl; }
  get rope() { return Math.max(1.5, TOP - this.h - 2.59); }
  get swing() { return Math.hypot(this.sa, this.sl); }

  /** シャーシとのずれ（コンテナ − シャーシ） */
  error(c: Chassis) { return { along: this.along - c.along, lateral: this.lateral - c.lateral, yaw: this.skew - c.yaw }; }
  aligned(c: Chassis): boolean {
    const e = this.error(c);
    return Math.abs(e.along) <= CRANE_TOL.along && Math.abs(e.lateral) <= CRANE_TOL.lateral && Math.abs(e.yaw) <= CRANE_TOL.yaw;
  }

  step(inp: CraneInput, c: Chassis, dt: number) {
    if (this.locked) return;
    // 着地している間は、上げる以外の動きはしない
    const low = this.h < 0.4;
    const k = this.landed ? 0 : low ? 0.25 : 1; // 荷台の近くでは、ゆっくりしか動かない
    const move = (v: number, want: number) => v + Math.sign(want - v) * Math.min(Math.abs(want - v), ACC * dt);
    const va0 = this.va, vl0 = this.vl;
    this.va = move(this.va, clamp(inp.along) * MAX_V * k);
    this.vl = move(this.vl, clamp(inp.lateral) * MAX_V * k);
    const aa = (this.va - va0) / dt, al = (this.vl - vl0) / dt;
    this.ga += this.va * dt; this.gl += this.vl * dt;
    if (!this.landed) this.skew += clamp(inp.skew) * SKEW_V * dt;

    // 振り子：吊り点が加速すると、コンテナはうしろへ残る
    const w2 = G / this.rope;
    if (this.landed) { this.sa = this.sl = this.wa = this.wl = 0; }
    else {
      this.wa += (-w2 * this.sa - aa - DAMP * this.wa) * dt;
      this.wl += (-w2 * this.sl - al - DAMP * this.wl) * dt;
      this.sa += this.wa * dt; this.sl += this.wl * dt;
    }

    // 巻き上げ・巻き下げ
    this.vh = clamp(inp.hoist) * HOIST_V;
    let nh = Math.min(MAX_H, this.h + this.vh * dt);
    if (this.landed) {
      if (this.vh > 0) { this.landed = false; this.h = nh; }
      return;
    }
    // 隅の金具が合っていなければ、荷台の端に乗って、それより下がらない
    const ok = this.aligned(c) && this.swing < 0.05;
    const floor = ok ? 0 : 0.12;
    const was = this.blocked;
    this.blocked = false;
    if (nh <= floor) {
      if (-this.vh > SAFE_LAND && !was) this.bumps++;
      nh = floor;
      if (ok) { this.landed = true; this.vh = 0; } else this.blocked = true;
    }
    this.h = nh;
  }

  lock(): boolean { if (this.landed) this.locked = true; return this.locked; }
}

function clamp(v: number) { return Math.max(-1, Math.min(1, v)); }
