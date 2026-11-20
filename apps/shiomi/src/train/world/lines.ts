// ひかり野線のほかの線路：あおば線（地上の単線・平面交差・分岐器）と、さざなみ線（高架の複線）
import * as THREE from 'three';
import { MAIN, TRACK_GAP, Signal, Route } from '../route';
import type { Path } from '../net/path';
import {
  AOBA, SAZANAMI, AOBA_TRACK, AOBA_OWN, SAZA_TRACK, SAZA_Y, SAZA_CROSS, DIAMOND, AOBA_D, AOBA_STATIONS, SAZA_STATIONS,
} from '../net/network';
import { extrudeAlong, beam, wire, merge, placeAt, rng } from './geo';
import { groundH } from './terrain';
import { buildPlatform } from './stations';
import type { SignalView } from './track';

export interface LinesWorld { signals: (SignalView & { route: Route })[]; sleepers: THREE.InstancedMesh[]; }

const GAUGE = 1.067;
const HEAD: [number, number][] = [
  [0.035, 0], [-0.035, 0], [-0.037, -0.045], [-0.009, -0.06], [-0.009, -0.13], [-0.065, -0.145], [-0.065, -0.16],
  [0.065, -0.16], [0.065, -0.145], [0.009, -0.13], [0.009, -0.06], [0.037, -0.045],
];

/** ひかり野線の線路の中心からの近さ（どちらかの線路に r m 以内か） */
function nearMain(x: number, z: number, r: number) {
  const n = MAIN.nearest(x, z);
  return Math.abs(n.d) < r || Math.abs(n.d - TRACK_GAP) < r;
}

export function buildLines(group: THREE.Group, M: Record<string, THREE.Material>): LinesWorld {
  const add = (g: THREE.BufferGeometry, m: THREE.Material, cast = true, recv = true) => {
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = cast; mesh.receiveShadow = recv; group.add(mesh); return mesh;
  };
  const sleepers: THREE.InstancedMesh[] = [];
  const signals: LinesWorld['signals'] = [];
  const r = rng(91);

  /** レール（色つき）を作ってまとめる */
  const rails = (P: Path, s0: number, s1: number, tracks: number[], yAbs?: (s: number) => number) => {
    const colors = (i: number): [number, number, number] => (i <= 1 ? [0.85, 0.85, 0.86] : [0.32, 0.2, 0.13]);
    // 400 m ごとに区切って作る（大きな配列を一度に広げない）
    for (let a = s0; a < s1; a += 400) {
      const b = Math.min(s1, a + 400);
      const parts: THREE.BufferGeometry[] = [];
      for (const t of tracks) for (const side of [1, -1]) {
        const dc = t + side * (GAUGE / 2 + 0.035);
        parts.push(extrudeAlong(HEAD.map(([x, y]) => [dc + x, y] as [number, number]), a, b, 2, { closed: true, colors, path: P, yAbs }).toNonIndexed());
      }
      const total = parts.reduce((n, g) => n + g.getAttribute('position').count, 0);
      const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
      let o = 0;
      for (const g of parts) {
        const n = g.getAttribute('position').count * 3;
        pos.set(g.getAttribute('position').array as Float32Array, o);
        nor.set(g.getAttribute('normal').array as Float32Array, o);
        col.set(g.getAttribute('color').array as Float32Array, o);
        o += n;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      add(geo, M.rail, true, true);
    }
  };
  /** まくら木（ひかり野線の線路と重なる所は置かない） */
  const ties = (P: Path, s0: number, s1: number, tracks: number[], y: (s: number) => number, skip: (s: number, d: number) => boolean) => {
    const g = new THREE.BoxGeometry(2.0, 0.17, 0.24);
    for (let a = s0; a < s1; a += 200) {
      const b = Math.min(s1, a + 200);
      const ms: THREE.Matrix4[] = [];
      for (const t of tracks) for (let s = a + 0.3; s < b; s += 0.62) if (!skip(s, t)) ms.push(placeAt(s, t, y(s) - 0.245, (r() - 0.5) * 0.015, 1, P));
      if (!ms.length) continue;
      const im = new THREE.InstancedMesh(g, M.sleeper, ms.length);
      ms.forEach((m, i) => im.setMatrixAt(i, m));
      im.receiveShadow = true; im.computeBoundingSphere();
      group.add(im); sleepers.push(im);
    }
  };
  /** 架線（柱は poleD の側。skipPole が真の所には立てない） */
  const catenary = (P: Path, s0: number, s1: number, tracks: { d: number; poleD: number }[], y: (s: number) => number, skipPole: (s: number, d: number) => boolean, poleBase: (s: number, d: number) => number) => {
    const poles: THREE.BufferGeometry[] = [], arms: THREE.BufferGeometry[] = [], wires: THREE.BufferGeometry[] = [];
    for (let s = s0 + 10; s < s1 - 5; s += 50) for (const t of tracks) {
      if (skipPole(s, t.poleD)) continue;
      const yy = y(s), p0 = P.at(s, t.poleD), base = poleBase(s, t.poleD);
      const topY = yy + 8.2;
      const pg = new THREE.CylinderGeometry(0.13, 0.18, topY - base, 10); pg.translate(p0.x, (topY + base) / 2, p0.z); poles.push(pg);
      const a0 = new THREE.Vector3(p0.x, yy + 6.9, p0.z), te = P.at(s, t.d - Math.sign(t.poleD - t.d) * 0.6);
      arms.push(beam(a0, new THREE.Vector3(te.x, yy + 6.9, te.z), 0.07));
      const tm = P.at(s, t.d);
      arms.push(beam(new THREE.Vector3(p0.x, yy + 5.6, p0.z), new THREE.Vector3(tm.x, yy + 5.2, tm.z), 0.05));
    }
    for (let a = s0 + 10, k = 0; a + 50 <= s1 - 5; a += 50, k++) {
      const b = a + 50;
      for (const t of tracks) {
        const z0 = k % 2 ? 0.2 : -0.2;
        const sag = (s: number) => { const u = (s - a) / (b - a); return 4 * u * (1 - u); };
        const cat = (s: number) => { const f = P.at(s, t.d); return new THREE.Vector3(f.x, y(s) + 6.9 - 0.75 * sag(s), f.z); };
        const tro = (s: number) => { const u = (s - a) / (b - a); const f = P.at(s, t.d + z0 - 2 * z0 * u); return new THREE.Vector3(f.x, y(s) + 5.15, f.z); };
        const pts = (fn: (s: number) => THREE.Vector3, n: number) => { const o: THREE.Vector3[] = []; for (let i = 0; i <= n; i++) o.push(fn(a + ((b - a) * i) / n)); return o; };
        wires.push(wire(pts(cat, 10), 0.012), wire(pts(tro, 4), 0.009));
        for (let s = a + 5; s < b - 2; s += 5) wires.push(beam(cat(s), tro(s), 0.008));
      }
    }
    if (poles.length) add(merge(poles), M.concrete, true);
    if (arms.length) add(merge(arms), M.steel, true);
    for (let i = 0; i < wires.length; i += 300) add(merge(wires.slice(i, i + 300)), M.wire, false, false);
  };
  /** 信号機（灯は列車の来る向き） */
  const signal = (route: Route, P: Path, sig: Signal, d: number, y: number) => {
    const g = new THREE.Group();
    g.applyMatrix4(placeAt(sig.s, d, y, 0, 1, P));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.3, 10), M.steel); mast.position.y = 2.65; mast.castShadow = true; g.add(mast);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.45, 0.25), M.black); head.position.set(0, 5.2, 0); g.add(head);
    const lamps = {} as SignalView['lamps'];
    (['Y', 'R', 'G'] as const).forEach((c, i) => {
      const color = c === 'G' ? 0x30ffa8 : c === 'Y' ? 0xffb020 : 0xff2a1a;
      const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0 });
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), mat); lens.position.set(0, 5.62 - i * 0.42, 0.131); g.add(lens);
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.03, 0.26), M.black); hood.position.set(0, 5.81 - i * 0.42, 0.25); g.add(hood);
      lamps[c] = mat;
    });
    group.add(g);
    signals.push({ sig, lamps, route });
  };

  // ======== あおば線 ========
  {
    const P = AOBA_TRACK;
    const s0 = -25, s1 = AOBA_OWN;
    const y = (s: number) => P.at(s).y;
    // 道床（ひかり野線と重なる所でちらつかないよう、少し低く）
    const bal: [number, number][] = [[3.6, -0.83], [2.0, -0.23], [-2.0, -0.23], [-3.6, -0.83]];
    for (let a = s0; a < s1; a += 400) add(extrudeAlong(bal, a, Math.min(s1, a + 400), 2, { uScale: 0.4, vScale: 0.4, path: P }), M.ballast, false);
    rails(P, s0, s1, [0]);
    ties(P, s0, s1, [0], y, (s) => { const f = P.at(s); return nearMain(f.x, f.z, 2.2); });
    // 平面交差：交わる所のガードレールと金物
    {
      const parts: THREE.BufferGeometry[] = [];
      for (const sm of [DIAMOND.main0, DIAMOND.main4]) {
        const mf = MAIN.at(sm, sm === DIAMOND.main0 ? 0 : TRACK_GAP);
        const n = P.nearest(mf.x, mf.z, 2).s;
        for (const side of [1, -1]) {
          // あおば線の内側のガードレール
          const g = extrudeAlong([[side * 0.42 + 0.03, -0.02], [side * 0.42 - 0.03, -0.02], [side * 0.42 - 0.03, -0.16], [side * 0.42 + 0.03, -0.16]], n - 4, n + 4, 1, { closed: true, path: P });
          parts.push(g);
          // ひかり野線の内側のガードレール
          parts.push(extrudeAlong([[(sm === DIAMOND.main0 ? 0 : TRACK_GAP) + side * 0.42 + 0.03, -0.02], [(sm === DIAMOND.main0 ? 0 : TRACK_GAP) + side * 0.42 - 0.03, -0.02], [(sm === DIAMOND.main0 ? 0 : TRACK_GAP) + side * 0.42 - 0.03, -0.16], [(sm === DIAMOND.main0 ? 0 : TRACK_GAP) + side * 0.42 + 0.03, -0.16]], sm - 4, sm + 4, 1, { closed: true }));
        }
        // 交差の床板（長いまくら木を並べた木の床）
        for (let k = -3; k <= 3; k++) { const b = new THREE.BoxGeometry(3.2, 0.16, 0.26); b.applyMatrix4(placeAt(sm + k * 0.6, sm === DIAMOND.main0 ? 0 : TRACK_GAP, MAIN.at(sm).y - 0.25, (DIAMOND.angle / 2), 1)); parts.push(b); }
      }
      add(merge(parts), M.steel, true);
    }
    // 分岐器（合流）：転てつ機の箱と、トングレールの所の長いまくら木
    {
      const parts: THREE.BufferGeometry[] = [];
      for (let s = s1 - 70; s < s1 + 4; s += 0.62) { const f = AOBA_TRACK.at(Math.min(s, s1)); const b = new THREE.BoxGeometry(3.4 + Math.max(0, (s - (s1 - 70)) / 70) * 1.4, 0.17, 0.24); b.applyMatrix4(placeAt(Math.min(s, s1), 0, f.y - 0.25, 0, 1, P)); parts.push(b); }
      add(merge(parts), M.sleeper, false);
      const box = new THREE.BoxGeometry(0.6, 0.45, 1.0); box.applyMatrix4(placeAt(s1 - 40, 2.6, y(s1 - 40) - 0.35, 0, 1, P));
      const lever = new THREE.BoxGeometry(0.08, 0.08, 1.6); lever.applyMatrix4(placeAt(s1 - 40, 1.6, y(s1 - 40) - 0.1, Math.PI / 2, 1, P));
      add(merge([box, lever]), M.yellow, true);
    }
    // 架線（柱は左。ひかり野線の線路の近くには立てない）
    catenary(P, s0, s1 - 20, [{ d: 0, poleD: 3.0 }], y,
      (s, d) => { const f = P.at(s, d); return nearMain(f.x, f.z, 6.5) || Math.abs(MAIN.nearest(f.x, f.z).s - 2110) < 14; },
      (s, d) => { const f = P.at(s, d); const n = MAIN.nearest(f.x, f.z); return Math.min(groundH(n.s, n.d), y(s) - 0.6); });
    // 信号（ひかり野線と共有でないもの）
    for (const sig of AOBA.signals) if (!sig.shared && sig.s < AOBA_OWN) signal(AOBA, P, sig, 2.4, y(sig.s) - 0.5);
    // 青葉駅（終点の頭端式：ホームは左）と車止め
    const st = AOBA_STATIONS[0];
    buildPlatform(group, M, {
      path: P, stop: st.stop, trackD: 0, side: 1, width: 4.6, name: st.name, kana: st.kana, prev: '', next: AOBA_STATIONS[1].name,
      line: 'あおば線', color: AOBA.color, house: 12.5, len: 120,
    }, add);
    bufferStop(group, M, P, -20, y(-20));
  }

  // ======== さざなみ線（高架） ========
  {
    const P = SAZA_TRACK;
    const s0 = -20, s1 = SAZA_TRACK.length + 20;
    const y = () => SAZA_Y;
    const stations = SAZA_STATIONS.map((st) => [st.stop - 108, st.stop + 18] as const);
    const atStation = (s: number) => stations.some(([a, b]) => s > a && s < b);
    // 床（駅以外：両側に壁。駅：ホームの下まで広い床）
    const deck: [number, number][] = [[3.0, 1.05], [2.75, 1.05], [2.75, -0.45], [TRACK_GAP - 2.75, -0.45], [TRACK_GAP - 2.75, 1.05], [TRACK_GAP - 3.0, 1.05], [TRACK_GAP - 3.0, -1.75], [3.0, -1.75]];
    const wide: [number, number][] = [[6.6, -0.45], [TRACK_GAP - 6.6, -0.45], [TRACK_GAP - 6.6, -1.75], [6.6, -1.75]];
    // 区間ごとに切り分ける
    const cuts: [number, number, boolean][] = [];
    let a = s0;
    for (const [sa, sb] of stations) { if (sa > a) cuts.push([a, sa, false]); cuts.push([sa, sb, true]); a = sb; }
    if (a < s1) cuts.push([a, s1, false]);
    for (const [ca, cb, st] of cuts) {
      for (let x = ca; x < cb; x += 300) add(extrudeAlong(st ? wide : deck, x, Math.min(cb, x + 300), 3, { closed: true, uScale: 0.35, vScale: 0.35, path: P, yAbs: y }), M.concrete, true);
    }
    // 軌道のコンクリートの台
    for (const t of [0, TRACK_GAP]) for (let x = s0; x < s1; x += 300) add(extrudeAlong([[t + 1.25, -0.3], [t - 1.25, -0.3], [t - 1.25, -0.45], [t + 1.25, -0.45]], x, Math.min(s1, x + 300), 3, { closed: true, uScale: 0.5, vScale: 0.5, path: P, yAbs: y }), M.concreteDark, false);
    rails(P, s0, s1, [0, TRACK_GAP], y);
    ties(P, s0, s1, [0, TRACK_GAP], y, () => false);
    // 橋脚：22 m ごと。下の線路・道の上には立てない（そこは長い桁）
    const piers: THREE.BufferGeometry[] = [], caps: THREE.BufferGeometry[] = [];
    for (let s = 8; s < P.length - 8; s += 22) {
      const f = P.at(s, TRACK_GAP / 2);
      if (nearMain(f.x, f.z, 9)) continue;
      const ao = AOBA_TRACK.nearest(f.x, f.z, 5);
      if (ao.dist < 8) continue;
      const n = MAIN.nearest(f.x, f.z);
      const gy = groundH(n.s, n.d);
      const topY = SAZA_Y - 1.75;
      const col = new THREE.BoxGeometry(2.0, topY - 1.0 - gy + 0.3, 1.6); col.translate(0, (topY - 1.0 + gy - 0.3) / 2, 0);
      col.applyMatrix4(new THREE.Matrix4().makeRotationY(-f.th)); col.translate(f.x, 0, f.z); piers.push(col);
      const cap = new THREE.BoxGeometry(atStation(s) ? 13.6 : 9.2, 1.0, 2.0); cap.translate(0, topY - 0.5, 0);
      cap.applyMatrix4(new THREE.Matrix4().makeRotationY(-f.th)); cap.translate(f.x, 0, f.z); caps.push(cap);
    }
    add(merge(piers), M.concrete, true); add(merge(caps), M.concrete, true);
    // 架線（柱は壁の上。駅ではホームの上）
    catenary(P, s0, s1, [{ d: 0, poleD: 3.2 }, { d: TRACK_GAP, poleD: TRACK_GAP - 3.2 }], y, () => false, () => SAZA_Y + (0.5));
    // 信号
    for (const sig of SAZANAMI.signals) signal(SAZANAMI, P, sig, atStation(sig.s) ? 2.4 : 2.0, SAZA_Y - 0.4);
    // 駅：上り（左のホーム）と、反対向きの線路のホーム（右）
    SAZA_STATIONS.forEach((st, i) => {
      const common = { path: P, stop: st.stop, name: st.name, kana: st.kana, line: 'さざなみ線', color: SAZANAMI.color, transfer: st.transfer, house: null, elevated: true };
      buildPlatform(group, M, { ...common, trackD: 0, side: 1, width: 3.5, prev: SAZA_STATIONS[i - 1]?.name ?? '', next: SAZA_STATIONS[i + 1]?.name ?? '' }, add);
      buildPlatform(group, M, { ...common, trackD: TRACK_GAP, side: -1, width: 3.5, prev: SAZA_STATIONS[i + 1]?.name ?? '', next: SAZA_STATIONS[i - 1]?.name ?? '' }, add);
      // 階段の入口（ホームの端の箱）と、高架下の駅の入口
      const sb = st.stop - 60;
      for (const [d, side] of [[3.6, 1], [TRACK_GAP - 3.6, -1]] as const) {
        const box = new THREE.BoxGeometry(2.4, 2.6, 6); box.applyMatrix4(placeAt(sb, d + side * 0.3, SAZA_Y + 1.0, 0, 1, P)); box.translate(0, 1.3, 0);
        add(box, M.steelBlue, true);
      }
      const f = P.at(sb, TRACK_GAP / 2); const n = MAIN.nearest(f.x, f.z);
      if (!nearMain(f.x, f.z, 10)) {
        const gy = groundH(n.s, n.d);
        const hall = new THREE.BoxGeometry(12, 4.2, 9); hall.translate(0, 2.1, 0); hall.applyMatrix4(placeAt(sb, TRACK_GAP / 2, gy, 0, 1, P));
        add(hall, M.steelBlue, true);
      }
    });
    bufferStop(group, M, P, s0 + 2, SAZA_Y, [0, TRACK_GAP]);
    bufferStop(group, M, P, s1 - 2, SAZA_Y, [0, TRACK_GAP], true);
    void SAZA_CROSS; void AOBA_D;
  }
  return { signals, sleepers };
}

function bufferStop(group: THREE.Group, M: Record<string, THREE.Material>, P: Path, s: number, y: number, tracks = [0], flip = false) {
  for (const t of tracks) {
    const g = new THREE.Group();
    g.applyMatrix4(placeAt(s, t, y - 0.2, flip ? 0 : Math.PI, 1, P));
    const red = new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.5 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.4), red); frame.position.y = 0.9; g.add(frame);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.42), M.white); stripe.position.y = 0.9; g.add(stripe);
    for (const x of [-0.8, 0.8]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 0.16), M.steel); leg.position.set(x, 0.5, 0); leg.rotation.x = -0.4; g.add(leg); }
    g.traverse((o) => { o.castShadow = true; });
    group.add(g);
  }
}
