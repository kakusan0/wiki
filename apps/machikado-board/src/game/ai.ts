// CPU の判断。状態を見て次の操作を 1 つ返す（状態は変えない）
import { forwardOptions, getMap } from './maps';
import { hash01 } from './rng';
import {
  BUYOUT_MULT, MAX_SHARES, STOCK_LOT, buyQuote, fee, isMonopoly, ownedInStreet, stockPrice, streetSquares,
} from './rules';
import type { Action, CpuLevel, GameState } from './state';
import { bidPrice, canBuyStock, investOptions } from './turn';

interface Style {
  reserve: number; // 手元に残したい現金（マップの初期資金に対する割合）
  investShare: number; // 増資に回す割合
  buyoutMin: number; // 買収を考える目安（0 は買収しない）
  stockShare: number; // 株に回す割合
  noise: number; // 判断のぶれ
}

const STYLES: Record<CpuLevel, Style> = {
  easy: { reserve: 0.05, investShare: 0.25, buyoutMin: 0, stockShare: 0.1, noise: 0.6 },
  normal: { reserve: 0.15, investShare: 0.45, buyoutMin: 0.95, stockShare: 0.15, noise: 0.3 },
  hard: { reserve: 0.12, investShare: 0.85, buyoutMin: 0.6, stockShare: 0.35, noise: 0 },
};

export function decide(s: GameState): Action {
  if (s.phase === 'auction' && s.auction) return decideBid(s);
  const p = s.players[s.turn];
  const level: CpuLevel = p.cpu ?? 'normal';
  const st = STYLES[level];
  const map = getMap(s.mapId);
  const r = (k: number) => hash01(s.rng, s.round, s.turn, s.log.length, k);
  const reserve = map.startCash * st.reserve;

  if (s.phase === 'roll') return { type: 'roll' };

  if (s.phase === 'decide' && s.pending) {
    const sq = s.pending.sq;
    switch (s.pending.kind) {
      case 'direction': {
        const opts = s.pending.options;
        // やさしいは半分、ふつうは 4 回に 1 回、気まぐれに選ぶ
        if (r(7) < (level === 'easy' ? 0.5 : level === 'normal' ? 0.25 : 0)) return { type: 'move', to: opts[Math.floor(r(8) * opts.length)] };
        const left = s.moving?.left ?? 1;
        let best = opts[0];
        let bestScore = -Infinity;
        for (const o of opts) {
          const scores = routeScores(s, o, sq, left - 1, p.stamps.slice());
          const sc = level === 'hard' ? Math.max(...scores) : scores.reduce((a, b) => a + b, 0) / scores.length;
          if (sc > bestScore) { bestScore = sc; best = o; }
        }
        return { type: 'move', to: best };
      }
      case 'buyShop': {
        const price = s.props[sq]!.value;
        // 現金が足りないとき：つよい・ふつうは、同じ通りに自分のお店があれば株を売って資金をつくる
        if (p.cash < price) {
          const street = map.squares[sq].street!;
          const worth = level !== 'easy' && (ownedInStreet(s, street, p.id) >= 1 || level === 'hard');
          const k = p.shares.findIndex((n) => n > 0);
          return worth && k >= 0 ? { type: 'sellStock', street: k, lots: 1 } : { type: 'skip' };
        }
        // つよい：お店は資産で利用料も入るので、払えるなら買う。相手の独占を防ぐときは手持ちぎりぎりでも買う
        if (level === 'hard') {
          const street = map.squares[sq].street!;
          const blocks = s.players.some((o) => o.id !== p.id && ownedInStreet(s, street, o.id) >= streetSquares(s, street).length - 1);
          return p.cash - price >= (blocks ? 0 : reserve * 0.5) ? { type: 'buyShop' } : { type: 'skip' };
        }
        const want = p.cash - price >= reserve || (level !== 'easy' && p.cash - price >= 0 && r(1) < 0.5);
        return want && r(2) > st.noise * 0.3 ? { type: 'buyShop' } : { type: 'skip' };
      }
      case 'buyLot': {
        if (p.cash < s.props[sq]!.value) return { type: 'skip' };
        if (p.cash - s.props[sq]!.value < reserve * 1.5 || r(3) < st.noise) return { type: 'skip' };
        const shops = s.props.filter((x, i) => x?.owner === p.id && map.squares[i].kind === 'shop').length;
        return { type: 'buyLot', facility: shops >= 3 || level === 'easy' ? 'yatai' : 'ryogae' };
      }
      case 'invest': {
        const opts = investOptions(s);
        if (!opts.length) return { type: 'skip' };
        // 一番高いお店へ（利用料が増えやすい）。つよいは利用料の割合が高い（独占・多数）ときほど大きく
        const best = opts.sort((a, b) => s.props[b.sq]!.value - s.props[a.sq]!.value)[0];
        const street = map.squares[best.sq].street!;
        const share = level === 'hard'
          ? (isMonopoly(s, street, p.id) ? 0.95 : ownedInStreet(s, street, p.id) >= 2 ? st.investShare : 0.4)
          : st.investShare;
        const budget = Math.floor((p.cash - reserve) * share);
        const amount = Math.min(best.room, budget);
        return amount >= 20 ? { type: 'invest', sq: best.sq, amount } : { type: 'skip' };
      }
      case 'buyout': {
        if (st.buyoutMin === 0) return { type: 'skip' };
        const street = map.squares[sq].street!;
        const price = s.props[sq]!.value * BUYOUT_MULT;
        const mine = ownedInStreet(s, street, p.id);
        const total = streetSquares(s, street).length;
        // その店で独占できる、または通りの過半数になるなら買収を考える
        const gain = (mine + 1) / total;
        const ok = gain >= st.buyoutMin && p.cash - price >= reserve * 2 && r(4) > st.noise;
        return ok ? { type: 'buyout' } : { type: 'skip' };
      }
    }
  }

  // ターンの終わり、または銀行で給料をもらって止まっているとき：株の売り買い
  if (s.phase === 'stock' || s.pending?.kind === 'bankStock') {
    // 足りないときは売る
    if (p.cash < reserve) {
      const st0 = p.shares.findIndex((n) => n > 0);
      if (st0 >= 0) return { type: 'sellStock', street: st0, lots: 1 };
    }
    // つよい：需給が高くなった株は、自分の独占でなければ売って利益を確定する
    if (level === 'hard') {
      const k = p.shares.findIndex((n, i) => n > 0 && s.demand[i] > 1.3 && !isMonopoly(s, i, p.id));
      if (k >= 0) return { type: 'sellStock', street: k, lots: Math.min(p.shares[k] / STOCK_LOT, 5) };
    }
    // 株を買えるのは銀行・両替所だけ
    if (canBuyStock(s)) {
      const budget = (p.cash - reserve * 2) * st.stockShare;
      if (budget > 0 && r(5) > st.noise) {
        // 自分のお店が多い通り（独占なら最優先）を選ぶ。やさしいはランダム
        let best = -1;
        let score = -Infinity;
        for (let k = 0; k < map.streets.length; k++) {
          if (p.shares[k] >= MAX_SHARES) continue;
          const sc = level === 'easy' ? r(10 + k)
            : ownedInStreet(s, k, p.id) * 2 + (isMonopoly(s, k, p.id) ? 4 : 0) - s.demand[k] + streetHeat(s, k) / 100;
          if (sc > score) { score = sc; best = k; }
        }
        if (best >= 0) {
          const lots = Math.min(Math.floor(budget / (stockPrice(s, best) * STOCK_LOT)), (MAX_SHARES - p.shares[best]) / STOCK_LOT, 10);
          if (lots >= 1 && buyQuote(s, best, lots).cost <= p.cash - reserve) return { type: 'buyStock', street: best, lots };
        }
      }
    }
    return s.phase === 'stock' ? { type: 'endTurn' } : { type: 'skip' };
  }
  return { type: 'skip' };
}

// 競売：上限の値まで +10 ずつ入札し、超えたら降りる
function decideBid(s: GameState): Action {
  const au = s.auction!;
  const map = getMap(s.mapId);
  const p = s.players[au.bidder];
  const level: CpuLevel = p.cpu ?? 'normal';
  const q = map.squares[au.sq];
  const value = s.props[au.sq]!.value;
  let mult = level === 'easy' ? 0.8 : level === 'normal' ? 1.0 : 1.2;
  if (level === 'hard' && q.kind === 'shop') {
    const mine = ownedInStreet(s, q.street!, p.id);
    if (mine >= 1) mult = 1.5;
    if (mine === streetSquares(s, q.street!).length - 1) mult = 2; // 落札すれば独占
  }
  const reserve = map.startCash * STYLES[level].reserve;
  const limit = Math.min(value * mult, p.cash - reserve);
  return bidPrice(s, 10) <= limit ? { type: 'bid', raise: 10 } : { type: 'pass' };
}

// 分かれ道の先を読む：残りの歩数で行ける道すじごとの点数（スタンプ・昇格・止まるマス）
function routeScores(s: GameState, pos: number, prev: number, left: number, stamps: boolean[], acc = 0, out: number[] = []): number[] {
  const map = getMap(s.mapId);
  const p = s.players[s.turn];
  const q = map.squares[pos];
  let sc = acc;
  const st = stamps.slice();
  if (q.kind === 'stamp' && !st[q.stamp!]) { st[q.stamp!] = true; sc += 40; }
  if (q.kind === 'bank' && st.every(Boolean)) { sc += 200; st.fill(false); }
  if (left === 0) {
    const pr = s.props[pos];
    if (q.kind === 'shop' && pr) {
      if (pr.owner == null) sc += p.cash >= pr.value ? 30 : 0;
      else if (pr.owner === p.id) sc += isMonopoly(s, q.street!, p.id) ? 40 : 15;
      else sc -= fee(s, pos);
    }
    if (q.kind === 'chance') sc += 5;
    if (q.kind === 'plaza') sc -= 5;
    if (q.kind === 'bank') sc += 10;
    out.push(sc);
    return out;
  }
  if (out.length > 200) return out;
  for (const nx of forwardOptions(map, pos, prev)) routeScores(s, nx, pos, left - 1, st, sc, out);
  return out;
}

// 通りの稼ぐ力のめやす（利用料の合計）
function streetHeat(s: GameState, street: number) {
  return streetSquares(s, street).reduce((a, sq) => a + fee(s, sq), 0);
}
