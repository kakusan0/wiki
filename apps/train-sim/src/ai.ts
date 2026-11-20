// 自動運転（ほかの路線の列車と、テスト用）：制限・信号・停止位置を守って走る
import { Sim, setNotch, toggleDoor, currentLimit, kmh, nextSignal, aspectOf, EB } from './sim';

export function autopilot(sim: Sim) {
  const R = sim.route;
  if (sim.finished) { setNotch(sim, -4); return; }
  const ns = nextSignal(sim);
  const red = ns && aspectOf(ns.sig, sim) === 'R' ? ns.dist : Infinity;
  if (sim.at >= 0) {
    const st = R.stations[sim.at];
    if (sim.door === 'closed' && !sim.served) toggleDoor(sim);
    else if (sim.door === 'open' && sim.t >= st.dep - 6 && sim.t - sim.doorOpenedAt > 8 && red > 80) toggleDoor(sim);
    else if (sim.door === 'closed' && sim.t >= st.dep && red > 80) setNotch(sim, 3);
    else setNotch(sim, -4);
    return;
  }
  if (sim.next > sim.end) { setNotch(sim, -6); return; }
  const st = R.stations[sim.next];
  // 止まる所：駅の停止位置か、赤信号の 20 m 手前
  const stopAt = Math.min(st.stop, Number.isFinite(red) ? sim.s + red - 20 : Infinity);
  const dist = stopAt - sim.s;
  const atStation = stopAt === st.stop;
  let lim = currentLimit(sim);
  if (ns && ns.sig.kind === 'home' && ns.dist < 700) lim = Math.min(lim, 45);
  // 次の制限の手前で落としておく
  for (const l of R.limits) {
    const d = l.from - sim.s;
    if (d > 0 && d < 400) {
      const vAllowed = Math.sqrt((l.kmh / 3.6) ** 2 + 2 * 0.5 * Math.max(0, d - 20)) * 3.6;
      lim = Math.min(lim, vAllowed);
    }
  }
  const v = kmh(sim.v);
  if (!atStation && dist < 2 && v < 1) { setNotch(sim, -5); return; } // 赤信号の手前で待つ
  const req = (sim.v * sim.v) / (2 * Math.max(0.3, dist - 0.3));
  if (atStation && dist < 0.8) { setNotch(sim, -5); return; }
  if (dist < 450 && req > 0.42) { setNotch(sim, -Math.max(1, Math.min(8, Math.round(req / 0.12 + 0.5)))); return; }
  if (dist < 450 && v < 12) { setNotch(sim, v < 8 ? 1 : 0); return; }
  const target = lim - 3;
  if (v < target - 4) setNotch(sim, 4);
  else if (v < target) setNotch(sim, 0);
  else setNotch(sim, -Math.min(8, Math.ceil((v - target) / 1.5) + 1));
  if (sim.notch === EB) setNotch(sim, -8);
}
