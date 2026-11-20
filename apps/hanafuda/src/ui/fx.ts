// 演出の状態：演出の時計（ヒットストップ・スロー）、火花・衝撃波・光の柱・画面効果、カメラの動き
import type { PillarDraw, RingDraw } from './gl/stage';
import { SPARK_MAX, SPARK_STRIDE } from './gl/stage';
import { qAxis, model, type Vec3 } from './gl/math';

interface Spark { p: Vec3; v: Vec3; life: number; max: number; c: Vec3; size: number }
interface Ring { c: Vec3; t0: number; dur: number; r: number; w: number; color: Vec3; a: number }
interface Pillar { c: Vec3; t0: number; dur: number; h: number; w: number; color: Vec3 }

export class Fx {
  lite = false;
  speed = 1; // 画面テストの速送り
  mobile = false;
  // 演出の時計（秒）
  at = 0;
  private stopLeft = 0; // ヒットストップの残り（実時間）
  private slowLeft = 0;
  private slowRate = 1;
  // 火花など
  private sparks: Spark[] = [];
  private ringsList: Ring[] = [];
  private pillarsList: Pillar[] = [];
  readonly sparkBuf = new Float32Array(SPARK_MAX * SPARK_STRIDE);
  // 画面効果
  flash = 0; flashColor: Vec3 = [1, 1, 1];
  speedLines = 0;
  vignette = 0; private vignetteTo = 0;
  red = 0; heartbeat = false;
  dim = 0; private dimTo = 0;
  // カメラ
  focus: Vec3 | null = null; private focusCur: Vec3 = [0, 0, 0];
  dist = 0; private distCur = 0;
  orbit = 0; private orbitCur = 0;
  private orbitAnim: { from: number; to: number; t0: number; dur: number } | null = null;
  fovKick = 0;
  shake = 0; shakeV = 0;

  // 実時間 dt から、演出の時計を進める
  tick(dt: number): number {
    let adt = dt;
    if (this.stopLeft > 0) { this.stopLeft -= dt; adt = 0; }
    else if (this.slowLeft > 0) { this.slowLeft -= dt; adt = dt * this.slowRate; }
    this.at += adt;
    // 火花
    let n = 0;
    for (const s of this.sparks) {
      s.life += adt;
      if (s.life >= s.max) continue;
      s.v[1] -= 7 * adt;
      const drag = Math.exp(-adt * 1.6);
      s.v[0] *= drag; s.v[2] *= drag;
      s.p[0] += s.v[0] * adt; s.p[1] += s.v[1] * adt; s.p[2] += s.v[2] * adt;
      if (s.p[1] < -0.85) { s.p[1] = -0.85; s.v[1] *= -0.35; }
      this.sparks[n++] = s;
    }
    this.sparks.length = n;
    this.ringsList = this.ringsList.filter((r) => this.at - r.t0 < r.dur);
    this.pillarsList = this.pillarsList.filter((p) => this.at - p.t0 < p.dur);
    // 画面効果（実時間で減る）
    this.flash *= Math.exp(-dt * 6);
    this.speedLines *= Math.exp(-dt * 3);
    this.red *= Math.exp(-dt * 3);
    if (this.heartbeat && !this.lite) {
      const ph = (this.at % 1.1) / 1.1;
      const beat = Math.exp(-((ph - 0.05) ** 2) / 0.002) + 0.7 * Math.exp(-((ph - 0.22) ** 2) / 0.002);
      this.red = Math.max(this.red, beat * 0.45);
    }
    this.vignette += (this.vignetteTo - this.vignette) * Math.min(1, dt * 3);
    this.dim += (this.dimTo - this.dim) * Math.min(1, dt * 3);
    // カメラ
    if (this.orbitAnim) {
      const k = Math.min(1, (this.at - this.orbitAnim.t0) / this.orbitAnim.dur);
      this.orbit = this.orbitAnim.from + (this.orbitAnim.to - this.orbitAnim.from) * (0.5 - Math.cos(k * Math.PI) / 2);
      if (k >= 1) this.orbitAnim = null;
    }
    const f = this.focus ?? this.focusCur;
    for (let i = 0; i < 3; i++) this.focusCur[i] += (f[i] - this.focusCur[i]) * Math.min(1, dt * 5);
    this.distCur += ((this.focus ? this.dist : 0) - this.distCur) * Math.min(1, dt * 3.5);
    this.orbitCur += (this.orbit - this.orbitCur) * Math.min(1, dt * 4);
    this.fovKick *= Math.exp(-dt * 7);
    this.shake *= Math.exp(-dt * 6);
    this.shakeV *= Math.exp(-dt * 8);
    return adt;
  }

  // ---------- 呼び出し ----------
  hitstop(sec: number) { if (!this.lite) this.stopLeft = Math.max(this.stopLeft, sec * this.speed); }
  slowmo(rate: number, sec: number) { if (!this.lite) { this.slowRate = rate; this.slowLeft = sec * this.speed; } }
  setDim(v: number) { this.dimTo = this.lite ? v * 0.5 : v; }
  setVignette(v: number) { this.vignetteTo = v; }
  doFlash(a: number, c: Vec3 = [1, 1, 1]) { this.flash = Math.max(this.flash, this.lite ? a * 0.4 : a); this.flashColor = c; }
  doShake(a: number, vertical = 0) { const k = this.lite ? 0.25 : 1; this.shake = Math.max(this.shake, a * k); this.shakeV = Math.max(this.shakeV, vertical * k); }
  kick(a: number) { if (!this.lite) this.fovKick = Math.max(this.fovKick, a); }
  camera(focus: Vec3 | null, dist = 0) { this.focus = focus; this.dist = this.lite ? dist * 0.5 : dist; }
  orbitTo(to: number, dur: number) { if (this.lite) return; this.orbitAnim = { from: this.orbit, to, t0: this.at, dur: dur * this.speed }; }
  resetOrbit() { this.orbitAnim = null; this.orbit = 0; }

  ring(c: Vec3, rMax: number, color: Vec3, dur = 0.6, w = 0.18, a = 1) {
    this.ringsList.push({ c: [c[0], Math.max(-0.85, c[1] - 0.2), c[2]], t0: this.at, dur: dur * this.speed, r: rMax, w, color, a });
  }
  pillar(c: Vec3, color: Vec3, dur = 2.2, h = 16, w = 2.2) { this.pillarsList.push({ c, t0: this.at, dur: dur * this.speed, h, w, color }); }

  burstSparks(c: Vec3, n: number, color: Vec3, power = 1, up = 0.6) {
    const max = this.mobile ? 280 : SPARK_MAX;
    n = Math.round(n * (this.lite ? 0.3 : 1) * (this.mobile ? 0.6 : 1));
    for (let i = 0; i < n && this.sparks.length < max; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1.5 + Math.random() * 5) * power;
      const tint = 0.6 + Math.random() * 0.4;
      this.sparks.push({
        p: [c[0], c[1] + 0.1, c[2]], v: [Math.cos(a) * sp, (up + Math.random()) * sp * 0.9, Math.sin(a) * sp],
        life: 0, max: 0.5 + Math.random() * 0.9, c: [color[0] * tint, color[1] * tint, color[2] * tint], size: 2 + Math.random() * 4,
      });
    }
  }

  // ---------- 描くためのデータ ----------
  sparkData(): number {
    const b = this.sparkBuf;
    let i = 0;
    for (const s of this.sparks) {
      const k = 1 - s.life / s.max;
      b[i++] = s.p[0]; b[i++] = s.p[1]; b[i++] = s.p[2];
      b[i++] = s.c[0] * k * 1.6; b[i++] = s.c[1] * k * 1.6; b[i++] = s.c[2] * k * 1.6;
      b[i++] = s.size * (0.4 + 0.6 * k);
    }
    return this.sparks.length;
  }
  rings(): RingDraw[] {
    return this.ringsList.map((r) => {
      const k = (this.at - r.t0) / r.dur;
      const e = 1 - (1 - k) ** 3;
      return { c: r.c, r: r.r * e, w: r.w * (1 + k * 2), color: r.color, a: r.a * (1 - k) * 1.6 };
    });
  }
  pillars(eye: Vec3): PillarDraw[] {
    return this.pillarsList.map((p) => {
      const k = (this.at - p.t0) / p.dur;
      const rise = Math.min(1, k * 5);
      const a = Math.min(1, k * 8) * (1 - Math.max(0, (k - 0.6) / 0.4));
      const yaw = Math.atan2(eye[0] - p.c[0], eye[2] - p.c[2]);
      const m = model(p.c, qAxis([0, 1, 0], yaw), 1);
      // 幅・高さを掛ける
      m[0] *= p.w * (1 + k * 0.3); m[1] *= p.w; m[2] *= p.w * (1 + k * 0.3);
      m[4] *= p.h * rise; m[5] *= p.h * rise; m[6] *= p.h * rise;
      return { m, color: p.color, a: a * 1.4 };
    });
  }

  // カメラの位置（基本の位置から、寄る・回り込む・揺れる）
  cameraPose(eye0: Vec3, at0: Vec3, fov0: number): { eye: Vec3; at: Vec3; fov: number } {
    const d = this.distCur;
    const at: Vec3 = [at0[0] + (this.focusCur[0] - at0[0]) * d, at0[1] + (this.focusCur[1] - at0[1]) * d, at0[2] + (this.focusCur[2] - at0[2]) * d];
    let dir: Vec3 = [eye0[0] - at0[0], eye0[1] - at0[1], eye0[2] - at0[2]];
    const o = this.orbitCur, c = Math.cos(o), s = Math.sin(o);
    dir = [dir[0] * c + dir[2] * s, dir[1], -dir[0] * s + dir[2] * c];
    const scale = 1 - d * 0.62;
    const eye: Vec3 = [at[0] + dir[0] * scale, at[1] + dir[1] * scale, at[2] + dir[2] * scale];
    const sh = this.shake;
    eye[0] += (Math.random() - 0.5) * sh; eye[1] += (Math.random() - 0.5) * sh + Math.sin(this.at * 60) * this.shakeV;
    at[0] += (Math.random() - 0.5) * sh * 0.4; at[1] += Math.sin(this.at * 60) * this.shakeV * 0.6;
    return { eye, at, fov: fov0 * (1 - this.fovKick * 0.14) };
  }
}
