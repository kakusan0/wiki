// 景色の密度：木（近くは葉の板の集まり、遠くは絵の板）、草・低木・岩（Poly Haven CC0）、家並み
import * as THREE from 'three';
import { at, LENGTH, STATIONS, TUNNEL, BRIDGE, CROSSINGS, zoneAt } from '../route';
import { ground, zoneW, C, FORM_W, riverS } from './terrain';
import { tex, loadProp, Prop } from './assets';
import { merge, rng } from './geo';
import { onPlatform } from './track';
import { AOBA_TRACK, SAZA_TRACK } from '../net/network';
import { buildTown } from './town';

export interface Scenery { near: THREE.Object3D[]; update(cam: THREE.Vector3, o: { grass: number; trees: number; treeShadow: number }): void; }

// ---- 木 ----
function treeGeometry(r: () => number, kind: 'broad' | 'conifer') {
  const h = kind === 'conifer' ? 11 + r() * 6 : 7 + r() * 5;
  const trunkH = kind === 'conifer' ? h * 0.95 : h * 0.55;
  const trunk = new THREE.CylinderGeometry(0.1, kind === 'conifer' ? 0.28 : 0.24, trunkH, 7, 1);
  trunk.translate(0, trunkH / 2, 0);
  const trunks: THREE.BufferGeometry[] = [trunk];
  const cards: THREE.BufferGeometry[] = [];
  const n = kind === 'conifer' ? 34 : 34;
  for (let i = 0; i < n; i++) {
    let x: number, y: number, z: number, size: number;
    if (kind === 'conifer') {
      const t = r();
      y = h * (0.25 + 0.75 * t);
      const rad = (1 - t) * 2.6 + 0.3;
      const a = r() * Math.PI * 2;
      x = Math.cos(a) * rad * (0.5 + r() * 0.5); z = Math.sin(a) * rad * (0.5 + r() * 0.5);
      size = 2.4 + (1 - t) * 1.8;
    } else {
      const u = r() * Math.PI * 2, v = Math.acos(2 * r() - 1);
      const rr = 0.55 + r() * 0.45;
      x = Math.sin(v) * Math.cos(u) * 2.9 * rr; z = Math.sin(v) * Math.sin(u) * 2.9 * rr;
      y = h * 0.62 + Math.cos(v) * 2.3 * rr;
      size = 3.2 + r() * 1.6;
      if (i < 5) { // 枝
        const b = new THREE.CylinderGeometry(0.04, 0.09, 2.4, 5); b.translate(0, 1.2, 0);
        b.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r() - 0.5, r() * 6, 0.7 + r() * 0.4)));
        b.translate(0, trunkH * 0.85, 0); trunks.push(b);
      }
    }
    const q = new THREE.PlaneGeometry(size * 0.6, size);
    q.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((r() - 0.5) * 1.2, r() * Math.PI, (r() - 0.5) * 1.2)));
    q.translate(x, y, z);
    // 外向きの法線にして、丸くやわらかい陰にする
    const nor = q.getAttribute('normal') as THREE.BufferAttribute;
    const nv = new THREE.Vector3(x, (y - h * 0.62) * 0.8 + 0.6, z).normalize();
    for (let k = 0; k < nor.count; k++) nor.setXYZ(k, nv.x, nv.y, nv.z);
    cards.push(q);
  }
  return { trunk: merge(trunks), leaves: merge(cards), h };
}

/** 桜の花の板（花びらのかたまりを描く） */
function blossomMaterial() {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
  const c = cv.getContext('2d')!;
  let a = 9; const r = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 900; i++) {
    const x = 128 + (r() - 0.5) * 220 * Math.sin(r() * Math.PI), y = 30 + r() * 450;
    const rad = 3 + r() * 5;
    const col = r() < 0.12 ? `hsl(95, 35%, ${30 + r() * 15}%)` : `hsl(${340 + r() * 15}, ${55 + r() * 25}%, ${80 + r() * 12}%)`;
    c.fillStyle = col;
    for (let k = 0; k < 5; k++) { const an = (k / 5) * Math.PI * 2 + r(); c.beginPath(); c.arc(x + Math.cos(an) * rad * 0.7, y + Math.sin(an) * rad * 0.7, rad * 0.6, 0, Math.PI * 2); c.fill(); }
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  m.alphaToCoverage = true;
  return m;
}

function leafMaterial(tint: number) {
  const m = new THREE.MeshStandardMaterial({
    map: tex('tex/leafcard.png', true), alphaTest: 0.5, side: THREE.DoubleSide, color: tint, roughness: 0.85,
  });
  m.alphaToCoverage = true;
  return m;
}

/** 木を真横から描いた絵（遠くの木用）を作る */
function impostor(renderer: THREE.WebGLRenderer, trunk: THREE.BufferGeometry, leaves: THREE.BufferGeometry, h: number, lm: THREE.Material, tm: THREE.Material) {
  const rt = new THREE.WebGLRenderTarget(256, 256);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const sc = new THREE.Scene();
  sc.add(new THREE.Mesh(trunk, tm), new THREE.Mesh(leaves, lm));
  sc.add(new THREE.HemisphereLight(0xd8e8ff, 0x3a4a2a, 1.6));
  const sun = new THREE.DirectionalLight(0xfff2e0, 2.2); sun.position.set(4, 8, 6); sc.add(sun);
  const w = 7;
  const cam = new THREE.OrthographicCamera(-w, w, h + 1, h + 1 - 2 * w, 0.1, 50);
  cam.position.set(0, 0, 20);
  const prevTarget = renderer.getRenderTarget();
  const prevTone = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(sc, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.toneMapping = prevTone;
  renderer.setClearColor(0x000000, 1);
  return { texture: rt.texture, w: 2 * w, top: h + 1, bottom: h + 1 - 2 * w };
}

export async function buildScenery(group: THREE.Group, renderer: THREE.WebGLRenderer): Promise<Scenery> {
  const r = rng(2024);
  const trunkM = new THREE.MeshStandardMaterial({ map: tex('tex/tree_branch_diff.jpg', true), normalMap: tex('tex/tree_branch_nor_gl.jpg'), roughness: 0.95, color: 0xb0a698 });
  const variants = [
    { ...treeGeometry(rng(1), 'broad'), lm: leafMaterial(0xb0d090) },
    { ...treeGeometry(rng(2), 'broad'), lm: leafMaterial(0xa8c890) },
    { ...treeGeometry(rng(3), 'conifer'), lm: leafMaterial(0x7f9a70) },
    { ...treeGeometry(rng(4), 'conifer'), lm: leafMaterial(0x8aa078) },
    { ...treeGeometry(rng(5), 'broad'), lm: blossomMaterial() }, // 桜
  ];
  const imps = variants.map((v) => impostor(renderer, v.trunk, v.leaves, v.h, v.lm, trunkM));

  // 木を置く場所を決める
  type T = { x: number; y: number; z: number; rot: number; sc: number; v: number; ad: number };
  const trees: T[] = [];
  const avoid = (s: number, d: number) => {
    const ad = Math.abs(d - C);
    if (ad < FORM_W + 4) return true;
    if (onPlatform(s) && ad < 30) return true;
    if (CROSSINGS.some((c) => Math.abs(s - c.s) < 8)) return true;
    if (Math.abs(s - riverS(d)) < 22) return true;
    const f = at(s, d);
    if (AOBA_TRACK.nearest(f.x, f.z, 8).dist < 12 || SAZA_TRACK.nearest(f.x, f.z, 8).dist < 13) return true;
    return false;
  };
  for (let s = -250; s < LENGTH + 250; s += 3) {
    const wz = zoneW(s);
    for (let k = 0; k < 6; k++) {
      const side = r() < 0.5 ? 1 : -1;
      const ad = FORM_W + 4 + Math.pow(r(), 1.6) * 420;
      const d = C + side * ad;
      const dens = wz.forest * 1.0 + wz.coast * (side < 0 ? 0.25 : 0.02) + wz.town * 0.08 + wz.paddy * 0.04;
      const tunnelHill = s > TUNNEL.from - 60 && s < TUNNEL.to + 60 ? 0.9 : 0;
      if (r() > Math.max(dens, tunnelHill) * (ad < 40 ? 0.7 : 1)) continue;
      if (avoid(s, d)) continue;
      const f = at(s, d);
      const g = ground(s, d, f.x, f.z, wz);
      if (g.paddy > 0.3 || g.sand > 0.3 || g.h < 0.5) continue;
      const conifer = wz.forest > 0.5 || g.h - at(Math.max(0, Math.min(LENGTH, s))).y > 15;
      trees.push({ x: f.x, y: g.h - 0.2, z: f.z, rot: r() * Math.PI * 2, sc: 0.75 + r() * 0.6, v: (conifer ? 2 : 0) + (r() < 0.5 ? 0 : 1), ad });
    }
  }
  // 駅の近くの桜並木
  for (const st of STATIONS) {
    for (let s = st.stop - 230; s < st.stop + 120; s += 11 + r() * 5) {
      for (const side of [1, -1]) {
        if (r() < 0.35) continue;
        const ad = side > 0 ? 9 + r() * 3 : 18.5 + r() * 2;
        const d = C + side * ad;
        if (avoid(s, d) && !(onPlatform(s) && side < 0)) continue;
        if (side > 0 && onPlatform(s)) continue;
        const f = at(s, d);
        const g = ground(s, d, f.x, f.z);
        trees.push({ x: f.x, y: g.h - 0.2, z: f.z, rot: r() * Math.PI * 2, sc: 0.8 + r() * 0.35, v: 4, ad });
      }
    }
  }
  // 近い木：葉の板（200 m ごとの束）。遠い木：絵の板（十字）を種類ごとに 1 回で描く
  const near: THREE.Object3D[] = [];
  const BUCKET = 200;
  const buckets = new Map<number, T[]>();
  for (const t of trees) {
    const k = Math.floor(nearestS(t) / BUCKET);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(t);
  }
  // 近い木がある所では絵の板を消す（頂点シェーダーで、木ごとにカメラからの距離を見る）
  const uNearR = { value: 380 };
  const imM = imps.map((im) => {
    const m = new THREE.MeshStandardMaterial({ map: im.texture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    m.alphaToCoverage = true;
    m.userData.key = 'impostor';
    m.userData.patch = (sh: THREE.WebGLProgramParametersWithUniforms) => {
      sh.uniforms.uNearR = uNearR;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aNear;\nuniform float uNearR;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  if (aNear > 0.5 && distance(ip, cameraPosition) < uNearR) transformed *= 0.0;
#endif`);
    };
    return m;
  });
  const cross = imps.map((im) => {
    const a = new THREE.PlaneGeometry(im.w, im.top - im.bottom); a.translate(0, (im.top + im.bottom) / 2, 0);
    const b = a.clone(); b.rotateY(Math.PI / 2);
    const g = merge([a, b]);
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    for (let k = 0; k < nor.count; k++) nor.setXYZ(k, 0, 1, 0);
    return g;
  });
  const NEAR_AD = 110;
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const compose = (t: T) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot); sv.setScalar(t.sc); pv.set(t.x, t.y, t.z); return mtx.compose(pv, q, sv); };
  for (let v = 0; v < variants.length; v++) {
    const list = trees.filter((t) => t.v === v);
    if (!list.length) continue;
    const geo = cross[v].clone();
    const im = new THREE.InstancedMesh(geo, imM[v], list.length);
    const nearA = new Float32Array(list.length);
    list.forEach((t, i) => { im.setMatrixAt(i, compose(t)); nearA[i] = t.ad < NEAR_AD ? 1 : 0; });
    geo.setAttribute('aNear', new THREE.InstancedBufferAttribute(nearA, 1));
    im.receiveShadow = true; im.castShadow = false;
    im.computeBoundingSphere();
    group.add(im);
  }
  type Lod = { obj: THREE.Object3D; center: THREE.Vector3; kind: 'trees' | 'props'; casters?: THREE.Mesh[] };
  const lods: Lod[] = [];
  for (const [k, list] of buckets) {
    const center = at(k * BUCKET + BUCKET / 2);
    const nearG = new THREE.Group();
    const casters: THREE.Mesh[] = [];
    for (let v = 0; v < variants.length; v++) {
      const nearL = list.filter((t) => t.v === v && t.ad < NEAR_AD);
      if (!nearL.length) continue;
      const leaves = new THREE.InstancedMesh(variants[v].leaves, variants[v].lm, nearL.length);
      const trunks = new THREE.InstancedMesh(variants[v].trunk, trunkM, nearL.length);
      nearL.forEach((t, i) => { compose(t); leaves.setMatrixAt(i, mtx); trunks.setMatrixAt(i, mtx); });
      leaves.castShadow = trunks.castShadow = true; leaves.receiveShadow = trunks.receiveShadow = true;
      leaves.computeBoundingSphere(); trunks.computeBoundingSphere();
      nearG.add(leaves, trunks);
      casters.push(leaves, trunks);
    }
    if (!casters.length) continue;
    group.add(nearG);
    lods.push({ obj: nearG, center: new THREE.Vector3(center.x, center.y, center.z), kind: 'trees', casters });
  }

  // ---- 草・低木・岩（線路ぎわ） ----
  const props: Record<string, Prop[]> = {};
  const ids = ['grass_medium_01', 'grass_medium_02', 'weed_plant_02', 'fern_02', 'shrub_02'];
  await Promise.all(ids.map(async (id) => { props[id] = await loadProp(id); }));
  for (const id of ids) for (const p of props[id]) for (const m of p.mats) {
    const sm = m as THREE.MeshStandardMaterial;
    if (id.startsWith('grass') || id.startsWith('weed')) sm.color.multiplyScalar(0.92);
  }
  // 変化形は 3 つまで（面の数が中くらいのもの）。束ごとの描画命令を減らす
  for (const id of ids) {
    const tri = (p: Prop) => (p.geos[0].index ? p.geos[0].index.count : p.geos[0].getAttribute('position').count) / 3;
    const sorted = [...props[id]].sort((x, y) => tri(x) - tri(y));
    const mid = Math.floor(sorted.length / 2);
    props[id] = sorted.slice(Math.max(0, mid - 1), Math.max(0, mid - 1) + 3);
  }
  props.rock = makeRocks().slice(0, 3);
  const PB = 150;
  const propBuckets = new Map<number, { id: string; vi: number; m: THREE.Matrix4 }[]>();
  const put = (s: number, id: string, d: number, scale: number, yaw: number) => {
    const f = at(s, d);
    const g = ground(s, d, f.x, f.z);
    if (g.paddy > 0.3 || g.h < 0.4) return;
    const k = Math.floor(s / PB);
    if (!propBuckets.has(k)) propBuckets.set(k, []);
    const vi = Math.floor(r() * props[id].length);
    const m = new THREE.Matrix4().makeRotationY(yaw);
    m.scale(new THREE.Vector3(scale, scale * (0.85 + r() * 0.3), scale));
    m.setPosition(f.x, g.h - 0.05, f.z);
    propBuckets.get(k)!.push({ id, vi, m });
  };
  for (let s = -250; s < LENGTH + 100; s += 1.6) {
    if (s > TUNNEL.from && s < TUNNEL.to) continue;
    if (s > BRIDGE.from - 5 && s < BRIDGE.to + 5) continue;
    const z = zoneAt(Math.max(0, s));
    for (let k = 0; k < 2; k++) {
      const side = r() < 0.5 ? 1 : -1;
      const ad = FORM_W + 0.4 + Math.pow(r(), 1.7) * 30;
      const d = C + side * ad;
      if (onPlatform(s) && ad < 12) continue;
      if (CROSSINGS.some((c) => Math.abs(s - c.s) < 6)) continue;
      const roll = r();
      if (z === 'town' && ad < 30 && r() < 0.6) continue;
      if (roll < 0.5) put(s, r() < 0.5 ? 'grass_medium_01' : 'grass_medium_02', d, 1.4 + r() * 0.8, r() * 6.28);
      else if (roll < 0.62) put(s, 'weed_plant_02', d, 1.4 + r(), r() * 6.28);
      else if (roll < 0.77 && z === 'forest') put(s, 'fern_02', d, 1.6 + r(), r() * 6.28);
      else if (roll < 0.8 && ad > 9) put(s, 'shrub_02', d, 1.2 + r() * 1.2, r() * 6.28);
      else if (roll < 0.86 && (z === 'coast' || z === 'forest')) put(s, 'rock', d, 0.5 + r() * 1.2, r() * 6.28);
    }
  }
  // 海岸の岩
  for (let s = 480; s < 1700; s += 6) {
    const d = C + 18 + r() * 40;
    put(s, 'rock', d, 0.8 + r() * 2, r() * 6.28);
  }
  for (const [k, list] of propBuckets) {
    const g = new THREE.Group();
    const byKey = new Map<string, THREE.Matrix4[]>();
    for (const it of list) { const kk = `${it.id}|${it.vi}`; if (!byKey.has(kk)) byKey.set(kk, []); byKey.get(kk)!.push(it.m); }
    for (const [kk, ms] of byKey) {
      const [id, vi] = kk.split('|');
      const p = props[id][Number(vi)];
      for (const geo of p.geos) {
        const im = new THREE.InstancedMesh(geo, p.mats[0], ms.length);
        ms.forEach((m, i) => im.setMatrixAt(i, m));
        im.castShadow = id === 'rock' || id === 'shrub_02';
        im.receiveShadow = true;
        im.computeBoundingSphere();
        g.add(im);
      }
    }
    group.add(g);
    const c = at(k * PB + PB / 2);
    lods.push({ obj: g, center: new THREE.Vector3(c.x, c.y, c.z), kind: 'props' });
  }

  // ---- 町並み ----
  buildTown(group);

  const update: Scenery['update'] = (cam, o) => {
    uNearR.value = o.trees;
    for (const l of lods) {
      const dist = l.center.distanceTo(cam);
      if (l.kind === 'props') { l.obj.visible = dist < o.grass; continue; }
      l.obj.visible = dist < o.trees + 40;
      const cast = dist < o.treeShadow;
      for (const m of l.casters!) m.castShadow = cast;
    }
  };
  return { near, update };
}

function nearestS(t: { x: number; z: number }): number {
  // 木は線路の近くに置いたので、粗い探索でよい
  let best = 0, bd = Infinity;
  for (let s = -250; s < LENGTH + 250; s += 25) {
    const f = at(s);
    const e = (f.x - t.x) ** 2 + (f.z - t.z) ** 2;
    if (e < bd) { bd = e; best = s; }
  }
  return best;
}

/** 岩：ゆがめた多面体（軽い） */
function makeRocks(): Prop[] {
  const mat = new THREE.MeshStandardMaterial({ map: tex('tex/rock_face_diff.jpg', true), normalMap: tex('tex/rock_face_nor.jpg'), roughness: 0.9, color: 0x6f6e6a });
  const out: Prop[] = [];
  for (let k = 0; k < 4; k++) {
    const r = rng(100 + k);
    const g = new THREE.IcosahedronGeometry(1, 3);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const sx = 1 + r() * 0.6, sy = 0.5 + r() * 0.4, sz = 0.8 + r() * 0.5;
    const ph = [r() * 10, r() * 10, r() * 10];
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      const n = 1 + 0.18 * Math.sin(v.x * 3 + ph[0]) * Math.sin(v.y * 4 + ph[1]) + 0.1 * Math.sin(v.z * 7 + ph[2]);
      v.multiplyScalar(n);
      p.setXYZ(i, v.x * sx, Math.max(-0.2, v.y) * sy, v.z * sz);
    }
    g.computeVertexNormals();
    // 上から見た座標で UV
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) * 0.5 + p.getY(i) * 0.3, p.getZ(i) * 0.5 + p.getY(i) * 0.3);
    g.translate(0, 0.1, 0);
    out.push({ geos: [g], mats: [mat], size: new THREE.Vector3(2 * sx, sy, 2 * sz) });
  }
  return out;
}
