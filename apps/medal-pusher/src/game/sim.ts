// メダルの動き（上から見た 2 次元＋落下の高さ）。上段・下段の 2 つの台と、前後に動くプッシャー
export const R = 0.22; // メダルの半径
export const BALL_R = 0.34;
export const HALF_W = 2.6; // 台の幅の半分
export const UPPER_Y = 1.2;
export const LOWER_Y = 0;
export const U_BACK = -4.3; // 上段の奥
export const U_EDGE = -1.4; // 上段の手前の縁（ここから下段へ落ちる）
export const L_EDGE = 2.6; // 下段の手前の縁（ここから落ちると払い出し）
export const SIDE_OPEN_Z = 1.75; // 下段はここより手前で横が開いている（横に落ちると戻らない）
export const STROKE_T = 3.2; // プッシャーの往復の時間（秒）

export interface Coin {
  id: number;
  x: number; z: number; y: number;
  vx: number; vz: number; vy: number;
  tier: 0 | 1; // 0 上段 1 下段
  falling: boolean;
  ball: boolean;
  spin: number; // 落ちるときの回転
  h: number; // 積み重なりの高さ（見た目）
}

export type SimEvent = { k: 'payout'; ball: boolean } | { k: 'lost'; ball: boolean } | { k: 'landUpper' } | { k: 'drop' };

export class Sim {
  coins: Coin[] = [];
  t = 0;
  private nextId = 1;
  events: SimEvent[] = [];

  // プッシャーの前の面の位置と速さ
  upperFace(t = this.t) { return -4.05 + 0.5 * (1 - Math.cos((t / STROKE_T) * Math.PI * 2)) * 0.95; }
  lowerFace(t = this.t) { return -1.75 + 0.5 * (1 - Math.cos((t / STROKE_T) * Math.PI * 2 + Math.PI)) * 1.25; }

  add(c: Partial<Coin> & { x: number; z: number }): Coin {
    const coin: Coin = { id: this.nextId++, y: UPPER_Y, vx: 0, vz: 0, vy: 0, tier: 0, falling: false, ball: false, spin: 0, h: 0, ...c };
    this.coins.push(coin);
    return coin;
  }

  // 上から落とす（投入・放出）
  drop(x: number, z: number, from = 3.2, vz = 0.6): Coin {
    return this.add({ x, z, y: from, vy: 0, vz, vx: 0, tier: 0, falling: true, spin: 0 });
  }

  step(dt: number) {
    this.t += dt;
    const uf = this.upperFace(), lf = this.lowerFace();
    const ufv = (this.upperFace(this.t + 0.01) - uf) / 0.01, lfv = (this.lowerFace(this.t + 0.01) - lf) / 0.01;
    const keep: Coin[] = [];
    for (const c of this.coins) {
      const r = c.ball ? BALL_R : R;
      if (c.falling) {
        c.vy -= 18 * dt;
        c.y += c.vy * dt; c.x += c.vx * dt; c.z += c.vz * dt;
        c.spin += dt * 9;
        const floor = c.tier === 0 ? UPPER_Y : LOWER_Y;
        // 下段の手前より先・横より外は、床がない
        const offLower = c.tier === 1 && (c.z > L_EDGE || Math.abs(c.x) > HALF_W);
        if (!offLower && c.y <= floor && c.vy < 0) {
          c.y = floor; c.vy = 0; c.falling = false; c.spin = 0;
          if (c.tier === 0) this.events.push({ k: 'landUpper' });
          c.vx *= 0.3; c.vz *= 0.3;
        }
        if (c.y < -2.5) { this.events.push(c.z > L_EDGE ? { k: 'payout', ball: c.ball } : { k: 'lost', ball: c.ball }); continue; }
        keep.push(c);
        continue;
      }
      // 床の上：摩擦
      const fr = Math.exp(-dt * 7);
      c.vx *= fr; c.vz *= fr;
      c.x += c.vx * dt; c.z += c.vz * dt;
      // プッシャー
      const face = c.tier === 0 ? uf : lf, fv = c.tier === 0 ? ufv : lfv;
      if (c.z < face + r) { c.z = face + r; if (fv > 0) c.vz = Math.max(c.vz, fv); }
      // 横の壁
      const walled = c.tier === 0 || c.z < SIDE_OPEN_Z || c.ball;
      if (walled) {
        if (c.x < -HALF_W + r) { c.x = -HALF_W + r; c.vx = Math.abs(c.vx) * 0.2; }
        if (c.x > HALF_W - r) { c.x = HALF_W - r; c.vx = -Math.abs(c.vx) * 0.2; }
      } else if (Math.abs(c.x) > HALF_W) { c.falling = true; c.vx = Math.sign(c.x) * 0.6; }
      // 縁から落ちる
      if (c.tier === 0 && c.z > U_EDGE) { c.falling = true; c.tier = 1; c.vz = Math.max(0.8, c.vz); c.vy = 0; }
      else if (c.tier === 1 && c.z > L_EDGE) { c.falling = true; c.vz = Math.max(0.8, c.vz); c.vy = 0; }
      keep.push(c);
    }
    this.coins = keep;
    this.collide(uf, lf);
  }

  // 重なりをほどく（押す力は少しずつしか伝わらない＝メダルが詰まって重なる）
  private collide(uf: number, lf: number) {
    const cell = 2 * BALL_R;
    for (const tier of [0, 1] as const) {
      const list = this.coins.filter((c) => !c.falling && c.tier === tier);
      const face = tier === 0 ? uf : lf;
      for (const c of list) c.h = 0;
      for (let iter = 0; iter < 3; iter++) {
        const grid = new Map<number, Coin[]>();
        for (const c of list) {
          const k = Math.floor(c.x / cell) * 1000 + Math.floor(c.z / cell);
          const a = grid.get(k); if (a) a.push(c); else grid.set(k, [c]);
        }
        for (const c of list) {
          const gx = Math.floor(c.x / cell), gz = Math.floor(c.z / cell);
          for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
            const a = grid.get((gx + dx) * 1000 + gz + dz);
            if (!a) continue;
            for (const o of a) {
              if (o.id <= c.id) continue;
              const rr = (c.ball ? BALL_R : R) + (o.ball ? BALL_R : R);
              const ddx = o.x - c.x, ddz = o.z - c.z;
              const d2 = ddx * ddx + ddz * ddz;
              if (d2 >= rr * rr || d2 < 1e-9) continue;
              const d = Math.sqrt(d2);
              const over = rr - d;
              const nx = ddx / d, nz = ddz / d;
              // プッシャーに当たっている側は動かない
              const cPin = c.z <= face + (c.ball ? BALL_R : R) + 0.01 ? 1 : 0;
              const oPin = o.z <= face + (o.ball ? BALL_R : R) + 0.01 ? 1 : 0;
              const cw = c.ball ? 0.25 : 1, ow = o.ball ? 0.25 : 1; // ボールは重い
              let wc = cPin ? 0 : cw, wo = oPin ? 0 : ow;
              if (!wc && !wo) { wc = 0.5; wo = 0.5; }
              const s = (over * 0.42) / (wc + wo);
              c.x -= nx * s * wc; c.z -= nz * s * wc;
              o.x += nx * s * wo; o.z += nz * s * wo;
              // 押された向きに少し速さを渡す
              const rv = (o.vx - c.vx) * nx + (o.vz - c.vz) * nz;
              if (rv < 0) { const j = -rv * 0.5; c.vx -= nx * j * wc; c.vz -= nz * j * wc; o.vx += nx * j * wo; o.vz += nz * j * wo; }
              if (iter === 2 && over > rr * 0.1) { if (c.id < o.id) o.h = Math.max(o.h, c.h + 1); }
            }
          }
        }
      }
    }
  }

  fieldCount() { return this.coins.length; }

  // 最初に台にメダルを並べる
  fill(rand: () => number, upper = 46, lower = 104) {
    const place = (tier: 0 | 1, n: number, z0: number, z1: number) => {
      for (let i = 0; i < n; i++) {
        this.add({ x: (rand() * 2 - 1) * (HALF_W - R), z: z0 + rand() * (z1 - z0), y: tier ? LOWER_Y : UPPER_Y, tier });
      }
    };
    place(0, upper, -3.0, U_EDGE - 0.25);
    place(1, lower, -0.3, L_EDGE - 0.35);
    for (let i = 0; i < 240; i++) this.step(1 / 60);
    this.events = [];
  }
}
