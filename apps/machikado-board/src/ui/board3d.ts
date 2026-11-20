// 3D の盤面（WebGL）。キャンバスは作り直さず、状態が変わったときだけ場面を組み直す
import { CARDS } from '../game/cards';
import { getMap, stopsVia } from '../game/maps';
import type { GameMap } from '../game/state';
import { fee, isMonopoly, netWorth } from '../game/rules';
import type { GameState } from '../game/state';
import type { BoardView } from './board2d';
import { g as gold, h } from './dom';
import * as G from './gl/geometry';
import { lookAt, mul, persp, project, type Vec3 } from './gl/math';
import { Renderer, type Item, type Mesh } from './gl/renderer';
import * as T from './gl/textures';

export type Detail = 'low' | 'mid' | 'high';
export const DETAIL_NAMES: Record<Detail, string> = { low: '低', mid: '中', high: '高' };

export interface Board3D {
  el: HTMLElement;
  update(s: GameState, v: BoardView): void;
  setDetail(d: Detail): void;
  resetView(): void;
  stats(): { triangles: number; textures: number; items: number };
  destroy(): void;
}

interface SceneItem extends Item { spin?: number; bob?: number; pinBob?: number; billboard?: boolean }
interface Meshes {
  cube: Mesh; cyl: Mesh; cone: Mesh; sphere: Mesh; prism: Mesh; plane: Mesh; rbox: Mesh;
  pawn: Mesh; pot: Mesh; lamp: Mesh; dice: Mesh[]; bowl: Mesh; card: Mesh;
}

const SEG: Record<Detail, number> = { low: 12, mid: 24, high: 48 };
const DPR: Record<Detail, number> = { low: 1, mid: 1.5, high: 2 };
const SKY: Vec3 = [0.81, 0.86, 0.93];
export const DICE_MS = 1300; // サイコロが止まるまで

function norm3(v: Vec3): Vec3 { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
// 軸と角度 → 3×3 の回転（列優先）
function axisAngle([x, y, z]: Vec3, a: number): number[] {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c];
}
// y 軸まわりの回転を掛ける（止まったときの向き）
function rotY(a: number, m: number[]): number[] {
  const c = Math.cos(a), s = Math.sin(a);
  const R = [c, 0, -s, 0, 1, 0, s, 0, c];
  const o = new Array<number>(9).fill(0);
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) for (let k = 0; k < 3; k++) o[col * 3 + row] += R[k * 3 + row] * m[col * 3 + k];
  return o;
}
// サイコロ：上の面が value になるように、面ごとの絵（0〜5 が 1〜6 の目）を決める
const DICE_FACES = (v: number) => {
  const top = v - 1, bottom = 6 - v;
  const rest = [0, 1, 2, 3, 4, 5].filter((k) => k !== top && k !== bottom);
  return [top, bottom, rest[0], 5 - rest[0], rest[1], 5 - rest[1]];
};

export function createBoard3D(initial: Detail): Board3D | null {
  const el = h('div', { class: 'board3d' });
  const canvas = h('canvas', { 'aria-label': '立体の盤面。ドラッグで回転、ホイールやピンチで拡大、マスをタップで詳しく' });
  const hud = h('div', { class: 'hud' });
  const hint = h('div', { class: 'hint' }, '');
  el.append(canvas, hud, hint);
  const R = Renderer.create(canvas);
  if (!R) return null;
  const r = R;

  let detail = initial;
  let state: GameState | null = null;
  let view: BoardView | null = null;
  let M: Meshes = makeMeshes();
  let items: SceneItem[] = [];
  let signature = '';
  let vp: number[] = [];
  let lastTris = 0;
  // 基本の向き：地図の上が画面の上（2D の盤面・分かれ道のボタンの ↑↓←→ と同じ向き）
  const HOME = { yaw: 0, pitch: 0.95 };
  const cam = { yaw: HOME.yaw, pitch: HOME.pitch, dist: 9 };
  let homeDist = 9;
  let camAnim: { t0: number; yaw: number; pitch: number; dist: number } | null = null;
  let wasMine = false, hadChoices = false;
  let camFor = '';
  let fontsReady = false;
  const disp: { pos: Vec3; from: Vec3; to: Vec3; t0: number }[] = [];
  let diceAnim = { value: 0, t0: 0 };
  let choiceSpots: { sq: number; p: Vec3 }[] = [];
  let destNow: number | null = null; // 到着マス（カメラの注視点に使う）

  function makeMeshes(): Meshes {
    r.dropMeshes();
    const seg = SEG[detail];
    const lat = seg / 2;
    const rs = detail === 'low' ? 2 : detail === 'mid' ? 4 : 8;
    return {
      cube: r.mesh(G.cube()), cyl: r.mesh(G.cylinder(seg)), cone: r.mesh(G.cone(seg)), sphere: r.mesh(G.sphere(lat, seg)),
      prism: r.mesh(G.prism()), plane: r.mesh(G.plane()), card: r.mesh(G.card()), rbox: r.mesh(G.roundedBox(rs, 0.12)),
      pawn: r.mesh(G.lathe([[.5, 0], [.5, .07], [.42, .12], [.3, .2], [.2, .45], [.16, .62], [.3, .68], [.32, .72], [.16, .76], [0, .78]], seg)),
      pot: r.mesh(G.lathe([[.32, 0], [.5, .8], [.56, .85], [.56, 1], [0, 1]], seg)),
      lamp: r.mesh(G.lathe([[.5, 0], [.5, .04], [.18, .08], [.12, .3], [.1, .95], [.18, 1], [0, 1]], seg)),
      bowl: r.mesh(G.lathe([[.3, 0], [.36, .3], [.5, .6], [.5, 1], [.44, 1], [.42, .7], [0, .7]], seg)),
      dice: [1, 2, 3, 4, 5, 6].map((v) => r.mesh(G.roundedBox(rs, 0.14, DICE_FACES(v)))),
    };
  }

  // ---------- 場面を組む ----------
  function build(s: GameState) {
    const map = getMap(s.mapId);
    const lay = layoutOf(map);
    const n = Math.max(map.width, map.height);
    const tx = {
      stone: r.tex('stone', T.stone), cobble: r.tex('cobble', T.cobble), grass: r.tex('grass', T.grass),
      wood: r.tex('wood', T.wood), bark: r.tex('bark', T.bark), leaves: r.tex('leaves', T.leaves), water: r.tex('water', T.water),
      bank: r.tex('bank', T.bank), chance: r.tex('chance', T.chance, false), shutter: r.tex('shutter', T.shutter, false),
      lantern: r.tex('lantern', T.lantern, false),
    };
    const out: SceneItem[] = [];
    let pins = 0;
    const add = (mesh: Mesh, p: Vec3, sc: Vec3, o: Partial<SceneItem> = {}) =>
      out.push({ mesh, p, s: sc, r: 0, c: [1, 1, 1], tex: r.white, uvs: [1, 1], ...o });
    const C = T.rgb;

    // 土台・芝（道のない所は芝生）
    const W = map.width, H = map.height;
    add(M.cube, [0, -0.36, 0], [W + 0.7, 0.3, H + 0.7], { tex: tx.stone, c: C('#8C94A8'), uvs: [n, 1] });
    add(M.cube, [0, -0.06, 0], [W + 0.3, 0.06, H + 0.3], { tex: tx.grass, uvs: [W, H] });
    // 道：つながったマスの間に石畳
    map.squares.forEach((sq) => map.links[sq.id].forEach((w) => {
      if (w < sq.id) return;
      const b = map.squares[w];
      const [ax, az] = lay.at(sq.x, sq.y), [bx, bz] = lay.at(b.x, b.y);
      add(M.cube, [(ax + bx) / 2, -0.005, (az + bz) / 2], [ax !== bx ? 1.0 : 0.5, 0.01, az !== bz ? 1.0 : 0.5], { tex: tx.cobble, uvs: [1, 1] });
    }));

    // 盤の縁の柵
    const LX = W / 2 + 0.12, LZ = H / 2 + 0.12;
    const posts = detail === 'low' ? 0 : detail === 'mid' ? 3 * (W + H) : 6 * (W + H);
    for (let i = 0; i < posts; i++) {
      const per = 2 * (2 * LX + 2 * LZ);
      let d = (i / posts) * per;
      let px: number, pz: number;
      if (d < 2 * LX) { px = -LX + d; pz = -LZ; } else if ((d -= 2 * LX) < 2 * LZ) { px = LX; pz = -LZ + d; }
      else if ((d -= 2 * LZ) < 2 * LX) { px = LX - d; pz = LZ; } else { d -= 2 * LX; px = -LX; pz = LZ - d; }
      add(M.cyl, [px, -0.02, pz], [0.05, 0.22, 0.05], { tex: tx.wood });
    }
    if (posts) for (const [x, z, sx, sz] of [[0, -LZ, 2 * LX, 0.03], [LX, 0, 0.03, 2 * LZ], [0, LZ, 2 * LX, 0.03], [-LX, 0, 0.03, 2 * LZ]]) {
      add(M.cube, [x, 0.13, z], [sx, 0.03, sz], { tex: tx.wood, uvs: [n, 1] });
    }

    // 空いている所：噴水・木・街灯
    if (lay.fountain) {
      const [fx, fz] = lay.fountain;
      add(M.cyl, [fx, 0.0, fz], [0.86, 0.14, 0.86], { tex: tx.stone, c: C('#E6E8EE'), uvs: [6, 1], shadow: 1 });
      add(M.cyl, [fx, 0.02, fz], [0.74, 0.14, 0.74], { tex: tx.water });
      add(M.bowl, [fx, 0.14, fz], [0.42, 0.3, 0.42], { tex: tx.stone, c: C('#EEF0F4') });
      add(M.sphere, [fx, 0.4, fz], [0.14, 0.2, 0.14], { tex: tx.water, bob: 1 });
    }
    const rand = mulberry(W * 97 + H * 13 + 3);
    const perCell = detail === 'low' ? 0.3 : detail === 'mid' ? 1 : 2;
    const trees: [number, number][] = [];
    lay.empty.forEach(([cx, cz], k) => {
      if (lay.fountain && cx === lay.fountain[0] && cz === lay.fountain[1]) return;
      let want = Math.floor(perCell) + (rand() < perCell % 1 ? 1 : 0);
      for (let guard = 0; want > 0 && guard < 40; guard++) {
        const x = cx + (rand() - 0.5) * 0.7, z = cz + (rand() - 0.5) * 0.7;
        if (segDist([x, z], lay.dice) < 0.5) continue;
        if (trees.every(([a, b]) => Math.hypot(a - x, b - z) > 0.42)) { trees.push([x, z]); want--; }
      }
      if (detail !== 'low' && k % 3 === 1) {
        const x = cx + 0.4, z = cz - 0.4;
        if (segDist([x, z], lay.dice) > 0.4) {
          add(M.lamp, [x, 0, z], [0.1, 0.6, 0.1], { c: C('#2B3350'), shadow: 0.5 });
          add(M.sphere, [x, 0.6, z], [0.14, 0.14, 0.14], { c: C('#FFE7A8'), flat: 1 });
          add(M.cone, [x, 0.69, z], [0.18, 0.07, 0.18], { c: C('#2B3350') });
        }
      }
    });
    trees.forEach(([x, z], k) => {
      const sc = 0.75;
      add(M.cyl, [x, 0, z], [0.08, 0.3, 0.08], { tex: tx.bark, uvs: [2, 1], shadow: 0.9 });
      if (k % 2) {
        for (const [y, w, hh] of [[0.2, 0.5, 0.42], [0.4, 0.4, 0.38], [0.58, 0.28, 0.32]]) add(M.cone, [x, y, z], [w * sc, hh, w * sc], { tex: tx.leaves });
      } else {
        add(M.sphere, [x, 0.22, z], [0.5 * sc, 0.46, 0.5 * sc], { tex: tx.leaves });
        add(M.sphere, [x + 0.08, 0.42, z - 0.04], [0.3, 0.3, 0.3], { tex: tx.leaves });
      }
    });

    // マス
    map.squares.forEach((sq) => {
      const [x, z] = lay.at(sq.x, sq.y);
      const rot = lay.facing(sq.x, sq.y);
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const at = (lx: number, lz: number): [number, number] => [x + cs * lx + sn * lz, z - sn * lx + cs * lz];
      const pr = s.props[sq.id];
      const owner = pr?.owner != null ? s.players[pr.owner] : null;
      // 頭上のピン：持ち主の色の札に利用料（休み中は「休業」）。ふわふわ揺れて、札はいつもカメラを向く
      const pin = (y: number) => {
        if (!owner) return;
        const closed = owner.closed;
        const text = closed ? '休業' : `${fee(s, sq.id).toLocaleString()}G`;
        const color = closed ? '#8890A8' : owner.color;
        const phase = sq.id * 0.9;
        const crown = s.mode === 'normal' && sq.kind === 'shop' && isMonopoly(s, sq.street!, owner.id);
        add(M.cyl, [x, y, z], [0.018, 0.2, 0.018], { c: C('#EEF0F4'), pinBob: phase });
        add(M.cone, [x, y + 0.34, z], [0.18, -0.14, 0.18], { c: C(color), pinBob: phase });
        add(M.cube, [x, y + 0.33, z], [0.6, 0.3, 0.012], {
          tex: r.tex(`sign:pin:${color}:${text}:${crown ? 'c' : ''}`, () => T.pinLabel(text, color, crown), false), pinBob: phase, billboard: true, flat: 0.35,
        });
        pins++;
      };
      const plate = (color: string, tex = tx.stone) => add(M.cube, [x, 0, z], [0.94, 0.06, 0.94], { tex, c: C(color, 0.5), uvs: [1, 1] });

      if (sq.kind === 'shop' || (sq.kind === 'lot' && s.mode === 'normal' && pr?.facility === 'ryogae')) {
        const isShop = sq.kind === 'shop';
        const st = isShop ? map.streets[sq.street!] : { name: '', color: '#C9A227' };
        const kind = isShop ? sq.street! % 3 : 1;
        const ratio = pr ? pr.value / (sq.base ?? pr.value) : 1;
        const floors = isShop ? Math.max(1, Math.min(4, 1 + Math.round((ratio - 1) * 1.5))) : 1;
        const hgt = 0.27 * floors + 0.12;
        const facadeTex = r.tex(`facade:${st.color}:${kind}`, () => T.facade(st.color, kind));
        const roofTex = r.tex(`roof:${st.color}:${kind % 2}`, () => T.roof(st.color, kind % 2));
        const dim: Vec3 = isShop && !owner ? [0.8, 0.8, 0.84] : [1, 1, 1];
        plate(st.color);
        add(M.cube, [x, 0.06, z], [0.6, hgt, 0.6], { tex: facadeTex, uvs: [1, floors], r: rot, c: dim, shadow: hgt });
        add(M.cube, [x, 0.06 + hgt, z], [0.66, 0.035, 0.66], { c: C(st.color, -0.3), r: rot });
        add(M.prism, [x, 0.095 + hgt, z], [0.7, 0.3, 0.68], { tex: roofTex, uvs: [2, 1.5], r: rot });
        if (detail === 'high') {
          const [chx, chz] = at(0.18, -0.12);
          add(M.cube, [chx, 0.12 + hgt, chz], [0.08, 0.26, 0.08], { tex: r.tex(`facade:${st.color}:0`, () => T.facade(st.color, 0)), uvs: [0.2, 0.5] });
        }
        // 入口・看板・日よけ
        let [dx, dz] = at(0, 0.305);
        add(M.cube, [dx, 0.06, dz], [0.17, 0.25, 0.02], { tex: tx.wood, r: rot });
        const label = isShop ? sq.name : '両替所';
        [dx, dz] = at(0, 0.31);
        add(M.cube, [dx, 0.33, dz], [0.52, 0.13, 0.024], { tex: r.tex(`sign:${label}:${st.color}`, () => T.sign(label, st.color), false), r: rot });
        if (owner) {
          [dx, dz] = at(0, 0.37);
          add(M.prism, [dx, 0.25, dz], [0.58, 0.07, 0.16], { tex: r.tex(`awning:${owner.color}`, () => T.awning(owner.color)), r: rot });
        }
        if (owner?.closed) {
          [dx, dz] = at(0, 0.318);
          add(M.cube, [dx, 0.06, dz], [0.5, 0.25, 0.02], { tex: tx.shutter, r: rot });
        }
        if (isShop && !owner) {
          const [px, pz] = at(0.3, 0.44);
          add(M.cyl, [px, 0.06, pz], [0.025, 0.3, 0.025], { tex: tx.wood });
          add(M.cube, [px, 0.26, pz], [0.26, 0.12, 0.02], { tex: r.tex('sign:売り物件', () => T.sign('売り物件', '#C8402F', '#C8402F'), false), r: rot });
        }
        if (detail !== 'low') for (const sx of [-0.22, 0.22]) {
          const [qx, qz] = at(sx, 0.4);
          add(M.pot, [qx, 0.06, qz], [0.1, 0.08, 0.1], { c: C('#B5643A') });
          add(M.sphere, [qx, 0.11, qz], [0.12, 0.1, 0.12], { tex: tx.leaves });
        }
        pin(0.095 + hgt + 0.3);
      } else if (sq.kind === 'bank') {
        plate('#C9D2E6');
        add(M.cube, [x, 0.06, z], [0.6, 1.5, 0.6], { tex: tx.bank, uvs: [1, 3], r: rot, shadow: 1.6 });
        add(M.cube, [x, 1.56, z], [0.68, 0.08, 0.68], { c: C('#C9A227'), r: rot });
        add(M.prism, [x, 1.64, z], [0.7, 0.28, 0.5], { c: C('#26314F'), r: rot });
        let [dx, dz] = at(0, 0.31);
        add(M.cube, [dx, 1.22, dz], [0.46, 0.15, 0.02], { tex: r.tex('sign:銀行', () => T.sign('銀行', '#C9A227'), false), r: rot });
        const cols = detail === 'low' ? [-0.24, 0.24] : [-0.27, -0.09, 0.09, 0.27];
        for (const c0 of cols) { [dx, dz] = at(c0 * 0.85, 0.36); add(M.cyl, [dx, 0.06, dz], [0.07, 0.62, 0.07], { c: C('#F3F0E6') }); }
        [dx, dz] = at(0, 0.36);
        add(M.cube, [dx, 0.68, dz], [0.6, 0.05, 0.13], { c: C('#F3F0E6'), r: rot });
        add(M.prism, [dx, 0.73, dz], [0.6, 0.12, 0.13], { c: C('#F3F0E6'), r: rot });
      } else if (sq.kind === 'stamp') {
        const col = ['#F4C27A', '#F5A3C0', '#9EC5F0', '#F2D16B'][sq.stamp!];
        plate(col);
        add(M.cyl, [x, 0.06, z], [0.42, 0.1, 0.42], { tex: tx.stone, c: C('#EEF0F4'), shadow: 0.4 });
        add(M.rbox, [x, 0.2, z], [0.34, 0.34, 0.34], { tex: r.tex(`stamp:${sq.stamp}`, () => T.stamp(sq.stamp!), false), spin: sq.id });
      } else if (sq.kind === 'chance' || (sq.kind === 'lot' && s.mode === 'easy')) {
        plate('#F6E3A0');
        add(M.rbox, [x, 0.14, z], [0.38, 0.38, 0.38], { tex: tx.chance, spin: sq.id, shadow: 0.5 });
      } else if (sq.kind === 'plaza') {
        add(M.cube, [x, 0, z], [0.94, 0.06, 0.94], { tex: tx.grass, uvs: [1, 1] });
        add(M.cyl, [x, 0.06, z], [0.62, 0.1, 0.62], { tex: tx.stone, c: C('#E6E8EE'), shadow: 0.4 });
        add(M.cyl, [x, 0.07, z], [0.52, 0.1, 0.52], { tex: tx.water });
        add(M.bowl, [x, 0.12, z], [0.22, 0.16, 0.22], { tex: tx.stone, c: C('#EEF0F4') });
        const [tx0, tz0] = at(-0.3, -0.3);
        add(M.cyl, [tx0, 0.06, tz0], [0.07, 0.3, 0.07], { tex: tx.bark });
        add(M.sphere, [tx0, 0.28, tz0], [0.34, 0.32, 0.34], { tex: tx.leaves, shadow: 0.6 });
      } else if (sq.kind === 'lot') {
        add(M.cube, [x, 0, z], [0.94, 0.06, 0.94], { tex: tx.grass, uvs: [1, 1] });
        if (pr?.facility === 'yatai') {
          for (const [lx, lz] of [[-0.2, 0.15], [0.2, 0.15], [0, -0.2]]) {
            const [sx, sz] = at(lx, lz);
            add(M.cube, [sx, 0.06, sz], [0.28, 0.14, 0.2], { tex: tx.wood, r: rot, shadow: 0.3 });
            add(M.prism, [sx, 0.28, sz], [0.34, 0.1, 0.26], { tex: r.tex('awning:#E2463B', () => T.awning('#E2463B')), r: rot });
            for (const d of [-0.12, 0.12]) { const [px, pz] = at(lx + d, lz + 0.09); add(M.cyl, [px, 0.2, pz], [0.015, 0.08, 0.015], { c: C('#2B3350') }); }
          }
          const [lx2, lz2] = at(0, 0.42);
          add(M.cyl, [lx2, 0.2, lz2], [0.12, 0.16, 0.12], { tex: tx.lantern, flat: 0.5 });
          pin(0.4);
        } else {
          const [px, pz] = at(0, 0.3);
          add(M.cyl, [px, 0.06, pz], [0.025, 0.28, 0.025], { tex: tx.wood });
          add(M.cube, [px, 0.24, pz], [0.3, 0.13, 0.02], { tex: r.tex('sign:空き地', () => T.sign('空き地', '#3E9B5A', '#3E9B5A'), false), r: rot });
        }
      }
    });
    items = out;
    el.dataset.pins = String(pins);
  }

  function sig(s: GameState) {
    return JSON.stringify([s.mapId, s.mode, detail, fontsReady, s.props.map((p) => p && [p.owner, p.value, p.facility ?? '']),
      s.players.map((p) => [p.color, p.closed])]);
  }

  // ---------- 動くもの ----------
  function squareCenter(s: GameState, sq: number): Vec3 {
    const map = getMap(s.mapId);
    const [x, z] = layoutOf(map).at(map.squares[sq].x, map.squares[sq].y);
    return [x, 0.06, z];
  }
  function tokenTargets(s: GameState, v: BoardView): Vec3[] {
    const pos = v.tokens ?? s.players.map((p) => p.pos);
    return s.players.map((_, i) => {
      const c = squareCenter(s, pos[i]);
      return [c[0] + (i % 2 ? 0.3 : -0.3), 0.06, c[2] + (i < 2 ? -0.3 : 0.3)];
    });
  }

  function dynamicItems(t: number): { items: SceneItem[]; overlay: SceneItem[] } {
    const s = state!, v = view!;
    const out: SceneItem[] = [];
    const overlay: SceneItem[] = [];
    const labels: SceneItem[] = []; // 矢印より手前に描くので、最後に足す
    // コマ（1 マスずつ跳ねて進む）
    const targets = tokenTargets(s, v);
    s.players.forEach((p, i) => {
      if (p.bankrupt) return;
      const d = disp[i] ?? (disp[i] = { pos: targets[i], from: targets[i], to: targets[i], t0: 0 });
      const tg = targets[i];
      if (tg[0] !== d.to[0] || tg[2] !== d.to[2]) { d.from = d.pos; d.to = tg; d.t0 = t; }
      const k = Math.min(1, (t - d.t0) / 160);
      const e = k * k * (3 - 2 * k);
      const hop = Math.sin(Math.PI * k) * 0.28 * (d.from === d.to ? 0 : 1);
      const bounce = i === s.turn && s.phase !== 'over' ? Math.abs(Math.sin(t / 260)) * 0.06 : 0;
      d.pos = [d.from[0] + (d.to[0] - d.from[0]) * e, 0.06 + hop + bounce, d.from[2] + (d.to[2] - d.from[2]) * e];
      const C = T.rgb(p.color);
      const mine = v.me === i;
      const k2 = mine ? 1.2 : 1; // 自分のコマは少し大きく
      out.push({ mesh: M.pawn, p: d.pos, s: [0.26 * k2, 0.5 * k2, 0.26 * k2], r: 0, c: C, tex: r.white, uvs: [1, 1], shadow: 0.5 });
      out.push({ mesh: M.sphere, p: [d.pos[0], d.pos[1] + 0.36 * k2, d.pos[2]], s: [0.17 * k2, 0.17 * k2, 0.17 * k2], r: 0, c: T.rgb(p.color, 0.25), tex: r.white, uvs: [1, 1] });
      if (mine) {
        // 自分のコマ：足元に光る輪、頭上に「あなた」の札（いつも手前に描く）
        const pulse = 1 + Math.sin(t / 250) * 0.12;
        overlay.push({ mesh: M.plane, p: [d.pos[0], 0.085, d.pos[2]], s: [0.62 * pulse, 1, 0.62 * pulse], r: 0, c: [1, 1, 1],
          tex: r.tex(`ring:${p.color}`, () => T.ring(p.color), false), uvs: [1, 1], alpha: 0.95, flat: 1 });
        const sc = Math.min(1.7, Math.max(1, 640 / Math.max(1, canvas.clientWidth)));
        if (!(i === s.turn && v.stepsLeft)) {
          labels.push({ mesh: M.card, p: [d.pos[0], d.pos[1] + 0.68, d.pos[2]], s: [0.5 * sc, 0.25 * sc, 1], r: cam.yaw, c: [1, 1, 1],
            tex: r.tex(`sign:pin:${p.color}:あなた:`, () => T.pinLabel('あなた', p.color), false), uvs: [1, 1], flat: 0.4, onTop: true });
        }
      }
      // 進んでいるあいだは、手番の人のコマの上に残りの歩数
      if (i === s.turn && v.stepsLeft) {
        const sc = Math.min(1.7, Math.max(1, 640 / Math.max(1, canvas.clientWidth)));
        const text = `あと ${v.stepsLeft}`;
        labels.push({ mesh: M.card, p: [d.pos[0], d.pos[1] + 0.68, d.pos[2]], s: [0.56 * sc, 0.28 * sc, 1], r: cam.yaw, c: [1, 1, 1],
          tex: r.tex(`sign:pin:#E0A21B:${text}:`, () => T.pinLabel(text, '#E0A21B'), false), uvs: [1, 1], flat: 0.4, onTop: true });
      }
      if (i === s.turn) {
        const y = mine ? 1.12 : 0.85;
        overlay.push({ mesh: M.cone, p: [d.pos[0], y + Math.sin(t / 300) * 0.05, d.pos[2]], s: [0.12, -0.16, 0.12], r: t / 500, c: T.rgb('#E0A21B'), tex: r.white, uvs: [1, 1], flat: 0.6 });
      }
    });
    // サイコロ：盤の隅から投げ、はねながら転がって、出た目を上にして止まる
    if (s.dice) {
      if (diceAnim.value !== s.dice) diceAnim = { value: s.dice, t0: t };
      out.push(...diceItems(t));
    } else diceAnim.value = 0;
    // 分かれ道：選べるマスの家の上に、名前と状態の札（自分が選ぶときは緑、ほかの人のときは灰色）
    choiceSpots = [];
    if (s.pending?.kind === 'direction' && s.phase === 'decide') {
      const mine = !!v.choices?.length;
      const color = mine ? '#2FA35B' : '#6B7390';
      const sc = Math.min(1.7, Math.max(1, 640 / Math.max(1, canvas.clientWidth)));
      const forkSq = s.pending.sq;
      s.pending.options.forEach((o, k) => {
        const c = squareCenter(s, o);
        const stops = stopsVia(getMap(s.mapId), forkSq, o, s.moving?.left ?? 1).map((q) => choiceText(s, q)[0]);
        const name = 'この道へ進む';
        const sub = `止まる：${stops.join('・')}`;
        // 札どうしが重ならないよう、2 枚目以降は少しずつ高くする
        const y = labelHeight(s, o) + k * 0.5 * sc + Math.sin(t / 300 + o) * 0.04;
        labels.push({
          mesh: M.card, p: [c[0], y, c[2]], s: [1.6 * sc, 0.4 * sc, 1], r: cam.yaw,
          tex: r.tex(`sign:choice:${color}:${name}:${sub}`, () => T.choiceLabel(name, sub, color), false),
          c: [1, 1, 1], uvs: [1, 1], flat: 0.4, onTop: true,
        });
        choiceSpots.push({ sq: o, p: [c[0], y + 0.2 * sc, c[2]] });
      });
    }
    el.dataset.choices = String(choiceSpots.length);
    // サイコロで止まる候補：床を青く光らせ、上に目の数の札（分かれ道の札が出ているマスには出さない）
    let lands = 0;
    for (const [sq, label] of v.landing ?? []) {
      const c = squareCenter(s, sq);
      overlay.push({ mesh: M.plane, p: [c[0], 0.078, c[2]], s: [0.96, 1, 0.96], r: 0, c: T.rgb('#2F5BD3'), tex: r.white, uvs: [1, 1], alpha: 0.28 + Math.sin(t / 300) * 0.1, flat: 1 });
      if (choiceSpots.some((x) => x.sq === sq)) continue;
      const text = label.replace('🎲', '');
      const sc = Math.min(1.7, Math.max(1, 640 / Math.max(1, canvas.clientWidth)));
      labels.push({ mesh: M.card, p: [c[0], labelHeight(s, sq) - 0.15, c[2]], s: [0.56 * sc, 0.28 * sc, 1], r: cam.yaw, c: [1, 1, 1],
        tex: r.tex(`sign:land:${text}`, () => T.landLabel(text), false), uvs: [1, 1], flat: 0.4, onTop: true });
      lands++;
    }
    el.dataset.landing = String(lands);
    // サイコロを振ったあと：通るマスの床に光る点、到着マスに金色の輪と光の柱と札
    for (const sq of v.trail ?? []) {
      if (sq === v.dest) continue;
      const c = squareCenter(s, sq);
      overlay.push({ mesh: M.cyl, p: [c[0], 0.075, c[2]], s: [0.18, 0.02, 0.18], r: 0, c: T.rgb('#F2C230'), tex: r.white, uvs: [1, 1], flat: 1, alpha: 0.9 });
    }
    if (v.dest != null) {
      const c = squareCenter(s, v.dest);
      const pulse = 1 + Math.sin(t / 200) * 0.08;
      overlay.push({ mesh: M.plane, p: [c[0], 0.082, c[2]], s: [1.1 * pulse, 1, 1.1 * pulse], r: 0, c: [1, 1, 1],
        tex: r.tex('ring:#E0A21B', () => T.ring('#E0A21B'), false), uvs: [1, 1], alpha: 1, flat: 1 });
      overlay.push({ mesh: M.cyl, p: [c[0], 0.06, c[2]], s: [0.5, 1.5, 0.5], r: 0, c: T.rgb('#FFE27A'), tex: r.white, uvs: [1, 1], flat: 1, alpha: 0.12 + Math.sin(t / 250) * 0.04 });
      const sc = Math.min(1.7, Math.max(1, 640 / Math.max(1, canvas.clientWidth)));
      const text = v.destText ?? '到着';
      if (!choiceSpots.some((x) => x.sq === v.dest)) {
        labels.push({ mesh: M.card, p: [c[0], labelHeight(s, v.dest), c[2]], s: [0.72 * sc, 0.36 * sc, 1], r: cam.yaw, c: [1, 1, 1],
          tex: r.tex(`sign:pin:#E0A21B:${text}:`, () => T.pinLabel(text, '#E0A21B'), false), uvs: [1, 1], flat: 0.4, onTop: true });
      }
      destNow = v.dest;
    } else destNow = null;
    el.dataset.dest = destNow != null ? String(destNow) : '';
    // 競売中のお店：赤い輪と「競売中 〇〇G」の札
    if (s.phase === 'auction' && s.auction) {
      const au = s.auction;
      const c = squareCenter(s, au.sq);
      const pulse = 1 + Math.sin(t / 160) * 0.1;
      overlay.push({ mesh: M.plane, p: [c[0], 0.083, c[2]], s: [1.1 * pulse, 1, 1.1 * pulse], r: 0, c: [1, 1, 1],
        tex: r.tex('ring:#C8402F', () => T.ring('#C8402F'), false), uvs: [1, 1], alpha: 1, flat: 1 });
      const text = au.leader == null ? `競売 最低${au.min}G` : `競売中 ${au.price}G`;
      const sc = Math.min(1.7, Math.max(1, 640 / Math.max(1, canvas.clientWidth)));
      labels.push({ mesh: M.card, p: [c[0], labelHeight(s, au.sq), c[2]], s: [0.8 * sc, 0.4 * sc, 1], r: cam.yaw, c: [1, 1, 1],
        tex: r.tex(`sign:pin:#C8402F:${text}:`, () => T.pinLabel(text, '#C8402F'), false), uvs: [1, 1], flat: 0.4, onTop: true });
    }
    // 分かれ道で選べるマス
    for (const c0 of v.choices ?? []) {
      const c = squareCenter(s, c0);
      overlay.push({ mesh: M.plane, p: [c[0], 0.08, c[2]], s: [0.98, 1, 0.98], r: 0, c: T.rgb('#2FA35B'), tex: r.white, uvs: [1, 1], alpha: 0.4 + Math.sin(t / 160) * 0.25, flat: 1 });
    }
    // 分かれ道：コマの頭上に、進める方向の矢印（自分が選ぶときは緑、ほかの人のときは灰色）
    if (s.pending?.kind === 'direction' && s.phase === 'decide') {
      const d0 = disp[s.turn];
      const from = squareCenter(s, s.pending.sq);
      const mine = !!v.choices?.length;
      const color = T.rgb(mine ? '#2FA35B' : '#8890A8');
      const base: Vec3 = d0 ? [d0.pos[0], 0, d0.pos[2]] : [from[0], 0, from[2]];
      // 銀行の上では建物より高くする
      const onBank = getMap(s.mapId).squares[s.pending.sq].kind === 'bank';
      const hgt = (onBank ? 2.15 : 1.0) + Math.sin(t / 260) * 0.04;
      for (const o of s.pending.options) {
        const to = squareCenter(s, o);
        const dir = norm3([to[0] - from[0], 0, to[2] - from[2]]);
        const push = 0.06 * (1 + Math.sin(t / 180)); // 進む向きへ少し動いて目立たせる
        const cx = base[0] + dir[0] * (0.32 + push), cz = base[2] + dir[2] * (0.32 + push);
        // 軸（細長い箱）
        overlay.push({ mesh: M.cube, p: [cx, hgt - 0.06, cz], s: [0.13, 0.12, 0.42], r: Math.atan2(dir[0], dir[2]), c: color, tex: r.white, uvs: [1, 1], flat: 0.3, onTop: true });
        // 先（横に倒した円錐。y 軸を進む向きへ回す）
        const hx = cx + dir[0] * 0.34, hz = cz + dir[2] * 0.34;
        overlay.push({ mesh: M.cone, p: [hx, hgt - 0.19, hz], s: [0.38, 0.38, 0.38], r: 0,
          m3: axisAngle(norm3([dir[2], 0, -dir[0]]), Math.PI / 2), c: color, tex: r.white, uvs: [1, 1], flat: 0.3, onTop: true });
      }
    }
    // この番に独占した通り：マスの床に金色の光る枠
    if (s.monopoly) {
      const map = getMap(s.mapId);
      const glow = 0.35 + Math.sin(t / 220) * 0.2;
      for (const q of map.squares) {
        if (q.kind !== 'shop' || q.street !== s.monopoly.street) continue;
        const c = squareCenter(s, q.id);
        overlay.push({ mesh: M.plane, p: [c[0], 0.075, c[2]], s: [1.04, 1, 1.04], r: 0, c: T.rgb('#F2C230'), tex: r.white, uvs: [1, 1], alpha: glow, flat: 1 });
      }
    }
    // 選んだマス
    if (v.selected != null) {
      const c = squareCenter(s, v.selected);
      overlay.push({ mesh: M.plane, p: [c[0], 0.075, c[2]], s: [1, 1, 1], r: 0, c: T.rgb('#F2C230'), tex: r.white, uvs: [1, 1], alpha: 0.45 + Math.sin(t / 200) * 0.2, flat: 1 });
    }
    overlay.push(...labels);
    return { items: out, overlay };
  }

  function diceItems(t: number): SceneItem[] {
    const k = Math.min(1, (t - diceAnim.t0) / DICE_MS);
    const seed = diceAnim.t0 % 1000;
    const [[fx, fz], [tx, tz]] = layoutOf(getMap(state!.mapId)).dice;
    const from: Vec3 = [fx, 0, fz];
    const to: Vec3 = [tx, 0, tz];
    // 進み方は減速、高さは 3 回はねて小さくなる
    const e = 1 - Math.pow(1 - k, 2.2);
    const bounces = [[0, 0.45, 0.9], [0.45, 0.75, 0.35], [0.75, 0.92, 0.12]];
    let y = 0;
    for (const [a, b, hh] of bounces) if (k >= a && k < b) y = Math.sin(((k - a) / (b - a)) * Math.PI) * hh;
    // 回転：斜めの軸のまわりに、止まるまでに何周もしてから 0 に戻る
    const axis = norm3([Math.sin(seed) + 0.3, 0.35, Math.cos(seed) + 0.2]);
    const angle = Math.pow(1 - k, 1.6) * Math.PI * 2 * 3.25;
    const size = 0.42;
    const p: Vec3 = [from[0] + (to[0] - from[0]) * e, 0.06 + y, from[2] + (to[2] - from[2]) * e];
    const items: SceneItem[] = [{
      mesh: M.dice[diceAnim.value - 1], p, s: [size, size, size], r: 0, m3: rotY(0.4, axisAngle(axis, angle)),
      c: [1, 1, 1], tex: r.tex('dice', T.diceAtlas, false), uvs: [1, 1], shadow: 0.35,
    }];
    return items;
  }

  // ---------- 描く ----------
  let raf = 0;
  let visible = true;
  // カメラの注視点：盤の中心から、手番の人のコマの方へ少し寄せる（分かれ道の矢印が画面の端に出ないように）
  const look: Vec3 = [0, 0.2, 0];
  function eye(): Vec3 {
    const { yaw, pitch, dist } = cam;
    return [look[0] + Math.cos(pitch) * Math.sin(yaw) * dist, look[1] + 0.1 + Math.sin(pitch) * dist, look[2] + Math.cos(pitch) * Math.cos(yaw) * dist];
  }
  function frame(t: number) {
    raf = 0;
    if (!state || !view || !visible || document.hidden) return;
    const dpr = Math.min(window.devicePixelRatio || 1, DPR[detail]);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), hh = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
    // 注視点：手番の人のコマへ寄せる。到着マスがあるときは、コマと到着マスの間へ
    const tok = disp[state.turn]?.pos;
    if (tok) {
      const k = 0.06;
      const dc = destNow != null ? squareCenter(state, destNow) : null;
      const tx = dc ? (tok[0] + dc[0]) / 2 : tok[0], tz = dc ? (tok[2] + dc[2]) / 2 : tok[2];
      look[0] += (tx * 0.5 - look[0]) * k;
      look[2] += (tz * 0.5 - look[2]) * k;
    }
    // 視点を戻す動き（向きは近い回り方で）
    if (camAnim) {
      const k = Math.min(1, (performance.now() - camAnim.t0) / 650);
      const e2 = 1 - Math.pow(1 - k, 3);
      let dy = (HOME.yaw - camAnim.yaw) % (Math.PI * 2);
      if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
      cam.yaw = camAnim.yaw + dy * e2;
      cam.pitch = camAnim.pitch + (HOME.pitch - camAnim.pitch) * e2;
      cam.dist = camAnim.dist + (homeDist - camAnim.dist) * e2;
      if (k >= 1) { cam.yaw = HOME.yaw; camAnim = null; }
    }
    el.dataset.yaw = (((cam.yaw % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI).toFixed(2); // 画面テスト用（-π〜π）
    const e = eye();
    const mp = getMap(state.mapId);
    const n = Math.max(mp.width, mp.height);
    vp = mul(persp(0.72, w / hh, 0.1, n * 8), lookAt(e, [look[0], look[1], look[2]], [0, 1, 0]));
    const sunRaw: Vec3 = [0.45, 0.78, 0.35];
    const sl = Math.hypot(...sunRaw);
    const sun: Vec3 = [sunRaw[0] / sl, sunRaw[1] / sl, sunRaw[2] / sl];
    const pinScale = Math.min(1.9, Math.max(1, 640 / Math.max(1, canvas.clientWidth)));
    const anim = items.map((it): SceneItem => {
      if (it.spin !== undefined) return { ...it, p: [it.p[0], it.p[1] + 0.05 + Math.sin(t / 420 + it.spin) * 0.06, it.p[2]], r: t / 1300 + it.spin };
      if (it.bob) return { ...it, p: [it.p[0], it.p[1] + Math.sin(t / 300) * 0.02, it.p[2]] };
      if (it.pinBob !== undefined) {
        // 札は小さい画面ほど大きくする（スマホでも金額が読めるように）
        const sc = it.billboard ? pinScale : 1;
        return { ...it, p: [it.p[0], it.p[1] + Math.sin(t / 450 + it.pinBob) * 0.05, it.p[2]], s: [it.s[0] * sc, it.s[1] * sc, it.s[2]], r: it.billboard ? cam.yaw : it.r };
      }
      return it;
    });
    const dyn = dynamicItems(t);
    const all = [...anim, ...dyn.items];
    const tris = all.reduce((a, it) => a + it.mesh.count / 3, 0);
    if (tris !== lastTris) { lastTris = tris; hint.textContent = `三角形 ${Math.round(tris).toLocaleString()}・テクスチャ ${r.textureCount} 枚`; el.dataset.triangles = String(Math.round(tris)); el.dataset.textures = String(r.textureCount); }
    r.frame({ w, h: hh, vp, eye: e, sun, sky: SKY, fog: [n * 1.6, n * 3.2], items: all, blob: r.tex('blob', T.blob, false), plane: M.plane, overlay: dyn.overlay });
    raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  // ---------- 操作 ----------
  const pointers = new Map<number, { x: number; y: number }>();
  let moved = 0;
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    camAnim = null; // 自分で動かし始めたら、戻す動きはやめる
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) moved = 0;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch > 0) zoom(pinch / d);
      pinch = d;
      return;
    }
    cam.yaw -= dx * 0.008;
    cam.pitch = Math.min(1.45, Math.max(0.2, cam.pitch + dy * 0.006));
  });
  const up = (e: PointerEvent) => {
    if (pointers.size === 1 && moved < 6) pick(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = 0;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); pinch = 0; });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(1 + e.deltaY * 0.001); }, { passive: false });
  function zoom(f: number) {
    if (!state) return;
    const mp = getMap(state.mapId);
    const n = Math.max(mp.width, mp.height);
    cam.dist = Math.min(n * 2.6, Math.max(n * 0.55, cam.dist * f));
  }
  function pick(e: PointerEvent) {
    if (!state || !view || !vp.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width, my = (e.clientY - rect.top) / rect.height;
    const aspect = rect.height / rect.width;
    let best: number | null = null;
    let bestD = 0.06;
    // 分かれ道の札を押しても選べる（札は大きいので判定を広めに）
    for (const c of choiceSpots) {
      const p = project(vp, c.p);
      if (!p) continue;
      const d = Math.hypot(p[0] - mx, (p[1] - my) * aspect) * 0.6;
      if (d < bestD) { bestD = d; best = c.sq; }
    }
    for (const sq of getMap(state.mapId).squares) {
      const c = squareCenter(state, sq.id);
      for (const y of [0.1, 0.4]) {
        const p = project(vp, [c[0], y, c[2]]);
        if (!p) continue;
        const d = Math.hypot(p[0] - mx, (p[1] - my) * aspect);
        if (d < bestD) { bestD = d; best = sq.id; }
      }
    }
    if (best != null) view.onSelect(best);
  }

  // 見えていないときは描かない
  const io = new IntersectionObserver((es) => { visible = es.some((x) => x.isIntersecting); if (visible) kick(); });
  io.observe(el);
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener('visibilitychange', onVis);
  // 看板の文字は、フォントが届いたら描き直す
  document.fonts?.ready.then(() => { fontsReady = true; r.dropTextures('sign:'); signature = ''; if (state && view) api.update(state, view); }).catch(() => {});

  function resetView() {
    camAnim = { t0: performance.now(), yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist };
    kick();
  }
  const resetBtn = h('button', { class: 'reset-view', type: 'button', onclick: resetView }, '視点を戻す');
  el.append(resetBtn);

  const api: Board3D = {
    el,
    resetView,
    update(s, v) {
      state = s; view = v;
      if (camFor !== s.mapId) {
        const mp = getMap(s.mapId);
        const n = Math.max(mp.width, mp.height);
        camFor = s.mapId;
        homeDist = n * 1.55;
        cam.dist = homeDist;
      }
      // 自分の番が来たとき・分かれ道で方向を選ぶときは、視点を基本の向きに戻す（ボタンの左右と画面の左右をそろえる）
      const mine = s.turn === v.me && s.phase !== 'over';
      const ch = !!v.choices?.length;
      if ((mine && !wasMine) || (ch && !hadChoices)) resetView();
      wasMine = mine; hadChoices = ch;
      const sg = sig(s);
      if (sg !== signature) { signature = sg; build(s); }
      renderHud(s, v);
      kick();
    },
    setDetail(d) {
      if (d === detail) return;
      detail = d;
      M = makeMeshes();
      signature = '';
      if (state && view) api.update(state, view);
    },
    stats: () => ({ triangles: Math.round(lastTris), textures: r.textureCount, items: items.length }),
    destroy() {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      r.gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };

  function renderHud(s: GameState, v: BoardView) {
    const map = getMap(s.mapId);
    const card = s.lastCard != null ? CARDS[s.lastCard] : null;
    const leader = [...s.players].sort((a, b) => netWorth(s, b.id) - netWorth(s, a.id))[0];
    hud.replaceChildren(...[
      h('div', { class: 'hud-row' }, h('b', {}, map.name), h('span', {}, `目標 ${gold(map.target)}・${s.round} 周目`),
        h('span', {}, `トップ：${leader.name} ${gold(netWorth(s, leader.id))}`)),
      h('div', { class: 'hud-tip' }, 'ドラッグで回転・ピンチやホイールで拡大・マスをタップで詳しく'),
      s.monopoly ? h('div', { class: 'hud-card mono', role: 'status' }, h('b', {}, `♛ ${s.players[s.monopoly.player].name}が${map.streets[s.monopoly.street].name}を独占！`), ' 利用料 +10%・増資の上限 3 倍・買収されない') : null,
      s.salary ? h('div', { class: 'hud-card salary', role: 'status' }, h('b', {}, `${s.players[s.salary.player].name}が昇格！`), ` 段階 ${s.salary.level}・給料 ${gold(s.salary.amount)}`) : null,
      card ? h('div', { class: 'hud-card' }, h('b', {}, card.title), ' ', card.text) : null,
      v.message ? h('div', { class: 'hud-card' }, v.message) : null,
    ].filter((x): x is HTMLDivElement => x != null));
  }

  return api;
}

// 分かれ道の札の文字：1 行目はマスの名前、2 行目はそのマスの状態
function choiceText(s: GameState, sq: number): [string, string] {
  const map = getMap(s.mapId);
  const q = map.squares[sq];
  const pr = s.props[sq];
  const owner = pr?.owner != null ? s.players[pr.owner] : null;
  switch (q.kind) {
    case 'shop':
      if (!owner) return [q.name, `空き店舗 ${pr!.value.toLocaleString()}G`];
      if (owner.id === s.turn) return [q.name, '自分のお店（増資できる）'];
      return [q.name, `${owner.name}のお店・利用料 ${fee(s, sq).toLocaleString()}G`];
    case 'bank': return ['銀行', 'スタンプがそろえば給料・株を買える'];
    case 'stamp': return [q.name, s.players[s.turn].stamps[q.stamp!] ? 'もう持っている' : 'まだ持っていないスタンプ'];
    case 'chance': return ['チャンス', 'カードを引く'];
    case 'plaza': return ['広場', '止まると自分のお店がお休み'];
    case 'lot':
      if (s.mode === 'easy') return ['チャンス', 'カードを引く'];
      if (!owner) return ['空き地', `施設を建てられる ${pr!.value.toLocaleString()}G`];
      return [pr!.facility === 'yatai' ? '屋台村' : '両替所', owner.id === s.turn ? '自分の施設' : `${owner.name}の施設・利用料 ${fee(s, sq).toLocaleString()}G`];
  }
}

// 札を浮かべる高さ：家の屋根と利用料のピンより上
function labelHeight(s: GameState, sq: number): number {
  const map = getMap(s.mapId);
  const q = map.squares[sq];
  if (q.kind === 'bank') return 2.6;
  if (q.kind === 'shop') {
    const pr = s.props[sq]!;
    const floors = Math.max(1, Math.min(4, 1 + Math.round((pr.value / q.base! - 1) * 1.5)));
    return 0.095 + 0.27 * floors + 0.12 + 0.3 + (pr.owner != null ? 0.8 : 0.35);
  }
  return 1.2;
}

// 盤の配置：マスの位置、空いている所、噴水、サイコロを投げる道すじ、建物の向き
interface Layout {
  at(x: number, y: number): [number, number];
  facing(x: number, y: number): number;
  empty: [number, number][];
  fountain: [number, number] | null;
  dice: [[number, number], [number, number]];
}
const layouts = new Map<string, Layout>();
function layoutOf(map: GameMap): Layout {
  const hit = layouts.get(map.id);
  if (hit) return hit;
  const ox = (map.width - 1) / 2, oy = (map.height - 1) / 2;
  const filled = new Set(map.squares.map((q) => `${q.x},${q.y}`));
  const at = (x: number, y: number): [number, number] => [x - ox, y - oy];
  const empty: [number, number][] = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (!filled.has(`${x},${y}`)) empty.push(at(x, y));
  const byCenter = [...empty].sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
  const fountain = byCenter[0] ?? null;
  // サイコロは噴水の次に中央に近い空き地へ。手前（カメラ側）から投げ込む
  const land = byCenter.find((c) => c !== fountain) ?? [0, 0];
  const from: [number, number] = [Math.max(-ox, land[0] - 1.1), Math.max(-oy, Math.min(oy, land[1] + 0.9))];
  // 建物の正面：道のない方向のうち、盤の外側に近い向き
  const facing = (x: number, y: number) => {
    const [px, pz] = at(x, y);
    let best = 0, score = -Infinity;
    for (const [dx, dy, rot] of [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]] as const) {
      if (filled.has(`${x + dx},${y + dy}`)) continue;
      const sc = dx * px + dy * pz + (x + dx < 0 || y + dy < 0 || x + dx >= map.width || y + dy >= map.height ? 100 : 0);
      if (sc > score) { score = sc; best = rot; }
    }
    return best;
  };
  const lay: Layout = { at, facing, empty, fountain, dice: [from, land] };
  layouts.set(map.id, lay);
  return lay;
}
function segDist([px, pz]: [number, number], [[ax, az], [bx, bz]]: [[number, number], [number, number]]) {
  const dx = bx - ax, dz = bz - az;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - ax - dx * k, pz - az - dz * k);
}

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
