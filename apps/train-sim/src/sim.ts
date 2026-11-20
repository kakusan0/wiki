// 運転のしくみ（画面に依存しない）。テストしやすいよう純粋な計算だけを置く。
import { TRAIN_LEN, limitAt, Signal, Route, HIKARI } from './route';

export const EB = -9; // 非常
export const NOTCH_MIN = EB, NOTCH_MAX = 5;
export const notchLabel = (n: number) => (n === EB ? '非常' : n > 0 ? `P${n}` : n < 0 ? `B${-n}` : 'N');

export type Aspect = 'G' | 'Y' | 'R';
export type Door = 'open' | 'closing' | 'closed' | 'opening';
export type Mode = 'easy' | 'normal';

export interface LegScore {
  station: number;
  posErr: number | null; // m（正＝行き過ぎ）
  arrErr: number | null; // 秒（正＝遅れ）
  depErr: number | null;
  pos: number; time: number; comfort: number;
  bonus: number; penalty: number;
  notes: string[];
}

export interface SimEvent { type: string; text?: string; value?: number; }

export interface Sim {
  route: Route;
  /** 出発駅と到着駅（駅の番号）。途中の駅から途中の駅までの運転もできる */
  start: number; end: number;
  mode: Mode;
  t: number; s: number; v: number; a: number;
  notch: number; brake: number; power: number; // 実際のブレーキの効き（m/s²）
  door: Door; doorT: number;
  at: number; // いまいる駅（停車中）または -1
  next: number; // 次に止まる駅
  sigLimit: number; // 最後に通った信号による制限（km/h）
  passedSig: number; // 通った信号の数
  ats: 'off' | 'warn' | 'brake'; atsT: number;
  legs: LegScore[]; leg: LegScore;
  called: Set<string>; announced: boolean; horned: Set<number>;
  stoppedAt: number | null; // 止まった時刻
  served: boolean; // いまの駅でドアを開けたか
  doorOpenedAt: number;
  jerk: number; lastA: number;
  finished: boolean;
  finishedAt: number;
  events: SimEvent[];
  odo: number;
}

const newLeg = (station: number): LegScore => ({
  station, posErr: null, arrErr: null, depErr: null, pos: 0, time: 0, comfort: 20, bonus: 0, penalty: 0, notes: [],
});

export function createSim(mode: Mode = 'normal', route: Route = HIKARI, start = 0, end = route.stations.length - 1): Sim {
  start = Math.max(0, Math.min(route.stations.length - 2, start));
  end = Math.max(start + 1, Math.min(route.stations.length - 1, end));
  const st = route.stations[start];
  return {
    route, start, end, mode, t: st.arr, s: st.stop, v: 0, a: 0, notch: -4, brake: 0.5, power: 0,
    door: 'open', doorT: 0, at: start, next: start + 1, sigLimit: route.maxKmh, passedSig: route.signals.filter((x) => x.s <= st.stop).length,
    ats: 'off', atsT: 0, legs: [], leg: newLeg(start + 1), called: new Set(), announced: false, horned: new Set(),
    stoppedAt: st.arr, served: true, doorOpenedAt: st.arr - 20, jerk: 0, lastA: 0, finished: false, finishedAt: 0,
    events: [], odo: 0,
  };
}

export const kmh = (v: number) => v * 3.6;

export function aspectOf(sig: Signal, sim: Sim): Aspect {
  if (sig.dyn) return sig.dyn(sim, sim.t);
  if (sig.kind === 'block' || sig.kind === 'interlock') return 'G';
  if (sig.kind === 'home') return 'Y';
  const st = sim.route.stations[sig.station!];
  // 出発信号：発車 10 秒前に青。それまでは赤
  if (sim.t >= st.dep - 10) return 'G';
  return 'R';
}

export function nextSignal(sim: Sim): { sig: Signal; dist: number } | null {
  for (const sig of sim.route.signals) if (sig.s > sim.s) return { sig, dist: sig.s - sim.s };
  return null;
}

/** 列車全体がかかっている区間の制限速度（最後尾が抜けるまで） */
export function trackLimit(s: number, route: Route = HIKARI): number {
  let v = limitAt(s, route.limits, route.maxKmh);
  for (const l of route.limits) if (l.from < s && l.to > s - TRAIN_LEN) v = Math.min(v, l.kmh);
  return v;
}

export function currentLimit(sim: Sim): number {
  return Math.min(trackLimit(sim.s, sim.route), sim.sigLimit);
}

/** 赤信号に向けた速度の上限（ATS のパターン）m/s */
export function patternSpeed(dist: number): number {
  return Math.sqrt(2 * 0.9 * Math.max(0, dist - 8));
}

/** いまの減速度のまま止まるまでの距離 */
export function brakingDistance(sim: Sim): number {
  const b = sim.brake + 9.8 * sim.route.path.gradeAt(sim.s);
  if (sim.v < 0.05) return 0;
  if (b <= 0.02) return Infinity;
  return (sim.v * sim.v) / (2 * b);
}

function emit(sim: Sim, type: string, text?: string, value?: number) { sim.events.push({ type, text, value }); }

export function setNotch(sim: Sim, n: number) {
  n = Math.max(NOTCH_MIN, Math.min(NOTCH_MAX, n));
  if (n === sim.notch) return;
  sim.notch = n;
  emit(sim, 'notch', notchLabel(n), n);
}
export function stepNotch(sim: Sim, d: number) {
  if (sim.notch === EB && d > 0) return setNotch(sim, -8);
  if (sim.notch === -8 && d < 0) return setNotch(sim, EB);
  setNotch(sim, sim.notch + d);
}

export function toggleDoor(sim: Sim) {
  if (sim.finished) return;
  if (sim.door === 'closed') {
    if (sim.v > 0.01 || sim.at < 0) return emit(sim, 'msg', '駅の停止位置で止まってから開けます');
    sim.door = 'opening'; sim.doorT = 0; sim.doorOpenedAt = sim.t; sim.served = true; emit(sim, 'door-open');
    const st = sim.route.stations[sim.at];
    if (sim.leg.station === sim.at && sim.leg.posErr === null) {
      const err = sim.s - st.stop;
      sim.leg.posErr = err;
      sim.leg.pos = Math.max(0, Math.round(50 - Math.max(0, Math.abs(err) - 0.5) * 8));
      const arr = (sim.stoppedAt ?? sim.t) - st.arr;
      sim.leg.arrErr = arr;
      sim.leg.time = Math.max(0, Math.round(30 - Math.max(0, Math.abs(arr) - 3)));
      emit(sim, 'stop-result', undefined, sim.at);
      if (sim.at === sim.end) finish(sim);
    }
  } else if (sim.door === 'open') {
    if (sim.t - sim.doorOpenedAt < 8) return emit(sim, 'msg', 'お客さまの乗り降りを待っています');
    sim.door = 'closing'; sim.doorT = 0; emit(sim, 'door-close');
  }
}

function finish(sim: Sim) {
  sim.finished = true;
  sim.finishedAt = sim.t;
  sim.legs.push(sim.leg);
  emit(sim, 'finish');
}

/** 喚呼（指差確認）。対象があれば加点 */
export function pointCall(sim: Sim): string | null {
  const ns = nextSignal(sim);
  if (ns && ns.dist < 300) {
    const key = `sig${ns.sig.s}`;
    const asp = aspectOf(ns.sig, sim);
    const name = ns.sig.kind === 'home' ? '場内' : ns.sig.kind === 'start' ? '出発' : '閉塞';
    const word = asp === 'G' ? '進行' : asp === 'Y' ? '注意' : '停止';
    const text = `${name}${word}！`;
    if (!sim.called.has(key)) { sim.called.add(key); sim.leg.bonus += 2; emit(sim, 'call', text, 2); }
    else emit(sim, 'call', text, 0);
    return text;
  }
  for (const l of sim.route.limits) {
    const d = l.from - sim.s;
    if (d > 0 && d < 250) {
      const key = `lim${l.from}`;
      const text = `制限 ${l.kmh}！`;
      if (!sim.called.has(key)) { sim.called.add(key); sim.leg.bonus += 2; emit(sim, 'call', text, 2); }
      else emit(sim, 'call', text, 0);
      return text;
    }
  }
  if (sim.next < (sim.end + 1)) {
    const d = sim.route.stations[sim.next].stop - sim.s;
    if (d > 0 && d < 400) {
      const key = `stop${sim.next}`;
      const text = '停車！';
      if (!sim.called.has(key)) { sim.called.add(key); sim.leg.bonus += 2; emit(sim, 'call', text, 2); }
      else emit(sim, 'call', text, 0);
      return text;
    }
  }
  emit(sim, 'msg', 'いまは確かめるものがありません');
  return null;
}

/** 車内放送 */
export function announce(sim: Sim): boolean {
  if (sim.next >= (sim.end + 1) || sim.at >= 0) return false;
  const st = sim.route.stations[sim.next];
  const d = st.stop - sim.s;
  const last = sim.next === sim.end;
  const tr = st.transfer ? `${st.transfer}は、お乗り換えです。` : '';
  const text = `まもなく${st.name}、${st.name}です。${last ? '終点です。' : ''}${tr}お出口は${st.side === 'R' ? '右' : '左'}側です。`;
  if (d > 250 && d < 1400 && !sim.announced) {
    sim.announced = true; sim.leg.bonus += 5; emit(sim, 'announce', text, 5); return true;
  }
  emit(sim, 'announce', text, 0);
  return false;
}

export function horn(sim: Sim) {
  const W = sim.route.whistles;
  for (let i = 0; i < W.length; i++) {
    const d = sim.s - W[i].s;
    if (d > -30 && d < 220 && !sim.horned.has(i)) { sim.horned.add(i); sim.leg.bonus += 3; emit(sim, 'horn', '警笛 OK', 3); return; }
  }
  emit(sim, 'horn');
}

export function step(sim: Sim, dt: number) {
  if (sim.finished) { sim.t += dt; return; }
  sim.t += dt;

  // ドア
  if (sim.door === 'opening' || sim.door === 'closing') {
    sim.doorT += dt;
    if (sim.doorT >= 3) {
      sim.door = sim.door === 'opening' ? 'open' : 'closed';
      if (sim.door === 'closed') emit(sim, 'pilot-on');
    }
  }

  // ブレーキ指令
  let target = 0;
  if (sim.notch < 0) target = sim.notch === EB ? 1.4 : -sim.notch * 0.12;
  if (sim.ats === 'brake') target = 1.4;
  if (sim.door !== 'closed' && target < 0.36) target = 0.36; // ドアが開いている間は止めておく
  const lag = target > sim.brake ? 0.8 : 1.1;
  sim.brake += (target - sim.brake) * Math.min(1, dt / lag);

  // 力行
  let pTarget = 0;
  if (sim.notch > 0 && sim.door === 'closed' && sim.ats !== 'brake') {
    const aMax = sim.v < 11 ? 0.78 : 0.78 * (11 / sim.v);
    pTarget = (sim.notch / 5) * aMax;
  }
  sim.power += (pTarget - sim.power) * Math.min(1, dt / 0.6);
  const power = sim.power;
  const res = 0.012 + 0.00005 * sim.v * sim.v;
  const g = 9.8 * sim.route.path.gradeAt(sim.s);
  let a = power - g - (sim.v > 0.01 || power > 0 ? res : 0);
  const brakeA = sim.brake;
  let v = sim.v + (a - brakeA) * dt;
  if (sim.v <= 0.0001 && power <= brakeA + g && v <= 0) v = 0; // 止まっている
  if (v < 0) {
    v = 0;
  }
  const wasMoving = sim.v > 0.05;
  const aReal = (v - sim.v) / Math.max(dt, 1e-6);
  sim.jerk += (Math.abs(aReal - sim.lastA) / Math.max(dt, 1e-6) - sim.jerk) * Math.min(1, dt / 0.4);
  sim.lastA = aReal;
  sim.a = aReal;
  sim.v = v;
  sim.s += v * dt;
  sim.odo += v * dt;

  // 乗り心地：大きな揺れ
  if (sim.v > 1 && sim.jerk > 2.0) sim.leg.comfort = Math.max(0, sim.leg.comfort - 1.2 * dt);

  // 停止したとき
  if (wasMoving && sim.v <= 0.05) {
    sim.v = 0;
    if (brakeA > 0.75) { sim.leg.comfort = Math.max(0, sim.leg.comfort - 6); sim.leg.notes.push('停止時の衝撃が大きい'); emit(sim, 'jolt'); }
    else if (brakeA > 0.5) { sim.leg.comfort = Math.max(0, sim.leg.comfort - 2); }
    sim.stoppedAt = sim.t;
    if (sim.next < (sim.end + 1)) {
      const err = sim.s - sim.route.stations[sim.next].stop;
      if (err > -60 && err < 30) {
        if (Math.abs(err) <= 10) { sim.at = sim.next; emit(sim, 'arrive', sim.route.stations[sim.at].name, err); }
        else emit(sim, 'msg', err < 0 ? `停止位置まで あと ${(-err).toFixed(1)} m` : `${err.toFixed(1)} m 行き過ぎ`);
      }
    }
  }

  // 発車（ドアを開けた駅からだけ。開ける前の位置直しは発車にしない）
  if (sim.at >= 0 && sim.v > 0.3) {
    if (!sim.served) { sim.at = -1; }
    else {
      const st = sim.route.stations[sim.at];
      const late = sim.t - st.dep;
      if (sim.at > sim.start) { sim.legs.push(sim.leg); sim.leg = newLeg(sim.at + 1); }
      sim.leg.depErr = late;
      if (late < -2) { sim.leg.penalty += 10; sim.leg.notes.push('早発'); }
      emit(sim, 'depart', st.name, late);
      sim.next = sim.at + 1; sim.at = -1; sim.served = false;
      sim.announced = false;
    }
  }
  // 次の駅を止まらずに過ぎた
  if (sim.at < 0 && sim.next < (sim.end + 1) && sim.s > sim.route.stations[sim.next].stop + 30) {
    sim.leg.notes.push('停車駅を通過'); sim.leg.penalty += 30; sim.leg.posErr = sim.s - sim.route.stations[sim.next].stop;
    emit(sim, 'overrun', sim.route.stations[sim.next].name);
    sim.legs.push(sim.leg);
    sim.next++;
    sim.leg = newLeg(sim.next);
    if (sim.next >= (sim.end + 1)) { sim.finished = true; sim.finishedAt = sim.t; emit(sim, 'finish'); }
  }

  // 信号の通過
  const SIG = sim.route.signals;
  while (sim.passedSig < SIG.length && SIG[sim.passedSig].s <= sim.s) {
    const sig = SIG[sim.passedSig];
    const asp = aspectOf(sig, sim);
    if (asp === 'R') {
      sim.leg.penalty += 30; sim.leg.notes.push('赤信号を越えた'); sim.ats = 'brake'; sim.atsT = 0;
      emit(sim, 'ats-brake', '停止信号を越えました');
    }
    sim.sigLimit = asp === 'Y' ? (sig.caution ? 35 : 45) : sim.route.maxKmh;
    emit(sim, 'pass-signal', asp);
    sim.passedSig++;
  }

  // ATS
  const lim = currentLimit(sim);
  const sp = kmh(sim.v);
  const ns = nextSignal(sim);
  let patternOver = false;
  if (ns && aspectOf(ns.sig, sim) === 'R' && ns.dist < 700) {
    const pv = patternSpeed(ns.dist);
    if (sim.v > pv + 0.3) patternOver = true;
  }
  const easy = sim.mode === 'easy';
  if (sim.ats === 'brake') {
    sim.atsT += dt;
    if ((sp < lim - 3 && !patternOver && sim.atsT > 2) || sim.v === 0) {
      if (sim.v === 0 || sp < lim - 3) { sim.ats = 'off'; emit(sim, 'ats-release'); }
    }
  } else if (patternOver || sp > lim + (easy ? 12 : 8)) {
    sim.ats = 'brake'; sim.atsT = 0; sim.leg.penalty += 10; sim.leg.notes.push('ATS が作動');
    emit(sim, 'ats-brake', patternOver ? '停止信号の手前で止まれません' : '速度超過');
  } else if (sp > lim + 1) {
    if (sim.ats !== 'warn') { sim.ats = 'warn'; sim.atsT = 0; emit(sim, 'ats-warn'); }
    sim.atsT += dt;
    sim.leg.penalty += dt * (easy ? 0.3 : 1);
    if (sim.atsT > (easy ? 6 : 4)) {
      sim.ats = 'brake'; sim.atsT = 0; sim.leg.penalty += 10; sim.leg.notes.push('ATS が作動'); emit(sim, 'ats-brake', '速度超過');
    }
  } else if (sim.ats === 'warn') { sim.ats = 'off'; emit(sim, 'ats-off'); }
}

export function legTotal(l: LegScore): number {
  return Math.max(0, Math.round(l.pos + l.time + l.comfort + l.bonus - l.penalty));
}
export function totalScore(sim: Sim): number {
  return sim.legs.reduce((a, l) => a + legTotal(l), 0);
}
export function rank(sim: Sim): string {
  const max = (sim.end - sim.start) * 100;
  const r = totalScore(sim) / max;
  return r >= 0.95 ? 'S' : r >= 0.8 ? 'A' : r >= 0.6 ? 'B' : r >= 0.4 ? 'C' : 'D';
}
