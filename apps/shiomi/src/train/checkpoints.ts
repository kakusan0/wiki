// チェックポイント：区間ごとに「ここでこの操作をするのが正しい」所を並べ、通ったときに判定する
import { Sim, kmh } from './sim';

export type CpKind = 'depart' | 'call' | 'limit' | 'horn' | 'announce' | 'brake' | 'stop';
export interface Checkpoint {
  id: string;
  kind: CpKind;
  s: number; // 線路の上の位置（判定する所）
  leg: number; // 何番目の駅へ向かう区間か（到着する駅の番号）
  key: string; // 操作のキー
  title: string;
  hint: string;
  result: 'pending' | 'ok' | 'ng';
  detail?: string;
  /** 判定を待つあいだ、少し前から案内を出す距離 */
  lead: number;
}

const SIG_NAME = { home: '場内信号', start: '出発信号', block: '閉塞信号', interlock: '進路の信号' } as const;

export function buildCheckpoints(sim: Sim): Checkpoint[] {
  const R = sim.route, out: Checkpoint[] = [];
  for (let k = sim.start; k < sim.end; k++) {
    const a = R.stations[k], b = R.stations[k + 1];
    const leg = k + 1;
    const push = (c: Omit<Checkpoint, 'result' | 'leg'>) => out.push({ ...c, leg, result: 'pending' });
    push({ id: `dep${k}`, kind: 'depart', s: a.stop, key: 'O・Z', title: `${a.name}を定刻に発車`, hint: '発車時刻が近づいたら O でドアを閉め、出発信号が青になったら Z で加速', lead: 0 });
    for (const sig of R.signals) {
      if (sig.s <= a.stop || sig.s > b.stop) continue;
      push({ id: `sig${sig.s}`, kind: 'call', s: sig.s, key: 'K', title: `${SIG_NAME[sig.kind]}の喚呼`, hint: '信号が見えたら K で喚呼（指差確認）', lead: 300 });
    }
    for (const l of R.limits) {
      if (l.from <= a.stop + 1 || l.from > b.stop) continue;
      push({ id: `lim${l.from}`, kind: 'limit', s: l.from, key: 'X', title: `制限 ${l.kmh} km/h`, hint: `標識までに ${l.kmh} km/h 以下へ。X でブレーキ`, lead: 600 });
    }
    R.whistles.forEach((w, i) => {
      if (w.s <= a.stop || w.s > b.stop) return;
      push({ id: `horn${i}`, kind: 'horn', s: w.s + 220, key: 'H', title: '警笛', hint: '「笛」の標識のところで H で警笛（踏切・トンネルの手前）', lead: 500 });
    });
    if (b.stop - a.stop > 700) push({ id: `ann${k + 1}`, kind: 'announce', s: b.stop - 250, key: 'A', title: '車内放送', hint: `${b.name}の 1.4 km〜250 m 手前で A を押して到着の案内`, lead: 1150 });
    push({ id: `brk${k + 1}`, kind: 'brake', s: b.stop - 330, key: 'X', title: 'ブレーキをかけ始める', hint: 'このあたりで B3〜B4。速さに合わせて強さを変える', lead: 250 });
    push({ id: `stop${k + 1}`, kind: 'stop', s: b.stop, key: 'X・O', title: `${b.name}の停止位置`, hint: '黄色の「2」に先頭を合わせて止め、O でドアを開ける（±1 m で合格）', lead: 400 });
  }
  return out.sort((x, y) => (x.leg - y.leg) || (x.s - y.s) || (x.kind === 'depart' ? -1 : 0));
}

/** 毎コマ：通ったチェックポイントを判定して、新しく判定したものを返す */
export function judgeCheckpoints(cps: Checkpoint[], sim: Sim): Checkpoint[] {
  const done: Checkpoint[] = [];
  const legOf = (st: number) => (sim.leg.station === st ? sim.leg : sim.legs.find((l) => l.station === st));
  for (const c of cps) {
    if (c.result !== 'pending') continue;
    let r: 'ok' | 'ng' | null = null;
    switch (c.kind) {
      case 'depart': {
        const l = legOf(c.leg);
        if (l && l.depErr !== null) { r = l.depErr >= -2 && l.depErr <= 10 ? 'ok' : 'ng'; c.detail = `${l.depErr >= 0 ? '+' : ''}${Math.round(l.depErr)} 秒`; }
        break;
      }
      case 'stop': {
        const l = legOf(c.leg);
        if (l && l.posErr !== null) { r = Math.abs(l.posErr) <= 1 ? 'ok' : 'ng'; c.detail = `${l.posErr >= 0 ? '+' : ''}${l.posErr.toFixed(2)} m`; }
        break;
      }
      default:
        if (sim.s < c.s) break;
        if (c.kind === 'call') r = sim.called.has(c.id) ? 'ok' : 'ng';
        else if (c.kind === 'limit') { const lim = Number(c.id.slice(3)); const lm = sim.route.limits.find((l) => l.from === lim)!; r = kmh(sim.v) <= lm.kmh + 1 ? 'ok' : 'ng'; c.detail = `${Math.round(kmh(sim.v))} km/h`; }
        else if (c.kind === 'horn') r = sim.horned.has(Number(c.id.slice(4))) ? 'ok' : 'ng';
        else if (c.kind === 'announce') r = sim.announced ? 'ok' : 'ng';
        else if (c.kind === 'brake') { r = sim.notch < 0 || kmh(sim.v) < 40 ? 'ok' : 'ng'; c.detail = `${Math.round(kmh(sim.v))} km/h`; }
    }
    if (r) { c.result = r; done.push(c); }
  }
  return done;
}

/** いま案内するチェックポイント（いちばん近い未判定のもの） */
export function nextCheckpoint(cps: Checkpoint[], sim: Sim): Checkpoint | null {
  for (const c of cps) if (c.result === 'pending') return c;
  void sim;
  return null;
}
