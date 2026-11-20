import { describe, expect, it } from 'vitest';
import { decide } from '../src/game/ai';
import { MAPS, getMap } from '../src/game/maps';
import {
  adjacencyMult, buyQuote, canBuyout, fee, feeRate, investCap, investRoom, streetInvestRoom, netWorth, salary, sellQuote, stockPrice, topHolder,
} from '../src/game/rules';
import type { GameState } from '../src/game/state';
import { apply, newGame } from '../src/game/turn';

const players = [
  { name: 'あなた', cpu: null },
  { name: 'CPU1', cpu: 'normal' as const },
  { name: 'CPU2', cpu: 'normal' as const },
  { name: 'CPU3', cpu: 'normal' as const },
];
const game = (mode: 'easy' | 'normal' = 'normal', mapId = 'corner') => newGame({ mapId, mode, seed: 1, players });
const shopsOf = (s: GameState, street: number) => getMap(s.mapId).squares.filter((q) => q.kind === 'shop' && q.street === street).map((q) => q.id);
const own = (s: GameState, sq: number, pid: number) => { s.props[sq]!.owner = pid; };
// sq のひとつ手前（分かれ道でないマス）に、sq へ向かう向きで立たせる。サイコロ 1 で sq に止まる
const standBefore = (s: GameState, sq: number) => {
  const m = getMap(s.mapId);
  const w = m.links[sq].find((v) => m.links[v].length === 2)!;
  s.players[0].pos = w;
  s.players[0].prev = m.links[w].find((v) => v !== sq)!;
};

describe('利用料', () => {
  it('ふつう：所有数で 15/25/35% 、独占で +10%', () => {
    const s = game();
    const [a, b, c] = shopsOf(s, 0);
    own(s, a, 1);
    expect(feeRate(s, a)).toBeCloseTo(0.15);
    own(s, b, 1);
    expect(feeRate(s, a)).toBeCloseTo(0.25);
    own(s, c, 1);
    expect(feeRate(s, a)).toBeCloseTo(0.45); // 3 軒 35% ＋ 独占 10%
    expect(fee(s, a)).toBe(Math.round(s.props[a]!.value * 0.45));
  });
  it('かんたん：隣が同じ持ち主なら ×1.5、両隣なら ×2', () => {
    const s = game('easy');
    own(s, 1, 1);
    expect(adjacencyMult(s, 1)).toBe(1);
    own(s, 2, 1);
    expect(adjacencyMult(s, 1)).toBe(1.5);
    own(s, 5, 2); own(s, 6, 2); own(s, 9, 3);
    expect(adjacencyMult(s, 6)).toBe(1.5);
    expect(feeRate(s, 2)).toBeCloseTo(0.3);
  });
  it('持ち主がお休み中なら 0', () => {
    const s = game();
    own(s, 1, 1);
    s.players[1].closed = true;
    expect(fee(s, 1)).toBe(0);
  });
});

describe('増資の上限', () => {
  it('基本価格 ×（1＋所有数×0.5）、独占で ×3', () => {
    const s = game();
    const [a, b, c] = shopsOf(s, 2); // 3 軒の通り
    const base = getMap('corner').squares[a].base!;
    own(s, a, 0);
    expect(investCap(s, a)).toBe(base * 1.5);
    own(s, b, 0);
    expect(investCap(s, a)).toBe(base * 2);
    own(s, c, 0);
    expect(investCap(s, a)).toBe(base * 3);
  });
  it('増資の余地：上限 − いまの価値。通りではお店ごとの合計', () => {
    const s = game();
    const [a, b, c] = shopsOf(s, 2);
    const base = getMap('corner').squares[a].base!;
    expect(investRoom(s, a)).toBe(0); // 持ち主なし
    own(s, a, 0); own(s, b, 1);
    expect(investRoom(s, a)).toBe(investCap(s, a) - s.props[a]!.value);
    s.props[a]!.value = investCap(s, a); // 上限まで増資した
    expect(investRoom(s, a)).toBe(0);
    expect(streetInvestRoom(s, 2)).toBe(investRoom(s, b));
    expect(investRoom(s, c)).toBe(0);
    void base;
  });
  it('かんたんでは増資できない', () => {
    const s = game('easy');
    own(s, 1, 0);
    expect(investCap(s, 1)).toBe(0);
  });
});

describe('株', () => {
  it('株価 ＝（10＋通りの価値÷40）× 需給', () => {
    const s = game();
    const value = shopsOf(s, 0).reduce((a, q) => a + s.props[q]!.value, 0);
    expect(stockPrice(s, 0)).toBe(Math.round(10 + value / 40));
    s.demand[0] = 1.5;
    expect(stockPrice(s, 0)).toBe(Math.round((10 + value / 40) * 1.5));
  });
  it('買ってすぐ売っても得をしない', () => {
    const s = game();
    for (const lots of [1, 5, 20]) {
      const b = buyQuote(s, 0, lots);
      const after = { ...s, demand: s.demand.map((d, i) => (i === 0 ? b.demand : d)) };
      expect(sellQuote(after, 0, lots).gain).toBeLessThanOrEqual(b.cost);
    }
  });
  it('筆頭株主は 50 株以上の単独 1 位', () => {
    const s = game();
    s.players[1].shares[0] = 40;
    expect(topHolder(s, 0)).toBeNull();
    s.players[1].shares[0] = 60;
    expect(topHolder(s, 0)).toBe(1);
    s.players[2].shares[0] = 60;
    expect(topHolder(s, 0)).toBeNull();
  });
  it('配当と筆頭株主ボーナスが入る', () => {
    let s = game();
    const sq = shopsOf(s, 0)[0];
    own(s, sq, 1);
    s.players[2].shares[0] = 100;
    standBefore(s, sq);
    // サイコロが 1 になる種を探す
    for (let seed = 0; seed < 500; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      const u = apply(t, { type: 'roll' });
      if (u.dice === 1) { s = t; break; }
    }
    const before = s.players[2].cash;
    const f = fee(s, sq);
    const after = apply(s, { type: 'roll' });
    expect(after.players[2].cash - before).toBe(50 + Math.round(f * 0.1));
  });
  it('株を買えるのは銀行に止まった番と両替所に止まった番だけ（ほかのマスでは買えない）', () => {
    const m = getMap('corner');
    const s = game();
    s.phase = 'stock';
    s.players[0].pos = m.squares.find((q) => q.kind === 'shop')!.id; // お店のマスで止まった番
    expect(() => apply(s, { type: 'buyStock', street: 0, lots: 1 })).toThrow();
    s.bankTouched = true; // 銀行を通っただけ（いまは銀行にいない）でも、ターンの終わりには買えない
    expect(() => apply(s, { type: 'buyStock', street: 0, lots: 1 })).toThrow();
    s.players[0].pos = 0; // 銀行に止まった番
    const raw = buyQuote(s, 0, 1).cost;
    const t = apply(s, { type: 'buyStock', street: 0, lots: 1 });
    expect(t.players[0].shares[0]).toBe(10);
    expect(s.players[0].cash - t.players[0].cash).toBe(raw); // 手数料はない
    expect(t.demand[0]).toBeCloseTo(1.02);
    s.players[0].pos = m.squares.find((q) => q.kind === 'lot')!.id;
    s.exchangeTouched = true; // 両替所に止まった番
    expect(apply(s, { type: 'buyStock', street: 0, lots: 1 }).players[0].shares[0]).toBe(10);
  });
  it('売るのは、銀行以外でもできる', () => {
    const s = game();
    s.phase = 'stock';
    s.players[0].pos = 1;
    s.players[0].shares[0] = 20;
    expect(apply(s, { type: 'sellStock', street: 0, lots: 1 }).players[0].shares[0]).toBe(10);
  });
  it('サイコロを振る前（ターンの途中）は買えない', () => {
    const s = game();
    expect(() => apply(s, { type: 'buyStock', street: 0, lots: 1 })).toThrow();
  });
});

describe('買収', () => {
  it('4 倍で買い、7 割が持ち主へ', () => {
    const s = game();
    const [a] = shopsOf(s, 2);
    own(s, a, 1);
    s.players[0].cash = 5000;
    s.phase = 'decide';
    s.pending = { kind: 'buyout', sq: a };
    const v = s.props[a]!.value;
    const t = apply(s, { type: 'buyout' });
    expect(t.props[a]!.owner).toBe(0);
    expect(t.players[0].cash).toBe(5000 - v * 4);
    expect(t.players[1].cash).toBe(s.players[1].cash + v * 4 * 0.7);
  });
  it('独占された通りの店は買収できない', () => {
    const s = game();
    for (const q of shopsOf(s, 2)) own(s, q, 1);
    s.players[0].cash = 99999;
    expect(canBuyout(s, shopsOf(s, 2)[0], 0)).toBe(false);
  });
});

describe('昇格と勝利', () => {
  it('スタンプ 4 つで銀行に戻ると昇格して給料', () => {
    let s = game();
    s.players[0].stamps = [true, true, true, true];
    standBefore(s, 0);
    const cash = s.players[0].cash;
    s = apply(s, { type: 'roll' });
    expect(s.players[0].level).toBe(1);
    expect(s.players[0].cash).toBeGreaterThanOrEqual(cash + salary(1) - 200);
    expect(salary(1)).toBe(260);
  });
  it('目標に届いて銀行を通ると勝ち', () => {
    let s = game();
    s.players[0].cash = 9000;
    standBefore(s, 0);
    s = apply(s, { type: 'roll' });
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
    expect(s.overReason).toBe('target');
  });
});

describe('破産と自動の競売', () => {
  // 1 の目で sq に止まる状態を作る
  const rollOne = (s: GameState) => {
    for (let seed = 0; seed < 1000; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      if (apply(t, { type: 'roll' }).dice === 1) return apply(t, { type: 'roll' });
    }
    throw new Error('not found');
  };
  it('利用料が払えないと、安いお店から自動で競売。入札がなければ銀行が 75% で買い取り、まだ足りなければ破産', () => {
    const s = game();
    const sq = shopsOf(s, 3)[0];
    own(s, sq, 1);
    s.props[sq]!.value = 2000;
    const mine = shopsOf(s, 0)[0];
    own(s, mine, 0);
    s.players[0].cash = 0;
    standBefore(s, sq);
    let u = rollOne(s);
    expect(u.phase).toBe('auction');
    expect(u.auction).toMatchObject({ sq: mine, seller: 0, forced: true, leader: null });
    while (u.phase === 'auction') u = apply(u, { type: 'pass' }); // 全員降りる
    expect(u.props[mine]!.owner).toBeNull();
    expect(u.players[0].bankrupt).toBe(true);
    expect(u.phase).toBe('over');
    expect(u.overReason).toBe('bankrupt');
    expect(u.winner).toBe(1);
  });
  it('自動の競売で落札されて足りたら、元の場面（ターンの終わり）に戻る', () => {
    const s = game();
    const sq = shopsOf(s, 3)[0];
    own(s, sq, 1);
    s.props[sq]!.value = 300; // 利用料 45G
    const mine = shopsOf(s, 0)[0];
    own(s, mine, 0);
    s.players[0].cash = 10;
    standBefore(s, sq);
    let u = rollOne(s);
    expect(u.phase).toBe('auction');
    expect(u.auction!.resume.phase).toBe('stock');
    const first = u.auction!.bidder;
    u = apply(u, { type: 'bid', raise: 50 }); // 最低価格 +40G で入札
    while (u.phase === 'auction') u = apply(u, { type: 'pass' });
    expect(u.props[mine]!.owner).toBe(first);
    expect(u.players[0].cash).toBeGreaterThanOrEqual(0);
    expect(u.phase).toBe('stock');
    expect(u.turn).toBe(0);
  });
});

describe('自分で競売に掛ける', () => {
  const ready = () => {
    const s = game();
    const sq = shopsOf(s, 1)[0];
    own(s, sq, 0);
    s.props[sq]!.value = 200;
    s.phase = 'stock';
    return { s, sq };
  };
  it('せり上げで一番高い人が落札し、代金は売り手へ', () => {
    const { s, sq } = ready();
    let t = apply(s, { type: 'auction', sq });
    expect(t.auction).toMatchObject({ seller: 0, min: 100, bidder: 1, active: [1, 2, 3] });
    t = apply(t, { type: 'bid', raise: 10 }); // 1 番：100G
    expect(t.auction).toMatchObject({ price: 100, leader: 1, bidder: 2 });
    t = apply(t, { type: 'bid', raise: 50 }); // 2 番：150G
    t = apply(t, { type: 'pass' }); // 3 番：降りる
    expect(t.auction).toMatchObject({ bidder: 1, active: [1, 2] });
    t = apply(t, { type: 'bid', raise: 100 }); // 1 番：250G
    t = apply(t, { type: 'pass' }); // 2 番：降りる → 1 番が落札
    expect(t.phase).toBe('stock');
    expect(t.props[sq]!.owner).toBe(1);
    expect(t.players[1].cash).toBe(s.players[1].cash - 250);
    expect(t.players[0].cash).toBe(s.players[0].cash + 250);
  });
  it('だれも入札しなければ、銀行が価値の 75% で買い取る', () => {
    const { s, sq } = ready();
    let t = apply(s, { type: 'auction', sq });
    while (t.phase === 'auction') t = apply(t, { type: 'pass' });
    expect(t.props[sq]!.owner).toBeNull();
    expect(t.players[0].cash).toBe(s.players[0].cash + 150);
  });
  it('人のお店・現金を超える入札・競売中のほかの操作は弾く', () => {
    const { s, sq } = ready();
    const other = shopsOf(s, 2)[0];
    own(s, other, 1);
    expect(() => apply(s, { type: 'auction', sq: other })).toThrow();
    let t = apply(s, { type: 'auction', sq });
    t.players[1].cash = 50;
    expect(() => apply(t, { type: 'bid', raise: 10 })).toThrow(); // 100G 払えない
    expect(() => apply(t, { type: 'endTurn' })).toThrow();
    expect(() => apply(t, { type: 'bid', raise: 30 })).toThrow(); // 上げ幅は 10・50・100 だけ
  });
});

describe('CPU だけで 100 試合', () => {
  it('例外・無限ループ・お金の矛盾がない', { timeout: 180_000 }, () => {
    const reasons: Record<string, number> = {};
    for (let g = 0; g < 100; g++) {
      const mapId = MAPS[g % MAPS.length].id;
      const mode = g % 4 === 0 ? 'easy' : 'normal';
      const levels = (['easy', 'normal', 'hard'] as const);
      let s = newGame({
        mapId, mode, seed: 1000 + g, maxRounds: 80,
        players: [0, 1, 2, 3].map((i) => ({ name: `CPU${i}`, cpu: levels[(g + i) % 3] })),
      });
      let steps = 0;
      while (s.phase !== 'over') {
        s = apply(s, decide(s));
        if (++steps > 20000) throw new Error(`game ${g} が終わらない`);
        for (const p of s.players) {
          // 競売中の売り手（お金が足りずに自動で掛けた）だけは、一時的にマイナスのことがある
          if (!p.bankrupt && !(s.phase === 'auction' && s.auction?.seller === p.id)) expect(p.cash).toBeGreaterThanOrEqual(0);
          for (const n of p.shares) expect(n % 10 === 0 && n >= 0 && n <= 500).toBe(true);
        }
        for (const d of s.demand) expect(d >= 0.5 - 1e-9 && d <= 1.8 + 1e-9).toBe(true);
        s.props.forEach((pr, i) => {
          if (pr?.owner != null && getMap(mapId).squares[i].kind === 'shop') {
            expect(pr.value).toBeLessThanOrEqual(getMap(mapId).squares[i].base! * 3);
          }
        });
      }
      expect(s.winner).not.toBeNull();
      expect(netWorth(s, s.winner!)).toBeGreaterThan(0);
      reasons[s.overReason!] = (reasons[s.overReason!] ?? 0) + 1;
    }
    console.log('終わり方', reasons);
  });
});

describe('分かれ道', () => {
  // サイコロの目が n になる乱数の種を探す
  const withDice = (s: GameState, n: number) => {
    for (let seed = 0; seed < 1000; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      if (apply(t, { type: 'roll' }).dice === n) return t;
    }
    throw new Error('not found');
  };
  it('分かれ道で止まって方向を選び、残りの歩数だけ進む', () => {
    const m = getMap('corner');
    const fork = m.squares.find((q) => m.links[q.id].length === 3 && q.y === 0)!; // 上の分かれ道（パンのスタンプ）
    let s = game();
    const before = m.links[fork.id].find((v) => m.squares[v].y === 0 && m.squares[v].x < fork.x)!;
    s.players[0].pos = before;
    s.players[0].prev = m.links[before].find((v) => v !== fork.id)!;
    s = withDice(s, 3);
    s = apply(s, { type: 'roll' });
    expect(s.phase).toBe('decide');
    expect(s.pending).toMatchObject({ kind: 'direction', sq: fork.id });
    const opts = (s.pending as { options: number[] }).options;
    expect(opts).toHaveLength(2);
    expect(opts).not.toContain(before); // 後ろには戻れない
    expect(() => apply(s, { type: 'move', to: before })).toThrow();
    const down = opts.find((v) => m.squares[v].y === 1)!;
    const t = apply(s, { type: 'move', to: down });
    expect(t.players[0].pos).toBe(m.links[down].find((v) => v !== fork.id));
    expect(t.players[0].prev).toBe(down);
    expect(t.moving).toBeNull();
  });
  it('はじめの銀行では、どちらへも進める（来た方向がない）', () => {
    let s = withDice(game(), 1);
    s = apply(s, { type: 'roll' });
    expect(s.pending).toMatchObject({ kind: 'direction', sq: 0, options: [1, 7] });
    s = apply(s, { type: 'move', to: 7 });
    expect(s.players[0].pos).toBe(7);
  });
});

describe('CPU の強さ', () => {
  it('勝った回数が つよい ＞ ふつう ＞ やさしい（60 試合・席順を回す）', { timeout: 180_000 }, () => {
    const lv = ['easy', 'normal', 'hard'] as const;
    const wins: Record<string, number> = { easy: 0, normal: 0, hard: 0, fourth: 0 };
    for (let g = 0; g < 60; g++) {
      const order = [lv[g % 3], lv[(g + 1) % 3], lv[(g + 2) % 3], 'normal' as const];
      let s = newGame({ mapId: MAPS[g % MAPS.length].id, mode: 'normal', seed: 7000 + g, maxRounds: 80,
        players: order.map((c, i) => ({ name: `P${i}`, cpu: c })) });
      while (s.phase !== 'over') s = apply(s, decide(s));
      wins[s.winner === 3 ? 'fourth' : s.players[s.winner!].cpu!] += 1;
    }
    console.log('勝った回数', wins);
    expect(wins.hard).toBeGreaterThan(wins.normal);
    expect(wins.normal).toBeGreaterThan(wins.easy);
  });
});

describe('銀行を通過したときの給料', () => {
  it('止まらずに通過しても、スタンプが 4 つそろっていれば昇格して給料が入る', () => {
    const m = getMap('corner');
    // 銀行の 2 つ手前に、銀行へ向かう向きで立つ（7 → 0 の順に進む向き）
    let s = game();
    const p = s.players[0];
    p.stamps = [true, true, true, true];
    const before = m.links[0].find((v) => v !== 1)!; // 銀行の下のマス
    p.pos = m.links[before].find((v) => v !== 0)!;
    p.prev = m.links[p.pos].find((v) => v !== before)!;
    // サイコロ 3：2 マス目で銀行を通り、3 マス目で止まる
    for (let seed = 0; seed < 1000; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      if (apply(t, { type: 'roll' }).dice === 3) { s = t; break; }
    }
    const cash = s.players[0].cash;
    const t = apply(s, { type: 'roll' });
    expect(t.path).toContain(0); // 銀行を通った（このあとまだ 1 マス残っている）
    expect(t.players[0].level).toBe(1);
    expect(t.salary).toEqual({ player: 0, amount: salary(1), level: 1 });
    expect(t.players[0].stamps.every((x) => !x)).toBe(true);
    // 給料をもらったので銀行で止まり、手数料なしで株を買える
    expect(t.players[0].pos).toBe(0);
    expect(t.pending).toEqual({ kind: 'bankStock', sq: 0 });
    expect(t.players[0].cash).toBe(cash + salary(1));
    const raw = buyQuote(t, 1, 2).cost;
    const u = apply(t, { type: 'buyStock', street: 1, lots: 2 });
    expect(t.players[0].cash - u.players[0].cash).toBe(raw);
    expect(u.pending).toEqual({ kind: 'bankStock', sq: 0 }); // 続けて買える
    const u2 = apply(u, { type: 'sellStock', street: 1, lots: 1 }); // 売ることもできる
    expect(u2.players[0].shares[1]).toBe(10);
    // 終えて進む：残りの 1 マスを進む
    const v = apply(u2, { type: 'skip' });
    expect(v.players[0].pos).not.toBe(0);
    expect(v.path).toEqual([0, v.players[0].pos]);
    expect(v.pending?.kind).not.toBe('bankStock');
  });
  it('かんたんモードでは株がないので、銀行で止まらずに進む', () => {
    const m = getMap('corner');
    let s = game('easy');
    const p = s.players[0];
    p.stamps = [true, true, true, true];
    const before = m.links[0].find((v) => v !== 1)!;
    p.pos = m.links[before].find((v) => v !== 0)!;
    p.prev = m.links[p.pos].find((v) => v !== before)!;
    for (let seed = 0; seed < 1000; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      if (apply(t, { type: 'roll' }).dice === 3) { s = t; break; }
    }
    const t = apply(s, { type: 'roll' });
    expect(t.players[0].level).toBe(1);
    expect(t.pending?.kind).not.toBe('bankStock');
    expect(t.players[0].pos).not.toBe(0);
  });
  it('スタンプが足りなければ給料は入らない', () => {
    let s = game();
    s.players[0].stamps = [true, true, true, false];
    s.players[0].pos = 1;
    s.players[0].prev = 2;
    for (let seed = 0; seed < 1000; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      if (apply(t, { type: 'roll' }).dice === 2) { s = t; break; }
    }
    const t = apply(s, { type: 'roll' });
    expect(t.path).toContain(0);
    expect(t.players[0].level).toBe(0);
    expect(t.salary).toBeNull();
    // 給料がなくても、銀行を通れば止まって株を買える
    expect(t.pending).toEqual({ kind: 'bankStock', sq: 0 });
    const u = apply(t, { type: 'buyStock', street: 2, lots: 1 });
    expect(u.players[0].shares[2]).toBe(10);
    const v = apply(u, { type: 'skip' });
    expect(v.players[0].pos).not.toBe(0);
  });
});

describe('通りの独占の知らせ', () => {
  it('最後の 1 軒を買って独占すると、知らせとできごとが入り、次の番で消える', () => {
    const s = game();
    const [a, b, c] = shopsOf(s, 0); // 3 軒の通り
    own(s, a, 0); own(s, b, 0);
    s.phase = 'decide';
    s.pending = { kind: 'buyShop', sq: c };
    const t = apply(s, { type: 'buyShop' });
    expect(t.monopoly).toEqual({ player: 0, street: 0 });
    expect(t.log.at(-1)!.text).toMatch(/あさひ通りを独占！/);
    const u = apply(t, { type: 'endTurn' });
    expect(u.monopoly).toBeNull();
  });
  it('買収で独占したときも知らせる', () => {
    const s = game();
    const [a, b, c] = shopsOf(s, 0);
    own(s, a, 0); own(s, b, 0); own(s, c, 1);
    s.players[0].cash = 99999;
    s.phase = 'decide';
    s.pending = { kind: 'buyout', sq: c };
    expect(apply(s, { type: 'buyout' }).monopoly).toEqual({ player: 0, street: 0 });
  });
  it('独占していなければ知らせない', () => {
    const s = game();
    const [a, , c] = shopsOf(s, 0);
    own(s, a, 0);
    s.phase = 'decide';
    s.pending = { kind: 'buyShop', sq: c };
    expect(apply(s, { type: 'buyShop' }).monopoly).toBeNull();
  });
});

describe('お店を買う資金が足りないとき', () => {
  const landOnVacant = (cash: number, shares: number) => {
    let s = game();
    const sq = shopsOf(s, 3)[0]; // ほしぞら通りのお店
    s.players[0].cash = cash;
    s.players[0].shares[1] = shares;
    standBefore(s, sq);
    for (let seed = 0; seed < 1000; seed++) {
      const t = structuredClone(s);
      t.rng = seed;
      if (apply(t, { type: 'roll' }).dice === 1) { s = t; break; }
    }
    return { s: apply(s, { type: 'roll' }), sq };
  };
  it('株を売れば買えるなら、買うか決める場面になり、株を売ってから買える', () => {
    const { s, sq } = landOnVacant(50, 200);
    const price = s.props[sq]!.value;
    expect(s.pending).toEqual({ kind: 'buyShop', sq });
    expect(() => apply(s, { type: 'buyShop' })).toThrow(); // まだ現金が足りない
    let t = s;
    while (t.players[0].cash < price) t = apply(t, { type: 'sellStock', street: 1, lots: 1 });
    expect(t.pending).toEqual({ kind: 'buyShop', sq }); // 売っても場面はそのまま
    const u = apply(t, { type: 'buyShop' });
    expect(u.props[sq]!.owner).toBe(0);
  });
  it('株を全部売っても足りないなら、買う場面にならない', () => {
    const { s } = landOnVacant(10, 0);
    expect(s.pending?.kind).not.toBe('buyShop');
  });
});
