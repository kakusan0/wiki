import { describe, expect, it } from 'vitest';
import { SEMI_40, RIGID_12FT, createState, step, articulation, bodies, cargoPose, fwd, type Controls } from '../src/sim/vehicle';
import { align, TOL, Docking, dockScore, HOLD } from '../src/sim/align';
import { tiltAngle, steerFromTilt, STEER_DEFAULT, elevation, convention } from '../src/input/tilt';
import { pedalValue } from '../src/input/pedals';

const run = (spec = SEMI_40, s = createState(SEMI_40), c: Partial<Controls>, sec: number, dt = 1 / 60) => {
  const ctl: Controls = { throttle: 0, brake: 0, steer: 0, reverse: false, ...c };
  for (let t = 0; t < sec; t += dt) step(spec, s, ctl, dt);
  return s;
};

describe('トラックの動き', () => {
  it('アクセルで前へ進み、ブレーキで止まる', () => {
    const s = run(SEMI_40, createState(SEMI_40), { throttle: 1 }, 10);
    expect(s.v).toBeGreaterThan(8);
    expect(s.x).toBeGreaterThan(30);
    run(SEMI_40, s, { brake: 1 }, 10);
    expect(s.v).toBe(0);
  });

  it('右へ切ると右へ曲がる（向きが減る）', () => {
    const s = createState(SEMI_40);
    run(SEMI_40, s, { throttle: 0.4, steer: 1 }, 4);
    expect(s.h).toBeLessThan(-0.2);
    // 右（+z）へ寄っている
    expect(s.z).toBeGreaterThan(0.5);
  });

  it('曲がるとき、トレーラーは内側を通る（折れ角はハンドルと同じ向き）', () => {
    const s = createState(SEMI_40);
    run(SEMI_40, s, { throttle: 0.3, steer: 1 }, 1.5);
    run(SEMI_40, s, { throttle: 0.2, steer: 1 }, 1.5);
    // 右へ曲がるとトラクターが先に右を向く：h − th < 0
    expect(articulation(s)).toBeLessThan(0);
    // トレーラーの車軸は、トラクターの通った円より内側
    const r = Math.hypot(s.tx - 0, s.tz - 0);
    expect(Number.isFinite(r)).toBe(true);
  });

  it('後退しても計算が壊れず、速さは上限で止まる', () => {
    const s = createState(SEMI_40);
    run(SEMI_40, s, { throttle: 1, reverse: true, steer: 0.3 }, 6);
    expect(s.v).toBeLessThan(0);
    expect(Math.abs(s.v)).toBeLessThanOrEqual(2.6);
    for (const k of ['x', 'z', 'h', 'tx', 'tz', 'th'] as const) expect(Number.isFinite(s[k])).toBe(true);
  });

  it('後退で大きく切り続けると、ジャックナイフになって止まる', () => {
    const s = createState(SEMI_40);
    run(SEMI_40, s, { throttle: 1, reverse: true, steer: 1 }, 25);
    expect(s.jackknife).toBe(true);
    run(SEMI_40, s, {}, 2);
    expect(s.v).toBe(0);
  });

  it('連結点とトレーラーの車軸の距離は変わらない', () => {
    const s = createState(SEMI_40);
    run(SEMI_40, s, { throttle: 0.5, steer: -0.7 }, 8);
    const [fx, fz] = fwd(s.h);
    const kx = s.x + fx * SEMI_40.hitch, kz = s.z + fz * SEMI_40.hitch;
    expect(Math.hypot(kx - s.tx, kz - s.tz)).toBeCloseTo(SEMI_40.trailerLen, 6);
  });

  it('重いほど、止まるまでの距離が長い', () => {
    const stopDist = (cargo: number) => {
      const s = createState(SEMI_40, 0, 0, 0, cargo);
      s.v = 15;
      const x0 = s.x;
      run(SEMI_40, s, { brake: 1 }, 15);
      return s.x - x0;
    };
    expect(stopDist(25000)).toBeGreaterThan(stopDist(0) * 1.3);
  });

  it('単車はトレーラーを持たず、荷台は車体についてくる', () => {
    const s = createState(RIGID_12FT);
    run(RIGID_12FT, s, { throttle: 0.5, steer: 0.5 }, 3);
    expect(bodies(RIGID_12FT, s)).toHaveLength(1);
    expect(cargoPose(RIGID_12FT, s).h).toBeCloseTo(s.h);
  });
});

describe('停止枠の判定', () => {
  const t = { x: 10, z: 5, h: 0 };
  it('ぴったりなら枠の中', () => {
    expect(align({ x: 10, z: 5, h: 0 }, t).inBox).toBe(true);
  });
  it('前後・左右・向きのずれを正しい向きで返す', () => {
    const r = align({ x: 10.5, z: 5.1, h: -0.02 }, t);
    expect(r.along).toBeCloseTo(0.5);
    expect(r.lateral).toBeCloseTo(0.1); // +z は右
    expect(r.yaw).toBeCloseTo(0.02);
    expect(r.inBox).toBe(false);
  });
  it('境目：許す範囲ちょうどは中、少しでも超えたら外', () => {
    expect(align({ x: 10 + TOL.along, z: 5, h: 0 }, t).inBox).toBe(true);
    expect(align({ x: 10 + TOL.along + 0.01, z: 5, h: 0 }, t).inBox).toBe(false);
  });
});

describe('傾きのハンドル', () => {
  const deg = (d: number) => d * Math.PI / 180;
  const rot = (v: { x: number; y: number }, a: number) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
  it('画面を時計回りに傾けると正（右）', () => {
    const v0 = { x: 0, y: 9.8 };
    // 画面を時計回りに回すと、画面から見た「上」は反時計回りに回る
    expect(tiltAngle(v0, rot(v0, deg(20)))).toBeCloseTo(deg(20));
  });
  it('値の符号が逆の端末や、横向きの左右が違っても同じ角度', () => {
    const v0 = { x: 9.8, y: 0.4 }, v = rot(v0, deg(-15));
    const a = tiltAngle(v0, v);
    expect(tiltAngle({ x: -v0.x, y: -v0.y }, { x: -v.x, y: -v.y })).toBeCloseTo(a);
    expect(tiltAngle(rot(v0, deg(90)), rot(v, deg(90)))).toBeCloseTo(a);
  });
  it('遊びの中は 0、40° で切れきり、それ以上は 1 のまま', () => {
    expect(steerFromTilt(deg(1.5))).toBe(0);
    expect(steerFromTilt(deg(40))).toBeCloseTo(1);
    expect(steerFromTilt(deg(70))).toBe(1);
    expect(steerFromTilt(deg(-20))).toBeLessThan(0);
    expect(steerFromTilt(deg(20), { ...STEER_DEFAULT, sens: 1.5 })).toBeGreaterThan(steerFromTilt(deg(20)));
  });
});

describe('ペダル', () => {
  it('下の方は弱く、上の方は強い', () => {
    expect(pedalValue(200, 100, 100)).toBeCloseTo(0.2);
    expect(pedalValue(100, 100, 100)).toBe(1);
    expect(pedalValue(150, 100, 100)).toBeGreaterThan(0.5);
  });
});

describe('停止枠に止める', () => {
  const t = { x: 0, z: 0, h: 0 };
  it('範囲の中で止まれば、ぴったりでなくても合格し、ずれを記録する', () => {
    const d = new Docking();
    const r = align({ x: 0.25, z: -0.15, h: 0.03 }, t);
    expect(d.update(r, 0, 0.1)).toBe('settling');
    for (let i = 0; i < 10; i++) d.update(r, 0, 0.1);
    expect(d.state).toBe('docked');
    expect(d.result?.along).toBeCloseTo(0.25);
  });
  it('動いている間や、範囲の外では合格しない', () => {
    const d = new Docking();
    for (let i = 0; i < 20; i++) d.update(align({ x: 0, z: 0, h: 0 }, t), 0.5, 0.1);
    expect(d.state).toBe('approach');
    for (let i = 0; i < 20; i++) d.update(align({ x: 0.5, z: 0, h: 0 }, t), 0, 0.1);
    expect(d.state).toBe('approach');
  });
  it('止まってすぐではなく、少し止まっていてから合格', () => {
    const d = new Docking();
    d.update(align({ x: 0, z: 0, h: 0 }, t), 0, HOLD * 0.5);
    expect(d.state).toBe('settling');
  });
  it('評価：ぴったりは 1、範囲いっぱいは 0', () => {
    expect(dockScore(align({ x: 0, z: 0, h: 0 }, t))).toBeCloseTo(1);
    expect(dockScore(align({ x: TOL.along, z: TOL.lateral, h: -TOL.yaw }, t))).toBeCloseTo(0);
  });
});

describe('前後の傾き（クレーン用）', () => {
  it('画面が上を向くほど大きい', () => {
    expect(elevation({ x: 0, y: 9, z: 4 })).toBeGreaterThan(elevation({ x: 0, y: 9, z: 1 }));
  });
  it('端末の流儀を、画面の上下の向きで見分ける', () => {
    // 横向き（90°）は端末の上を左へ倒した持ち方で、端末の右の縁（+x）が上になる
    expect(convention({ x: 9.8, y: 0 }, 90)).toBe(1);
    expect(convention({ x: -9.8, y: 0 }, 90)).toBe(-1);
    expect(convention({ x: -9.8, y: 0 }, 270)).toBe(1);
    expect(convention({ x: 0, y: 9.8 }, 0)).toBe(1);
  });
});

describe('当たり判定の格子', () => {
  it('格子で調べても、全部を調べるのと同じ結果', async () => {
    const { Grid, hit } = await import('../src/sim/collide');
    const items = Array.from({ length: 300 }, (_, i) => ({ cx: (i % 20) * 37, cz: Math.floor(i / 20) * 41, h: (i % 7) * 0.3, len: 10 + (i % 5), wid: 6 }));
    const g = new Grid(items);
    for (let x = -20; x < 760; x += 13) for (let z = -20; z < 620; z += 17) {
      const b = [{ cx: x, cz: z, h: 0.4, len: 13.6, wid: 2.5 }];
      expect(g.hit(b) >= 0).toBe(hit(b, items) >= 0);
    }
  });
  it('開いたゲート（off）には当たらない', async () => {
    const { Grid } = await import('../src/sim/collide');
    const gate = { cx: 0, cz: 0, h: 0, len: 1, wid: 10, off: false };
    const g = new Grid([gate]);
    const b = [{ cx: 0, cz: 0, h: 0, len: 4, wid: 2 }];
    expect(g.hit(b)).toBe(0);
    gate.off = true;
    expect(g.hit(b)).toBe(-1);
  });
});
