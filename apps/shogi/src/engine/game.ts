// 対局の記録と勝ち負けの判定（詰み・投了・時間切れ・千日手・連続王手の千日手・入玉宣言）
import { kifMove, moveName } from './notation';
import { Position, mTo, type Move } from './position';
import { B, K, R, RULESETS, unpromote, type Ruleset } from './rules';

export type Result =
  | { kind: 'checkmate'; winner: 0 | 1 }
  | { kind: 'resign'; winner: 0 | 1 }
  | { kind: 'timeout'; winner: 0 | 1 }
  | { kind: 'repetition' } // 千日手（引き分け）
  | { kind: 'perpetual'; winner: 0 | 1 } // 連続王手の千日手（王手をかけ続けた側の負け）
  | { kind: 'nyugyoku'; winner: 0 | 1 | null }; // 入玉宣言（null は引き分け）

export interface RecordEntry { move: Move; name: string; kif: string; check: boolean; key: number }

export class Game {
  readonly rules: Ruleset;
  readonly startSfen: string;
  pos: Position;
  record: RecordEntry[] = [];
  keys: number[]; // 各局面の印（はじめの局面を含む）
  result: Result | null = null;

  constructor(rules: Ruleset = RULESETS.standard, startSfen = rules.start) {
    this.rules = rules;
    this.startSfen = startSfen;
    this.pos = Position.fromSfen(startSfen, rules);
    this.keys = [this.pos.key];
    this.updateResult();
  }

  static fromMoves(rules: Ruleset, startSfen: string, moves: Move[]): Game {
    const g = new Game(rules, startSfen);
    for (const m of moves) g.play(m);
    return g;
  }

  get moves(): Move[] { return this.record.map((r) => r.move); }
  get lastTo(): number | null { const r = this.record.at(-1); return r ? mTo(r.move) : null; }

  legalMoves(): Move[] { return this.result ? [] : this.pos.legalMoves(); }

  play(m: Move): void {
    if (this.result) throw new Error('対局は終わっています');
    if (!this.pos.isLegal(m)) throw new Error('指せない手です');
    const name = moveName(this.pos, m, this.lastTo);
    const kif = kifMove(this.pos, m, this.lastTo);
    this.pos.make(m);
    const check = this.pos.inCheck();
    this.record.push({ move: m, name, kif, check, key: this.pos.key });
    this.keys.push(this.pos.key);
    this.updateResult();
  }

  // 待った：最後の n 手を戻す
  undo(n = 1): void {
    const moves = this.moves.slice(0, Math.max(0, this.record.length - n));
    const g = Game.fromMoves(this.rules, this.startSfen, moves);
    Object.assign(this, { pos: g.pos, record: g.record, keys: g.keys, result: g.result });
  }

  resign(side: 0 | 1): void { if (!this.result) this.result = { kind: 'resign', winner: side === 0 ? 1 : 0 }; }
  timeout(side: 0 | 1): void { if (!this.result) this.result = { kind: 'timeout', winner: side === 0 ? 1 : 0 }; }

  // 入玉宣言（24 点法）：手番の人が宣言する。条件を満たせば点数で勝ち・引き分け、満たさなければ宣言した側の負け
  declare(): Result {
    const s = this.pos.side;
    const ok = canDeclare(this.pos, s);
    const pts = declarePoints(this.pos, s);
    this.result = !ok ? { kind: 'nyugyoku', winner: s === 0 ? 1 : 0 }
      : pts >= 31 ? { kind: 'nyugyoku', winner: s }
      : pts >= 24 ? { kind: 'nyugyoku', winner: null }
      : { kind: 'nyugyoku', winner: s === 0 ? 1 : 0 };
    return this.result;
  }

  private updateResult() {
    // 指せる手がない ＝ 負け（将棋は「手詰まり」も負け）
    if (!this.pos.hasLegalMove()) {
      this.result = { kind: 'checkmate', winner: this.pos.side === 0 ? 1 : 0 };
      return;
    }
    // 千日手：同じ局面（盤・持ち駒・手番）が 4 回
    const key = this.pos.key;
    const seen = this.keys.reduce((a, k, i) => (k === key ? [...a, i] : a), [] as number[]);
    if (seen.length >= 4) {
      // 最初に現れてからの手のうち、片方の手がすべて王手なら、その側の負け
      const from = seen[0];
      const span = this.record.slice(from);
      for (const s of [0, 1] as const) {
        // record[i] は (i+1) 手目。先手の手は startSide と手数で決まる
        const mine = span.filter((_, k) => this.sideOfMove(from + k) === s);
        if (mine.length && mine.every((r) => r.check)) {
          this.result = { kind: 'perpetual', winner: s === 0 ? 1 : 0 };
          return;
        }
      }
      this.result = { kind: 'repetition' };
    }
  }

  private sideOfMove(i: number): 0 | 1 {
    const startSide = this.startSfen.split(/\s+/)[1] === 'w' ? 1 : 0;
    return ((startSide + i) % 2) as 0 | 1;
  }

  kif(names = ['先手', '後手']): string {
    const lines = ['# まちかど将棋 棋譜', `先手：${names[0]}`, `後手：${names[1]}`, `開始局面：${this.startSfen}`, '手数----指手---------'];
    this.record.forEach((r, i) => lines.push(`${String(i + 1).padStart(4)} ${r.kif}`));
    return lines.join('\n');
  }
}

// ---------- 入玉宣言（24 点法） ----------
// 玉が敵陣にいる・敵陣に玉以外の自分の駒が 10 枚以上・王手がかかっていない
export function canDeclare(p: Position, s: 0 | 1): boolean {
  if (!p.rules.nyugyoku) return false;
  const k = p.kings[s];
  if (k < 0 || !p.inZone(k, s) || p.inCheck(s)) return false;
  let count = 0;
  for (let i = 0; i < p.n; i++) {
    const v = p.board[i];
    if (!v || (v > 0 ? 0 : 1) !== s || Math.abs(v) === K) continue;
    if (p.inZone(i, s)) count++;
  }
  return count >= 10;
}

// 点数：飛・角（成りを含む）は 5 点、ほかは 1 点。敵陣の駒と持ち駒を数える
export function declarePoints(p: Position, s: 0 | 1): number {
  const pt = (t: number) => (unpromote(t) === R || unpromote(t) === B ? 5 : 1);
  let total = 0;
  for (let i = 0; i < p.n; i++) {
    const v = p.board[i];
    if (!v || (v > 0 ? 0 : 1) !== s || Math.abs(v) === K) continue;
    if (p.inZone(i, s)) total += pt(Math.abs(v));
  }
  for (let t = 1; t <= 7; t++) total += p.hands[s][t] * pt(t);
  return total;
}
