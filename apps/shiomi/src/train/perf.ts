// 自動調整：コマ時間を見て、画質の段を上げ下げし 60 FPS を保つ
// 画面のリフレッシュが 60 Hz だと、軽いときもコマ時間は約 16.7 ms で頭打ちになる。
// そのため「余裕があるか」は測れないので、しばらく 60 FPS が続いたら 1 段上げて試し、
// 落ちたらすぐ戻して、その段はしばらく試さない。

export interface Level {
  dpr: number; gtao: boolean; bloom: boolean; samples: number;
  shadowSize: number; shadowFar: number; grass: number; trees: number; treeShadow: number;
}

export const LEVELS: Level[] = [
  { dpr: 2.0, gtao: true, bloom: true, samples: 4, shadowSize: 2048, shadowFar: 700, grass: 190, trees: 380, treeShadow: 160 },
  { dpr: 1.5, gtao: true, bloom: true, samples: 4, shadowSize: 2048, shadowFar: 700, grass: 190, trees: 380, treeShadow: 160 },
  { dpr: 1.25, gtao: false, bloom: true, samples: 4, shadowSize: 2048, shadowFar: 600, grass: 160, trees: 320, treeShadow: 130 },
  { dpr: 1.0, gtao: false, bloom: true, samples: 4, shadowSize: 1024, shadowFar: 500, grass: 120, trees: 260, treeShadow: 100 },
  { dpr: 0.85, gtao: false, bloom: false, samples: 2, shadowSize: 1024, shadowFar: 300, grass: 90, trees: 200, treeShadow: 70 },
  { dpr: 0.7, gtao: false, bloom: false, samples: 2, shadowSize: 1024, shadowFar: 200, grass: 60, trees: 160, treeShadow: 0 },
];

export const SLOW_MS = 18.2; // これより遅いコマが多いと下げる（約 55 FPS）
export const GOOD_MS = 17.4; // これより速ければ 60 FPS が出ている

export class Governor {
  level: number;
  auto: boolean;
  private win: number[] = [];
  private hold = 0; // 段を変えた直後に判断しない時間（秒）
  private goodFor = 0; // 60 FPS が続いている時間（秒）
  private justRaised = -1; // 上げた直後の段（下がったら試すのをやめる）
  private sinceRaise = 0;
  private banned = new Map<number, number>(); // 段 → 試さない残り秒
  private banLen = 30;
  fps = 60;

  constructor(start: number, auto = true) {
    this.level = Math.max(0, Math.min(LEVELS.length - 1, start));
    this.auto = auto;
    this.hold = 2;
  }

  /** 1 コマごとに呼ぶ。段が変わったら新しい段を返す */
  frame(ms: number): number | null {
    if (!(ms > 0) || ms > 250) return null; // 裏に回ったときなど
    this.win.push(ms);
    if (this.win.length > 90) this.win.shift();
    const sec = ms / 1000;
    const avg = this.win.reduce((a, b) => a + b, 0) / this.win.length;
    this.fps = 1000 / avg;
    for (const [k, v] of this.banned) { if (v - sec <= 0) this.banned.delete(k); else this.banned.set(k, v - sec); }
    if (!this.auto) return null;
    if (this.hold > 0) { this.hold -= sec; return null; }
    if (this.justRaised >= 0) this.sinceRaise += sec;
    if (this.win.length < 45) return null;
    const sorted = [...this.win].sort((a, b) => a - b);
    const p70 = sorted[Math.floor(sorted.length * 0.7)];
    if (p70 > SLOW_MS) {
      if (this.level >= LEVELS.length - 1) return null;
      // 上げた直後に落ちたなら、その段はしばらく試さない（何度も落ちるほど長く）
      if (this.justRaised === this.level && this.sinceRaise < 6) {
        this.banned.set(this.level, this.banLen);
        this.banLen = Math.min(600, this.banLen * 2);
      }
      return this.set(this.level + 1);
    }
    if (p70 < GOOD_MS) this.goodFor += sec; else this.goodFor = 0;
    if (this.justRaised >= 0 && this.sinceRaise > 6) this.justRaised = -1;
    if (this.goodFor > 8 && this.level > 0 && !this.banned.has(this.level - 1)) {
      const n = this.set(this.level - 1);
      this.justRaised = n; this.sinceRaise = 0;
      return n;
    }
    return null;
  }

  set(n: number): number {
    this.level = Math.max(0, Math.min(LEVELS.length - 1, n));
    this.win = []; this.hold = 2; this.goodFor = 0;
    return this.level;
  }
}

export function startLevel(coarse: boolean, shortSide: number): number {
  return coarse || shortSide <= 820 ? 3 : 1;
}
