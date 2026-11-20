// 列車を自分で運転していない間（トラックに乗っている間）の鉄道：
// 3 路線の列車が時刻表どおりに自動で走り、走り終えたら少しあとにまた走る。すれ違う下りの列車も出る。
// 信号と踏切は、その列車の位置で動く。
import * as THREE from 'three';
import { HIKARI, TRACK_GAP, TRAIN_LEN, CROSSINGS, type Route } from '../train/route';
import { ROUTES, AOBA, aobaToMain } from '../train/net/network';
import { ILK, simRef, wireSignals, type TrainRef } from '../train/net/interlock';
import { createSim, step, aspectOf, type Sim } from '../train/sim';
import { autopilot } from '../train/ai';
import { makeTrain, type TrainView } from '../train/train';
import { updateSignal, type TrackWorld } from '../train/world/track';
import type { LinesWorld } from '../train/world/lines';

interface Ai { sim: Sim; view: TrainView; doneT: number; id: string; route: Route; restT: number; }
interface Oncoming { view: TrainView; s: number; v: number; ref: TrainRef; }

/** 平面交差（あおば線と交わる所）の、下りの列車にとっての手前の位置 */
const DIAMOND_S = 1868;
/** 下りの列車が出てくる間隔（秒） */
const ONCOMING_EVERY = 240;
/** 走り終えた列車が、次にまた走り出すまでの秒数 */
const REST = 60;

export class Railway {
  private ais: Ai[] = [];
  private oncoming: Oncoming[] = [];
  private dummies = new Map<string, Sim>();
  private nextOncoming = 30;
  private serial = 0;
  /** ゲームの中の時刻（秒） */
  t: number;

  /** make：列車の形を作る（テストでは形のない代わりを渡す） */
  constructor(private parent: THREE.Object3D, private track: TrackWorld, private lines: LinesWorld, private finalize: (o: THREE.Object3D) => void, t0: number,
    private make: (color?: string) => TrainView = makeTrain) {
    this.t = t0;
    wireSignals();
    ILK.clear();
    for (const r of ROUTES) {
      this.dummies.set(r.id, createSim('normal', r));
      this.spawn(r);
    }
  }

  private spawn(r: Route) {
    const sim = createSim('normal', r);
    sim.t = Math.max(sim.t, this.t);
    const view = this.make(r.color);
    this.parent.add(view.group); this.finalize(view.group);
    const id = `ai-${r.id}-${this.serial++}`;
    this.ais.push({ sim, view, doneT: 0, id, route: r, restT: 0 });
    ILK.add(simRef(id, sim));
  }

  private spawnOncoming(ps: number) {
    const view = this.make();
    this.parent.add(view.group); this.finalize(view.group);
    const o: Oncoming = { view, s: ps, v: 21, ref: null as unknown as TrainRef };
    o.ref = { id: `oncoming-${this.serial++}`, key: 'main4', dir: -1, s: () => o.s, ready: () => true, nextStop: () => -Infinity, gone: () => o.s < -250 };
    ILK.add(o.ref);
    this.oncoming.push(o);
  }

  update(dt: number) {
    this.t += dt;
    ILK.update();
    // 時刻表で走る列車
    for (const a of [...this.ais]) {
      if (a.sim.finished) {
        a.doneT += dt;
        if (a.doneT > 25 && a.view.group.visible) { a.view.group.visible = false; ILK.remove(a.id); } // 車庫へ
        if (!a.view.group.visible && (a.restT += dt) > REST) {
          this.parent.remove(a.view.group);
          this.ais.splice(this.ais.indexOf(a), 1);
          this.spawn(a.route);
        }
        continue;
      }
      const sub = Math.ceil(dt / (1 / 60));
      for (let i = 0; i < sub; i++) { autopilot(a.sim); step(a.sim, dt / sub); }
      a.sim.events.length = 0;
      a.view.place(a.sim.s, 0, false, a.sim.route.path);
    }
    for (const d of this.dummies.values()) d.t = this.t;
    // すれ違う下りの列車（ひかり野線の右の線路を、山ノ口から潮見台へ）
    if ((this.nextOncoming -= dt) <= 0) { this.nextOncoming = ONCOMING_EVERY; this.spawnOncoming(5700); }
    for (const o of [...this.oncoming]) {
      const wait = o.s > DIAMOND_S && o.s - DIAMOND_S < 260 && !ILK.free('diamond', o.ref);
      const target = wait ? Math.max(0, Math.min(21, Math.sqrt(Math.max(0, 2 * 0.8 * (o.s - DIAMOND_S - 25))))) : 21;
      o.v += Math.max(-1.0 * dt, Math.min(0.6 * dt, target - o.v));
      o.s -= o.v * dt;
      o.view.place(o.s, TRACK_GAP, true);
      if (o.s < -250) {
        this.parent.remove(o.view.group);
        ILK.remove(o.ref.id);
        this.oncoming.splice(this.oncoming.indexOf(o), 1);
      }
    }
    // 信号
    const whoFor = (r: Route) => this.ais.find((a) => a.route === r && a.view.group.visible)?.sim ?? this.dummies.get(r.id)!;
    for (const sv of this.track.signals) updateSignal(sv, aspectOf(sv.sig, whoFor(HIKARI)));
    for (const sv of this.lines.signals) updateSignal(sv, aspectOf(sv.sig, whoFor(sv.route)));
    // 踏切
    const ph = Math.floor(this.t * 1.6) % 2;
    this.track.crossings.forEach((c, i) => {
      const active = this.crossingActive(i);
      for (const arm of c.arms) arm.rotation.x += ((active ? 0 : Math.PI / 2 * 0.96) - arm.rotation.x) * Math.min(1, dt * 2.4);
      c.lights.forEach((pair) => pair.forEach((m, k) => { m.emissiveIntensity = active && k === ph ? 7 : 0; }));
    });
  }

  /** ひかり野線の線路の上にいる上りの列車の、先頭の位置 */
  private mainTrains(): number[] {
    const out: number[] = [];
    for (const a of this.ais) {
      if (!a.view.group.visible || a.sim.finished && a.doneT > 25) continue;
      if (a.route === HIKARI) out.push(a.sim.s);
      else if (a.route === AOBA) { const m = aobaToMain(a.sim.s); if (m !== null) out.push(m); }
    }
    return out;
  }

  /** 確かめる用：いま走っている列車 */
  debug() {
    return { t: Math.round(this.t), ais: this.ais.map((a) => ({ id: a.id, s: Math.round(a.sim.s), v: Math.round(a.sim.v), vis: a.view.group.visible, fin: a.sim.finished })), oncoming: this.oncoming.map((o) => Math.round(o.s)) };
  }

  /** i 番目の踏切が鳴っているか（列車が近い） */
  crossingActive(i: number): boolean {
    const s = CROSSINGS[i].s;
    return this.mainTrains().some((m) => m > s - 420 && m - TRAIN_LEN < s + 4)
      || this.oncoming.some((o) => o.s < s + 420 && o.s + TRAIN_LEN > s - 4);
  }

  /** i 番目の踏切の上に、いま列車がいるか */
  onCrossing(i: number): boolean {
    const s = CROSSINGS[i].s;
    return this.mainTrains().some((m) => m > s - 4 && m - TRAIN_LEN < s + 4)
      || this.oncoming.some((o) => o.s < s + 4 && o.s + TRAIN_LEN > s - 4);
  }
}
