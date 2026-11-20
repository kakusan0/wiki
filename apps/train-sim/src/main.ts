import * as THREE from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { at, TUNNEL, CROSSINGS, TRACK_GAP, TRAIN_LEN, fmtTime, HIKARI, Route } from './route';
import { ROUTES, PLAYABLE, routeById, aobaToMain, AOBA } from './net/network';
import { makeFreight, type Box12 } from './freight';
import { Link, LINK_API } from './link';
import { ILK, wireSignals, simRef, TrainRef } from './net/interlock';
import { autopilot } from './ai';
import { buildCheckpoints, judgeCheckpoints, nextCheckpoint, Checkpoint } from './checkpoints';
import { buildLines, LinesWorld } from './world/lines';
import {
  createSim, step, stepNotch, setNotch, toggleDoor, pointCall, announce, horn, kmh, currentLimit, notchLabel, EB,
  aspectOf, Sim, Mode, legTotal, totalScore, rank, SimEvent,
} from './sim';
import { buildTerrain } from './world/terrain';
import { buildTrack, updateSignal, TrackWorld } from './world/track';
import { buildScenery, Scenery } from './world/scenery';
import { buildWater } from './world/water';
import { setAniso, texturesReady, tex } from './world/assets';
import { buildCab, Cab } from './cab';
import { makeTrain, TrainView } from './train';
import { buildPost, Post } from './post';
import { Governor, LEVELS, startLevel } from './perf';
import { Sound } from './audio';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);

// ---- 描画の土台 ----
const canvas = $<HTMLCanvasElement>('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.info.autoReset = false;
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.05, 9000);
const skyTex = tex('tex/sky.jpg', true);
skyTex.mapping = THREE.EquirectangularReflectionMapping;
skyTex.wrapS = THREE.ClampToEdgeWrapping; skyTex.repeat.set(1, 1);
scene.background = skyTex;
scene.backgroundIntensity = 1.25;
scene.fog = new THREE.FogExp2(0xaebdcc, 0.00022);
const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x4a5236, 0.35);
scene.add(hemi);

const SUN_DIR = new THREE.Vector3(-0.55, -0.75, 0.35).normalize();
const csm = new CSM({
  maxFar: 700, cascades: 3, mode: 'practical', parent: scene, shadowMapSize: 2048,
  lightDirection: SUN_DIR, camera, lightIntensity: 3.2, lightNear: 1, lightFar: 3000, lightMargin: 120,
});
csm.fade = true;
for (const l of csm.lights) { l.color.set(0xfff1df); l.shadow.bias = -0.0002; l.shadow.normalBias = 0.04; }

const world = new THREE.Group();
scene.add(world);
const uTime = { value: 0 };

let track!: TrackWorld, lines!: LinesWorld, scenery!: Scenery, cab!: Cab, post!: Post;
let myTrain!: TrainView;
const others: { view: TrainView; s: number; v: number; passed: boolean; ref: TrainRef }[] = [];
/** ほかの路線の列車（自動運転） */
const ais: { sim: Sim; view: TrainView; doneT: number; id: string }[] = [];
const dummies = new Map<string, Sim>();
const sound = new Sound();

/** すべての材質に、遠くまでの細かい影（CSM）と独自の手直しをつなぐ */
function finalize(root: THREE.Object3D) {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of (Array.isArray(m.material) ? m.material : [m.material])) {
      if (seen.has(mat) || !(mat as THREE.MeshStandardMaterial).isMeshStandardMaterial || mat.userData.done) continue;
      seen.add(mat);
      mat.userData.done = true;
      csm.setupMaterial(mat);
      const csmHook = mat.onBeforeCompile;
      const patch = mat.userData.patch as ((sh: THREE.WebGLProgramParametersWithUniforms) => void) | undefined;
      mat.onBeforeCompile = (sh, r) => { csmHook.call(mat, sh, r); patch?.(sh); };
      const key = (mat.userData.key as string) ?? (patch ? 'terrain' : 'std');
      mat.customProgramCacheKey = () => key;
    }
  });
}

async function build(progress: (p: string) => void) {
  progress('地形');
  await tick();
  const terrainMat = buildTerrain(world);
  terrainMat.userData.key = 'terrain';
  progress('線路と駅');
  await tick();
  const mats: Record<string, THREE.Material> = {};
  track = buildTrack(world, mats);
  lines = buildLines(world, mats);
  progress('海と川');
  buildWater(world, uTime);
  progress('木と草');
  await tick();
  scenery = await buildScenery(world, renderer);
  myTrain = makeTrain();
  scene.add(myTrain.group);
  cab = buildCab();
  rig.add(cab.group);
  cab.group.position.set(-0.5, 2.75, 0);
  finalize(scene);
  progress('素材');
  await Promise.race([texturesReady(), new Promise((r) => setTimeout(r, 15000))]);
  await document.fonts.ready;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- カメラの台（車体の動き） ----
const rig = new THREE.Object3D();
scene.add(rig);
rig.add(camera);
camera.position.set(-0.5, 2.75, 0);
let view: 'cab' | 'ext' = params.get('view') === 'ext' ? 'ext' : 'cab';
let lookYaw = 0, lookPitch = -0.15, extYaw = Number(params.get('ey') ?? 2.5), extPitch = Number(params.get('ep') ?? 0.18), extDist = Number(params.get('ed') ?? 34);
let bump = 0, lastJoint = 0;

function placeRig(sim: Sim, dt: number) {
  const s = sim.s - 1.4;
  const P = sim.route.path;
  const f = P.at(s);
  const fa = P.at(s - 6), fb = P.at(s + 6);
  const yaw = Math.atan2(-(fb.x - fa.x), -(fb.z - fa.z));
  const pitch = Math.atan2(fb.y - fa.y, 12) - sim.a * 0.0035;
  const k = P.curvatureAt(s);
  const v = sim.v;
  const t = sim.t;
  // 継ぎ目の揺れ（25 m ごと）
  if (Math.floor(sim.s / 25) !== lastJoint) { lastJoint = Math.floor(sim.s / 25); bump = Math.min(1, v / 20); sound.joint(v); }
  bump *= Math.exp(-dt * 7);
  const vib = (Math.sin(t * 13.1 + s * 0.7) * 0.5 + Math.sin(t * 23.7) * 0.3) * 0.0025 * Math.min(1, v / 15);
  const sway = Math.sin(t * 1.05 + s * 0.013) * 0.012 * Math.min(1, v / 20);
  const roll = k * 26 + Math.sin(t * 0.8 + s * 0.02) * 0.004 * Math.min(1, v / 20) + sim.a * 0.0;
  rig.position.set(f.x, f.y + vib + bump * 0.006 * Math.sin(t * 40), f.z);
  rig.rotation.order = 'YXZ';
  rig.rotation.set(pitch, yaw, roll + sway * 0.3);
  rig.position.x += Math.cos(yaw) * sway; rig.position.z -= Math.sin(yaw) * sway;
}

function placeCamera() {
  if (view === 'cab') {
    camera.position.set(-0.5, 2.75, 0);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(lookPitch, lookYaw, 0);
    camera.fov = 62;
  } else {
    // 外から：先頭車のまわりを回る
    camera.position.set(Math.sin(extYaw) * extDist, 3 + Math.sin(extPitch) * extDist, Math.cos(extYaw) * extDist - 10);
    rig.updateMatrixWorld(true);
    camera.lookAt(rig.localToWorld(new THREE.Vector3(0, 2.4, -10)));
    camera.fov = 50;
  }
  camera.updateProjectionMatrix();
}

// ---- 入力 ----
let sim: Sim = createSim('easy');
let running = false, paused = false, wipers = false;
const keys = new Set<string>();

function act(a: string) {
  if (!running || sim.finished) return;
  sound.start();
  switch (a) {
    case 'door': toggleDoor(sim); break;
    case 'call': pointCall(sim); break;
    case 'announce': announce(sim); break;
    case 'horn': horn(sim); break;
    case 'wiper': wipers = !wipers; break;
    case 'view': view = view === 'cab' ? 'ext' : 'cab'; break;
    case 'eb': setNotch(sim, EB); break;
    case 'help': openHelp(); break;
  }
}
addEventListener('keydown', (e) => {
  if (e.repeat && !['KeyZ', 'KeyX'].includes(e.code)) return;
  keys.add(e.code);
  if (!running) return;
  const map: Record<string, () => void> = {
    KeyZ: () => stepNotch(sim, 1), KeyX: () => stepNotch(sim, -1), KeyN: () => setNotch(sim, 0),
    Space: () => act('eb'), KeyO: () => act('door'), KeyK: () => act('call'), KeyA: () => act('announce'),
    KeyF: () => toggleFps(), KeyH: () => act('horn'), KeyC: () => act('view'), KeyW: () => act('wiper'), KeyM: () => sound.setMute(!sound.muted),
    Slash: () => act('help'), Escape: () => (paused ? closeHelp() : openHelp()),
  };
  const f = map[e.code];
  if (f) { e.preventDefault(); sound.start(); f(); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
document.querySelectorAll<HTMLButtonElement>('#btns button, #keys button').forEach((b) => b.addEventListener('click', () => act(b.dataset.act!)));

// 見回し（ドラッグ）
let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); sound.start(); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
  if (view === 'cab') {
    lookYaw = Math.max(-1.3, Math.min(1.3, lookYaw - dx * 0.004));
    lookPitch = Math.max(-0.9, Math.min(0.4, lookPitch - dy * 0.004));
  } else {
    extYaw -= dx * 0.006; extPitch = Math.max(0.02, Math.min(1.2, extPitch + dy * 0.004));
  }
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { if (view === 'ext') extDist = Math.max(12, Math.min(90, extDist + e.deltaY * 0.03)); }, { passive: true });
canvas.addEventListener('dblclick', () => { lookYaw = 0; lookPitch = -0.15; });

// マスコンのレバー（指で上下）
const lever = $('lever'), knob = $('knob');
function notchFromY(y: number) {
  const r = lever.getBoundingClientRect();
  const u = Math.max(0, Math.min(1, (y - r.top) / r.height));
  return 5 - Math.round(u * 14);
}
let leverDrag = false;
lever.addEventListener('pointerdown', (e) => { leverDrag = true; lever.setPointerCapture(e.pointerId); sound.start(); if (running) setNotch(sim, notchFromY(e.clientY)); });
lever.addEventListener('pointermove', (e) => { if (leverDrag && running) setNotch(sim, notchFromY(e.clientY)); });
lever.addEventListener('pointerup', () => { leverDrag = false; });
lever.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') { stepNotch(sim, 1); e.preventDefault(); }
  if (e.key === 'ArrowDown') { stepNotch(sim, -1); e.preventDefault(); }
});

// ---- 画面の表示 ----
let toastT = 0, subT = 0, cardT = 0;
function toast(text: string, pts = 0) {
  const el = $('toast');
  el.innerHTML = '';
  el.append(text);
  if (pts > 0) { const p = document.createElement('span'); p.className = 'pts'; p.textContent = `+${pts}`; el.append(p); }
  el.classList.add('show'); toastT = 1.8;
}
function subtitle(text: string) { const el = $('sub'); el.textContent = text; el.classList.add('show'); subT = 4.5; }
function stopCard(i: number) {
  const st = sim.route.stations[i];
  const leg = sim.leg.station === i ? sim.leg : sim.legs.find((l) => l.station === i);
  if (!leg) return;
  const el = $('stopcard');
  const pe = leg.posErr ?? 0, ae = leg.arrErr ?? 0;
  const word = Math.abs(pe) <= 0.5 ? 'ぴったり！' : Math.abs(pe) <= 2 ? 'おしい！' : pe > 0 ? '行き過ぎ' : '手前で停止';
  el.innerHTML = `<h3>${st.name}・${word}</h3><div class="grid">
    <span>停止位置</span><b class="mono">${pe >= 0 ? '+' : ''}${pe.toFixed(2)} m　${leg.pos} 点</b>
    <span>到着時刻</span><b class="mono">${ae >= 0 ? '+' : ''}${ae.toFixed(0)} 秒　${leg.time} 点</b>
    <span>乗り心地</span><b class="mono">${Math.round(leg.comfort)} 点</b></div>`;
  el.hidden = false; cardT = 6;
}

function handleEvents(evs: SimEvent[]) {
  for (const e of evs) {
    switch (e.type) {
      case 'call': toast(e.text!, e.value); sound.tone(660, 0.12, 'sine', 0.08); break;
      case 'announce': subtitle(`車内放送：${e.text}`); if (e.value) toast('車内放送', e.value); sound.chime(); break;
      case 'horn': sound.horn(); if (e.value) toast(e.text!, e.value); break;
      case 'msg': subtitle(e.text!); break;
      case 'door-open': sound.doorChime(); sound.hiss(); break;
      case 'door-close': sound.doorChime(); break;
      case 'arrive': sound.hiss(); subtitle(`${e.text} に到着。O でドアを開けます`); break;
      case 'stop-result': stopCard(e.value!); break;
      case 'depart': if (e.value! > 5) subtitle(`${Math.round(e.value!)} 秒遅れで発車`); break;
      case 'ats-warn': sound.atsBell(true); break;
      case 'ats-off': case 'ats-release': sound.atsBell(false); break;
      case 'ats-brake': sound.atsBell(true); toast(`ATS：${e.text}`); break;
      case 'overrun': subtitle(`${e.text} を通過してしまいました`); break;
      case 'jolt': subtitle('停止時の衝撃が大きかった'); break;
      case 'finish': setTimeout(showResult, 2500); break;
    }
  }
  evs.length = 0;
}

let melodyPlayed = -1;
// ---- 画面の表示（HUD） ----
const speedo = $<HTMLCanvasElement>('speedo').getContext('2d')!;
const notchCol = $('notchCol');
const NOTCHES = [5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8, EB];
notchCol.innerHTML = NOTCHES.map((n) => `<i data-n="${n}" class="${n > 0 ? 'p' : n === 0 ? 'n' : n === EB ? 'eb' : 'b'}"></i>`).join('') + '<span>マスコン</span>';
const notchCells = [...notchCol.querySelectorAll('i')];
let hudKey = '';
function drawSpeedo(sp: number, lim: number) {
  const c = speedo, W = 300, H = 250, cx = 150, cy = 140, R = 112;
  c.clearRect(0, 0, W, H);
  const A0 = Math.PI * 0.8, A1 = Math.PI * 2.2, MAX = 120;
  const ang = (v: number) => A0 + (A1 - A0) * Math.min(1, v / MAX);
  // 下地
  c.lineCap = 'round';
  c.strokeStyle = 'rgba(10,12,16,0.45)'; c.lineWidth = 34; c.beginPath(); c.arc(cx, cy, R - 6, A0, A1); c.stroke();
  // 速度の弧
  c.strokeStyle = sp > lim + 1 ? '#FF5A4E' : '#FFB347'; c.lineWidth = 10; c.beginPath(); c.arc(cx, cy, R, A0, ang(sp)); c.stroke();
  // 目盛り
  c.strokeStyle = '#E8ECF5'; c.fillStyle = '#E8ECF5'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = '700 15px "Share Tech Mono", monospace';
  for (let v = 0; v <= MAX; v += 10) {
    const a = ang(v), big = v % 20 === 0; c.lineWidth = big ? 3 : 1.5; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12)); c.lineTo(cx + Math.cos(a) * (R - (big ? 24 : 19)), cy + Math.sin(a) * (R - (big ? 24 : 19))); c.stroke();
    if (big) c.fillText(String(v), cx + Math.cos(a) * (R - 38), cy + Math.sin(a) * (R - 38));
  }
  // 制限の印
  const la = ang(lim); c.strokeStyle = '#FF5A4E'; c.lineWidth = 4;
  c.beginPath(); c.moveTo(cx + Math.cos(la) * (R - 16), cy + Math.sin(la) * (R - 16)); c.lineTo(cx + Math.cos(la) * (R + 10), cy + Math.sin(la) * (R + 10)); c.stroke();
  // 針
  const a = ang(sp); c.strokeStyle = '#FFFFFF'; c.lineWidth = 4; c.lineCap = 'round';
  c.beginPath(); c.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 10); c.lineTo(cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26)); c.stroke();
  // 数字
  c.fillStyle = '#FFFFFF'; c.font = '700 64px "Share Tech Mono", monospace'; c.fillText(String(Math.round(sp)), cx, cy + 62);
  c.font = '700 14px "Share Tech Mono", monospace'; c.fillStyle = '#A9B2C8'; c.fillText('km/h', cx, cy + 98);
  // 制限の丸
  c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(cx + 104, cy + 70, 22, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#D22'; c.lineWidth = 4; c.beginPath(); c.arc(cx + 104, cy + 70, 20, 0, Math.PI * 2); c.stroke();
  c.fillStyle = '#111'; c.font = '700 20px "Share Tech Mono", monospace'; c.fillText(String(lim), cx + 104, cy + 71);
}
function fmtDist(d: number) { return d > 999 ? `${(d / 1000).toFixed(2)} km` : `${d.toFixed(d < 50 ? 1 : 0)} m`; }

function updateHud() {
  const STATIONS = sim.route.stations;
  const at0 = sim.at >= 0;
  const idx = Math.min(sim.end, at0 ? sim.at : sim.next);
  const st = STATIONS[idx];
  const dist = at0 ? null : STATIONS[sim.next].stop - sim.s;
  const sp = kmh(sim.v), lim = currentLimit(sim);
  // 速度計は値が変わったときだけ描き直す
  const key = `${Math.round(sp * 2)}|${lim}`;
  if (key !== hudKey) { hudKey = key; drawSpeedo(sp, lim); }
  $('clock').textContent = fmtTime(sim.t);
  $('stopKind').textContent = at0 ? (sim.at === sim.end ? '終点' : '停車中') : '停車';
  $('nextSt').textContent = st.name;
  $('dist').textContent = dist === null ? '0 m' : fmtDist(dist);
  $('dist2').textContent = dist === null ? '---' : fmtDist(dist);
  const toArr = at0 ? st.dep - sim.t : st.arr - sim.t;
  $('toArr').textContent = `${toArr < 0 ? '−' : ''}${Math.abs(Math.round(toArr))} 秒`;
  $('toArr').parentElement!.firstElementChild!.textContent = at0 ? '発車まで' : '到着まで';
  $('toArr').classList.toggle('late', toArr < 0);
  const gr = sim.route.path.gradeAt(sim.s) * 1000;
  $('grade').textContent = `${gr >= 0 ? '+' : ''}${gr.toFixed(1)}‰`;
  // 次の駅の時刻（このあと 2 駅）
  const tl = STATIONS.slice(idx, Math.min(idx + 2, sim.end + 1)).map((x, i) => {
    const t = i === 0 && at0 ? x.dep : x.arr;
    return `<li><span>${x.name}</span><b class="mono">${fmtTime(t).slice(0, 5)}<small>${fmtTime(t).slice(5)}</small></b></li>`;
  }).join('');
  const tlEl = $('timeline'); if (tlEl.dataset.k !== tl) { tlEl.dataset.k = tl; tlEl.innerHTML = tl; }
  // マスコンの段・BC・MR
  for (const cell of notchCells) cell.classList.toggle('on', Number(cell.dataset.n) === sim.notch);
  $('bcBar').style.height = `${Math.min(100, (sim.brake / 1.4) * 100)}%`;
  $('mrBar').style.height = `${82 + Math.sin(sim.t * 0.3) * 3}%`;
  const n = $('notch');
  n.textContent = notchLabel(sim.notch);
  n.className = 'mono ' + (sim.notch === EB ? 'eb' : sim.notch > 0 ? 'p' : sim.notch < 0 ? 'b' : '');
  knob.textContent = notchLabel(sim.notch);
  knob.style.top = `calc(${((5 - (sim.notch === EB ? -9 : sim.notch)) / 14) * 100}% - ${((5 - (sim.notch === EB ? -9 : sim.notch)) / 14) * 34}px)`;
  lever.setAttribute('aria-valuenow', String(sim.notch));
  const d = $('door');
  d.textContent = sim.door === 'closed' ? '戸閉' : sim.door === 'open' ? 'ドア開' : 'ドア動作中';
  d.className = sim.door === 'closed' ? 'closed' : '';
  $('ats').hidden = sim.ats === 'off';
  $('ats').textContent = sim.ats === 'brake' ? 'ATS ブレーキ' : 'ATS 警報';
  $('score').textContent = String(totalScore(sim) + (sim.finished ? 0 : Math.round(sim.leg.bonus - sim.leg.penalty)));
  // 発車メロディ：発車 25 秒前、ドアが開いているとき
  if (at0 && sim.door === 'open' && sim.t > st.dep - 25 && melodyPlayed !== sim.at && sim.at < sim.end) {
    melodyPlayed = sim.at; sound.melody(); subtitle('発車メロディ。発車時刻が近づいたら O でドアを閉めます');
  }
}

// ---- チェックポイントの表示 ----
let cps: Checkpoint[] = [];
let cpLegKey = '', cpFlashT = 0;
function cpFlash(c: Checkpoint) {
  const el = $('cpFlash');
  el.textContent = `${c.result === 'ok' ? '✓' : '✗'} ${c.title}${c.detail ? `（${c.detail}）` : ''}`;
  el.className = `show ${c.result}`;
  cpFlashT = 2.2;
  if (c.result === 'ok') sound.tone(990, 0.12, 'sine', 0.06); else sound.tone(220, 0.25, 'square', 0.05);
}
function updateCpBar() {
  const ST = sim.route.stations;
  const leg = sim.at >= 0 ? Math.min(sim.end, sim.at === sim.end ? sim.end : sim.at + 1) : Math.min(sim.end, sim.next);
  const a = ST[leg - 1].stop, b = ST[leg].stop;
  const pct = (s: number) => `${Math.max(0, Math.min(100, ((s - a) / (b - a)) * 100)).toFixed(2)}%`;
  const list = cps.filter((c) => c.leg === leg);
  const next = nextCheckpoint(cps, sim);
  const key = `${leg}|${list.map((c) => c.result).join('')}|${next?.id}`;
  if (key !== cpLegKey) {
    cpLegKey = key;
    $('cpFrom').textContent = ST[leg - 1].name; $('cpTo').textContent = ST[leg].name;
    const track = $('cpTrack');
    track.querySelectorAll('b').forEach((x) => x.remove());
    for (const c of list) {
      const m = document.createElement('b');
      m.className = c.result !== 'pending' ? c.result : c === next ? 'next' : '';
      m.style.left = pct(c.s); m.title = c.title;
      track.append(m);
    }
    const done = cps.filter((c) => c.result !== 'pending'), ok = done.filter((c) => c.result === 'ok');
    $('cpCount').textContent = `チェックポイント ${ok.length}/${done.length} 合格・のこり ${cps.length - done.length}`;
  }
  $('cpMe').style.left = pct(sim.s);
  const card = $('cpNext');
  card.hidden = !next;
  if (next) {
    $('cpKey').textContent = next.key; $('cpTitle').textContent = next.title; $('cpHint').textContent = next.hint;
    let dist: string, near: boolean;
    if (next.kind === 'depart') { const t = ST[next.leg - 1].dep - sim.t; dist = t > 0 ? `発車まで ${Math.ceil(t)} 秒` : '発車時刻'; near = t < 25; }
    else { const d = next.s - sim.s; dist = d > 999 ? `あと ${(d / 1000).toFixed(1)} km` : `あと ${Math.max(0, Math.round(d))} m`; near = d < Math.min(300, next.lead); }
    $('cpDist').textContent = dist;
    card.classList.toggle('near', near);
  }
}
function cpSummary() {
  const done = cps.filter((c) => c.result !== 'pending');
  const ok = done.filter((c) => c.result === 'ok');
  const ng = done.filter((c) => c.result === 'ng');
  const list = ng.slice(0, 8).map((c) => `<li>${c.title}${c.detail ? `（${c.detail}）` : ''}</li>`).join('');
  return `<p><b>チェックポイント ${ok.length} / ${done.length} 合格</b></p>${ng.length ? `<ul class="dim" style="margin:0;padding-left:20px">${list}</ul>` : ''}`;
}

function showResult() {
  const STATIONS = sim.route.stations;
  running = false;
  sound.atsBell(false);
  const el = $('result');
  const rows = sim.legs.map((l) => {
    const st = STATIONS[l.station];
    return `<tr><td>${st.name}</td><td class="mono">${l.posErr === null ? '—' : (l.posErr >= 0 ? '+' : '') + l.posErr.toFixed(2) + ' m'}</td>
      <td class="mono">${l.arrErr === null ? '—' : (l.arrErr >= 0 ? '+' : '') + l.arrErr.toFixed(0) + ' 秒'}</td>
      <td class="mono">${Math.round(l.comfort)}</td><td class="mono">+${Math.round(l.bonus)}</td><td class="mono">−${Math.round(l.penalty)}</td><td class="mono"><b>${legTotal(l)}</b></td></tr>`;
  }).join('');
  const notes = [...new Set(sim.legs.flatMap((l) => l.notes))];
  el.innerHTML = `<div class="card">
    <p class="eyebrow">運転の結果　${sim.route.name}　${STATIONS[sim.start].name} → ${STATIONS[sim.end].name}</p>
    <div style="display:flex;gap:20px;align-items:center"><span class="rank">${rank(sim)}</span><div><h2>${totalScore(sim)} 点</h2><span class="dim">満点 ${(sim.end - sim.start) * 100}（加点で超えることがあります）</span></div></div>
    <div style="overflow-x:auto"><table><thead><tr><th>駅</th><th>停止位置</th><th>到着</th><th>乗り心地</th><th>加点</th><th>減点</th><th>合計</th></tr></thead><tbody>${rows}</tbody></table></div>
    ${cpSummary()}
    ${notes.length ? `<p class="dim">気をつけたいこと：${notes.join('・')}</p>` : '<p class="dim">安全運転でした。</p>'}
    ${sim.route.freight ? '<div id="freightRes" class="dim">山ノ口に着いたコンテナを知らせています…</div>' : ''}
    <button class="primary" id="again">もう一度運転する</button></div>`;
  el.hidden = false;
  if (sim.route.freight && !freightPosted && sim.end === sim.route.stations.length - 1) { freightPosted = true; void reportFreight(); }
  $('again').addEventListener('click', () => { el.hidden = true; startRun(); });
}

// ---- 貨物列車とトラックのゲームのつながり ----
const link = new Link();
let freightBoxes: Box12[] = [];
let freightLinked = false, freightPosted = false;
async function refreshFreight() {
  const w = await link.waiting();
  freightBoxes = w.boxes; freightLinked = w.linked;
  const note = $('linkNote');
  if (!LINK_API) note.textContent = 'つなぎ先（トラックのゲームの公開先）がまだ設定されていません。仮のコンテナで走れます。';
  else if (!link.code) note.textContent = 'トラックのゲームで作った連携コードを入れると、トラックで駅に運んだコンテナを貨物列車で運べます。';
  else if (!w.linked) note.textContent = 'つながりません。いまは仮のコンテナで走れます。';
  else note.textContent = `つながっています（${link.code}）。潮見貨物駅で待つ山ノ口あて：${w.boxes.length} 個${w.boxes.length ? `（${w.boxes.map((b) => b.contents).join('・')}）` : '。トラックで駅へ運ぶと積めます'}`;
}
async function reportFreight() {
  const el = document.getElementById('freightRes');
  const r = await link.arrive();
  if (!el) return;
  if (!r) { el.textContent = freightLinked ? '知らせられませんでした（電波がないかもしれません）。' : '仮のコンテナを山ノ口に届けました。トラックのゲームとつなぐと、荷物が行き来します。'; return; }
  el.innerHTML = '';
  const p1 = document.createElement('p'); p1.textContent = `山ノ口に届けたコンテナ：${r.carried.length ? r.carried.map((b) => `${b.num}（${b.contents}）`).join('・') : 'なし'}`;
  const p2 = document.createElement('p'); p2.textContent = `帰りの列車が、町あてのコンテナ ${r.arrived.length} 個を潮見貨物駅へ持ち帰りました。トラックのゲームの依頼に出ます。`;
  el.append(p1, p2);
}
$('linkUse').addEventListener('click', async () => {
  const v = ($('linkInput') as HTMLInputElement).value;
  const c = await link.use(v);
  if (!c) $('linkNote').textContent = 'コードが見つかりません（8 文字の英数字。トラックのゲームのはじめの画面で作れます）';
  void refreshFreight();
});
void refreshFreight();

function openHelp() { paused = true; $('help').hidden = false; }
function closeHelp() { paused = false; $('help').hidden = true; }
$('help').querySelector('[data-close]')!.addEventListener('click', closeHelp);
$('fpsBtn').addEventListener('click', () => toggleFps());

function chosenRoute(): Route {
  return routeById(params.get('route') ?? document.querySelector<HTMLInputElement>('input[name=route]:checked')?.value ?? 'hikari');
}

function startRun() {
  const mode = (document.querySelector<HTMLInputElement>('input[name=mode]:checked')?.value ?? 'easy') as Mode;
  const route = chosenRoute();
  const from = Number(params.get('from') ?? $<HTMLSelectElement>('fromSt').value ?? 0);
  const to = Number(params.get('to') ?? $<HTMLSelectElement>('toSt').value ?? route.stations.length - 1);
  sim = createSim(mode, route, from, to);
  const ST = route.stations;
  const s0 = Number(params.get('s'));
  if (s0 > 0) { sim.s = s0; sim.at = -1; sim.served = false; sim.door = 'closed'; sim.notch = 0; sim.v = Number(params.get('v') ?? 60) / 3.6; sim.next = Math.max(1, ST.findIndex((st) => st.stop > s0 + 1)); sim.passedSig = route.signals.filter((x) => x.s <= s0).length; sim.t = ST[Math.max(0, sim.next - 1)].dep + 30; }
  // 自分の列車の色
  scene.remove(myTrain.group);
  // 貨物列車は、潮見貨物駅で待つコンテナを積んだ機関車と貨車
  myTrain = route.freight ? makeFreight(freightBoxes) : makeTrain(route.color); scene.add(myTrain.group); finalize(myTrain.group);
  freightPosted = false;
  cab.setRoute(route);
  // 連動とほかの列車
  ILK.clear();
  for (const a of ais) scene.remove(a.view.group);
  ais.length = 0;
  for (const o of others) scene.remove(o.view.group);
  others.length = 0;
  ILK.add(simRef('player', sim));
  for (const r of ROUTES) {
    dummies.set(r.id, createSim('normal', r));
    if (r === route || (route.track ?? route.id) === r.id) continue; // 同じ線路の列車は出さない（貨物列車のときのひかり野線）
    const ai = createSim('normal', r);
    ai.t = sim.t;
    const view = makeTrain(r.color); scene.add(view.group); finalize(view.group);
    const id = 'ai-' + r.id;
    ais.push({ sim: ai, view, doneT: 0, id });
    ILK.add(simRef(id, ai));
  }
  spawned.clear();
  melodyPlayed = -1;
  running = true; paused = false;
  checkRotate();
  $('hud').hidden = false;
  $('title').hidden = true;
  $('lineName').textContent = route.name; $('lineName').style.background = route.color;
  cps = buildCheckpoints(sim);
  if (s0 > 0) for (const c of cps) if (c.leg < sim.next || (c.leg === sim.next && c.s < s0)) c.result = 'ok'; // 途中から始めたとき（確認用）
  cpLegKey = '';
  subtitle(route.freight
    ? `貨物列車　潮見台（潮見貨物駅）→ 山ノ口。12ft コンテナ ${freightBoxes.length} 個を積んでいます${freightLinked ? '（トラックのゲームとつながっています）' : '（仮の荷物）'}。途中の駅は通過します`
    : `${route.name}　${ST[sim.start].name} → ${ST[sim.end].name}。${ST[sim.start].name}・発車 ${fmtTime(ST[sim.start].dep)}。発車メロディのあと、O でドアを閉めます`);
}

/** ほかの路線の列車を進める */
function updateAis(dt: number) {
  for (const a of ais) {
    if (a.sim.finished) {
      a.doneT += dt;
      if (a.doneT > 25 && a.view.group.visible) { a.view.group.visible = false; ILK.remove(a.id); } // 車庫へ
    }
    const sub = Math.ceil(dt / (1 / 60));
    for (let i = 0; i < sub; i++) { autopilot(a.sim); step(a.sim, dt / sub); }
    a.sim.events.length = 0;
    if (a.view.group.visible) a.view.place(a.sim.s, 0, false, a.sim.route.path);
  }
  for (const d of dummies.values()) d.t = sim.t;
}

/** ひかり野線の上での自分の列車の位置（ひかり野線の外にいるときは null） */
function playerMainS(): number | null {
  if (sim.route === HIKARI) return sim.s;
  if (sim.route === AOBA) return aobaToMain(sim.s);
  return null;
}
/** ひかり野線の左の線路にいる列車の位置（踏切用） */
function mainTrains(): number[] {
  const out: number[] = [];
  const p = playerMainS(); if (p !== null) out.push(p);
  for (const a of ais) {
    if (!a.view.group.visible) continue;
    if (a.sim.route === HIKARI) out.push(a.sim.s);
    else if (a.sim.route === AOBA) { const m = aobaToMain(a.sim.s); if (m !== null) out.push(m); }
  }
  return out;
}

// すれ違う列車
const spawned = new Set<number>();
const SPAWN_AT = [700, 2700, 4950];
function updateOthers(dt: number) {
  const ps = playerMainS();
  for (const s of SPAWN_AT) {
    if (ps !== null && !spawned.has(s) && ps > s && ps < s + 300) {
      spawned.add(s);
      const view = makeTrain();
      scene.add(view.group);
      finalize(view.group);
      const o = { view, s: Math.min(ps + 1300, 5700), v: 21, passed: false, ref: null as unknown as TrainRef };
      o.ref = { id: 'oncoming-' + s, key: 'main4', dir: -1, s: () => o.s, ready: () => true, nextStop: () => -Infinity, gone: () => o.s < -250 };
      ILK.add(o.ref);
      others.push(o);
    }
  }
  for (const o of others) {
    // 平面交差の手前：進路がなければ止まって待つ
    const z = 1868;
    const wait = o.s > z && o.s - z < 260 && !ILK.free('diamond', o.ref);
    const target = wait ? Math.max(0, Math.min(21, Math.sqrt(Math.max(0, 2 * 0.8 * (o.s - z - 25))))) : 21;
    o.v += Math.max(-1.0 * dt, Math.min(0.6 * dt, target - o.v));
    o.s -= o.v * dt;
    o.view.place(o.s, TRACK_GAP, true);
    const rel = o.s - (ps ?? -1e9);
    if (!o.passed && rel < 15 && ps !== null) { o.passed = true; if (view === 'cab') sound.whoosh(); }
    o.view.group.visible = o.s > -250;
  }
}

function updateCrossings(time: number, camPos: THREE.Vector3): number {
  let vol = 0;
  track.crossings.forEach((c, i) => {
    const mine = mainTrains().some((m) => m > c.s - 420 && m - TRAIN_LEN < c.s + 4);
    const other = others.some((o) => o.s < c.s + 420 && o.s + TRAIN_LEN > c.s - 4);
    const active = mine || other;
    for (const arm of c.arms) arm.rotation.x += ((active ? 0 : Math.PI / 2 * 0.96) - arm.rotation.x) * 0.04;
    const ph = Math.floor(time * 1.6) % 2;
    c.lights.forEach((pair) => pair.forEach((m, k) => { m.emissiveIntensity = active && k === ph ? 7 : 0; }));
    if (active) { const f = at(CROSSINGS[i].s); vol = Math.max(vol, 1 - Math.min(1, Math.hypot(f.x - camPos.x, f.z - camPos.z) / 500)); }
  });
  return vol;
}

// ---- メインループ ----
let exposure = 1;
const clock = new THREE.Clock();
const AUTODRIVE = Number(params.get('autodrive') ?? 0);
const camPos = new THREE.Vector3();
let frame = 0;
function loop(now = performance.now()) {
  requestAnimationFrame(loop);
  const t0 = performance.now();
  // 確かめる用：?autodrive=8 で、自分の列車を自動運転にして 8 倍の速さで進める
  const dt = Math.min(0.1, clock.getDelta()) * (AUTODRIVE || 1);
  uTime.value += dt;
  if (running && !paused && !needRotate) {
    const sub = Math.ceil(dt / (1 / 120));
    ILK.update();
    for (let i = 0; i < sub; i++) { if (AUTODRIVE) autopilot(sim); step(sim, dt / sub); }
    handleEvents(sim.events);
    for (const c of judgeCheckpoints(cps, sim)) cpFlash(c);
    updateAis(dt);
    updateOthers(dt);
  }
  placeRig(sim, running && !paused ? dt : 0);
  placeCamera();
  rig.updateMatrixWorld(true);
  camera.getWorldPosition(camPos);
  // 信号
  const whoFor = (r: Route) => (sim.route === r ? sim : ais.find((a) => a.sim.route === r && a.view.group.visible)?.sim ?? dummies.get(r.id) ?? sim);
  for (const sv of track.signals) updateSignal(sv, aspectOf(sv.sig, whoFor(HIKARI)));
  for (const sv of lines.signals) updateSignal(sv, aspectOf(sv.sig, whoFor(sv.route)));
  const crossVol = updateCrossings(uTime.value, camPos);
  sound.tick(dt, crossVol);
  const pm = playerMainS();
  const inTunnel = pm !== null && pm - 1.4 > TUNNEL.from + 5 && pm - 1.4 < TUNNEL.to - 5;
  sound.update(sim.v, sim.power, sim.brake, inTunnel);
  // トンネルでは目が慣れるように明るさを変える
  const targetExp = inTunnel && view === 'cab' ? 2.4 : 1.0;
  exposure += (targetExp - exposure) * Math.min(1, dt * (targetExp > exposure ? 0.9 : 1.6));
  renderer.toneMappingExposure = exposure;
  const envK = inTunnel && view === 'cab' ? 0.12 : 1;
  scene.environmentIntensity += (envK - scene.environmentIntensity) * Math.min(1, dt * 2);
  hemi.intensity = 0.35 * scene.environmentIntensity;
  // 自分の列車（外からの視点のときだけ見せる）
  myTrain.group.visible = view === 'ext';
  cab.group.visible = view === 'cab';
  if (view === 'ext') myTrain.place(sim.s, 0, false, sim.route.path);
  cab.update(sim, dt, { wipers, guide: sim.mode === 'easy', dist: sim.at >= 0 ? null : sim.route.stations[sim.next].stop - sim.s });
  const L = LEVELS[gov.level];
  scenery.update(camPos, L);
  for (const im of track.sleepers) im.visible = im.boundingSphere!.center.distanceTo(camPos) < 450;
  for (const im of lines.sleepers) im.visible = im.boundingSphere!.center.distanceTo(camPos) < 450;
  post.grade.uniforms.uSpeed.value = view === 'cab' ? Math.min(1, Math.max(0, (sim.v - 8) / 20)) : 0;
  if (running) { updateHud(); updateCpBar(); }
  if (cpFlashT > 0 && (cpFlashT -= dt) <= 0) $('cpFlash').classList.remove('show');
  if (toastT > 0 && (toastT -= dt) <= 0) $('toast').classList.remove('show');
  if (subT > 0 && (subT -= dt) <= 0) $('sub').classList.remove('show');
  if (cardT > 0 && (cardT -= dt) <= 0) $('stopcard').hidden = true;
  csm.update();
  // いちばん遠い段の影は 2 コマに 1 回だけ描き直す
  const farLight = csm.lights[csm.lights.length - 1];
  farLight.shadow.autoUpdate = false;
  farLight.shadow.needsUpdate = frame % 2 === 0;
  renderer.info.reset();
  post.composer.render(dt);
  frame++;
  const js = performance.now() - t0;
  jsAvg += (js - jsAvg) * 0.05;
  // 自動調整：実際のコマの間隔で判断する
  const changed = gov.frame(now - lastNow);
  lastNow = now;
  if (changed !== null) applyLevel(changed);
  if (showFps && frame % 15 === 0) fpsEl.textContent = `${Math.round(gov.fps)} FPS・画質 ${LEVELS.length - gov.level}/${LEVELS.length}${gov.auto ? '（自動）' : ''}`;
  (window as unknown as { __ts: unknown }).__ts = { sim, frame, ready: true, view, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, js: Math.round(jsAvg * 10) / 10, level: gov.level };
}

// ---- スマホは横向きで遊ぶ ----
const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 900;
/** 全画面にして横向きに固定する（Android の Chrome など）。できない端末（iPhone の Safari など）は案内を出す */
async function forceLandscape() {
  if (!isPhone()) return;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (o?.lock) await o.lock('landscape');
  } catch { /* 固定できない端末では、縦のときに案内を出して止めておく */ }
  checkRotate();
}
let needRotate = false;
function checkRotate() {
  needRotate = running && isPhone() && innerHeight > innerWidth;
  $('rotate').hidden = !needRotate;
}
addEventListener('resize', checkRotate);
screen.orientation?.addEventListener?.('change', checkRotate);

// ---- 画質の段 ----
let gov = new Governor(startLevel(matchMedia('(pointer: coarse)').matches, Math.min(screen.width, screen.height)));
let lastNow = performance.now(), jsAvg = 0;
let showFps = params.has('fps');
const fpsEl = $('fps');
fpsEl.hidden = !showFps;
function toggleFps() { showFps = !showFps; fpsEl.hidden = !showFps; }
function applyLevel(n: number) {
  const L = LEVELS[n];
  renderer.setPixelRatio(Math.min(devicePixelRatio, L.dpr));
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
  post.setLevel(L);
  for (const l of csm.lights) {
    if (l.shadow.mapSize.x !== L.shadowSize) {
      l.shadow.mapSize.set(L.shadowSize, L.shadowSize);
      l.shadow.map?.dispose();
      (l.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
  }
  if (csm.maxFar !== L.shadowFar) { csm.maxFar = L.shadowFar; csm.updateFrustums(); }
}
function chooseQuality(q: string) {
  const start = startLevel(matchMedia('(pointer: coarse)').matches, Math.min(screen.width, screen.height));
  gov = q === 'high' ? new Governor(0, false) : q === 'low' ? new Governor(3, false) : new Governor(start, true);
  applyLevel(gov.level);
}

addEventListener('resize', () => {
  if (!post) return; // 読み込み中
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  post.setSize(innerWidth, innerHeight);
  csm.updateFrustums();
});

// ---- 路線を選ぶ画面：カードと路線図 ----
function buildTitle() {
  const fmtLen = (m: number) => `${(m / 1000).toFixed(1)} km`;
  const cards = PLAYABLE.map((r, i) => {
    const st = r.stations;
    const len = st[st.length - 1].stop - st[0].stop;
    const min = Math.round((st[st.length - 1].arr - st[0].dep) / 60);
    return `<label><input type="radio" name="route" value="${r.id}" ${i === 0 ? 'checked' : ''}><span class="sw" style="--c:${r.color}"></span><b>${r.name}</b>
      <small>${st.map((x) => x.name).join(' → ')}　${st.length} 駅・${fmtLen(len)}・約 ${min} 分<br>${r.note}</small></label>`;
  }).join('');
  $('routeCards').innerHTML = cards;
  const fromSel = $<HTMLSelectElement>('fromSt'), toSel = $<HTMLSelectElement>('toSt');
  const fill = () => {
    const r = routeById(document.querySelector<HTMLInputElement>('input[name=route]:checked')?.value ?? 'hikari');
    const st = r.stations;
    const f = Math.min(Number(fromSel.dataset.r === r.id ? fromSel.value : 0), st.length - 2);
    fromSel.innerHTML = st.slice(0, -1).map((x, i) => `<option value="${i}" ${i === f ? 'selected' : ''}>${x.name}</option>`).join('');
    const tPrev = toSel.dataset.r === r.id ? Number(toSel.value) : st.length - 1;
    const t = Math.max(f + 1, tPrev);
    toSel.innerHTML = st.map((x, i) => (i > f ? `<option value="${i}" ${i === t ? 'selected' : ''}>${x.name}</option>` : '')).join('');
    fromSel.dataset.r = toSel.dataset.r = r.id;
    const len = st[t].stop - st[f].stop, min = Math.round((st[t].arr - st[f].dep) / 60);
    $('legNote').textContent = `${t - f} 区間・${(len / 1000).toFixed(1)} km・約 ${min} 分。区間ごとのチェックポイントが画面の上に出ます。`;
  };
  document.querySelectorAll<HTMLInputElement>('input[name=route]').forEach((x) => x.addEventListener('change', () => { fromSel.dataset.r = ''; toSel.dataset.r = ''; fill(); }));
  fromSel.addEventListener('change', fill); toSel.addEventListener('change', fill);
  fill();
  // 路線図（浜田のまわり）：ひかり野線を横軸にした図（左が潮見台、右が山ノ口）
  const toUV = (x: number, z: number) => { const n = HIKARI.path.nearest(x, z, 5); return [n.s, -n.d] as [number, number]; };
  const pts = (P: import('./net/path').Path, a: number, b: number) => { const o: [number, number][] = []; for (let s = a; s <= b; s += 15) { const f = P.at(s); o.push(toUV(f.x, f.z)); } return o; };
  const lines = [
    { r: AOBA, p: pts(AOBA.path, 0, AOBA.stations[2].stop + 20), w: 10 },
    { r: HIKARI, p: pts(HIKARI.path, 1000, 4000), w: 5 },
    { r: ROUTES[2], p: pts(ROUTES[2].path, 0, ROUTES[2].path.length), w: 6 },
  ];
  const minX = 1000, maxX = 4000, minZ = -420, maxZ = 420;
  const W = 640, H = 230;
  const X = (u: number) => ((u - minX) / (maxX - minX)) * W, Y = (v: number) => ((v - minZ) / (maxZ - minZ)) * H;
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (const l of lines) svg += `<polyline points="${l.p.map(([u, v]) => `${X(u).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="${l.r.color}" stroke-width="${l.w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const seen = new Set<string>();
  for (const l of lines) for (const st of l.r.stations) {
    const f = l.r.path.at(st.stop);
    const [u, v] = toUV(f.x, f.z);
    if (u < minX || u > maxX) continue;
    const key = `${Math.round(u / 30)}|${Math.round(v / 30)}`;
    if (seen.has(key)) continue; seen.add(key);
    svg += `<circle cx="${X(u)}" cy="${Y(v)}" r="6" fill="#fff" stroke="${l.r.color}" stroke-width="3"/>`;
    const below = l.r.id !== 'saza';
    svg += `<text x="${X(u)}" y="${Y(v) + (below ? 22 : -12)}" fill="#E8ECF5" font-size="14" font-weight="700" text-anchor="middle" font-family="Zen Kaku Gothic New, sans-serif">${st.name}</text>`;
  }
  const mark = (s: number, d: number, t: string) => { svg += `<text x="${X(s)}" y="${Y(-d)}" fill="#FFB347" font-size="12" text-anchor="middle" font-family="Zen Kaku Gothic New, sans-serif">${t}</text>`; };
  mark(1868, 70, '平面交差'); mark(2330, 40, '分岐器'); mark(2110, -150, '立体交差');
  svg += `<text x="6" y="${Y(0) - 8}" fill="#A9B2C8" font-size="12">← 潮見台</text><text x="${W - 6}" y="${Y(0) - 8}" fill="#A9B2C8" font-size="12" text-anchor="end">山ノ口 →</text>`;
  svg += '</svg>';
  $('netmap').innerHTML = svg;
}

(async function main() {
  buildTitle();
  const pct = $('loadPct');
  const pmrem = new THREE.PMREMGenerator(renderer);
  await new Promise<void>((res) => { const im = new Image(); im.onload = () => res(); im.onerror = () => res(); im.src = 'tex/sky.jpg'; });
  await build((p) => { pct.textContent = p; });
  wireSignals();
  scene.environment = pmrem.fromEquirectangular(skyTex).texture;
  scene.environmentIntensity = 1;
  post = buildPost(renderer, scene, camera);
  chooseQuality(params.get('q') ?? 'auto');
  const reb = () => chooseQuality(document.querySelector<HTMLInputElement>('input[name=q]:checked')?.value ?? 'auto');
  $('loading').remove();
  const btn = $<HTMLButtonElement>('startBtn');
  btn.disabled = false; btn.textContent = '運転をはじめる';
  btn.addEventListener('click', () => { sound.start(); void forceLandscape(); reb(); startRun(); });
  if (params.has('auto')) startRun();
  placeRig(sim, 0);
  loop();
})();
