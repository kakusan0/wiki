// 停止枠への位置合わせの判定（前進で入って止める）
import { wrap } from './vehicle';

export interface Target { x: number; z: number; h: number; }
export interface AlignResult {
  along: number;   // 前後のずれ（m）。正 = 行きすぎ
  lateral: number; // 左右のずれ（m）。正 = 右へずれている
  yaw: number;     // 向きのずれ（rad）。正 = 右を向いている
  inBox: boolean;  // 許す範囲に入っている
}
const EPS = 1e-9; // 小数の誤差で境目がずれないように
export const TOL = { along: 0.3, lateral: 0.2, yaw: 3 * Math.PI / 180 };

export function align(pose: { x: number; z: number; h: number }, t: Target): AlignResult {
  const dx = pose.x - t.x, dz = pose.z - t.z;
  const fx = Math.cos(t.h), fz = -Math.sin(t.h);
  // 右向きのベクトルは、前 (fx, fz) を上から見て時計回りに 90°
  const rx = -fz, rz = fx;
  const along = dx * fx + dz * fz;
  const lateral = dx * rx + dz * rz;
  const yaw = -wrap(pose.h - t.h);
  return { along, lateral, yaw, inBox: Math.abs(along) <= TOL.along + EPS && Math.abs(lateral) <= TOL.lateral + EPS && Math.abs(yaw) <= TOL.yaw + EPS };
}

/**
 * 停止枠に止める判定。許す範囲に入って止まれば合格（ぴったりでなくてよい）。
 * 合格したら、そのときのずれを記録する。トラックは動かさず、あとのクレーンがこの位置に合わせる。
 */
export const HOLD = 0.6; // 止まってから合格にするまでの秒数
export class Docking {
  state: 'approach' | 'settling' | 'docked' = 'approach';
  result: AlignResult | null = null;
  private held = 0;
  update(r: AlignResult, v: number, dt: number): Docking['state'] {
    if (this.state === 'docked') return this.state;
    if (r.inBox && Math.abs(v) < 0.05) {
      this.held += dt;
      this.state = this.held >= HOLD ? 'docked' : 'settling';
      if (this.state === 'docked') this.result = { ...r };
    } else {
      this.held = 0;
      this.state = 'approach';
    }
    return this.state;
  }
  reset() { this.state = 'approach'; this.result = null; this.held = 0; }
}

/** ずれの小ささで評価（範囲いっぱい = 0、ぴったり = 1 の平均） */
export function dockScore(r: AlignResult): number {
  const k = (x: number, t: number) => Math.max(0, 1 - Math.abs(x) / t);
  return (k(r.along, TOL.along) + k(r.lateral, TOL.lateral) + k(r.yaw, TOL.yaw)) / 3;
}
