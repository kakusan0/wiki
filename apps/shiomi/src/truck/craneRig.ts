// 積み込みの場面：門型クレーンの吊り具と、吊ったコンテナの 3D、運転室からの視点
import * as THREE from 'three';
import { Crane, type CraneInput, type Chassis } from './sim/crane';
import { ISO } from './world/containers';
import { box } from './world/tex';

const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c21b, roughness: 0.5, metalness: 0.3 });
const orange = new THREE.MeshStandardMaterial({ color: 0xe8692a, roughness: 0.45, metalness: 0.3 });
const rope = new THREE.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.6, metalness: 0.6 });

export interface Lane { x: number; z: number; h: number; }

export class CraneRig {
  crane = new Crane();
  readonly spreader = new THREE.Group();
  readonly hook = new THREE.Group(); // コンテナを吊る所（吊り具の下）
  private ropes: THREE.Mesh[] = [];
  private fx: number; private fz: number; private rx: number; private rz: number;

  constructor(private lane: Lane, private rtg: THREE.Group, private trolley: THREE.Group, private deckY: number, scene: THREE.Object3D) {
    this.fx = Math.cos(lane.h); this.fz = -Math.sin(lane.h);
    this.rx = -this.fz; this.rz = this.fx;
    box(12.2, 0.45, 2.4, yellow, 0, 0.25, 0, this.spreader);
    box(2.4, 1.0, 2.0, orange, 0, 0.9, 0, this.spreader);
    [-1, 1].forEach((a) => [-1, 1].forEach((b) => box(0.28, 0.7, 0.28, yellow, a * 6.0, -0.1, b * 1.15, this.spreader, false)));
    this.spreader.add(this.hook);
    scene.add(this.spreader);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 6), rope);
      m.castShadow = true; scene.add(m); this.ropes.push(m);
    }
  }

  /** 新しく始める：吊り点は停止枠から少しずらし、コンテナは高い所 */
  reset(startAlong: number, startLateral: number) {
    this.crane = new Crane(startAlong, startLateral, 6);
    this.place();
  }

  private world(along: number, lateral: number, out: THREE.Vector3, y: number) {
    return out.set(this.lane.x + this.fx * along + this.rx * lateral, y, this.lane.z + this.fz * along + this.rz * lateral);
  }

  step(inp: CraneInput, chassis: Chassis, dt: number) { this.crane.step(inp, chassis, dt); this.place(); }

  private tmpA = new THREE.Vector3(); private tmpB = new THREE.Vector3(); private up = new THREE.Vector3(0, 1, 0);
  place() {
    const c = this.crane;
    // 門型クレーンはレーンの向きに、台車は左右に動く
    this.world(c.ga, 0, this.tmpA, 0);
    this.rtg.position.set(this.tmpA.x, 0, this.tmpA.z);
    this.trolley.position.z = c.gl;
    // 吊り具はコンテナの上（揺れを含む）
    this.world(c.along, c.lateral, this.spreader.position, this.deckY + c.h + ISO.H);
    this.spreader.rotation.y = this.lane.h - c.skew;
    // ワイヤー：台車の下の 4 点から、吊り具の 4 点へ
    const top = this.trolley.position.y + this.rtg.position.y - 1.0;
    const corners: [number, number][] = [[-2.4, -0.9], [-2.4, 0.9], [2.4, -0.9], [2.4, 0.9]];
    corners.forEach(([a, l], i) => {
      const A = this.world(c.ga + a, c.gl + l * 0.6, this.tmpA, top);
      const B = this.world(c.along + a, c.lateral + l * 0.6, this.tmpB, this.spreader.position.y + 1.3);
      const m = this.ropes[i];
      m.position.copy(A).add(B).multiplyScalar(0.5);
      const d = B.clone().sub(A);
      m.scale.set(1, d.length(), 1);
      m.quaternion.setFromUnitVectors(this.up, d.normalize());
    });
  }

  /** 運転室からの視点：台車の下の運転室から、斜めに吊り具とシャーシを見下ろす。画面の上がレーンの前 */
  cameraPose(pos: THREE.Vector3, quat: THREE.Quaternion) {
    const c = this.crane;
    // 運転室は台車の右うしろの下。吊ったコンテナとシャーシの両方が見えるよう、斜めに見下ろす
    this.world(c.ga - 9, c.gl + 3.2, pos, this.deckY + 13);
    const look = this.world(c.along + 1.5, c.lateral, new THREE.Vector3(), this.deckY + Math.min(2.5, c.h * 0.4));
    const m = new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(this.fx, 0, this.fz));
    quat.setFromRotationMatrix(m);
  }
}
