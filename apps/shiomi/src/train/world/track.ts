// 線路・架線・信号・標識・駅・橋・トンネル・踏切
import * as THREE from 'three';
import {
  at, LENGTH, STATIONS, PLATFORM_LEN, SIGNALS, LIMITS, CROSSINGS, TUNNEL, BRIDGE, WHISTLES, TRACK_GAP, Signal,
} from '../route';
import { extrudeAlong, beam, wire, merge, placeAt, labelTex, rng } from './geo';
import { pbr } from './assets';
import { groundH, RIVER_LEVEL } from './terrain';
import { buildPlatform } from './stations';
import { MAIN } from '../route';
import { AOBA_D, SAZA_CROSS_MAIN } from '../net/network';

export const S_START = -300, S_END = LENGTH - 70; // 線路の両端（終点は車止め）
const GAUGE = 1.067;
const TRACKS = [0, TRACK_GAP];

export interface SignalView { sig: Signal; lamps: Record<'G' | 'Y' | 'R', THREE.MeshStandardMaterial>; }
export interface CrossingView { s: number; arms: THREE.Object3D[]; lights: THREE.MeshStandardMaterial[][]; }
export interface TrackWorld { signals: SignalView[]; crossings: CrossingView[]; tunnelLights: THREE.Mesh | null; sleepers: THREE.InstancedMesh[]; }

const platformRange = (i: number) => [STATIONS[i].stop - PLATFORM_LEN, STATIONS[i].stop + 12] as const;
export function onPlatform(s: number) {
  return STATIONS.some((_, i) => { const [a, b] = platformRange(i); return s > a - 5 && s < b + 5; });
}

export function buildTrack(group: THREE.Group, mats: Record<string, THREE.Material>): TrackWorld {
  const M = {
    ballast: pbr('gray_rocks', { repeat: 1, color: 0xb8b2aa, normalScale: 1.4 }),
    sleeper: pbr('concrete', { repeat: 1, color: 0xc9c6c0 }),
    rail: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.75, roughness: 0.42 }),
    concrete: pbr('brushed_concrete', { repeat: 1, color: 0xd8d4cc }),
    concreteDark: pbr('concrete', { repeat: 1, color: 0x9a968f }),
    platform: pbr('concrete_tiles', { repeat: 1, color: 0xd6d2ca }),
    steel: pbr('metal_plate', { repeat: 1, color: 0x7b8a8c, metalness: 0.6, roughness: 0.6 }),
    steelBlue: pbr('metal_plate', { repeat: 1, color: 0x5d7f95, metalness: 0.5, roughness: 0.55 }),
    wire: new THREE.MeshStandardMaterial({ color: 0x3c3a36, metalness: 0.8, roughness: 0.45 }),
    copper: new THREE.MeshStandardMaterial({ color: 0x7a5a3c, metalness: 0.9, roughness: 0.35 }),
    insulator: new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.3 }),
    black: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c418, roughness: 0.55 }),
    white: new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.5 }),
    roof: pbr('corrugated_iron_02', { repeat: 1, color: 0x9aa4a8, metalness: 0.4, roughness: 0.6, side: THREE.DoubleSide }),
    tunnel: pbr('concrete', { repeat: 1, color: 0x6a6762, side: THREE.BackSide }),
    portal: pbr('brushed_concrete', { repeat: 1, color: 0xa9a59d }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 3 }),
    rust: pbr('rusty_metal_02', { repeat: 1, color: 0x8a7a6a, metalness: 0.4 }),
  };
  Object.assign(mats, M);
  const sleepers: THREE.InstancedMesh[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Material, cast = true, recv = true) => {
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = cast; mesh.receiveShadow = recv; group.add(mesh); return mesh;
  };

  // ---- 道床・枕木・レール ----
  const ballastProf: [number, number][] = [[3.7, -0.8], [2.05, -0.2], [TRACK_GAP - 2.05, -0.2], [TRACK_GAP - 3.7, -0.8]];
  for (let s0 = S_START; s0 < S_END; s0 += 400) { // 400 m ごとにまとめて描画の回数を減らす
    const s1 = Math.min(S_END + 6, s0 + 400);
    add(extrudeAlong(ballastProf, s0, s1, 2, { uScale: 0.4, vScale: 0.4 }), M.ballast, false);
    // レール（頭は磨かれた鋼、ほかは錆）
    const head: [number, number][] = [
      [0.035, 0], [-0.035, 0], [-0.037, -0.045], [-0.009, -0.06], [-0.009, -0.13], [-0.065, -0.145], [-0.065, -0.16],
      [0.065, -0.16], [0.065, -0.145], [0.009, -0.13], [0.009, -0.06], [0.037, -0.045],
    ];
    const colors = (i: number): [number, number, number] => (i <= 1 ? [0.85, 0.85, 0.86] : [0.32, 0.2, 0.13]);
    const rails: THREE.BufferGeometry[] = [];
    for (const t of TRACKS) for (const side of [1, -1]) {
      const dc = t + side * (GAUGE / 2 + 0.035);
      const prof = head.map(([x, y]) => [dc + x, y] as [number, number]);
      rails.push(extrudeAlong(prof, s0, s1, 2, { closed: true, colors }));
    }
    // merge は色を落とすので、色付きで手作業でつなぐ
    const allPos: number[] = [], allCol: number[] = [], allNor: number[] = [];
    for (const g of rails) {
      const x = g.toNonIndexed();
      allPos.push(...(x.getAttribute('position').array as Float32Array));
      allNor.push(...(x.getAttribute('normal').array as Float32Array));
      allCol.push(...(x.getAttribute('color').array as Float32Array));
    }
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));
    rgeo.setAttribute('normal', new THREE.Float32BufferAttribute(allNor, 3));
    rgeo.setAttribute('color', new THREE.Float32BufferAttribute(allCol, 3));
    add(rgeo, M.rail, true, true);
  }
  // 枕木（コンクリート）：200 m ごとの束にして、見えない束は描かない
  {
    const g = new THREE.BoxGeometry(2.0, 0.17, 0.24);
    const r = rng(7);
    for (let s0 = S_START; s0 < S_END; s0 += 200) {
      const s1 = Math.min(S_END, s0 + 200);
      const n = Math.ceil((s1 - s0) / 0.62) * TRACKS.length;
      const im = new THREE.InstancedMesh(g, M.sleeper, n);
      let k = 0;
      for (const t of TRACKS) for (let s = s0 + 0.3; s < s1; s += 0.62) im.setMatrixAt(k++, placeAt(s, t, at(s).y - 0.245, (r() - 0.5) * 0.015));
      im.count = k;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
      sleepers.push(im);
    }
  }
  // ケーブルの溝（コンクリートのトラフ）
  for (let s0 = S_START; s0 < S_END; s0 += 400) {
    const s1 = Math.min(S_END, s0 + 400);
    const prof: [number, number][] = [[4.05, -0.62], [4.05, -0.5], [3.65, -0.5], [3.65, -0.62]];
    add(extrudeAlong(prof, s0, s1, 4, { uScale: 1, vScale: 0.3 }), M.concrete, false);
  }

  // ---- 架線柱と架線 ----
  const poles: THREE.BufferGeometry[] = [], arms: THREE.BufferGeometry[] = [], wires: THREE.BufferGeometry[] = [], ins: THREE.BufferGeometry[] = [];
  const SPAN = 50;
  const inTunnel = (s: number) => s > TUNNEL.from - 2 && s < TUNNEL.to + 2;
  const poleS: number[] = [];
  for (let s = S_START + 10; s < S_END - 5; s += SPAN) if (!inTunnel(s) && !(s > BRIDGE.from - 4 && s < BRIDGE.to + 4) && Math.abs(s - SAZA_CROSS_MAIN) > 12) poleS.push(s);
  for (const s of poleS) {
    const plat = onPlatform(s);
    const y = at(s).y;
    for (const [pd, track, dir] of [[plat ? 5.2 : 3.0, 0, -1], [TRACK_GAP - 3.0, TRACK_GAP, 1]] as const) {
      const base = Math.min(groundH(s, pd), y - 0.6);
      const p0 = at(s, pd);
      const top = y + 8.6;
      const pg = new THREE.CylinderGeometry(0.14, 0.2, top - base + 0.5, 10);
      pg.translate(p0.x, (top + base - 0.5) / 2, p0.z);
      poles.push(pg);
      // 腕（水平の管と斜めの支え）
      const a0 = new THREE.Vector3(p0.x, y + 6.9, p0.z);
      const tEnd = at(s, track - dir * 0.6);
      const a1 = new THREE.Vector3(tEnd.x, y + 6.9, tEnd.z);
      arms.push(beam(a0, a1, 0.07));
      const b0 = new THREE.Vector3(p0.x, y + 5.6, p0.z);
      const tMid = at(s, track + dir * -0.2);
      arms.push(beam(b0, new THREE.Vector3(tMid.x, y + 5.2, tMid.z), 0.05));
      arms.push(beam(new THREE.Vector3(p0.x, y + 8.4, p0.z), a1.clone().lerp(a0, 0.45), 0.04));
      // がいし
      const ig = new THREE.CylinderGeometry(0.06, 0.06, 0.32, 8);
      ig.rotateZ(Math.PI / 2);
      const ip = at(s, pd + dir * 0.35);
      ig.applyMatrix4(new THREE.Matrix4().makeRotationY(-p0.th));
      ig.translate(ip.x, y + 6.9, ip.z);
      ins.push(ig);
      const ig2 = ig.clone(); ig2.translate(0, -1.3, 0); ins.push(ig2);
      // き電線用の腕
      arms.push(beam(new THREE.Vector3(p0.x, top - 0.3, p0.z), new THREE.Vector3(at(s, pd - dir * 0.9).x, top - 0.3, at(s, pd - dir * 0.9).z), 0.06));
    }
  }
  // 電線：ちょう架線（たるみ）、トロリ線（ジグザグ）、ハンガー、き電線
  const pts = (fn: (s: number) => THREE.Vector3, s0: number, s1: number, n: number) => {
    const a: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) a.push(fn(s0 + ((s1 - s0) * i) / n));
    return a;
  };
  const wireEnd = S_END - 8;
  const spans: [number, number][] = [];
  let prev = S_START + 10;
  for (let s = S_START + 10 + SPAN; s <= wireEnd; s += SPAN) { spans.push([prev, s]); prev = s; }
  spans.forEach(([s0, s1], k) => {
    for (const track of TRACKS) {
      const z0 = (k % 2 ? 0.2 : -0.2), z1 = -z0;
      const sag = (s: number) => { const u = (s - s0) / (s1 - s0); return 4 * u * (1 - u); };
      const cat = (s: number) => { const f = at(s, track + 0.0); return new THREE.Vector3(f.x, f.y + 6.9 - 0.75 * sag(s), f.z); };
      const tro = (s: number) => { const u = (s - s0) / (s1 - s0); const f = at(s, track + z0 + (z1 - z0) * u); return new THREE.Vector3(f.x, f.y + 5.15, f.z); };
      wires.push(wire(pts(cat, s0, s1, 10), 0.012));
      wires.push(wire(pts(tro, s0, s1, 4), 0.009));
      for (let s = s0 + 5; s < s1 - 2; s += 5) wires.push(beam(cat(s), tro(s), 0.008));
      const pd = track === 0 ? 3.0 : TRACK_GAP - 3.0;
      const fe = (s: number) => { const f = at(s, pd + (track === 0 ? -0.9 : 0.9)); return new THREE.Vector3(f.x, f.y + 8.25 - 0.9 * sag(s), f.z); };
      wires.push(wire(pts(fe, s0, s1, 8), 0.016));
    }
  });
  add(merge(poles), M.concrete, true);
  add(merge(arms), M.steel, true);
  add(merge(ins), M.insulator, false);
  // 電線はいくつかに分けて、見えない所を省く
  for (let i = 0; i < wires.length; i += 300) add(merge(wires.slice(i, i + 300)), M.wire, false, false);

  // ---- 信号機 ----
  const signals: SignalView[] = [];
  for (const sig of SIGNALS) {
    const g = new THREE.Group();
    const y = at(sig.s).y;
    const d = onPlatform(sig.s) ? 2.3 : 2.5;
    g.applyMatrix4(placeAt(sig.s, d, y - 0.5));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.3, 10), M.steel);
    mast.position.y = 2.65; mast.castShadow = true; g.add(mast);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.45, 0.25), M.black);
    head.position.set(0, 5.2, 0); g.add(head);
    const lamps = {} as SignalView['lamps'];
    (['Y', 'R', 'G'] as const).forEach((c, i) => {
      const color = c === 'G' ? 0x30ffa8 : c === 'Y' ? 0xffb020 : 0xff2a1a;
      const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0 });
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), mat);
      lens.position.set(0, 5.62 - i * 0.42, 0.131); // 列車は +z 側から近づく
      g.add(lens);
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.03, 0.26), M.black);
      hood.position.set(0, 5.62 - i * 0.42 + 0.19, 0.25); g.add(hood);
      lamps[c] = mat;
    });
    // 列車は手前（+z 側）から近づくので、灯は +z を向く
    // 細い物は影を落とさない（影の描き直しを軽く）
    group.add(g);
    signals.push({ sig, lamps });
  }

  // ---- 標識 ----
  const signs: THREE.Object3D[] = [];
  const signPost = (s: number, d: number, tex: THREE.Texture, w: number, h: number, height = 2.2) => {
    const g = new THREE.Group();
    g.applyMatrix4(placeAt(s, d, Math.min(groundH(s, d), at(s).y - 0.6)));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, height, 8), M.steel);
    post.position.y = height / 2; post.castShadow = true; g.add(post);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    board.position.set(0, height + h / 2 - 0.1, 0.05); g.add(board);
    const backB = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.steel); backB.rotation.y = Math.PI; backB.position.copy(board.position).z -= 0.01; g.add(backB);
    // 細い物は影を落とさない（影の描き直しを軽く）
    group.add(g); signs.push(g);
    return g;
  };
  for (const l of LIMITS) {
    if (l.from > 10) signPost(l.from, 2.6, labelTex(256, 220, (c) => {
      c.fillStyle = '#fff'; c.fillRect(0, 0, 256, 220); c.lineWidth = 16; c.strokeStyle = '#111'; c.strokeRect(8, 8, 240, 204);
      c.fillStyle = '#111'; c.font = '900 150px "Share Tech Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(l.kmh), 128, 118);
    }), 0.62, 0.53);
    // 制限の終わり（解除）
    if (l.to < LENGTH) signPost(l.to + 40, 2.6, labelTex(256, 220, (c) => {
      c.fillStyle = '#fff'; c.fillRect(0, 0, 256, 220); c.lineWidth = 16; c.strokeStyle = '#111'; c.strokeRect(8, 8, 240, 204);
      c.fillStyle = '#111'; c.font = '900 64px "Zen Kaku Gothic New", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('解除', 128, 112);
      c.strokeStyle = '#111'; c.lineWidth = 10; c.beginPath(); c.moveTo(20, 200); c.lineTo(236, 20); c.stroke();
    }), 0.62, 0.53);
  }
  for (const w of WHISTLES) signPost(w.s, 2.6, labelTex(200, 200, (c) => {
    c.fillStyle = '#1d2433'; c.fillRect(0, 0, 200, 200); c.fillStyle = '#fff'; c.font = '900 130px "Zen Kaku Gothic New", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('笛', 100, 108);
  }), 0.45, 0.45, 1.6);
  // 距離標（100 m ごと）
  {
    const g = new THREE.BoxGeometry(0.12, 0.7, 0.12);
    const im = new THREE.InstancedMesh(g, M.white, Math.ceil(LENGTH / 100));
    let k = 0;
    for (let s = 100; s < LENGTH - 100; s += 100) { const d = 3.4; im.setMatrixAt(k++, placeAt(s, d, Math.min(groundH(s, d), at(s).y - 0.6) + 0.3)); }
    im.count = k; im.castShadow = true; group.add(im);
  }

  // ---- 駅 ----
  STATIONS.forEach((st, i) => buildPlatform(group, M, {
    path: MAIN, stop: st.stop, trackD: 0, side: 1, width: i === 1 ? AOBA_D - 3.1 : 4.65,
    island: i === 1 ? { otherD: AOBA_D } : undefined,
    name: st.name, kana: st.kana, prev: STATIONS[i - 1]?.name ?? '', next: STATIONS[i + 1]?.name ?? '',
    line: 'ひかり野線', color: '#1f6fb4', transfer: st.transfer,
    house: i === 1 ? AOBA_D + 12 : 12.2,
  }, add));

  // ---- 車止め ----
  for (const t of TRACKS) {
    const g = new THREE.Group();
    g.applyMatrix4(placeAt(S_END - 1, t, at(S_END).y - 0.2));
    const red = new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.5 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.4), red); frame.position.y = 0.9; g.add(frame);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.42), M.white); stripe.position.y = 0.9; g.add(stripe);
    for (const x of [-0.8, 0.8]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.2, 0.16), M.steel); leg.position.set(x, 0.5, 0); leg.rotation.x = -0.4; g.add(leg); }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 3 }));
    lamp.position.set(0, 1.3, 0.1); g.add(lamp);
    g.traverse((o) => { o.castShadow = true; });
    group.add(g);
  }

  // ---- 橋（トラス） ----
  buildBridge(group, M, add);
  // ---- トンネル ----
  const tunnelLights = buildTunnel(group, M, add);
  // ---- 踏切 ----
  const crossings = CROSSINGS.map((c) => buildCrossing(group, M, c.s, add));

  return { signals, crossings, tunnelLights, sleepers };
}

type AddFn = (g: THREE.BufferGeometry, m: THREE.Material, cast?: boolean, recv?: boolean) => THREE.Mesh;

export const houseMats: Record<string, THREE.Material> = {};
function hm() {
  if (!houseMats.wall0) {
    const walls = ['#f1ece2', '#e2d6c2', '#d2d8dc', '#efe2cf', '#c8c0b2', '#b9a58c'];
    walls.forEach((c, i) => { houseMats['wall' + i] = pbr('painted_plaster_wall', { repeat: 1, color: c }); });
    houseMats.clay = pbr('clay_roof_tiles', { repeat: 1, color: 0x8a8fa0 });
    houseMats.grey = pbr('grey_roof_tiles', { repeat: 1, color: 0x6c7076 });
    houseMats.metal = pbr('corrugated_iron_02', { repeat: 1, color: 0x5b6d7a, metalness: 0.3, roughness: 0.6 });
    houseMats.window = new THREE.MeshStandardMaterial({ color: 0x24303a, roughness: 0.08, metalness: 0.6 });
    houseMats.frame = new THREE.MeshStandardMaterial({ color: 0xc9c9c4, roughness: 0.5, metalness: 0.4 });
    houseMats.wood = pbr('dark_wooden_planks', { repeat: 1 });
  }
  return houseMats;
}

/** 家：壁・切妻の屋根・窓。原点は床の中心、-z が正面 */
export function makeHouse(w: number, dpt: number, h: number, roof: 'clay' | 'grey' | 'metal', r: () => number): THREE.Group {
  const H = hm();
  const g = new THREE.Group();
  const wall = new THREE.BoxGeometry(w, h, dpt);
  // UV を m 単位に
  const uv = wall.getAttribute('uv') as THREE.BufferAttribute;
  const pos = wall.getAttribute('position') as THREE.BufferAttribute, nor = wall.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    const u = nx > 0.5 ? pos.getZ(i) : pos.getX(i);
    const v = ny > 0.5 ? pos.getZ(i) : pos.getY(i);
    uv.setXY(i, u / 3, v / 3);
  }
  wall.translate(0, h / 2, 0);
  const wm = new THREE.Mesh(wall, H['wall' + Math.floor(r() * 6)]);
  g.add(wm);
  // 屋根（切妻）
  const pitch = 0.45 + r() * 0.2, over = 0.5;
  const rise = (dpt / 2 + over) * pitch;
  const shape = new THREE.Shape();
  shape.moveTo(-dpt / 2 - over, 0); shape.lineTo(0, rise); shape.lineTo(dpt / 2 + over, 0); shape.lineTo(dpt / 2 + over, -0.12); shape.lineTo(0, rise - 0.12); shape.lineTo(-dpt / 2 - over, -0.12); shape.closePath();
  const rg = new THREE.ExtrudeGeometry(shape, { depth: w + over * 2, bevelEnabled: false });
  rg.rotateY(Math.PI / 2); rg.translate(-(w + over * 2) / 2, h, 0);
  const ruv = rg.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) / 2.5, ruv.getY(i) / 2.5);
  g.add(new THREE.Mesh(rg, H[roof]));
  // 妻壁
  const gable = new THREE.Shape(); gable.moveTo(-dpt / 2, 0); gable.lineTo(0, dpt / 2 * pitch); gable.lineTo(dpt / 2, 0); gable.closePath();
  const gg = new THREE.ShapeGeometry(gable);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(gg, wm.material); m.rotation.y = sx * Math.PI / 2; m.position.set(sx * w / 2, h, 0); g.add(m);
  }
  // 窓
  const floors = h > 5 ? 2 : 1;
  const wins: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [];
  for (let f = 0; f < floors; f++) {
    const y = 1.0 + f * 2.8;
    for (let x = -w / 2 + 1.4; x < w / 2 - 1; x += 2.6 + r() * 0.8) {
      if (r() < 0.25) continue;
      const ww = 1.2 + r() * 0.6, wh = f === 0 && r() < 0.3 ? 1.9 : 1.1;
      for (const sz of [-1, 1]) {
        const wg = new THREE.BoxGeometry(ww, wh, 0.06); wg.translate(x, y + wh / 2, sz * (dpt / 2 + 0.01)); wins.push(wg);
        const fg = new THREE.BoxGeometry(ww + 0.12, 0.08, 0.14); fg.translate(x, y - 0.03, sz * (dpt / 2 + 0.03)); frames.push(fg);
      }
    }
  }
  if (wins.length) g.add(new THREE.Mesh(merge(wins), H.window));
  if (frames.length) g.add(new THREE.Mesh(merge(frames), H.frame));
  g.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
  return g;
}

function buildBridge(group: THREE.Group, M: Record<string, THREE.Material>, add: AddFn) {
  const { from, to } = BRIDGE;
  const y = (s: number) => at(s).y;
  const deck: THREE.BufferGeometry[] = [], truss: THREE.BufferGeometry[] = [];
  // 床版
  add(extrudeAlong([[3.4, -0.8], [TRACK_GAP - 3.4, -0.8], [TRACK_GAP - 3.4, -1.6], [3.4, -1.6]], from - 2, to + 2, 2, { closed: true, uScale: 0.5, vScale: 0.5 }), M.concrete, true);
  // トラス：左右 2 面
  const P = (s: number, d: number, h: number) => { const f = at(s, d); return new THREE.Vector3(f.x, y(s) + h, f.z); };
  const panel = 9.1;
  const n = Math.round((to - from) / panel);
  const L = (to - from) / n;
  for (const d of [3.5, TRACK_GAP - 3.5]) {
    for (let k = 0; k <= n; k++) {
      const s = from + k * L;
      truss.push(beam(P(s, d, -1.2), P(s, d, 6.4), 0.32, 0.4)); // 縦材
      if (k < n) {
        truss.push(beam(P(s, d, -1.2), P(s + L, d, -1.2), 0.5, 0.6)); // 下弦
        truss.push(beam(P(s, d, 6.4), P(s + L, d, 6.4), 0.5, 0.5)); // 上弦
        truss.push(k % 2 ? beam(P(s, d, -1.2), P(s + L, d, 6.4), 0.3) : beam(P(s, d, 6.4), P(s + L, d, -1.2), 0.3));
      }
    }
  }
  for (let k = 0; k <= n; k++) {
    const s = from + k * L;
    truss.push(beam(P(s, 3.5, 6.4), P(s, TRACK_GAP - 3.5, 6.4), 0.3)); // 上の横材
    if (k < n) truss.push(beam(P(s, 3.5, 6.4), P(s + L, TRACK_GAP - 3.5, 6.4), 0.12));
  }
  add(merge(truss), M.steelBlue, true);
  // 橋脚・橋台
  const piers: THREE.BufferGeometry[] = [];
  const river = RIVER_LEVEL();
  for (const s of [from, to]) {
    const f = at(s, -2), top = y(s) - 1.6;
    const bot = river - 3;
    const g = new THREE.BoxGeometry(12, top - bot, 3); g.applyMatrix4(new THREE.Matrix4().makeRotationY(-f.th)); g.translate(f.x, (top + bot) / 2, f.z);
    piers.push(g);
  }
  add(merge(piers), M.concreteDark, true);
  void deck;
}

function buildTunnel(group: THREE.Group, M: Record<string, THREE.Material>, add: AddFn): THREE.Mesh {
  const { from, to } = TUNNEL;
  // 断面：馬てい形（中心は複線の中心）
  const prof: [number, number][] = [];
  const cx = -2, R = 5.4, wall = 3.2;
  prof.push([cx + R, -0.9], [cx + R, wall]);
  for (let i = 1; i < 16; i++) { const a = (i / 16) * Math.PI; prof.push([cx + R * Math.cos(a), wall + R * 0.85 * Math.sin(a)]); }
  prof.push([cx - R, wall], [cx - R, -0.9]);
  add(extrudeAlong(prof, from, to, 4, { uScale: 0.35, vScale: 0.35 }), M.tunnel, true, true);
  // 坑門
  for (const [s, flip] of [[from, 0], [to, Math.PI]] as const) {
    const sh = new THREE.Shape();
    sh.moveTo(-14, -3); sh.lineTo(14, -3); sh.lineTo(14, 13); sh.lineTo(-14, 13); sh.closePath();
    const hole = new THREE.Path();
    hole.moveTo(R, -3); hole.lineTo(R, wall);
    hole.absellipse(0, wall, R, R * 0.85, 0, Math.PI, false, 0);
    hole.lineTo(-R, -3); hole.closePath();
    sh.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 1.6, bevelEnabled: false });
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 4, uv.getY(i) / 4);
    g.translate(0, 0, -0.8);
    g.applyMatrix4(placeAt(s, cx, at(s).y, flip));
    add(g, M.portal, true);
    // 上の笠石
    const cap = new THREE.BoxGeometry(29, 0.8, 2.4); cap.translate(0, 13.2, 0); cap.applyMatrix4(placeAt(s, cx, at(s).y, flip));
    add(cap, M.concreteDark, true);
  }
  // 照明（壁の上の方に、25 m ごと）
  const ls: THREE.BufferGeometry[] = [];
  for (let s = from + 10; s < to; s += 25) {
    for (const d of [cx + R - 0.15, cx - R + 0.15]) { const g = new THREE.BoxGeometry(0.1, 0.18, 1.1); g.applyMatrix4(placeAt(s, d, at(s).y + wall + 0.8)); ls.push(g); }
  }
  return add(merge(ls), M.lamp, false, false);
}

function buildCrossing(group: THREE.Group, M: Record<string, THREE.Material>, s: number, add: AddFn): CrossingView {
  const y = at(s).y;
  // 道路（線路に直角、地形に沿って）
  const road = pbr('asphalt_02', { repeat: 1, color: 0x9a9a9a });
  const pts: number[] = [];
  const idx: number[] = [], uvs: number[] = [];
  const ds: number[] = [];
  for (let d = -140; d <= 140; d += 4) ds.push(d);
  ds.forEach((d, k) => {
    for (const w of [-3, 3]) {
      const f = at(s + w, d);
      const near = Math.abs(d + 2) < 8;
      const h = near ? y - 0.02 : Math.max(groundH(s + w, d) + 0.08, Math.min(y - 0.02, groundH(s + w, d) + 0.08 + Math.max(0, 1 - (Math.abs(d + 2) - 8) / 30) * (y - groundH(s + w, d))));
      pts.push(f.x, h, f.z); uvs.push(w / 3, d / 3);
    }
    if (k < ds.length - 1) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  });
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  rg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  rg.setIndex(idx); rg.computeVertexNormals();
  const rm = add(rg, road, false, true);
  (rm.material as THREE.Material).side = THREE.DoubleSide;
  // 白線
  const arms: THREE.Object3D[] = [];
  const lights: THREE.MeshStandardMaterial[][] = [];
  const stripeTex = labelTex(256, 32, (c) => { for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#111' : '#f2c418'; c.fillRect(i * 32, 0, 32, 32); } });
  const stripeM = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5 });
  for (const [d, side] of [[4.2, -1], [TRACK_GAP - 4.2, 1]] as const) {
    for (const ss of [s - 4, s + 4]) {
      const before = ss < s;
      const g = new THREE.Group();
      g.applyMatrix4(placeAt(ss, d, y - 0.1, before ? 0 : Math.PI));
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 10), stripeM); post.position.y = 1.7; g.add(post);
      // ×印
      const xTex = labelTex(256, 256, (c) => { c.translate(128, 128); for (const r of [Math.PI / 4, -Math.PI / 4]) { c.save(); c.rotate(r); for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#111' : '#f2c418'; c.fillRect(-120 + i * 30, -18, 30, 36); } c.restore(); } });
      const xm = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshStandardMaterial({ map: xTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
      xm.position.set(0, 3.1, 0.1); g.add(xm);
      const pair: THREE.MeshStandardMaterial[] = [];
      for (const x of [-0.32, 0.32]) {
        const lm = new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff1a0a, emissiveIntensity: 0 });
        const l = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), lm); l.position.set(x, 2.35, 0.12); g.add(l);
        const l2 = l.clone(); l2.rotation.y = Math.PI; l2.position.z = -0.12; g.add(l2);
        const hood = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.2), M.black); hood.position.set(x, 2.35, 0); g.add(hood);
        pair.push(lm);
      }
      lights.push(pair);
      // 遮断かん（道路の中ほどへ伸ばす）
      const pivot = new THREE.Group(); pivot.position.set(0, 1.0, 0); g.add(pivot);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.6), stripeM); arm.position.z = -1.9;
      pivot.add(arm);
      pivot.rotation.x = Math.PI / 2 * 0.96;
      arms.push(pivot);
      void side;
      g.traverse((o) => { o.castShadow = true; });
      group.add(g);
    }
  }
  return { s, arms, lights };
}

export function updateSignal(v: SignalView, aspect: 'G' | 'Y' | 'R') {
  for (const k of ['G', 'Y', 'R'] as const) v.lamps[k].emissiveIntensity = k === aspect ? 6 : 0;
}
