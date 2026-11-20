// 連動：平面交差・合流・同じ線路を、2 本の列車が同時に使わないようにする
// 列車が区間の手前（950 m 以内）に来て、発車できる状態なら、空いていれば進路を渡す（早い者勝ち）。
// 最後尾が区間を抜けたら返す。進路を持たない列車の信号は赤になる。
import { Route, TRAIN_LEN, HIKARI } from '../route';
import { Sim } from '../sim';
import { ZONES, AOBA, mainToAoba, DIAMOND } from './network';

export type RangeKey = 'hikari' | 'aoba' | 'saza' | 'main4';
export interface TrainRef {
  id: string;
  key: RangeKey;
  /** 先頭の位置（その経路の s） */
  s(): number;
  /** 進む向き（main4 の列車は s が減る向きに走る） */
  dir: 1 | -1;
  /** 区間へ入れる状態か（駅で発車を待っている間は進路を取らない） */
  ready(): boolean;
  /** 次に止まる駅の停止位置（ないときは Infinity）。区間の手前で止まる列車には、まだ進路を渡さない */
  nextStop(): number;
  /** 走り終えた（車庫へ入った）列車は、区間を返す */
  gone(): boolean;
  sim?: Sim;
}

// 信号の手前で ATS のパターンが効き始める前（信号の 700 m 手前より前）に進路を取る
const APPROACH = 950;

export class Interlock {
  trains: TrainRef[] = [];
  holder = new Map<string, string>();

  add(t: TrainRef) { this.trains.push(t); }
  remove(id: string) {
    this.trains = this.trains.filter((t) => t.id !== id);
    for (const [z, h] of this.holder) if (h === id) this.holder.delete(z);
  }
  clear() { this.trains = []; this.holder.clear(); }

  /** 毎コマ：返す・渡す */
  update() {
    for (const z of ZONES) {
      const h = this.holder.get(z.id);
      if (h) {
        const t = this.trains.find((x) => x.id === h);
        const r = t && z.ranges[t.key];
        if (!t || !r || t.gone()) { this.holder.delete(z.id); continue; }
        const s = t.s();
        const tail = s - t.dir * TRAIN_LEN;
        const passed = t.dir > 0 ? tail > r[1] : tail < r[0];
        if (passed) this.holder.delete(z.id); else continue;
      }
      // 渡す相手：区間にいちばん近い、発車できる列車
      let best: TrainRef | null = null, bestD = Infinity;
      for (const t of this.trains) {
        const r = z.ranges[t.key];
        if (!r || t.gone()) continue;
        const s = t.s();
        const dist = t.dir > 0 ? r[0] - s : s - r[1]; // 区間の入口までの距離（負なら中にいる）
        const tail = s - t.dir * TRAIN_LEN;
        const inside = t.dir > 0 ? s >= r[0] && tail <= r[1] : s <= r[1] && tail >= r[0];
        if (inside) { best = t; bestD = -Infinity; break; } // 中にいる列車が最優先
        if (dist > APPROACH || dist < 0 || !t.ready() || t.gone()) continue;
        const ns = t.nextStop();
        if (t.dir > 0 && ns < r[0] - 1) continue; // 区間の手前の駅に止まる
        if (dist < bestD) { bestD = dist; best = t; }
      }
      if (best) this.holder.set(z.id, best.id);
    }
  }

  /** その列車が区間を使ってよいか */
  free(zoneId: string, who: unknown): boolean {
    const h = this.holder.get(zoneId);
    if (!h) return false; // まだ誰にも渡していない：手前で待つ（渡されると青になる）
    const t = this.trains.find((x) => x.id === h);
    return !!t && (t.sim === who || t === who);
  }
}

export const ILK = new Interlock();

/** 信号に連動の現示をつなぐ（起動時に一度） */
export function wireSignals() {
  const H = HIKARI.signals, A = AOBA.signals;
  const startDep = (r: Route, i: number, sim: Sim, t: number) => t >= r.stations[i].dep - 10 || sim.route !== r;
  for (const sig of H) {
    if (sig.kind === 'home' && sig.station === 1) sig.dyn = (w) => (ILK.free('diamond', w) ? 'Y' : 'R');
    if (sig.kind === 'start' && sig.station === 1) sig.dyn = (w, t) => (startDep(HIKARI, 1, w as Sim, t) && ILK.free('merge', w) ? 'G' : 'R');
    if (sig.kind === 'block' && sig.s === 3000) sig.dyn = (w) => (ILK.free('merge', w) ? 'G' : 'R');
  }
  for (const sig of A) {
    if (sig.kind === 'interlock') sig.dyn = (w) => (ILK.free('diamond', w) ? 'G' : 'R');
    if (sig.kind === 'start' && sig.station === 1) sig.dyn = (w, t) => (startDep(AOBA, 1, w as Sim, t) && ILK.free('merge', w) ? 'Y' : 'R');
    if (sig.kind === 'block' && Math.abs(sig.s - mainToAoba(3000)) < 1) sig.dyn = (w) => (ILK.free('merge', w) ? 'G' : 'R');
  }
  void DIAMOND;
}

/** Sim の列車を連動に登録する */
export function simRef(id: string, sim: Sim): TrainRef {
  const key = (sim.route.track ?? sim.route.id) as RangeKey;
  return {
    id, key, dir: 1, sim,
    s: () => sim.s,
    ready: () => sim.finished ? false : sim.at < 0 || sim.t >= sim.route.stations[sim.at].dep - 15,
    nextStop: () => (sim.at >= 0 ? Infinity : sim.next <= sim.end ? sim.route.stations[sim.next].stop : Infinity),
    // 終点に着いた列車は、25 秒後に車庫へ入る（それまではホームをふさいでいる）
    gone: () => sim.finished && sim.t - sim.finishedAt > 25,
  };
}
