import './style.css';
import * as THREE from 'three';
import { SEMI_40, RIGID_12FT, createState, step, bodies, cargoPose, fwd, type TruckState, type Controls, type TruckSpec } from './sim/vehicle';
import { allJobs, type Job } from './sim/jobs';
import { Link, type Box12 } from './link';
import { align, TOL, Docking, dockScore } from './sim/align';
import { Grid } from './sim/collide';
import { buildRoads } from './world/roads3d';
import { buildTown } from './world/town3d';
import { PLACES, route, steps, where, nearestOn, nearestNode, node, type Place, type Step } from './world/roadnet';
import { Minimap } from './minimap';
import { Tilt } from './input/tilt';
import { Pedal } from './input/pedals';
import { manager, loadEnv, setAniso } from './world/tex';
import { buildTractor } from './world/truck3d';
import { container, LINES, ISO, railBox, C12 } from './world/containers';
import { CraneRig } from './craneRig';
import type { CraneInput } from './sim/crane';
import { CRANE_TOL } from './sim/crane';
import { buildPractice } from './world/practice';
import { buildSky } from './world/sky';
import { Governor, LEVELS, startLevel } from './perf';

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);

// 文字の絵（コンテナの社名など）を描く前に字体を待つ（待ちすぎない）
await Promise.race([
  Promise.all([
    document.fonts.load('900 40px "Zen Kaku Gothic New"'),
    document.fonts.load('700 40px "Barlow Semi Condensed"'),
  ]).catch(() => undefined),
  new Promise((r) => setTimeout(r, 2500)),
]);

// ---------- 描画の土台 ----------
const canvasEl = $('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
setAniso(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 1500);
const sky = buildSky(scene);
loadEnv(renderer).then((env) => { if (env) { scene.environment = env; scene.environmentIntensity = 0.95; } });

// ---------- 練習場とトラック ----------
let spec: TruckSpec = SEMI_40;
const practice = buildPractice();
scene.add(practice.group);
scene.add(buildRoads());
const town = buildTown();
scene.add(town.group);
const grid = new Grid([...practice.obstacles, ...town.obstacles]);
// トラックは 2 種類：港の 40ft はトラクターとシャーシ、駅の 12ft は単車
const semiModel = buildTractor(SEMI_40), rigidModel = buildTractor(RIGID_12FT);
let model = semiModel;
scene.add(semiModel.tractor, semiModel.trailer!, rigidModel.tractor);
rigidModel.tractor.visible = false;
function useTruck(kind: 'semi' | 'rigid') {
  spec = kind === 'semi' ? SEMI_40 : RIGID_12FT;
  model = kind === 'semi' ? semiModel : rigidModel;
  semiModel.tractor.visible = semiModel.trailer!.visible = kind === 'semi';
  rigidModel.tractor.visible = kind === 'rigid';
}
// 積むコンテナは、はじめはクレーンが吊っている。トラックは空のシャーシで来る
const box = container(LINES[1], 40, 7);
const CARGO = 18000;
let s: TruckState = createState(spec, practice.start.x, practice.start.z, practice.start.h, 0);
const SLOT_Y = 1.3; // 荷台の上でのコンテナの中心の高さ（cargoSlot から）
const deckY = semiModel.cargoSlot.position.y + SLOT_Y - ISO.H / 2;
const rig = new CraneRig(practice.target, practice.rtg, practice.trolley, deckY, scene);
function hangBox() { semiModel.cargoSlot.remove(box); rig.hook.add(box); box.position.set(0, -ISO.H / 2, 0); box.rotation.set(0, 0, 0); }
function rnd(a: number, b: number) { return (Math.random() < 0.5 ? -1 : 1) * (a + Math.random() * (b - a)); }
hangBox();
rig.reset(rnd(2, 4), rnd(1, 2));
function placeModel() {
  model.tractor.position.set(s.x, 0, s.z);
  model.tractor.rotation.y = s.h;
  if (model.trailer) { model.trailer.position.set(s.tx, 0, s.tz); model.trailer.rotation.y = s.th; }
  model.update(s.steer, s.odo);
}
placeModel();

// ---------- 入力 ----------
const tilt = new Tilt();
const brake = new Pedal($('brake'), $('brake').querySelector('i')!);
const accel = new Pedal($('accel'), $('accel').querySelector('i')!);
let reverse = false;
let mode: 'tilt' | 'keys' = 'keys';
const keys = new Set<string>();
let keySteer = 0;
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyR') toggleGear();
  if (e.code === 'KeyC') nextView();
  if (e.code === 'Space') { recenter(); e.preventDefault(); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const toastEl = $('toast');
let toastT = 0;
function toast(msg: string) { toastEl.textContent = msg; toastEl.classList.add('show'); toastT = 2.2; }

const gearBtn = $('gear');
function toggleGear() {
  if (Math.abs(s.v) > 0.5) { toast('止まってから切り替えます'); return; }
  reverse = !reverse;
  gearBtn.textContent = reverse ? 'R' : 'D';
  gearBtn.classList.toggle('rev', reverse);
  gearBtn.setAttribute('aria-label', reverse ? '後退中（押すと前進）' : '前進中（押すと後退）');
}
gearBtn.addEventListener('click', toggleGear);
function recenter() { tilt.recenter(); toast('この持ち方を「まっすぐ」にします'); }
$('center').addEventListener('click', recenter);
// 画面の向きが変わったら、持ち直したところで「まっすぐ」を取り直す
screen.orientation?.addEventListener?.('change', () => tilt.recenter(0.8));
addEventListener('orientationchange', () => tilt.recenter(0.8));
$('view').addEventListener('click', () => nextView());
$('reset').addEventListener('click', () => { restart(); toast('スタートに戻りました'); });
$('again').addEventListener('click', restart);
$('closeResult').addEventListener('click', () => { dockedEl.hidden = true; });
$('againAll').addEventListener('click', toTitle);

// ハンドルの効き（この端末に覚えておく）
const sensInputs = document.querySelectorAll<HTMLInputElement>('input[name="sens"]');
try { const v = localStorage.getItem('truck.sens'); if (v) sensInputs.forEach((i) => { i.checked = i.value === v; }); } catch { /* 覚えられなくても遊べる */ }
function applySens() { const c = [...sensInputs].find((i) => i.checked); tilt.opts.sens = Number(c?.value ?? 1); try { localStorage.setItem('truck.sens', String(tilt.opts.sens)); } catch { /* なし */ } }
sensInputs.forEach((i) => i.addEventListener('change', applySens));
applySens();

// ---------- 画面の向き ----------
const isPhone = () => matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
async function forceLandscape() {
  if (!isPhone()) return;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    if (o?.lock) await o.lock('landscape');
  } catch { /* 固定できない端末（iPhone）は、縦のとき案内を出す */ }
  checkRotate();
}
let running = false;
function checkRotate() { $('rotate').hidden = !(running && isPhone() && innerHeight > innerWidth); }
addEventListener('resize', checkRotate);

// ---------- はじめる ----------
const startTilt = $('startTilt') as HTMLButtonElement;
manager.onLoad = () => { startTilt.disabled = false; startTilt.textContent = '傾きを使って運転する'; };
function begin(m: 'tilt' | 'keys') {
  mode = m;
  running = true;
  $('title').hidden = true;
  $('hud').hidden = false;
  resize();
  checkRotate();
  startJob();
}
/** 依頼を選び直す（はじめの画面へ） */
function toTitle() {
  running = false;
  $('hud').hidden = true;
  $('delivered').hidden = true;
  $('title').hidden = false;
  void refreshJobs();
}
startTilt.addEventListener('click', async () => {
  const ok = await tilt.start();
  void forceLandscape();
  begin('tilt');
  setTimeout(() => {
    if (tilt.enabled) return;
    toast(ok ? '傾きが読み取れません。キーボードか、別の端末で試してください' : '傾きの許可がありません。設定で「動きと向き」を許可してください');
  }, 2000);
});
$('startKeys').addEventListener('click', () => begin('keys'));
if (params.has('auto')) setTimeout(() => begin('keys'), 0); // 依頼の変数が用意できてから
// 開発で確かめる用：?trip で積み込みを飛ばして道案内から、?autopilot で経路に沿って自動で走る
function skipToTrip() {
  rig.hook.remove(box); semiModel.cargoSlot.add(box); box.position.set(0, SLOT_Y, 0); box.rotation.set(0, 0, 0);
  s = createState(spec, 150, 0, 0, CARGO);
  docking.state = 'docked'; docking.result = { along: 0, lateral: 0, yaw: 0, inBox: true };
  phase = 'loaded'; startTrip();
}
// （下で定める道案内の変数を使うので、読み込みが全部終わってから）
if (params.has('trip')) setTimeout(() => { begin('keys'); skipToTrip(); }, 0);
const autopilot = params.has('autopilot');
function autoControls(): { steer: number; throttle: number; brake: number } | null {
  if (!autopilot || !trip || phase !== 'loaded') return null;
  const cpo = cargoPose(spec, s);
  const n = nearestOn(trip.pts, cpo.x, cpo.z);
  // 目指す点は運転台から見た先：荷台の真ん中からの進み具合に、運転台までの差を足す
  const lead = Math.hypot(s.x - cpo.x, s.z - cpo.z);
  // 14 m 先の経路の点を目指す（追従）
  const end0 = trip.stepS[trip.stepS.length - 1];
  const s2 = Math.min(end0 + lead, n.s + lead + 14);
  let acc = 0, tx = s.x, tz = s.z;
  for (let i = 0; i < trip.pts.length - 1; i++) {
    const a = trip.pts[i], b = trip.pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + L >= s2) {
      const t = (s2 - acc) / L, dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
      // 左側通行：道の真ん中より左の車線を走る（構内と停止枠の近くは真ん中）
      const w = where(a.x + dx * t * L, a.z + dz * t * L, dx, dz);
      const off = end0 - s2 < 30 ? 0 : w.kind === 'main' ? 3.7 : w.kind === 'street' ? 2.1 : 0;
      tx = a.x + dx * t * L + dz * off; tz = a.z + dz * t * L - dx * off;
      break;
    }
    acc += L; tx = b.x; tz = b.z;
  }
  // 停止枠より先は、停止枠の向きにまっすぐのばす
  if (s2 > end0) { const d = trip.dest.dock; tx = d.x + Math.cos(d.h) * (s2 - end0); tz = d.z - Math.sin(d.h) * (s2 - end0); }
  const want = Math.atan2(-(tz - s.z), tx - s.x);
  let err = want - s.h; err = Math.atan2(Math.sin(err), Math.cos(err));
  const end = trip.stepS[trip.stepS.length - 1] - n.s;
  const k = trip.stepS.findIndex((v) => v > n.s + 5);
  const toTurn = k < 0 ? end : trip.stepS[k] - n.s;
  // 停止枠の手前ではごくゆっくりにして、枠の真ん中で止める
  const target = end < 0.05 ? 0 : end < 6 ? 0.6 : end < 40 ? 2 : toTurn < 45 ? 4.5 : 11;
  const v = s.v;
  return { steer: Math.max(-1, Math.min(1, -err * 3)), throttle: v < target ? 0.5 : 0, brake: end < 0.05 ? 1 : v > target + 0.3 ? 0.6 : 0 };
}

// ---------- 視点 ----------
type View = 'chase' | 'cab' | 'top';
const VIEWS: View[] = ['chase', 'cab', 'top'];
let view: View = 'chase';
function nextView() { view = VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]; }
let camH = s.h;
const camPos = new THREE.Vector3(), look = new THREE.Vector3();
const cranePos = new THREE.Vector3(), craneQuat = new THREE.Quaternion();
let blend = 0; // 0 = 運転の視点、1 = クレーンの視点
function placeCamera(dt: number) {
  // 追いかける向きは、トラクターとトレーラーの間をなめらかに
  const want = Math.atan2(Math.sin(s.h) + Math.sin(s.th) * 0.6, Math.cos(s.h) + Math.cos(s.th) * 0.6);
  let d = want - camH; d = Math.atan2(Math.sin(d), Math.cos(d));
  camH += d * Math.min(1, dt * 2.5);
  const [fx, fz] = fwd(camH);
  const [hx, hz] = fwd(s.h);
  if (view === 'chase') {
    camPos.set(s.x - fx * 25, 8.5, s.z - fz * 25);
    look.set(s.x + hx * 12, 1.5, s.z + hz * 12);
    camera.position.lerp(camPos, Math.min(1, dt * 6));
  } else if (view === 'cab') {
    const rx = -hz, rz = hx; // 右ハンドル：運転席は右側
    camera.position.set(s.x + hx * (spec.front - 0.9) + rx * 0.55, 2.75, s.z + hz * (spec.front - 0.9) + rz * 0.55);
    look.set(camera.position.x + hx * 20, 2.2, camera.position.z + hz * 20);
  } else {
    camPos.set(s.x - fx * 8, 46, s.z - fz * 8);
    look.set(s.x + fx * 6, 0, s.z + fz * 6);
    camera.position.lerp(camPos, Math.min(1, dt * 4));
  }
  camera.lookAt(look);
  // 積み込みのときは、クレーンの運転室の視点へなめらかに移る
  const k = blend * blend * (3 - 2 * blend);
  if (k > 0) {
    rig.cameraPose(cranePos, craneQuat);
    camera.position.lerp(cranePos, k);
    camera.quaternion.slerp(craneQuat, k);
  }
  // スマホを傾けても景色は水平のまま：傾けた分だけカメラを逆に回す
  if (mode === 'tilt' && tilt.enabled) camera.rotateZ(-tilt.roll);
}

// ---------- 画質（60 FPS を保つ） ----------
const gov = new Governor(startLevel(matchMedia('(pointer: coarse)').matches, Math.min(screen.width, screen.height)));
function applyLevel(n: number) {
  const L = LEVELS[n];
  renderer.setPixelRatio(Math.min(devicePixelRatio, L.dpr));
  if (sky.sun.shadow.mapSize.x !== L.shadowSize) {
    sky.sun.shadow.mapSize.set(L.shadowSize, L.shadowSize);
    sky.sun.shadow.map?.dispose(); sky.sun.shadow.map = null;
  }
  resize();
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
applyLevel(gov.level);

// ---------- 表示 ----------
const kmhEl = $('kmh'), guideEl = $('guide'), levelEl = $('level');
const alignEl = $('align'), aAlong = $('aAlong'), aLat = $('aLat'), aYaw = $('aYaw');
const cm = (m: number) => `${Math.round(Math.abs(m) * 100)} cm`;
let hits = 0, hitCool = 0;
const docking = new Docking();
const dockedEl = $('docked');
type Phase = 'drive' | 'toCrane' | 'crane' | 'rising' | 'toDrive' | 'loaded' | 'handling' | 'delivered';
let phase: Phase = 'drive';
let riseT = 0;
function showResult() {
  const r = docking.result!;
  const sc = dockScore(r);
  $('dDock').textContent = `${sc > 0.8 ? 'ぴったり' : sc > 0.45 ? 'よい' : '範囲内'}（前後 ${cm(r.along)}・左右 ${cm(r.lateral)}）`;
  $('dLand').textContent = `前後 ${cm(landErr.along)}・左右 ${cm(landErr.lateral)}`;
  $('dBump').textContent = rig.crane.bumps ? `${rig.crane.bumps} 回` : 'なし';
  dockedEl.hidden = false;
}
function restart() {
  useTruck('semi');
  clearRail();
  s = createState(spec, practice.start.x, practice.start.z, practice.start.h, 0);
  reverse = true; toggleGear();
  docking.reset(); dockedEl.hidden = true;
  trip = null; arrive.reset(); $('delivered').hidden = true; practice.gate.setOpen(false); hits = 0;
  minimap.el.hidden = true; navEl.hidden = true; limitEl.textContent = '20';
  phase = 'drive'; blend = 0; document.body.classList.remove('crane');
  hangBox();
  rig.reset(rnd(2, 4), rnd(1, 2));
}
let landErr = { along: 0, lateral: 0, yaw: 0 };

// ---------- 依頼（港の 40ft／駅をはさむ 12ft） ----------
const link = new Link();
let jobs: Job[] = allJobs([]);
let job: Job = jobs[0];
let loadedBoxes: Box12[] = [];
const railMeshes: THREE.Mesh[] = [];
function clearRail() { for (const m of railMeshes) rigidModel.cargoSlot.remove(m); railMeshes.length = 0; loadedBoxes = []; }
const placeOf = (id: string) => PLACES.find((p) => p.id === id)!;
/** 停止枠に荷台の真ん中が合う位置に、トラックを置く */
function parkAt(dock: { x: number; z: number; h: number }, cargo: number) {
  const c = (spec.front - 2.4 - spec.rear) / 2;
  s = createState(spec, dock.x - Math.cos(dock.h) * c, dock.z + Math.sin(dock.h) * c, dock.h, cargo);
  camH = s.h;
  camera.position.set(s.x - Math.cos(s.h) * 25, 8.5, s.z + Math.sin(s.h) * 25);
}
// 駅の人による積み下ろし：1 個ずつ、上から下ろす（または上へ持ち上げる）短い動き
let handling: { kind: 'load' | 'unload'; t: number; done: () => void } | null = null;
function startHandling(kind: 'load' | 'unload', done: () => void) {
  phase = 'handling';
  handling = { kind, t: 0, done };
  if (kind === 'load') {
    clearRailMeshesOnly();
    loadedBoxes.forEach((b, i) => {
      const m = railBox(b.num, b.id);
      m.position.set((i === 0 ? 1 : -1) * (C12.L / 2 + 0.06), 0.02 + C12.H / 2 + 6, 0);
      m.visible = false;
      rigidModel.cargoSlot.add(m); railMeshes.push(m);
    });
  }
}
function clearRailMeshesOnly() { for (const m of railMeshes) rigidModel.cargoSlot.remove(m); railMeshes.length = 0; }
function updateHandling(dt: number) {
  if (!handling) return;
  handling.t += dt;
  const per = 1.4; // 1 個あたりの秒数
  railMeshes.forEach((m, i) => {
    const k = Math.max(0, Math.min(1, (handling!.t - i * per) / per));
    const e = k * k * (3 - 2 * k);
    const baseY = 0.02 + C12.H / 2;
    if (handling!.kind === 'load') { m.visible = handling!.t > i * per; m.position.y = baseY + (1 - e) * 6; }
    else { m.position.y = baseY + e * 6; m.visible = k < 1; }
  });
  if (handling.t > railMeshes.length * per + 0.4) { const d = handling.done; handling = null; d(); }
}
async function startJob() {
  $('delivered').hidden = true; dockedEl.hidden = true;
  if (job.kind === 'port') { restart(); return; }
  // 12ft：単車で、出発地の停止枠から始める（駅の人が積む）
  restart();
  useTruck('rigid');
  clearRail();
  practice.gate.setOpen(false);
  const from = placeOf(job.from), to = placeOf(job.to);
  parkAt(from.dock, 0);
  docking.state = 'docked';
  phase = 'handling';
  guideEl.textContent = 'コンテナを準備しています…'; guideEl.className = 'ok';
  loadedBoxes = job.kind === 'toStation' ? await link.factoryLoad(2) : job.boxes;
  if (job.kind === 'fromStation') await link.move(job.boxes.map((b) => b.id), 'station', 'truck');
  startHandling('load', () => {
    s.cargo = loadedBoxes.reduce((a, b) => a + b.weight, 0);
    phase = 'loaded';
    startTrip(to, from.node, { x: s.x, z: s.z });
    toast(`積み終わりました：${to.name}へ`);
  });
}

// ---------- はじめの画面：依頼の一覧と、ひかり野線との連携 ----------
const jobList = $('jobs'), linkCode = $('linkCode'), linkNote = $('linkNote');
async function refreshJobs() {
  const station = await link.stationIn();
  jobs = allJobs(station);
  if (!jobs.some((j) => j.title === job.title && j.kind === job.kind)) job = jobs[0];
  // 確かめる用：?job=toStation などで依頼を選んでおく
  const want = params.get('job');
  if (want && !running) job = jobs.find((j) => j.kind === want) ?? job;
  jobList.innerHTML = '';
  for (const j of jobs) {
    const id = `job-${jobs.indexOf(j)}`;
    const label = document.createElement('label');
    label.className = 'job';
    label.innerHTML = `<input type="radio" name="job" id="${id}"><span><b></b><small></small></span>`;
    label.querySelector('b')!.textContent = j.title;
    label.querySelector('small')!.textContent = j.detail;
    const input = label.querySelector('input')!;
    input.checked = j === job || (j.kind === job.kind && j.title === job.title);
    input.addEventListener('change', () => { job = j; });
    jobList.appendChild(label);
  }
  // 連携のようす
  linkCode.textContent = link.code ?? 'まだ作っていません';
  const c = await link.counts();
  if (!link.code) linkNote.textContent = 'つないでいないので、駅のコンテナは仮のものです。コードを作って、ひかり野線のはじめの画面に入れるとつながります。';
  else if (!c) linkNote.textContent = '記録置き場につながりません（まだ用意できていないか、電波がありません）。いまは仮のコンテナで遊べます。';
  else linkNote.textContent = `つながっています。駅で待つコンテナ：山ノ口あて ${c.stationOut} 個・町あて ${c.stationIn} 個`;
}
$('linkMake').addEventListener('click', async () => {
  const c = await link.create();
  if (!c) linkNote.textContent = 'コードを作れませんでした（記録置き場がまだ用意できていないかもしれません）。';
  void refreshJobs();
});
$('linkCopy').addEventListener('click', async () => {
  if (!link.code) return;
  try { await navigator.clipboard.writeText(link.code); linkNote.textContent = 'コードをコピーしました'; }
  catch { const r = document.createRange(); r.selectNodeContents(linkCode); getSelection()?.removeAllRanges(); getSelection()?.addRange(r); }
});
$('linkUse').addEventListener('click', async () => {
  const v = ($('linkInput') as HTMLInputElement).value;
  linkNote.textContent = (await link.use(v)) ? 'このコードでつなぎました' : 'コードが見つかりません（8 文字の英数字）';
  void refreshJobs();
});
void refreshJobs();

// ---------- 道案内（積み込みのあと、届け先まで） ----------
interface Trip { dest: Place; pts: { x: number; z: number }[]; steps: Step[]; stepS: number[]; t0: number; over: number; wrong: number; hits0: number; }
let trip: Trip | null = null;
const arrive = new Docking();
const minimap = new Minimap($('minimap') as HTMLCanvasElement);
/** 交差点の並びから、道のりの折れ線と、曲がる所までの道のりを作る */
function plan(fromNode: string, dest: Place, lead?: { x: number; z: number }) {
  const path = route(fromNode, dest.node);
  const pts = (lead ? [lead] : []).concat(path.map((id) => ({ x: node(id).x, z: node(id).z })), [{ x: dest.dock.x, z: dest.dock.z }]);
  const st = steps(path);
  // 最後の「到着」は停止枠の位置にする
  st[st.length - 1] = { ...st[st.length - 1], x: dest.dock.x, z: dest.dock.z };
  const stepS = st.map((p) => nearestOn(pts, p.x, p.z).s);
  stepS[stepS.length - 1] = nearestOn(pts, dest.dock.x, dest.dock.z).s;
  return { pts, steps: st, stepS };
}
function startTrip(dest: Place = PLACES[0], fromNode = 'gate', lead: { x: number; z: number } = { x: 150, z: 0 }) {
  const p = plan(fromNode, dest, lead);
  trip = { dest, ...p, t0: performance.now(), over: 0, wrong: 0, hits0: hits };
  if (fromNode === 'gate') practice.gate.setOpen(true);
  minimap.setRoute(trip.pts);
}
/** 港の積み込み場の中にいるか（出口のゲートの手前） */
const inYard = () => s.x < 205 && Math.abs(s.z) < 64;
const navEl = $('nav'), navArrow = $('navArrow'), navDist = $('navDist'), navTo = $('navTo'), limitEl = $('limit');
const ARROW: Record<string, string> = { left: 'rotate(-90deg)', right: 'rotate(90deg)', straight: 'none', arrive: 'none' };
const fmtDist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(m / 10) * 10)} m`);
let warnT = 0;
function updateTrip(dt: number): { msg: string; cls: string } | null {
  if (!trip) return null;
  const [hx, hz] = fwd(s.h);
  // 道のどこにいるか：制限速度、逆走、道の外
  const w = where(s.x, s.z, hx, hz);
  const kmh = Math.abs(s.v) * 3.6;
  limitEl.textContent = String(w.limit);
  limitEl.classList.toggle('over', kmh > w.limit + 3);
  if (kmh > w.limit + 3) trip.over += dt;
  if (w.wrongWay && kmh > 5) trip.wrong += dt;
  // 経路から外れたら、近い交差点から引き直す
  const cp = cargoPose(spec, s);
  let near = nearestOn(trip.pts, cp.x, cp.z);
  if (nearestOn(trip.pts, s.x, s.z).d > 35 && !inYard()) {
    const p = plan(nearestNode(s.x, s.z), trip.dest, { x: s.x, z: s.z });
    Object.assign(trip, p);
    minimap.setRoute(trip.pts);
    near = nearestOn(trip.pts, cp.x, cp.z);
    toast('道を外れました：経路を引き直します');
  }
  const total = trip.stepS[trip.stepS.length - 1] - near.s;
  const k = trip.stepS.findIndex((v) => v > near.s + 5);
  const next = trip.steps[k < 0 ? trip.steps.length - 1 : k];
  const toNext = (k < 0 ? trip.stepS[trip.stepS.length - 1] : trip.stepS[k]) - near.s;
  navEl.hidden = false;
  navArrow.style.transform = ARROW[next.turn];
  navArrow.textContent = next.turn === 'arrive' ? '◎' : '↑';
  navDist.textContent = next.turn === 'arrive' ? `到着まで ${fmtDist(toNext)}` : `${fmtDist(toNext)} 先 ${next.turn === 'left' ? '左へ' : next.turn === 'right' ? '右へ' : 'まっすぐ'}`;
  navTo.textContent = `${trip.dest.name}まで ${fmtDist(total)}`;
  // 注意（少しのあいだだけ出す）
  warnT -= dt;
  if (w.wrongWay && kmh > 5) return { msg: '右側を走っています：日本は左側通行', cls: 'stop' };
  if (w.on === 'walk' && kmh > 2) return { msg: '歩道に乗り上げています', cls: 'stop' };
  if (w.on === 'off' && kmh > 2) return { msg: '道の外です', cls: 'warn' };
  if (kmh > w.limit + 3) return { msg: `速度を落として（制限 ${w.limit} km/h）`, cls: 'warn' };
  if (inYard()) return { msg: '出口のゲートへ', cls: 'ok' };
  return { msg: '', cls: '' };
}
function showDelivered() {
  if (!trip) return;
  const r = arrive.result!;
  const sec = (performance.now() - trip.t0) / 1000;
  const sc = dockScore(r);
  $('vTitle').textContent = `${trip.dest.name}に届けました`;
  $('vTime').textContent = `${Math.floor(sec / 60)} 分 ${Math.round(sec % 60)} 秒`;
  $('vDock').textContent = `${sc > 0.8 ? 'ぴったり' : sc > 0.45 ? 'よい' : '範囲内'}（前後 ${cm(r.along)}・左右 ${cm(r.lateral)}）`;
  $('vHits').textContent = hits - trip.hits0 ? `${hits - trip.hits0} 回` : 'なし';
  $('vOver').textContent = trip.over > 0.5 ? `${Math.round(trip.over)} 秒` : 'なし';
  $('vWrong').textContent = trip.wrong > 0.5 ? `${Math.round(trip.wrong)} 秒` : 'なし';
  // 12ft：何を運んだか、ひかり野線とのつながり
  const what = loadedBoxes.map((b) => `${b.num}（${b.contents}）`).join('・');
  $('vNote').textContent = job.kind === 'toStation'
    ? `駅に降ろしました：${what}。ひかり野線の貨物列車が山ノ口へ運びます${link.code ? `（連携コード ${link.code}）` : '（つなぐと、ひかり野線で運べます）'}。`
    : job.kind === 'fromStation' ? `ひかり野線が運んできたコンテナを届けました：${what}。` : '荷下ろしと報酬の計算は、次の段階で作ります。';
  $('delivered').hidden = false;
  navEl.hidden = true;
}
// ---------- クレーンの操作 ----------
let hoistVal = 0, skewVal = 0;
const hoistEl = $('hoist'), knob = $('hoistKnob');
let hoistPid: number | null = null;
function readHoist(e: PointerEvent) {
  const r = hoistEl.getBoundingClientRect();
  const v = ((r.top + r.height / 2) - e.clientY) / (r.height / 2 - 26);
  setHoist(Math.max(-1, Math.min(1, v)));
}
function setHoist(v: number) {
  hoistVal = Math.abs(v) < 0.12 ? 0 : v;
  const r = hoistEl.getBoundingClientRect();
  knob.style.transform = `translateY(${-v * (r.height / 2 - 26)}px)`;
  knob.textContent = hoistVal > 0 ? '上' : hoistVal < 0 ? '下' : '止';
  hoistEl.setAttribute('aria-valuenow', String(Math.round(hoistVal * 100)));
}
hoistEl.addEventListener('pointerdown', (e) => { hoistPid = e.pointerId; hoistEl.setPointerCapture(e.pointerId); readHoist(e); });
hoistEl.addEventListener('pointermove', (e) => { if (e.pointerId === hoistPid) readHoist(e); });
const hoistUp = (e: PointerEvent) => { if (e.pointerId === hoistPid) { hoistPid = null; setHoist(0); } };
hoistEl.addEventListener('pointerup', hoistUp);
hoistEl.addEventListener('pointercancel', hoistUp);
for (const [id, v] of [['skewL', -1], ['skewR', 1]] as const) {
  const b = $(id);
  b.addEventListener('pointerdown', () => { skewVal = v; });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { skewVal = 0; });
}
const lockBtn = $('lock') as HTMLButtonElement;
function doLock() {
  if (phase !== 'crane' || !rig.crane.lock()) return;
  landErr = rig.crane.error(chassisNow());
  // コンテナを吊り具から外して、シャーシに固定する
  rig.hook.remove(box); semiModel.cargoSlot.add(box); box.position.set(0, SLOT_Y, 0); box.rotation.set(0, 0, 0);
  s.cargo = CARGO;
  phase = 'rising'; riseT = 2.2;
  toast('ロックしました：吊り具を上げます');
}
lockBtn.addEventListener('click', doLock);
addEventListener('keydown', (e) => { if (e.code === 'KeyL' || e.code === 'Enter') doLock(); });
function chassisNow() { const r = align(cargoPose(spec, s), practice.target); return { along: r.along, lateral: r.lateral, yaw: r.yaw }; }
/** 傾き（rad）を -1〜1 に：真ん中 2° は遊び、20° で最大 */
function axis(a: number) { const d = 2 * Math.PI / 180, m = Math.abs(a); return m < d ? 0 : Math.sign(a) * Math.min(1, (m - d) / (18 * Math.PI / 180)); }
function craneInput(): CraneInput {
  let along = 0, lateral = 0;
  if (mode === 'tilt' && tilt.enabled) { lateral = axis(tilt.roll); along = axis(tilt.pitch); }
  const k = (a: string, b: string) => (keys.has(a) ? 1 : 0) - (keys.has(b) ? 1 : 0);
  lateral += k('ArrowRight', 'ArrowLeft'); along += k('ArrowUp', 'ArrowDown');
  // キーは、荷台の近くでは自動でゆっくりにする
  const hoist = Math.abs(hoistVal) > 0 ? hoistVal : k('KeyW', 'KeyS') * (rig.crane.h < 1.2 ? 0.35 : 0.8);
  const skew = skewVal || k('KeyX', 'KeyZ');
  return { along, lateral, hoist, skew };
}
const cAlong = $('cAlong'), cLat = $('cLat'), cYaw = $('cYaw'), cH = $('cH'), swayBars = [...$('cSway').querySelectorAll('i')];
const stageEls = [...$('stages').querySelectorAll<HTMLElement>('li[data-s]')];
function updateCraneHud() {
  const c = rig.crane, e = c.error(chassisNow());
  const set = (el: HTMLElement, ok: boolean, okTxt: string, ngTxt: string) => { el.textContent = ok ? `OK ${okTxt}` : ngTxt; el.className = `num ${ok ? 'ok' : 'warn'}`; };
  // 表示は「コンテナをどちらへ動かせばよいか」
  set(cAlong, Math.abs(e.along) <= CRANE_TOL.along, cm(e.along), `${e.along > 0 ? 'うしろへ' : '前へ'} ${cm(e.along)}`);
  set(cLat, Math.abs(e.lateral) <= CRANE_TOL.lateral, cm(e.lateral), `${e.lateral > 0 ? '左へ' : '右へ'} ${cm(e.lateral)}`);
  const deg = `${(Math.abs(e.yaw) * 180 / Math.PI).toFixed(1)}°`;
  set(cYaw, Math.abs(e.yaw) <= CRANE_TOL.yaw, deg, `${e.yaw > 0 ? '左へ回す' : '右へ回す'} ${deg}`);
  cH.textContent = c.landed ? '着地' : `荷台の上 ${c.h.toFixed(1)} m`;
  const level = Math.min(4, Math.ceil(c.swing / 0.06));
  swayBars.forEach((b, i) => b.classList.toggle('on', i < level));
  const aligned = c.aligned(chassisNow());
  const now = c.landed ? 'lock' : aligned ? 'lower' : 'carry';
  stageEls.forEach((li) => { li.classList.toggle('now', li.dataset.s === now); });
  lockBtn.disabled = !c.landed;
  $('lockNote').textContent = c.landed ? '4 隅が合いました' : c.blocked ? 'ずれて乗っている' : 'まだ合っていない';
  let msg = '', cls = 'warn';
  if (c.landed) { msg = '着地しました：ロックを押す'; cls = 'ok'; }
  else if (c.blocked) { msg = 'ずれています：少し上げて合わせ直す'; cls = 'stop'; }
  else if (aligned && c.swing < 0.05) { msg = '真上です：ゆっくり下ろす'; cls = 'ok'; }
  else if (aligned) { msg = '揺れが収まるのを待つ'; }
  else msg = '吊り具をシャーシの真上へ';
  if (guideEl.textContent !== msg) guideEl.textContent = msg;
  guideEl.className = cls;
}
let lastBumps = 0;
/** 停止枠とのずれ：範囲の中なら「OK」、外なら、どちらへ直せばよいか */
function showAlign(r: ReturnType<typeof align>) {
  const set = (el: HTMLElement, ok: boolean, okTxt: string, ngTxt: string) => { el.textContent = ok ? `OK ${okTxt}` : ngTxt; el.className = `num ${ok ? 'ok' : 'warn'}`; };
  set(aAlong, Math.abs(r.along) <= TOL.along, cm(r.along), r.along < 0 ? `前へ ${cm(r.along)}` : `下がる ${cm(r.along)}`);
  set(aLat, Math.abs(r.lateral) <= TOL.lateral, cm(r.lateral), `${r.lateral > 0 ? '右' : '左'}へ ${cm(r.lateral)}`);
  const deg = `${(Math.abs(r.yaw) * 180 / Math.PI).toFixed(1)}°`;
  set(aYaw, Math.abs(r.yaw) <= TOL.yaw, deg, `${r.yaw > 0 ? '右' : '左'}向き ${deg}`);
}
function updateHud(dt: number) {
  kmhEl.textContent = String(Math.round(Math.abs(s.v) * 3.6));
  levelEl.style.transform = mode === 'tilt' && tilt.enabled ? `rotate(${-tilt.roll}rad)` : '';
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.classList.remove('show'); }
  if (phase === 'toCrane' || phase === 'crane' || phase === 'rising') { updateCraneHud(); return; }
  if (phase === 'toDrive') { alignEl.hidden = true; return; }
  if (phase === 'handling') {
    alignEl.hidden = true; minimap.el.hidden = true;
    const m = handling?.kind === 'unload' ? '駅の人が降ろしています…' : 'コンテナを積んでいます…';
    if (guideEl.textContent !== m) guideEl.textContent = m;
    guideEl.className = 'ok';
    return;
  }
  if (phase === 'delivered') { alignEl.hidden = true; return; }
  if (phase === 'loaded') {
    let g = updateTrip(dt) ?? { msg: '', cls: '' };
    // 届け先の近くでは、停止枠の位置合わせ
    const pose = cargoPose(spec, s), d = trip!.dest.dock;
    const near = Math.hypot(pose.x - d.x, pose.z - d.z) < 35;
    alignEl.hidden = !near;
    minimap.el.hidden = near;
    if (near) {
      const r = align(pose, d);
      showAlign(r);
      const st = arrive.update(r, s.v, dt);
      if (st === 'docked') {
        g = { msg: '届けました', cls: 'ok' };
        if (job.kind === 'port') { phase = 'delivered'; showDelivered(); }
        else {
          startHandling('unload', async () => {
            const ids = loadedBoxes.map((b) => b.id);
            await link.move(ids, 'truck', job.kind === 'toStation' ? 'station' : 'delivered');
            s.cargo = 0;
            phase = 'delivered';
            showDelivered();
          });
        }
      }
      else if (st === 'settling') g = { msg: 'そのまま止まって…', cls: 'ok' };
      else if (r.inBox) g = { msg: '範囲に入りました：止まってください', cls: 'ok' };
      else if (r.along > TOL.along) g = { msg: '行きすぎ：R で少し下がる', cls: 'stop' };
      else if (r.along > -6) g = { msg: '荷さばき場の停止枠へ：ゆっくり', cls: 'warn' };
      else if (!g.msg) g = { msg: '荷さばき場の停止枠へ（前進で入る）', cls: 'ok' };
    } else if (!g.msg && inYard()) g = { msg: '積み込み完了：発進してよい', cls: 'ok' };
    if (guideEl.textContent !== g.msg) guideEl.textContent = g.msg;
    guideEl.className = g.cls;
    minimap.draw(s.x, s.z, s.h);
    return;
  }
  const pose = cargoPose(spec, s);
  const r = align(pose, practice.target);
  const near = Math.hypot(pose.x - practice.target.x, pose.z - practice.target.z) < 30;
  alignEl.hidden = !near;
  let cls = '', msg = '';
  if (s.jackknife) { cls = 'stop'; msg = 'トレーラーが折れました：↺ でやり直し'; }
  else if (!near) { cls = ''; msg = `3 番レーンの停止枠へ（あと ${Math.max(0, Math.round(-r.along))} m）`; }
  else {
    showAlign(r);
    const st = docking.update(r, s.v, dt);
    if (st === 'docked') {
      cls = 'ok'; msg = '位置 OK：クレーンで積み込み';
      if (phase === 'drive') { phase = 'toCrane'; document.body.classList.add('crane'); lastBumps = 0; toast('位置 OK：クレーンの運転室へ'); }
    }
    else if (st === 'settling') { cls = 'ok'; msg = 'そのまま止まって…'; }
    else if (r.inBox) { cls = 'ok'; msg = '範囲に入りました：止まってください'; }
    else if (r.along > TOL.along) { cls = 'stop'; msg = '行きすぎ：R で少し下がる'; }
    else if (r.along > -4) { cls = 'warn'; msg = 'ゆっくり'; }
    else { cls = 'ok'; msg = 'まっすぐ前へ'; }
  }
  if (guideEl.textContent !== msg) guideEl.textContent = msg;
  guideEl.className = cls;
}

// ---------- 1 コマ ----------
let last = performance.now();
function frame(now: number) {
  const ms = now - last; last = now;
  const dt = Math.min(0.05, ms / 1000);
  const lv = gov.frame(ms);
  if (lv !== null) applyLevel(lv);

  // ハンドル：傾き、またはキー
  let steer = 0;
  if (mode === 'tilt') steer = tilt.update(dt);
  const kl = keys.has('ArrowLeft') || keys.has('KeyA'), kr = keys.has('ArrowRight') || keys.has('KeyD');
  const kt = kr ? 1 : kl ? -1 : 0;
  keySteer += Math.sign(kt - keySteer) * Math.min(Math.abs(kt - keySteer), dt * (kt === 0 ? 4 : 2.2));
  if (kt !== 0 || Math.abs(keySteer) > 0.001) steer = keySteer;
  const c: Controls = {
    steer,
    throttle: Math.max(accel.value, keys.has('ArrowUp') || keys.has('KeyW') ? 1 : 0),
    brake: Math.max(brake.value, keys.has('ArrowDown') || keys.has('KeyS') ? 1 : 0),
    reverse,
  };
  const ap = autoControls();
  if (ap) { c.steer = ap.steer; c.throttle = ap.throttle; c.brake = ap.brake; }
  // 始める前と、積み込みが終わるまでは、ブレーキをかけたまま
  const parked = !running || (docking.state === 'docked' && phase !== 'loaded') || phase === 'delivered' || phase === 'handling';
  updateHandling(dt);
  if (parked) { c.throttle = 0; c.brake = 1; c.steer = 0; }
  // 積み込みの段階
  if (phase === 'toCrane') { blend = Math.min(1, blend + dt / 1.5); if (blend >= 1) phase = 'crane'; }
  if (phase === 'crane') {
    rig.step(craneInput(), chassisNow(), dt);
    if (rig.crane.bumps > lastBumps) { lastBumps = rig.crane.bumps; toast('強く下ろしました：荷が傷みます'); }
  }
  if (phase === 'rising') {
    rig.crane.locked = false; rig.crane.landed = false;
    rig.step({ along: 0, lateral: 0, hoist: 1, skew: 0 }, chassisNow(), dt);
    riseT -= dt;
    if (riseT <= 0) { phase = 'toDrive'; document.body.classList.remove('crane'); }
  }
  if (phase === 'toDrive') { blend = Math.max(0, blend - dt / 1.5); if (blend <= 0) { phase = 'loaded'; showResult(); startTrip(); } }
  practice.gate.update(dt);

  // 動かして、ぶつかったら元に戻して止める
  // 自動で走らせて確かめるときは、1 コマで何歩か進める（遅い端末でも早く終わるように）
  const sub = autopilot ? Math.max(1, Math.round(Number(params.get('autopilot')) || 1)) : 1;
  for (let k = 0; k < sub; k++) {
    if (k > 0) { const ap2 = autoControls(); if (ap2) { c.steer = ap2.steer; c.throttle = ap2.throttle; c.brake = ap2.brake; } }
    const before = { ...s };
    step(spec, s, c, dt);
    hitCool -= dt;
    if (grid.hit(bodies(spec, s)) >= 0) {
      s = before; s.v = 0;
      if (hitCool <= 0) { hits++; toast(`ぶつかりました（${hits} 回目）`); hitCool = 1.5; }
    }
  }
  placeModel();
  sky.follow(s.x, s.z);
  placeCamera(dt);
  if (running) updateHud(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
