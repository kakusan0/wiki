// 3D の場：札の置き場所・動き・カメラ・演出・タップの判定
import { CARDS } from '../game/cards';
import type { Ev, Player } from '../game/koikoi';
import type { View } from '../game/view';
import { BACK, atlas } from './art';
import { Fx } from './fx';
import { CH, CW, Stage, type CardDraw, type HaloDraw } from './gl/stage';
import { lookAt, model, mul, persp, project, qAxis, qMul, qSlerp, type Mat4, type Quat, type Vec3 } from './gl/math';

interface Pose { p: Vec3; q: Quat; s: number }
// 動き方：smooth＝なめらか、slam＝高く跳んで叩きつける、pop＝勢いよく飛び出して行き過ぎて戻る
type Style = 'smooth' | 'slam' | 'pop';
interface Tween { from: Pose; to: Pose; t0: number; dur: number; arc: number; spin: number; axis: Vec3; style: Style; trail: boolean }
interface Obj { key: string; face: number; cur: Pose; tween: Tween | null; target: Pose; phase: number; flash: number; punch: number; trail: Mat4[]; seen: Pose }

export interface Interaction {
  pickable: Set<number>; // 押せる札（手札・場）
  selected: number | null; // 選んでいる手札
  targets: Set<number>; // 光らせる場札
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const backOut = (t: number) => { const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const KIND_ORDER = { hikari: 0, tane: 1, tan: 2, kasu: 3 } as const;

const FACE_UP: Quat = qAxis([1, 0, 0], -Math.PI / 2);
const FACE_DOWN: Quat = qMul(qAxis([0, 1, 0], Math.PI), qAxis([1, 0, 0], Math.PI / 2));
const GOLD: Vec3 = [1.0, 0.75, 0.25];

// 札の格：演出の大きさと色
function power(id: number): { p: number; color: Vec3 } {
  const c = CARDS[id];
  if (c.kind === 'hikari') return { p: 1, color: GOLD };
  if (c.tag === 'akatan') return { p: 0.8, color: [1.0, 0.3, 0.3] };
  if (c.tag === 'aotan') return { p: 0.8, color: [0.35, 0.55, 1.0] };
  if (c.tag) return { p: 0.75, color: [0.5, 1.0, 0.7] };
  if (c.kind === 'tane' || c.kind === 'tan') return { p: 0.55, color: [0.5, 0.85, 1.0] };
  return { p: 0.4, color: [0.55, 0.8, 1.0] };
}

// 画面の縦横で置き方を変える
interface Layout {
  eye: Vec3; at: Vec3; fov: number;
  field: (i: number) => Vec3; fieldSlots: number;
  deck: Vec3;
  hand: (i: number, n: number) => Vec3; handTilt: number; handScale: number;
  opp: (i: number, n: number) => Vec3; oppScale: number;
  cap: (who: 0 | 1, group: number, i: number, n: number) => Vec3; capScale: number;
  reveal: Vec3; spot: (i: number, n: number) => Vec3;
}
function layoutFor(aspect: number): Layout {
  if (aspect >= 1.05) {
    return {
      eye: [0, 11.2, 8.6], at: [0, 0, 0.7], fov: 0.72,
      field: (i) => { const col = [4, 3, 5, 2, 6, 1, 7, 0, 8][Math.floor(i / 2) % 9]; return [(col - 4) * 1.22, 0.25, ((i % 2) - 0.5) * 1.9 + (i >= 18 ? 0.3 : 0)]; }, fieldSlots: 18,
      deck: [-6.9, 0.1, 0],
      hand: (i, n) => [(i - (n - 1) / 2) * 1.18, 1.0, 4.35], handTilt: 0.95, handScale: 1.05,
      opp: (i, n) => [(i - (n - 1) / 2) * 0.62, 0.15, -4.4], oppScale: 0.6,
      cap: (who, g, i, n) => { const step = Math.min(0.3, 2.9 / Math.max(1, n)); return [-6.3 + g * 3.65 + i * step, 0.12 + i * 0.004, who === 0 ? 2.75 : -2.75]; }, capScale: 0.5,
      reveal: [0, 4.2, 3.2], spot: (i, n) => [(i - (n - 1) / 2) * Math.min(1.35, 10 / n), 3.6, 2.2],
    };
  }
  return {
    eye: [0, 17, 6.6], at: [0, 0, 0.35], fov: 0.92,
    field: (i) => { const row = [1, 2, 0, 3, 4][Math.floor(i / 4) % 5]; return [((i % 4) - 1.5) * 1.22, 0.25, (row - 1.5) * 1.75]; }, fieldSlots: 20,
    deck: [3.6, 0.1, -5.7],
    hand: (i, n) => [(i - (n - 1) / 2) * Math.min(1.0, 6.9 / Math.max(1, n)), 1.3, 6.0], handTilt: 1.0, handScale: 0.92,
    opp: (i, n) => [-0.9 + (i - (n - 1) / 2) * 0.5, 0.15, -5.7], oppScale: 0.55,
    cap: (who, g, i, n) => { const step = Math.min(0.22, 1.6 / Math.max(1, n)); return [-4.0 + g * 2.15 + i * step, 0.12 + i * 0.004, who === 0 ? 4.15 : -4.15]; }, capScale: 0.42,
    reveal: [0, 6.0, 3.0], spot: (i, n) => [(i - (n - 1) / 2) * Math.min(1.5, 8 / n), 6.5, 3.2],
  };
}

export class Table3D {
  readonly canvas: HTMLCanvasElement;
  private stage: Stage;
  readonly fx = new Fx();
  private objs: Obj[] = [];
  private byKey = new Map<string, Obj>();
  // 見えている置き場所
  private hand: number[] = [];
  private oppHand: string[] = [];
  private field: (string | null)[] = [];
  private deck: string[] = [];
  private cap: [string[], string[]] = [[], []];
  private reveal: string | null = null;
  private spot: string[] = [];
  private frozen = new Set<string>(); // 吹き飛んだ札など、置き場所に戻さない札
  private me: Player = 0;
  private L: Layout = layoutFor(1.6);
  private vp: Mat4 = [];
  private eye: Vec3 = [0, 10, 8];
  private t = 0; // 実時間
  private raf = 0;
  private uid = 0;
  // 演出の状態
  tint: Vec3 = [0.25, 0.55, 1.0];
  private tintTo: Vec3 = [0.25, 0.55, 1.0];
  cheer = 0;
  private burst = -99;
  private pulse = -99;
  private orbitSpot: { t0: number; c: Vec3 } | null = null; // 役の札が回る
  private vortex: { t0: number; dur: number } | null = null; // こいこいの渦
  private inter: Interaction = { pickable: new Set(), selected: null, targets: new Set() };
  onPick: (id: number) => void = () => {};
  private queue: Promise<void> = Promise.resolve();
  private seenRound = 0;
  private seenEvents = 0;
  private _speed = 1;
  get speed() { return this._speed; }
  set speed(v: number) { this._speed = v; this.fx.speed = v; }

  static create(): Table3D | null {
    const canvas = document.createElement('canvas');
    canvas.className = 'stage';
    const stage = Stage.create(canvas, atlas());
    return stage ? new Table3D(canvas, stage) : null;
  }

  private constructor(canvas: HTMLCanvasElement, stage: Stage) {
    this.canvas = canvas;
    this.stage = stage;
    this.fx.mobile = matchMedia('(pointer: coarse)').matches;
    for (let i = 0; i < 48; i++) {
      const pose: Pose = { p: [0, 0.1 + i * 0.01, 0], q: FACE_DOWN, s: 1 };
      const o: Obj = { key: `u${this.uid++}`, face: BACK, cur: pose, target: pose, tween: null, phase: i * 0.7, flash: 0, punch: 0, trail: [], seen: pose };
      this.objs.push(o);
      this.byKey.set(o.key, o);
    }
    canvas.addEventListener('pointerdown', (e) => this.pick(e));
    const loop = (ms: number) => { this.frame(ms / 1000); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() { cancelAnimationFrame(this.raf); this.canvas.remove(); }

  setLite(lite: boolean) { this.fx.lite = lite; }
  setInteraction(i: Interaction) { this.inter = i; this.place(0.18); }
  setMood(kind: 'normal' | 'final' | 'cheer') {
    this.tintTo = kind === 'final' ? [1.0, 0.22, 0.25] : kind === 'cheer' ? [1.0, 0.75, 0.25] : [0.25, 0.55, 1.0];
    this.fx.heartbeat = kind === 'final';
  }
  doBurst() { this.burst = this.fx.at; this.fx.doShake(0.35); }
  doPulse() { this.pulse = this.fx.at; }

  // ---------- 置き場所 ----------
  private rename(o: Obj, key: string, face: number) { this.byKey.delete(o.key); o.key = key; o.face = face; this.byKey.set(key, o); }
  private obj(id: number) { return this.byKey.get(`c${id}`); }

  // 見え方に合わせて置き場所を作り直す（足りない札は、伏せた札から割り当てる）
  private rebuild(v: View) {
    const known = new Set<number>([...v.hand, ...v.field, ...v.captured[0], ...v.captured[1], ...(v.pendingDraw != null ? [v.pendingDraw] : [])]);
    const free = this.objs.filter((o) => !(o.key.startsWith('c') && known.has(o.face)));
    for (const id of known) if (!this.obj(id)) this.rename(free.shift()!, `c${id}`, id);
    for (const o of free) this.rename(o, `u${this.uid++}`, BACK);
    const unknown = free.map((o) => o.key);
    this.me = v.me;
    this.hand = [...v.hand];
    this.oppHand = unknown.slice(0, v.oppHand);
    this.deck = unknown.slice(v.oppHand, v.oppHand + v.deck);
    const keep = this.field.map((k) => (k && v.field.includes(Number(k.slice(1))) && k.startsWith('c') ? k : null));
    for (const id of v.field) if (!keep.includes(`c${id}`)) { const i = keep.indexOf(null); if (i >= 0) keep[i] = `c${id}`; else keep.push(`c${id}`); }
    this.field = keep;
    this.cap = [v.captured[0].map((id) => `c${id}`), v.captured[1].map((id) => `c${id}`)];
    this.reveal = v.pendingDraw != null && v.phase === 'drawChoose' ? `c${v.pendingDraw}` : null;
  }

  private facing(p: Vec3): Quat {
    const dy = this.eye[1] - p[1], dz = this.eye[2] - p[2];
    return qAxis([1, 0, 0], -Math.atan2(dy, dz));
  }

  private move(o: Obj, to: Pose, dur: number, opt: Partial<Pick<Tween, 'arc' | 'spin' | 'axis' | 'style' | 'trail'>> & { delay?: number } = {}) {
    const lite = this.fx.lite;
    o.tween = {
      from: this.poseNow(o), to, t0: this.fx.at + (opt.delay ?? 0) * this.speed, dur: Math.max(0.03, dur * this.speed * (lite ? 0.7 : 1)),
      arc: opt.arc ?? 0, spin: lite ? 0 : opt.spin ?? 0, axis: opt.axis ?? [0, 1, 0], style: opt.style ?? 'smooth', trail: !lite && !!opt.trail,
    };
    o.target = to;
  }

  // それぞれの札の行き先を決め、変わったものは動かす
  private place(dur = 0.45, stagger = 0) {
    const L = this.L;
    const want = new Map<string, Pose>();
    const fieldN = this.field.length;
    this.field.forEach((k, i) => { if (k) want.set(k, { p: L.field(i % Math.max(L.fieldSlots, fieldN)), q: FACE_UP, s: 1 }); });
    this.deck.forEach((k, i) => want.set(k, { p: [L.deck[0], L.deck[1] + i * 0.02, L.deck[2]], q: FACE_DOWN, s: 1 }));
    const tilt = qAxis([1, 0, 0], -Math.PI / 2 + L.handTilt);
    this.hand.forEach((id, i) => {
      const p = L.hand(i, this.hand.length);
      const sel = this.inter.selected === id;
      want.set(`c${id}`, { p: [p[0], p[1] + (sel ? 0.55 : 0), p[2] - (sel ? 0.5 : 0)], q: tilt, s: L.handScale * (sel ? 1.08 : 1) });
    });
    this.oppHand.forEach((k, i) => want.set(k, { p: L.opp(i, this.oppHand.length), q: FACE_DOWN, s: L.oppScale }));
    for (const who of [0, 1] as const) {
      const groups: string[][] = [[], [], [], []];
      for (const k of this.cap[who]) groups[KIND_ORDER[CARDS[Number(k.slice(1))].kind]].push(k);
      groups.forEach((g, gi) => g.sort().forEach((k, i) => {
        const side = who === this.me ? 0 : 1;
        want.set(k, { p: L.cap(side, gi, i, g.length), q: FACE_UP, s: L.capScale });
      }));
    }
    if (this.reveal) want.set(this.reveal, { p: L.reveal, q: this.facing(L.reveal), s: 1.5 });
    this.spot.forEach((k, i) => { const p = L.spot(i, this.spot.length); want.set(k, { p, q: this.facing(p), s: 1.1 }); });
    let n = 0;
    for (const o of this.objs) {
      const w = want.get(o.key);
      if (!w || this.frozen.has(o.key)) continue;
      const d = Math.hypot(w.p[0] - o.target.p[0], w.p[1] - o.target.p[1], w.p[2] - o.target.p[2]) + Math.abs(w.s - o.target.s) + (1 - Math.abs(w.q[0] * o.target.q[0] + w.q[1] * o.target.q[1] + w.q[2] * o.target.q[2] + w.q[3] * o.target.q[3]));
      if (d < 1e-4) continue;
      const from = this.poseNow(o);
      const dist = Math.hypot(w.p[0] - from.p[0], w.p[2] - from.p[2]);
      this.move(o, w, dur, { arc: dur > 0.2 ? Math.min(2.2, 0.3 + dist * 0.18) : 0, delay: stagger * n++ });
    }
  }

  // すべての札が止まるまで待つ（配り終わる前に押せないように）
  private async settle(limitMs = 4000) {
    const end = performance.now() + limitMs;
    while (performance.now() < end && this.objs.some((o) => o.tween && this.fx.at < o.tween.t0 + o.tween.dur)) await sleep(30);
  }

  // 演出の時計で待つ（ヒットストップ・スローの間は進まない）
  private async wait(ms: number) {
    const target = this.fx.at + (ms / 1000) * this.speed;
    const limit = performance.now() + ms * this.speed * 6 + 200;
    while (this.fx.at < target && performance.now() < limit) await sleep(12);
  }

  private poseNow(o: Obj): Pose {
    const tw = o.tween;
    if (!tw) return o.cur;
    const k = Math.min(1, Math.max(0, (this.fx.at - tw.t0) / tw.dur));
    let p: Vec3, e: number;
    if (tw.style === 'slam') {
      // 少し沈んで溜め → 高く跳ぶ → 加速して叩きつける
      e = 1 - (1 - k) ** 2;
      p = lerp3(tw.from.p, tw.to.p, e);
      const up = k < 0.12 ? -Math.sin((k / 0.12) * Math.PI) * 0.25 : k < 0.55 ? easeOut((k - 0.12) / 0.43) : 1 - ((k - 0.55) / 0.45) ** 2.6;
      p[1] += up * tw.arc;
    } else if (tw.style === 'pop') {
      e = backOut(k);
      p = lerp3(tw.from.p, tw.to.p, e);
      p[1] += Math.sin(Math.min(1, k * 1.3) * Math.PI) * tw.arc;
    } else {
      e = ease(k);
      p = lerp3(tw.from.p, tw.to.p, e);
      p[1] += Math.sin(k * Math.PI) * tw.arc;
    }
    let q = qSlerp(tw.from.q, tw.to.q, Math.min(1, Math.max(0, tw.style === 'slam' ? Math.min(1, k * 1.25) : e)));
    if (tw.spin) q = qMul(qAxis(tw.axis, tw.spin * Math.PI * 2 * (tw.style === 'slam' ? Math.min(1, k * 1.2) : Math.min(1, e))), q);
    return { p, q, s: tw.from.s + (tw.to.s - tw.from.s) * Math.min(1.15, Math.max(0, e)) };
  }

  // ---------- 1 コマ描く ----------
  private frame(now: number) {
    const dt = Math.min(0.05, now - (this.t || now));
    this.t = now;
    const adt = this.fx.tick(dt);
    const at = this.fx.at;
    const cv = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(cv.clientWidth * dpr)), h = Math.max(1, Math.round(cv.clientHeight * dpr));
    this.stage.resize(w, h);
    const aspect = w / h;
    const L2 = layoutFor(aspect);
    if (L2.eye[1] !== this.L.eye[1]) { this.L = L2; this.place(0.3); }
    for (let i = 0; i < 3; i++) this.tint[i] += (this.tintTo[i] - this.tint[i]) * Math.min(1, dt * 2);
    const L = this.L;
    const cam = this.fx.cameraPose(L.eye, L.at, L.fov);
    cam.eye[0] += Math.sin(at * 0.25) * 0.35;
    this.eye = cam.eye;
    this.vp = mul(persp(cam.fov, aspect, 0.5, 120), lookAt(cam.eye, cam.at, [0, 1, 0]));

    const cards: CardDraw[] = [];
    const halos: HaloDraw[] = [];
    const ghosts: CardDraw[] = [];
    const pulse = 0.55 + 0.45 * Math.sin(this.t * 5);
    const choosing = this.inter.targets.size > 0 || this.inter.pickable.size > 0;
    for (const o of this.objs) {
      let pose = this.poseNow(o);
      if (o.tween && at >= o.tween.t0 + o.tween.dur) { o.cur = o.tween.to; o.tween = null; pose = o.cur; }
      else if (!o.tween) o.cur = pose;
      const id = o.key.startsWith('c') ? o.face : -1;
      const inField = this.field.includes(o.key);
      const inSpot = this.spot.includes(o.key);
      let p: Vec3 = [...pose.p];
      let q = pose.q;
      if (!o.tween && inField) p[1] += Math.sin(at * 1.3 + o.phase) * 0.05;
      if (!o.tween && inSpot) p[1] += Math.sin(at * 2 + o.phase) * 0.08;
      // 役の札が輪になって回る
      if (inSpot && this.orbitSpot && !o.tween) {
        const i = this.spot.indexOf(o.key), n = this.spot.length;
        const k = at - this.orbitSpot.t0;
        const ang = (i / n) * Math.PI * 2 + k * 3.2 + k * k * 1.5;
        const R = 2.3;
        p = [this.orbitSpot.c[0] + Math.cos(ang) * R, this.orbitSpot.c[1] + Math.sin(ang * 2) * 0.25, this.orbitSpot.c[2] + Math.sin(ang) * R * 0.6];
        q = qMul(qAxis([0, 1, 0], -ang + Math.PI / 2), this.facing(p));
      }
      // こいこい：場の札が渦を巻いて舞い上がる
      if (inField && this.vortex) {
        const k = Math.min(1, (at - this.vortex.t0) / this.vortex.dur);
        const amt = Math.sin(k * Math.PI);
        const ang = ease(k) * Math.PI * 2;
        const rx = p[0], rz = p[2];
        const c = Math.cos(ang), s = Math.sin(ang);
        p = [(rx * c - rz * s) * (1 + amt * 0.5), p[1] + amt * (2.2 + Math.sin(o.phase) * 0.8), (rx * s + rz * c) * (1 + amt * 0.5)];
        q = qMul(qAxis([0, 1, 0], ang * 2), qMul(qAxis([1, 0, 0], amt * 0.9), q));
        if (k >= 1) this.vortex = null;
      }
      // 当たったときの伸び縮み
      let s = pose.s;
      if (o.punch > 0) { s *= 1 + Math.sin(o.punch * Math.PI) * 0.18; o.punch = Math.max(0, o.punch - adt * 3.5); }
      o.seen = { p, q, s: pose.s };
      const m = model(p, q, s);
      let glow: CardDraw['glow'] = [0, 0, 0, 0];
      const isTarget = id >= 0 && this.inter.targets.has(id);
      const isSel = id >= 0 && this.inter.selected === id;
      const isPick = id >= 0 && this.inter.pickable.has(id);
      if (isTarget) glow = [0.3, 0.9, 1.0, pulse];
      else if (isSel) glow = [1.0, 0.8, 0.3, 0.9];
      else if (isPick && this.hand.includes(id)) glow = [0.4, 0.7, 1.0, 0.25];
      if (o.flash > 0) { glow = [1.0, 0.85, 0.4, Math.max(glow[3], o.flash)]; o.flash = Math.max(0, o.flash - dt * 1.2); }
      if (inSpot) glow = [1.0, 0.75, 0.25, 0.4];
      const dimByChoice = choosing && inField && this.inter.targets.size > 0 && !isTarget ? 0.6 : 0;
      const dim = Math.max(dimByChoice, inSpot ? 0 : this.fx.dim);
      cards.push({ m, face: o.face, glow, dim });
      if (isTarget || isSel || inSpot || o.flash > 0.05) halos.push({ m, color: isTarget ? [0.2, 0.75, 1.0, 0.9 * pulse] : [1.0, 0.7, 0.25, 0.9] });
      if (!o.tween && o.key === this.reveal) halos.push({ m, color: [1, 1, 1, 0.5] });
      // 残像：速く動いている札の、少し前の位置
      if (o.tween?.trail && at >= o.tween.t0) {
        o.trail.unshift(m);
        if (o.trail.length > (this.fx.mobile ? 3 : 5)) o.trail.pop();
        o.trail.forEach((tm, i) => { if (i > 0) ghosts.push({ m: tm, face: o.face, glow: [0.4, 0.7, 1.0, 0.6], dim: 0, alpha: 0.32 * (1 - i / 6) }); });
      } else if (o.trail.length) o.trail = [];
    }
    if (this.orbitSpot && this.fx.at - this.orbitSpot.t0 > 6) this.orbitSpot = null;
    cards.sort((a, b) => b.m[14] - a.m[14]);
    const sparkCount = this.fx.sparkData();
    this.stage.draw({
      time: at, vp: this.vp, eye: cam.eye, tint: this.tint, cheer: this.cheer, burst: this.burst, pulse: this.pulse,
      dim: this.fx.dim,
      overlay: { flash: this.fx.flash, flashColor: this.fx.flashColor, speed: this.fx.speedLines, vignette: this.fx.vignette, red: this.fx.red },
      rings: this.fx.rings(), pillars: this.fx.pillars(cam.eye), sparks: this.fx.sparkBuf, sparkCount,
    }, cards, halos, ghosts);
    if (this.sampler) { const f = this.sampler; this.sampler = null; f(this.stage.brightPixels()); }
  }

  // 描けているかの確認（画面テスト用）：明るい点の数
  private sampler: ((n: number) => void) | null = null;
  sample(): Promise<number> { return new Promise((r) => { this.sampler = r; }); }

  // ---------- タップ ----------
  private corners(o: Obj): [number, number][] | null {
    const pose = this.poseNow(o);
    const m = model(pose.p, pose.q, pose.s);
    const pts: [number, number][] = [];
    for (const [x, y] of [[-CW / 2, -CH / 2], [CW / 2, -CH / 2], [CW / 2, CH / 2], [-CW / 2, CH / 2]]) {
      const w: Vec3 = [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13], m[2] * x + m[6] * y + m[14]];
      const s = project(this.vp, w);
      if (!s) return null;
      pts.push(s);
    }
    return pts;
  }

  // 札の画面上の中心（0〜1）。画面テストで使う
  screenOf(id: number): [number, number] | null {
    const o = this.obj(id);
    if (!o || !this.vp.length) return null;
    return project(this.vp, this.poseNow(o).p);
  }

  private pick(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    let best: { id: number; score: number } | null = null;
    for (const id of [...this.inter.pickable, ...this.inter.targets]) {
      const o = this.obj(id);
      if (!o) continue;
      const c = this.corners(o);
      if (!c || !inside(c, x, y)) continue;
      const score = (this.hand.includes(id) ? 10 : 0) + (c[0][1] + c[2][1]) / 2;
      if (!best || score > best.score) best = { id, score };
    }
    if (best) this.onPick(best.id);
  }

  // ---------- 見え方の更新（出来事を順に演出する） ----------
  update(v: View, hooks: EventHooks): Promise<void> {
    this.queue = this.queue.then(() => this.play(v, hooks)).catch((e) => console.error(e));
    return this.queue;
  }

  private async play(v: View, hooks: EventHooks) {
    if (v.round !== this.seenRound) {
      // 新しい月：札を集めて配り直す
      this.seenRound = v.round;
      this.seenEvents = 0;
      this.spot = []; this.reveal = null; this.frozen.clear(); this.orbitSpot = null; this.vortex = null;
      this.fx.camera(null); this.fx.resetOrbit(); this.fx.setDim(0); this.fx.setVignette(0);
      const all = this.objs.map((o) => o.key);
      this.hand = []; this.oppHand = []; this.field = []; this.cap = [[], []];
      this.deck = all;
      this.place(0.4, 0.004);
      hooks.onEvent?.({ k: 'deal', round: v.round, dealer: v.dealer });
      await this.wait(650);
      const fresh = v.events.every((e) => e.k === 'deal');
      this.rebuild(v);
      if (!fresh) {
        // 途中から見る（つなぎ直しなど）：いまの状態をそのまま出す
        this.place(0.5, 0.02);
        this.seenEvents = v.events.length;
        await this.settle();
        return;
      }
      // 配る：札が次々に飛んで、場に落ちるたびに小さく光る
      this.place(0.5, 0.035);
      this.seenEvents = v.events.length;
      await this.wait(300);
      await this.settle();
      return;
    }
    const evs = v.events.slice(this.seenEvents);
    this.seenEvents = v.events.length;
    for (const ev of evs) await this.animate(ev, hooks);
    this.spot = [];
    this.rebuild(v);
    this.place(0.4);
    await this.wait(250);
    await this.settle();
  }

  private async animate(ev: Ev, hooks: EventHooks) {
    hooks.onEvent?.(ev);
    switch (ev.k) {
      case 'play': {
        let o = this.obj(ev.card);
        if (!o) { const k = this.oppHand.pop(); if (k) { o = this.byKey.get(k)!; this.rename(o, `c${ev.card}`, ev.card); } }
        if (!o) return;
        this.hand = this.hand.filter((x) => x !== ev.card);
        this.oppHand = this.oppHand.filter((k) => k !== o!.key);
        await this.land(o, ev.card, ev.took, ev.p, hooks);
        break;
      }
      case 'draw': {
        let o = this.obj(ev.card);
        if (!o) { const k = this.deck.pop(); if (k) { o = this.byKey.get(k)!; this.rename(o, `c${ev.card}`, ev.card); } }
        if (!o) return;
        this.deck = this.deck.filter((k) => k !== o!.key);
        if (this.reveal !== o.key) {
          // 山から回転しながら飛び出し、目の前で止まる。カメラが追いかける
          this.reveal = o.key;
          const L = this.L;
          hooks.onSound?.('whoosh');
          this.fx.speedLines = 1;
          this.fx.camera(L.reveal, 0.22);
          this.move(o, { p: L.reveal, q: this.facing(L.reveal), s: 1.5 }, 0.55, { style: 'pop', arc: 1.2, spin: 2, axis: [0, 0, 1], trail: true });
          await this.wait(560);
          o.punch = 1;
          this.fx.doShake(0.12);
          hooks.onSound?.('flip');
          await this.wait(420);
          this.fx.camera(null);
        }
        if (ev.choosing) return; // 取る札を選ぶまで待つ
        this.reveal = null;
        await this.land(o, ev.card, ev.took, ev.p, hooks);
        break;
      }
      case 'yaku': await this.yakuScene(ev.yaku.flatMap((y) => y.cards), hooks); break;
      case 'koikoi': {
        // 場の札が渦を巻いて舞い上がり、画面が赤く脈打つ
        hooks.onSound?.('koikoi');
        this.vortex = this.fx.lite ? null : { t0: this.fx.at, dur: 1.3 * this.speed };
        this.fx.red = 1;
        this.fx.doShake(0.55);
        this.fx.kick(1);
        this.doBurst();
        this.doPulse();
        for (let i = 0; i < 3; i++) this.fx.ring([0, 0.1, 0], 6 + i * 3, [1, 0.25, 0.3], 0.9, 0.3);
        this.fx.burstSparks([0, 0.3, 0], 160, [1, 0.35, 0.3], 1.4, 1.0);
        await this.wait(1400);
        break;
      }
      case 'end': {
        const r = ev.result;
        if (r.winner != null && r.reason === 'stop') await this.blast(r.winner, hooks);
        else await this.wait(300);
        break;
      }
      default: break;
    }
  }

  // 札を場に叩きつける・合わせて取る
  private async land(o: Obj, card: number, took: number[], p: Player, hooks: EventHooks) {
    const pw = power(card);
    const capPw = took.length ? Math.max(...took.map((c) => power(c).p)) : pw.p;
    if (!took.length) {
      const i = this.field.indexOf(null);
      if (i >= 0) this.field[i] = o.key; else this.field.push(o.key);
      const to: Pose = { p: this.L.field(i >= 0 ? i : this.field.length - 1), q: FACE_UP, s: 1 };
      hooks.onSound?.('whoosh');
      this.move(o, to, 0.55, { style: 'slam', arc: 2.6, spin: 1, trail: true });
      await this.wait(560);
      this.impact(to.p, pw.p * 0.7, pw.color, hooks);
      o.punch = 1;
      await this.wait(200);
      return;
    }
    // 合わせる札の上に叩きつける
    const tgt = took.filter((x) => x !== card).map((x) => this.obj(x)).filter(Boolean) as Obj[];
    const base = tgt[0]?.target.p ?? this.L.field(0);
    const to: Pose = { p: [base[0] + 0.12, base[1] + 0.1, base[2] + 0.08], q: FACE_UP, s: 1 };
    hooks.onSound?.('whoosh');
    this.move(o, to, 0.58, { style: 'slam', arc: 2.4 + capPw * 1.2, spin: capPw >= 0.75 ? 2 : 1, trail: true });
    await this.wait(590);
    this.impact(to.p, capPw, took.map((c) => power(c)).sort((a, b) => b.p - a.p)[0].color, hooks);
    for (const x of [o, ...tgt]) { x.flash = 1; x.punch = 1; }
    await this.wait(260);
    // 取り札へ：はじかれて弧を描く
    this.field = this.field.map((k) => (k && tgt.some((x) => x.key === k) ? null : k));
    this.cap[p].push(o.key, ...tgt.map((x) => x.key));
    const L = this.L;
    const side = p === this.me ? 0 : 1;
    [o, ...tgt].forEach((x, i) => {
      const kind = KIND_ORDER[CARDS[x.face].kind];
      this.move(x, { p: L.cap(side, kind, 20, 21), q: FACE_UP, s: L.capScale }, 0.5, { arc: 1.8, spin: 1, axis: [0, 1, 0], trail: true, delay: i * 0.05 });
    });
    await this.wait(420);
    this.place(0.25);
    await this.wait(150);
  }

  // 叩きつけた瞬間：止まる・衝撃波・火花・揺れ
  private impact(at: Vec3, pw: number, color: Vec3, hooks: EventHooks) {
    hooks.onSound?.(pw >= 0.75 ? 'impactBig' : 'slap');
    this.fx.hitstop(0.05 + pw * 0.07);
    this.fx.ring(at, 2 + pw * 3.5, color, 0.55 + pw * 0.3, 0.16 + pw * 0.1);
    if (pw >= 0.75) this.fx.ring(at, 5 + pw * 4, [1, 1, 1], 0.8, 0.12, 0.6);
    this.fx.burstSparks(at, 30 + pw * 110, color, 0.6 + pw * 0.9);
    this.fx.doShake(0.05 + pw * 0.12, 0.05 + pw * 0.14);
    this.fx.kick(pw * 0.8);
    if (pw >= 0.75) this.fx.doFlash(0.35 * pw, color);
  }

  // 役：暗転とスロー → 札が輪になって回る → 光の柱 → 並んで決め
  private async yakuScene(ids: number[], hooks: EventHooks) {
    const list = [...new Set(ids)].slice(0, 10).map((id) => `c${id}`).filter((k) => this.byKey.has(k));
    const L = this.L;
    const c: Vec3 = [0, (L.spot(0, 1)[1]) * 0.8, L.spot(0, 1)[2] * 0.5];
    hooks.onSound?.('rise');
    this.fx.setDim(0.8);
    this.fx.setVignette(0.85);
    this.fx.slowmo(0.45, 1.1);
    this.fx.camera(c, 0.16);
    this.fx.orbitTo(-0.55, 0.01);
    this.fx.orbitTo(0.55, 2.4);
    this.fx.pillar([0, -0.9, 0], GOLD, 3.2, 18, 2.6);
    this.doPulse();
    this.spot = list;
    if (!this.fx.lite) {
      // 輪の位置へ集まり、回る
      list.forEach((k, i) => {
        const o = this.byKey.get(k)!;
        const ang = (i / list.length) * Math.PI * 2;
        const p: Vec3 = [c[0] + Math.cos(ang) * 2.3, c[1], c[2] + Math.sin(ang) * 2.3 * 0.6];
        this.move(o, { p, q: this.facing(p), s: 1.0 }, 0.5, { style: 'pop', arc: 1.5, spin: 1, trail: true, delay: i * 0.04 });
      });
      await this.wait(560);
      this.orbitSpot = { t0: this.fx.at, c };
      await this.wait(1100);
      this.orbitSpot = null;
      for (const k of list) { const o = this.byKey.get(k)!; o.cur = o.seen; o.target = o.seen; }
    }
    // 並んで決め：閃光・衝撃波・火花・文字
    this.place(0.32, 0.03);
    await this.wait(330);
    this.fx.doFlash(0.7, [1, 0.9, 0.6]);
    this.fx.hitstop(0.12);
    this.fx.kick(1.2);
    this.fx.doShake(0.3);
    this.fx.ring([0, 0, 0], 12, GOLD, 1.2, 0.35);
    this.fx.ring([0, 0, 0], 7, [1, 1, 1], 0.8, 0.2, 0.7);
    this.fx.burstSparks(c, 220, GOLD, 1.2, 0.2);
    for (const k of list) this.byKey.get(k)!.punch = 1;
    hooks.onCue?.('yaku');
    hooks.onSound?.('yaku');
    await this.wait(1500);
    this.spot = [];
    this.fx.setDim(0);
    this.fx.setVignette(0);
    this.fx.camera(null);
    this.fx.resetOrbit();
    this.place(0.5, 0.02);
    await this.wait(450);
  }

  // 勝負（上がり）：一瞬止まって、場の札が吹き飛ぶ
  private async blast(winner: Player, hooks: EventHooks) {
    this.fx.hitstop(0.18);
    await this.wait(120);
    hooks.onSound?.('boom');
    this.fx.doFlash(1, winner === this.me ? [1, 0.85, 0.5] : [1, 0.4, 0.4]);
    this.fx.doShake(0.7, 0.2);
    this.fx.kick(1.5);
    for (let i = 0; i < 4; i++) this.fx.ring([0, 0, 0], 6 + i * 5, i % 2 ? [1, 1, 1] : GOLD, 0.8 + i * 0.25, 0.25, 1);
    this.fx.burstSparks([0, 0.3, 0], 320, winner === this.me ? GOLD : [1, 0.35, 0.35], 2.2, 0.8);
    const flying = [...this.field.filter((k): k is string => !!k), ...this.oppHand];
    for (const k of flying) {
      const o = this.byKey.get(k)!;
      const p = this.poseNow(o).p;
      const a = Math.atan2(p[2] + 0.001, p[0] + 0.001) + (Math.random() - 0.5) * 0.6;
      const d = 9 + Math.random() * 6;
      this.frozen.add(k);
      this.move(o, { p: [Math.cos(a) * d, 2 + Math.random() * 5, Math.sin(a) * d], q: qMul(qAxis([Math.random(), 1, Math.random()], Math.random() * 6), o.cur.q), s: 1 }, 0.9, { style: 'pop', arc: 2, spin: 2 + Math.random() * 2, axis: [Math.random() - 0.5, 1, Math.random() - 0.5], trail: true });
    }
    for (const k of this.cap[winner]) { const o = this.byKey.get(k); if (o) { o.flash = 1; o.punch = 1; } }
    await this.wait(900);
  }

  // 全部の月の終わり：勝てば札が昇って花火、負ければ崩れ落ちる
  async finale(win: boolean) {
    const mine = this.cap[this.me].map((k) => this.byKey.get(k)!).filter(Boolean);
    if (win) {
      mine.forEach((o, i) => {
        this.frozen.add(o.key);
        const a = (i / Math.max(1, mine.length)) * Math.PI * 2;
        this.move(o, { p: [Math.cos(a) * 3, 9 + (i % 5), Math.sin(a) * 2 - 1], q: qMul(qAxis([0, 1, 0], a), FACE_UP), s: 0.8 }, 1.2, { style: 'pop', spin: 2, trail: true, delay: i * 0.03 });
      });
      for (let i = 0; i < 6; i++) {
        await this.wait(380);
        const c: Vec3 = [(Math.random() - 0.5) * 10, 6 + Math.random() * 4, -2 - Math.random() * 3];
        const col: Vec3 = [[1, 0.75, 0.25], [1, 0.35, 0.45], [0.45, 0.8, 1], [0.6, 1, 0.6]][i % 4] as Vec3;
        this.fx.burstSparks(c, 140, col, 1.6, 0.2);
        this.fx.doFlash(0.25, col);
      }
    } else {
      this.fx.setDim(0.5);
      mine.forEach((o, i) => {
        this.frozen.add(o.key);
        const p = this.poseNow(o).p;
        this.move(o, { p: [p[0], -0.8, p[2] + 0.5], q: qMul(qAxis([1, 0, 0], 0.4), FACE_UP), s: o.cur.s }, 1.4, { delay: i * 0.04 });
      });
    }
  }

  pendingPick() { return this.reveal != null; }
}

export interface EventHooks {
  onEvent?: (ev: Ev | { k: 'deal'; round: number; dealer: Player }) => void;
  onSound?: (s: 'slap' | 'flip' | 'whoosh' | 'impactBig' | 'rise' | 'yaku' | 'koikoi' | 'boom') => void;
  onCue?: (name: 'yaku') => void;
}

function inside(c: [number, number][], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = c[i], [bx, by] = c[(i + 1) % 4];
    const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cr !== 0) { if (sign === 0) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false; }
  }
  return true;
}
