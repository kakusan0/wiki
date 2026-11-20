// 台のルール：投入・チャッカー・スロット・ボール・星図ルーレット・帆ゲージ・ジャックポット・メダルの出入り
import { HALF_W, R, Sim, UPPER_Y, type Coin } from './sim';

export const CHUCKERS = [-1.7, 0, 1.7]; // チャッカーの横の位置
export const CHUCKER_W = 0.3; // 入る幅（中心から）
export const SYMBOLS = ['星', '波', '船', '貝', '月'] as const;
export type Pocket = 'wave' | 'star' | 'sail' | 'treasure';
// ルーレットのポケット（12 個、時計回り）
export const POCKETS: Pocket[] = ['wave', 'star', 'wave', 'sail', 'wave', 'star', 'wave', 'star', 'wave', 'sail', 'wave', 'treasure'];
export const POCKET_INFO: Record<Pocket, { name: string; color: string }> = {
  wave: { name: '波', color: '#5CE1E6' }, star: { name: '星', color: '#7B5CE6' }, sail: { name: '帆', color: '#E8513A' }, treasure: { name: '宝', color: '#F5C542' },
};
export const SAIL_MAX = 7;
export const JP_BASE = 500;
export const STOCK_MAX = 4;
export const INSERT_INTERVAL = 0.18; // 連続投入の間隔（秒）

export type GameEvent =
  | { k: 'insert' }
  | { k: 'chucker'; index: number }
  | { k: 'slotStart'; reach: boolean }
  | { k: 'slotStop'; reels: string[]; win: boolean }
  | { k: 'ball' }
  | { k: 'rouletteStart' }
  | { k: 'roulette'; pocket: Pocket; index: number; amount: number }
  | { k: 'sail'; gauge: number }
  | { k: 'jackpot'; amount: number }
  | { k: 'payout'; n: number }
  | { k: 'lost' };

export interface Records { maxWallet: number; jackpots: number; inserted: number; best: number }
export interface SaveData {
  v: 1; wallet: number; pool: number; gauge: number; stock: number; records: Records;
  coins: [number, number, number, number][]; // x, z, tier, ball
  balls?: number; // ルーレット待ちのボール
}

export class Game {
  sim = new Sim();
  wallet = 300;
  pool = JP_BASE;
  gauge = 0;
  stock = 0; // スロットの保留
  records: Records = { maxWallet: 300, jackpots: 0, inserted: 0, best: 0 };
  events: GameEvent[] = [];
  // スロット
  slot: { t: number; dur: number; reels: string[]; win: boolean; reach: boolean } | null = null;
  // ルーレット
  roulette: { t: number; dur: number; index: number; pocket: Pocket } | null = null;
  rouletteQueue = 0;
  private spill: { n: number; t: number }[] = []; // 上から流れ込むメダル
  private lastInsert = -1;
  private poolFrac = 0;
  private rand: () => number;

  constructor(rand: () => number = Math.random, save?: SaveData | null) {
    this.rand = rand;
    if (save && save.v === 1) {
      Object.assign(this, { wallet: save.wallet, pool: save.pool, gauge: save.gauge, stock: save.stock, rouletteQueue: save.balls ?? 0, records: { ...this.records, ...save.records } });
      for (const [x, z, tier, ball] of save.coins) this.sim.add({ x, z, tier: tier as 0 | 1, y: tier ? 0 : UPPER_Y, ball: !!ball });
    } else this.sim.fill(rand);
  }

  // チャッカーの扉：時間で開いたり閉じたり
  gateOpen(i: number, t = this.sim.t) { return Math.sin(t * 2.4 + i * 2.1) > -0.1; }

  canInsert() { return this.wallet > 0 && this.sim.t - this.lastInsert >= INSERT_INTERVAL; }

  // メダルを入れる。aim は -1〜1（左〜右）
  insert(aim: number): boolean {
    if (!this.canInsert()) return false;
    this.wallet--;
    this.lastInsert = this.sim.t;
    this.records.inserted++;
    this.addPool(0.06);
    const x = Math.max(-1, Math.min(1, aim)) * (HALF_W - R - 0.05) + (this.rand() - 0.5) * 0.12;
    this.events.push({ k: 'insert' });
    // チャッカーの真上で扉が開いていれば、入る
    const ci = CHUCKERS.findIndex((cx) => Math.abs(cx - x) < CHUCKER_W);
    if (ci >= 0 && this.gateOpen(ci)) {
      this.events.push({ k: 'chucker', index: ci });
      this.addPool(0.3);
      if (this.stock < STOCK_MAX) this.stock++;
      return true;
    }
    this.sim.drop(x, -3.0 + this.rand() * 0.5, 3.2, 0.9);
    return true;
  }

  private addPool(n: number) { this.poolFrac += n; const w = Math.floor(this.poolFrac); this.pool += w; this.poolFrac -= w; }

  update(dt: number) {
    this.sim.step(dt);
    for (const e of this.sim.events) {
      if (e.k === 'payout') {
        if (e.ball) { this.rouletteQueue++; this.events.push({ k: 'ball' }); }
        else { this.wallet++; this.events.push({ k: 'payout', n: 1 }); }
      } else if (e.k === 'lost') {
        if (e.ball) { this.rouletteQueue++; this.events.push({ k: 'ball' }); }
        else { this.addPool(0.2); this.events.push({ k: 'lost' }); }
      }
    }
    this.sim.events = [];
    if (this.wallet > this.records.maxWallet) this.records.maxWallet = this.wallet;
    this.updateSlot(dt);
    this.updateRoulette(dt);
    // 流れ込むメダル（1 秒に 20 枚）
    for (const s of this.spill) {
      s.t += dt;
      while (s.n > 0 && s.t >= 0.05) { s.t -= 0.05; s.n--; this.sim.drop((this.rand() * 2 - 1) * (HALF_W - 0.4), -3.1 + this.rand() * 0.9, 3.6, 0.7); }
    }
    this.spill = this.spill.filter((s) => s.n > 0);
  }

  // メダルを台の上に流し込む（多いぶんは直接もらえる）
  private payToField(n: number, maxOnField = 60) {
    const onField = Math.min(n, maxOnField);
    if (onField) this.spill.push({ n: onField, t: 0 });
    this.wallet += n - onField;
    if (n - onField > 0) this.events.push({ k: 'payout', n: n - onField });
  }

  private updateSlot(dt: number) {
    if (!this.slot && this.stock > 0 && !this.roulette) {
      this.stock--;
      const win = this.rand() < 1 / 14;
      const sym = () => SYMBOLS[Math.floor(this.rand() * SYMBOLS.length)];
      let reels: string[];
      if (win) { const s = sym(); reels = [s, s, s]; }
      else {
        reels = [sym(), sym(), sym()];
        if (reels[0] === reels[1] && reels[1] === reels[2]) reels[2] = SYMBOLS[(SYMBOLS.indexOf(reels[2] as never) + 1) % SYMBOLS.length];
        if (this.rand() < 0.25) reels[1] = reels[0]; // はずれのリーチ
      }
      const reach = reels[0] === reels[1];
      this.slot = { t: 0, dur: reach ? 3.2 : 1.8, reels, win, reach };
      this.events.push({ k: 'slotStart', reach });
    }
    if (this.slot) {
      this.slot.t += dt;
      if (this.slot.t >= this.slot.dur) {
        const s = this.slot;
        this.slot = null;
        this.events.push({ k: 'slotStop', reels: s.reels, win: s.win });
        if (s.win) {
          // ボールが上段に落ちてくる＋ 少しメダル
          this.sim.drop(0, -2.6, 4.0, 0.4).ball = true;
          this.payToField(8);
        }
      }
    }
  }

  private updateRoulette(dt: number) {
    if (!this.roulette && this.rouletteQueue > 0) {
      this.rouletteQueue--;
      // 宝は出にくく、波は出やすい
      const weights: Record<Pocket, number> = { wave: 1, star: 0.8, sail: 1.1, treasure: 0.9 };
      const total = POCKETS.reduce((a, p) => a + weights[p], 0);
      let r = this.rand() * total, index = 0;
      for (let i = 0; i < POCKETS.length; i++) { r -= weights[POCKETS[i]]; if (r <= 0) { index = i; break; } }
      this.roulette = { t: 0, dur: 4.2, index, pocket: POCKETS[index] };
      this.events.push({ k: 'rouletteStart' });
    }
    if (this.roulette) {
      this.roulette.t += dt;
      if (this.roulette.t >= this.roulette.dur) {
        const { pocket, index } = this.roulette;
        this.roulette = null;
        let amount = 0;
        if (pocket === 'wave') amount = 10;
        else if (pocket === 'star') amount = 30;
        else if (pocket === 'sail') { amount = 5; this.gauge++; this.events.push({ k: 'sail', gauge: this.gauge }); }
        else amount = this.rand() < 0.25 ? -1 : 40; // -1 = ジャックポット
        if (amount === -1 || this.gauge >= SAIL_MAX) { this.jackpot(); amount = Math.max(amount, 0); }
        this.events.push({ k: 'roulette', pocket, index, amount });
        if (amount > 0) this.payToField(amount);
      }
    }
  }

  jackpot() {
    const amount = this.pool;
    this.pool = JP_BASE;
    this.gauge = 0;
    this.records.jackpots++;
    this.records.best = Math.max(this.records.best, amount);
    this.events.push({ k: 'jackpot', amount });
    this.payToField(amount, 120);
  }

  // メダルをもらう（毎日の配給など）
  give(n: number) { this.wallet += n; if (this.wallet > this.records.maxWallet) this.records.maxWallet = this.wallet; }

  save(): SaveData {
    return {
      v: 1, wallet: this.wallet + this.spill.reduce((a, s) => a + s.n, 0), pool: this.pool, gauge: this.gauge,
      stock: Math.min(STOCK_MAX, this.stock + (this.slot ? 1 : 0)), balls: this.rouletteQueue + (this.roulette ? 1 : 0), records: this.records,
      coins: this.sim.coins.filter((c) => !c.falling || c.y > -0.5).map((c: Coin) => [round(c.x), round(c.z), c.tier, c.ball ? 1 : 0]),
    };
  }
}

const round = (n: number) => Math.round(n * 1000) / 1000;
