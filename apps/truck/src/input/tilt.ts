// スマホの傾き（ハンドル）。
// 重力の向き（devicemotion の accelerationIncludingGravity）の、画面の面の中での回り方を見る。
// 「まっすぐ」を合わせた時の向きとの角度だけを使うので、
//  ・横向きの左右どちらで持っても
//  ・iPhone と Android で値の符号が逆でも
// 同じ向きに効く（どちらも回転なので、2 つのベクトルの間の角度は変わらない）。

export interface V2 { x: number; y: number; }
export interface V3 extends V2 { z: number; }

/** 合わせた向き v0 から、いまの向き v までの角度（rad）。正 = 画面を時計回りに傾けた = 右へ切る */
export function tiltAngle(v0: V2, v: V2): number {
  const cross = v0.x * v.y - v0.y * v.x;
  const dot = v0.x * v.x + v0.y * v.y;
  return Math.atan2(cross, dot);
}

export interface SteerOpts { dead: number; range: number; sens: number; }
export const STEER_DEFAULT: SteerOpts = { dead: 2 * Math.PI / 180, range: 40 * Math.PI / 180, sens: 1 };

/** 画面の面からの持ち上がり（rad）。画面が上を向くほど大きい（符号は端末の流儀 s で直す） */
export function elevation(v: V3): number { return Math.atan2(v.z, Math.hypot(v.x, v.y)); }

/**
 * 端末の値の流儀：Android は「上向き」、iPhone は「下向き（重力そのもの）」を返す。
 * 横向きの画面の上下の向き（screen.orientation.angle）で画面の座標に直し、どちらの流儀かを見分ける。
 */
export function convention(v: V2, angleDeg: number): 1 | -1 {
  const a = angleDeg * Math.PI / 180;
  const yScreen = v.x * Math.sin(a) + v.y * Math.cos(a);
  return yScreen >= 0 ? 1 : -1;
}

/** 傾き（rad）→ ハンドル（-1〜1）。真ん中の少しは遊び、±range で切れきる */
export function steerFromTilt(a: number, o: SteerOpts = STEER_DEFAULT): number {
  const m = Math.abs(a);
  if (m <= o.dead) return 0;
  const t = Math.min(1, ((m - o.dead) / (o.range - o.dead)) * o.sens);
  // 真ん中付近をやわらかく（細かい直しをしやすく）
  const curved = t * (0.55 + 0.45 * t);
  return Math.sign(a) * curved;
}

/** 傾きの読み取り：許可、まっすぐの合わせ直し、なめらかさ */
export class Tilt {
  enabled = false;
  roll = 0;   // なめらかにした傾き（rad）。景色を水平に保つのにも使う
  private g: V3 | null = null;
  private zero: V3 | null = null;
  pitch = 0; // 前後の傾き（rad）。画面の上の端を向こうへ倒すと正
  opts: SteerOpts = { ...STEER_DEFAULT };

  /** iPhone はボタンを押した時に許可を求める必要がある */
  async start(): Promise<boolean> {
    const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    let ok = true;
    try {
      if (DM?.requestPermission) ok = (await DM.requestPermission()) === 'granted';
    } catch { ok = false; }
    // 許可の答えにかかわらず聞いておく（許可がなければ、そもそも届かない）
    window.addEventListener('devicemotion', this.onMotion);
    return ok;
  }

  private onMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null || a.y == null) return;
    // 手のぶれを抑える（ゆっくりした傾きだけを残す）
    const z = a.z ?? 0;
    if (!this.g) { this.g = { x: a.x, y: a.y, z }; this.recenter(0.6); }
    else { this.g.x += (a.x - this.g.x) * 0.2; this.g.y += (a.y - this.g.y) * 0.2; this.g.z += (z - this.g.z) * 0.2; }
    if (Math.hypot(this.g.x, this.g.y) < 2.5) return; // 寝かせすぎ：向きが読めない
    this.enabled = true;
  };

  private until = 0; // 「まっすぐ」を決める時刻（ms）。押した手が落ち着くまで待つ

  /** いまの傾きを「まっすぐ」にする。delay 秒だけ待ってから決める（ボタンを押した手が落ち着くまで） */
  recenter(delay = 0.4) {
    this.zero = null;
    this.until = performance.now() + delay * 1000;
    this.roll = 0;
    this.pitch = 0;
  }

  /** 「まっすぐ」を決めるのを待っているところ */
  get settling(): boolean { return this.zero === null && this.g !== null; }

  /** 1 コマごとに呼ぶ */
  update(dt: number): number {
    if (!this.enabled || !this.g) return 0;
    if (!this.zero) {
      if (performance.now() < this.until) return 0;
      this.zero = { ...this.g };
    }
    const a = tiltAngle(this.zero, this.g);
    this.roll += (a - this.roll) * Math.min(1, dt * 18);
    const ang = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
    const sgn = convention(this.zero, ang);
    const p = (elevation(this.g) - elevation(this.zero)) * sgn;
    this.pitch += (p - this.pitch) * Math.min(1, dt * 18);
    return steerFromTilt(this.roll, this.opts);
  }
}
