// 駅のホーム（どの路線でも使う）：ホームの面・点字ブロック・白線・上屋・柱・ベンチ・駅名標・停止位置の目印・駅舎
import * as THREE from 'three';
import { PLATFORM_LEN } from '../route';
import type { Path } from '../net/path';
import { extrudeAlong, merge, placeAt, labelTex, rng } from './geo';
import { makeHouse } from './track';

export interface PlatformOpts {
  path: Path;
  stop: number;
  trackD: number; // 線路の中心（横ずれ）
  side: 1 | -1; // ホームが線路の左（1）か右（-1）か
  width: number; // ホームの幅
  island?: { otherD: number }; // 島式：反対側にも線路がある（その線路の中心）
  name: string; kana: string; prev: string; next: string;
  line: string; color: string; transfer?: string;
  house?: number | null; // 駅舎を置く横ずれ（null なら置かない）
  elevated?: boolean; // 高架：ホームの下は高架の床
  len?: number;
}

type AddFn = (g: THREE.BufferGeometry, m: THREE.Material, cast?: boolean, recv?: boolean) => THREE.Mesh;

export function buildPlatform(group: THREE.Group, M: Record<string, THREE.Material>, o: PlatformOpts, add: AddFn) {
  const P = o.path;
  const a = o.stop - (o.len ?? PLATFORM_LEN), b = o.stop + 12;
  const top = 1.0;
  const σ = o.side;
  const D = (u: number) => o.trackD + σ * u; // 線路から外へ u m
  // σ が負のときは、向きをそろえるため点の順を逆にする
  const prof = (pts: [number, number][]) => { const p = pts.map(([u, y]) => [D(u), y] as [number, number]); return σ > 0 ? p : p.reverse(); };
  const X = (pts: [number, number][], s0 = a, s1 = b, step = 2, opt: Parameters<typeof extrudeAlong>[4] = {}) => extrudeAlong(prof(pts), s0, s1, step, { ...opt, path: P });
  const edge = 1.55, back = edge + o.width;
  // 線路側の縁：点字ブロック・白線・側面
  const edgeSet = (e: number, dir: 1 | -1) => {
    const E = (u: number) => e + dir * u;
    const seg = (pts: [number, number][]) => pts;
    add(X(seg([[E(0.95), top + 0.004], [E(0.55), top + 0.004]]), a, b, 2, { uScale: 1, vScale: 2 }), M.yellow, false);
    add(X(seg([[E(0.12), top + 0.003], [E(0), top + 0.003], [E(0), top - 0.06]])), M.white, false);
    add(X(seg([[E(0), top - 0.06], [E(0.1), -0.4], [E(0.1), o.elevated ? -0.45 : -0.9]])), M.concreteDark, false);
  };
  // 面
  add(X([[o.island ? back - 0.001 : back, top], [edge, top]], a, b, 2, { uScale: 0.5, vScale: 0.5 }), M.platform, false);
  edgeSet(edge, 1);
  if (o.island) {
    // 反対側の縁：島式ホームの向こうの線路に面する
    const e2 = Math.abs(o.island.otherD - o.trackD) - edge;
    add(X([[e2 - 0.55, top + 0.004], [e2 - 0.95, top + 0.004]], a, b, 2, { uScale: 1, vScale: 2 }), M.yellow, false);
    add(X([[e2, top - 0.06], [e2, top + 0.003], [e2 - 0.12, top + 0.003]]), M.white, false);
    add(X([[e2 - 0.1, o.elevated ? -0.45 : -0.9], [e2 - 0.1, -0.4], [e2, top - 0.06]]), M.concreteDark, false);
  } else {
    // 裏の壁と柵
    add(X([[back + 0.25, o.elevated ? -0.45 : -0.9], [back + 0.25, top + 1.2], [back, top + 1.2], [back, top]]), M.concrete, true);
  }
  // 上屋
  const roofA = o.stop - 70, roofB = o.stop - 10;
  const mid = o.island ? (edge + (Math.abs(o.island.otherD - o.trackD) - edge)) / 2 : back - 0.6;
  const rEdge = edge + 1.0, rBack = o.island ? Math.abs(o.island.otherD - o.trackD) - edge - 1.0 : back + 0.4;
  if (o.island) {
    // 島式：中央が高い山形の屋根
    add(X([[rBack, top + 3.2], [mid, top + 3.55], [rEdge, top + 3.2]], roofA, roofB, 2, { uScale: 0.5, vScale: 0.5 }), M.roof, true);
  } else {
    add(X([[rBack, top + 3.6], [rEdge, top + 3.15]], roofA, roofB, 2, { uScale: 0.5, vScale: 0.5 }), M.roof, true);
    add(X([[rEdge, top + 3.15], [rEdge, top + 2.95], [rBack, top + 3.4]], roofA, roofB, 4), M.steel, false);
  }
  const cols: THREE.BufferGeometry[] = [], lamps: THREE.BufferGeometry[] = [], benches: THREE.BufferGeometry[] = [];
  for (let s = roofA + 3; s < roofB; s += 8) {
    const f = P.at(s, D(mid)), y = P.at(s).y;
    const c = new THREE.CylinderGeometry(0.1, 0.1, 3.5, 10); c.translate(f.x, y + top + 1.75, f.z); cols.push(c);
    for (const lu of o.island ? [edge + 2.2, Math.abs(o.island.otherD - o.trackD) - edge - 2.2] : [edge + 2.2]) {
      const lp = new THREE.BoxGeometry(0.2, 0.06, 1.2); lp.applyMatrix4(placeAt(s, D(lu), y + top + 3.0, 0, 1, P)); lamps.push(lp);
    }
    if (Math.round(s) % 16 < 8) {
      const bn = new THREE.BoxGeometry(0.45, 0.08, 1.8); bn.applyMatrix4(placeAt(s + 3, D(mid), y + top + 0.45, 0, 1, P)); benches.push(bn);
    }
  }
  add(merge(cols), M.steel, true);
  add(merge(lamps), M.lamp, false, false);
  if (benches.length) add(merge(benches), M.steelBlue, true);
  // 駅名標
  const nameTex = labelTex(1024, 400, (c) => {
    c.fillStyle = '#fbfbf8'; c.fillRect(0, 0, 1024, 400);
    c.fillStyle = o.color; c.fillRect(0, 250, 1024, 34);
    c.fillStyle = '#f08a24'; c.fillRect(0, 284, 1024, 8);
    c.fillStyle = '#16181c'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 140px "Zen Kaku Gothic New", sans-serif'; c.fillText(o.name, 512, 120);
    c.font = '700 42px "Zen Kaku Gothic New", sans-serif'; c.fillText(o.kana, 512, 215);
    c.font = '700 36px "Zen Kaku Gothic New", sans-serif'; c.textAlign = 'left'; c.fillText(o.prev ? `← ${o.prev}` : '', 24, 325);
    c.textAlign = 'right'; c.fillText(o.next ? `${o.next} →` : '', 1000, 325);
    c.font = '700 30px "Zen Kaku Gothic New", sans-serif'; c.textAlign = 'left'; c.fillStyle = o.color; c.fillText(o.line, 24, 40);
    if (o.transfer) { c.textAlign = 'center'; c.fillStyle = '#16181c'; c.font = '700 30px "Zen Kaku Gothic New", sans-serif'; c.fillText(`のりかえ　${o.transfer}`, 512, 368); }
  });
  const nameM = new THREE.MeshStandardMaterial({ map: nameTex, roughness: 0.6 });
  for (const ds of [-30, -85]) {
    const s = o.stop + ds;
    const g = new THREE.Group();
    g.applyMatrix4(placeAt(s, D(o.island ? mid : back - 0.8), P.at(s).y + top, σ > 0 ? Math.PI / 2 - 0.2 : -Math.PI / 2 + 0.2, 1, P));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.9, 8), M.steel); post.position.y = 0.95; g.add(post);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.86), nameM); board.position.set(0, 2.25, 0.05); g.add(board);
    const backB = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.86), o.island ? nameM : M.steel); backB.rotation.y = Math.PI; backB.position.set(0, 2.25, 0.04); g.add(backB);
    group.add(g);
  }
  // 停止位置の目印（2 両）
  const stopTex = labelTex(160, 110, (c) => {
    c.fillStyle = '#f2d24b'; c.fillRect(0, 0, 160, 110); c.lineWidth = 8; c.strokeStyle = '#111'; c.strokeRect(4, 4, 152, 102);
    c.fillStyle = '#111'; c.font = '900 84px "Zen Kaku Gothic New", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('2', 80, 60);
  });
  const sp = new THREE.Group();
  sp.applyMatrix4(placeAt(o.stop, D(edge + 0.25), P.at(o.stop).y + top, 0, 1, P));
  const spPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8), M.steel); spPost.position.y = 0.6; sp.add(spPost);
  const spB = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.29), new THREE.MeshStandardMaterial({ map: stopTex, roughness: 0.6 })); spB.position.set(0, 1.3, 0.03); sp.add(spB);
  group.add(sp);
  // 駅舎
  if (o.house !== null && o.house !== undefined) {
    const r = rng(Math.round(o.stop) + 5);
    const bs = o.stop - 45 + r() * 10;
    const house = makeHouse(14, 8, 4.2, 'clay', r);
    house.applyMatrix4(placeAt(bs, o.house, P.at(bs).y - 0.6, 0, 1, P));
    group.add(house);
  }
  // 柵（島式でないとき）
  if (!o.island) {
    const fence: THREE.BufferGeometry[] = [];
    for (let s = a; s < b; s += 2.5) {
      const f = P.at(s, D(back + 0.12)), y = P.at(s).y;
      const p = new THREE.BoxGeometry(0.05, 1.0, 0.05); p.translate(f.x, y + top + 1.7, f.z); fence.push(p);
    }
    fence.push(X([[back + 0.15, top + 2.2], [back + 0.1, top + 2.2], [back + 0.1, top + 2.15], [back + 0.15, top + 2.15]], a, b, 4, { closed: true }));
    add(merge(fence), M.steel, true);
  }
}
