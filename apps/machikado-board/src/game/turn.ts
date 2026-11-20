// 手番の進行。apply(state, action) が新しい状態を返す（元の状態は変えない）
import { CARDS } from './cards';
import { bankOf, distances, forwardOptions, getMap } from './maps';
import { step } from './rng';
import {
  BUYOUT_MULT, BUYOUT_OWNER_SHARE, DEMAND_DECAY, DEMAND_MAX, DEMAND_MIN, LIQUIDATE_RATE, MAX_SHARES, STOCK_LOT,
  TOP_HOLDER_RATE, buyQuote, sellableCash, canBuyout, isMonopoly, dividendFor, fee, investCap, netWorth, salary, sellQuote, topHolder,
} from './rules';
import type { Action, CpuLevel, GameState, Mode, Player } from './state';
import { FACILITY_NAMES, STAMP_NAMES } from './state';

export interface NewGameOptions {
  mapId: string;
  mode: Mode;
  seed: number;
  players: { name: string; cpu: CpuLevel | null }[];
  maxRounds?: number;
}

const COLORS = ['#E2463B', '#2F6FD8', '#2FA35B', '#E0A21B'];

export function newGame(o: NewGameOptions): GameState {
  const map = getMap(o.mapId);
  const s: GameState = {
    version: 1,
    mapId: o.mapId,
    mode: o.mode,
    rng: o.seed | 0,
    players: o.players.map((p, i): Player => ({
      id: i, name: p.name, color: COLORS[i % COLORS.length], cpu: p.cpu, cash: map.startCash, pos: bankOf(map), prev: null,
      stamps: [false, false, false, false], level: 0, shares: map.streets.map(() => 0), closed: false, bankrupt: false,
    })),
    props: map.squares.map((sq) =>
      sq.kind === 'shop' || (sq.kind === 'lot' && o.mode === 'normal') ? { owner: null, value: sq.base! } : null),
    demand: map.streets.map(() => 1),
    turn: 0,
    round: 1,
    maxRounds: o.maxRounds ?? 60,
    phase: 'roll',
    pending: null,
    bankTouched: false,
    exchangeTouched: false,
    dice: null,
    moving: null,
    path: [],
    deck: [],
    lastCard: null,
    salary: null,
    monopoly: null,
    auction: null,
    log: [],
    winner: null,
    overReason: null,
  };
  log(s, null, `${map.name}（${o.mode === 'easy' ? 'かんたん' : 'ふつう'}）で開始。目標 ${map.target.toLocaleString()}G`);
  return s;
}

function rand(s: GameState): number {
  const [v, next] = step(s.rng);
  s.rng = next;
  return v;
}

function log(s: GameState, player: number | null, text: string) {
  s.log.push({ round: s.round, player, text });
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
}

const cur = (s: GameState) => s.players[s.turn];

export function apply(prev: GameState, a: Action): GameState {
  if (prev.phase === 'over') throw new Error('game over');
  const s = structuredClone(prev);
  const p = cur(s);
  switch (a.type) {
    case 'auction': {
      // 自分の番のはじめか終わりに、自分のお店を競売に掛ける
      need((s.phase === 'roll' || s.phase === 'stock') && s.props[a.sq]?.owner === s.turn, a);
      startAuction(s, a.sq, s.turn, false);
      break;
    }
    case 'bid': {
      need(s.phase === 'auction' && !!s.auction && [10, 50, 100].includes(a.raise), a);
      const au = s.auction!;
      const price = bidPrice(s, a.raise);
      need(s.players[au.bidder].cash >= price, a);
      au.price = price;
      au.leader = au.bidder;
      log(s, au.bidder, `${s.players[au.bidder].name}が ${price}G で入札`);
      nextBidder(s);
      break;
    }
    case 'pass': {
      need(s.phase === 'auction' && !!s.auction, a);
      const au = s.auction!;
      au.active = au.active.filter((x) => x !== au.bidder);
      log(s, au.bidder, `${s.players[au.bidder].name}は降りた`);
      nextBidder(s);
      break;
    }
    case 'roll': {
      need(s.phase === 'roll', a);
      s.dice = 1 + Math.floor(rand(s) * 6);
      s.path = [p.pos];
      log(s, p.id, `サイコロは ${s.dice}`);
      move(s, s.dice, true);
      break;
    }
    case 'move': {
      need(s.phase === 'decide' && s.pending?.kind === 'direction' && s.pending.options.includes(a.to) && !!s.moving, a);
      s.pending = null;
      s.path = [p.pos];
      stepTo(s, a.to);
      s.moving!.left -= 1;
      if (!isOverNow(s) && !bankPause(s)) continueMove(s);
      break;
    }
    case 'buyShop': {
      need(s.phase === 'decide' && s.pending?.kind === 'buyShop', a);
      const sq = s.pending!.sq;
      const pr = s.props[sq]!;
      need(p.cash >= pr.value, a);
      p.cash -= pr.value;
      pr.owner = p.id;
      log(s, p.id, `${sqName(s, sq)}を ${pr.value}G で買った`);
      checkMonopoly(s, sq);
      toStock(s);
      break;
    }
    case 'invest': {
      need(s.phase === 'decide' && s.pending?.kind === 'invest', a);
      const map = getMap(s.mapId);
      const target = map.squares[a.sq];
      const landed = map.squares[s.pending!.sq];
      need(target.kind === 'shop' && target.street === landed.street && s.props[a.sq]?.owner === p.id, a);
      const room = investCap(s, a.sq) - s.props[a.sq]!.value;
      const amount = Math.floor(a.amount);
      need(amount > 0 && amount <= room && amount <= p.cash, a);
      p.cash -= amount;
      s.props[a.sq]!.value += amount;
      log(s, p.id, `${target.name}に ${amount}G 増資`);
      toStock(s);
      break;
    }
    case 'buyout': {
      need(s.phase === 'decide' && s.pending?.kind === 'buyout', a);
      const sq = s.pending!.sq;
      need(canBuyout(s, sq, p.id), a);
      const pr = s.props[sq]!;
      const price = pr.value * BUYOUT_MULT;
      const owner = s.players[pr.owner!];
      p.cash -= price;
      owner.cash += Math.round(price * BUYOUT_OWNER_SHARE);
      log(s, p.id, `${owner.name}の${sqName(s, sq)}を ${price}G で買収`);
      pr.owner = p.id;
      checkMonopoly(s, sq);
      toStock(s);
      break;
    }
    case 'buyLot': {
      need(s.phase === 'decide' && s.pending?.kind === 'buyLot', a);
      const sq = s.pending!.sq;
      const pr = s.props[sq]!;
      need(p.cash >= pr.value && (a.facility === 'yatai' || a.facility === 'ryogae'), a);
      p.cash -= pr.value;
      pr.owner = p.id;
      pr.facility = a.facility;
      log(s, p.id, `空き地に ${FACILITY_NAMES[a.facility]} を建てた（${pr.value}G）`);
      toStock(s);
      break;
    }
    case 'skip': {
      need(s.phase === 'decide', a);
      if (s.pending?.kind === 'bankStock') {
        // 銀行での株の売り買いを終えて、残りの歩数を進む
        need(!!s.moving, a);
        s.pending = null;
        s.path = [p.pos];
        continueMove(s);
        break;
      }
      need(s.pending?.kind !== 'direction', a);
      toStock(s);
      break;
    }
    case 'buyStock': {
      // 株を買えるのは銀行（止まった番・通って止まっているとき）と両替所に止まった番だけ
      need(canBuyStock(s), a);
      need(Number.isInteger(a.lots) && a.lots > 0 && a.street >= 0 && a.street < s.demand.length, a);
      need(p.shares[a.street] + a.lots * STOCK_LOT <= MAX_SHARES, a);
      const q = buyQuote(s, a.street, a.lots);
      need(p.cash >= q.cost, a);
      p.cash -= q.cost;
      p.shares[a.street] += a.lots * STOCK_LOT;
      s.demand[a.street] = q.demand;
      log(s, p.id, `${streetName(s, a.street)}の株を ${a.lots * STOCK_LOT} 株買った（${q.cost}G）`);
      break;
    }
    case 'sellStock': {
      need(canSellStock(s), a);
      need(Number.isInteger(a.lots) && a.lots > 0 && p.shares[a.street] >= a.lots * STOCK_LOT, a);
      const q = sellQuote(s, a.street, a.lots);
      p.cash += q.gain;
      p.shares[a.street] -= a.lots * STOCK_LOT;
      s.demand[a.street] = q.demand;
      log(s, p.id, `${streetName(s, a.street)}の株を ${a.lots * STOCK_LOT} 株売った（${q.gain}G）`);
      break;
    }
    case 'endTurn': {
      need(s.phase === 'stock', a);
      nextTurn(s);
      break;
    }
    default:
      throw new Error('unknown action');
  }
  runDebts(s);
  return s;
}

function need(ok: boolean, a: Action) {
  if (!ok) throw new Error(`いまはできない操作です: ${a.type}`);
}

const sqName = (s: GameState, sq: number) => getMap(s.mapId).squares[sq].name;
const streetName = (s: GameState, st: number) => getMap(s.mapId).streets[st].name;

// n マス進む。通過・到着したマスの効果を順に処理し、最後に止まったマスを解決する。
// 分かれ道では止まって、進む方向を選んでもらう（来た方向へは戻れない）
function move(s: GameState, n: number, resolve: boolean, depth = 0) {
  s.moving = { left: n, depth: resolve ? depth : -1 };
  continueMove(s);
}

function continueMove(s: GameState) {
  const map = getMap(s.mapId);
  const p = cur(s);
  const m = s.moving!;
  while (m.left > 0) {
    const opts = forwardOptions(map, p.pos, p.prev);
    if (opts.length > 1) {
      s.phase = 'decide';
      s.pending = { kind: 'direction', sq: p.pos, options: opts };
      return;
    }
    stepTo(s, opts[0]);
    m.left -= 1;
    if (isOverNow(s) || bankPause(s)) return;
  }
  s.moving = null;
  if (m.depth >= 0) land(s, p.pos, m.depth);
}

// 銀行を通ったら、そこで止まって株を売り買いできる（ふつうモード。給料がなくても止まる。止まったときはターンの終わりに買える）
function bankPause(s: GameState): boolean {
  const map = getMap(s.mapId);
  const p = cur(s);
  if (s.mode !== 'normal' || !s.moving || s.moving.left <= 0) return false;
  if (map.squares[p.pos].kind !== 'bank') return false;
  s.phase = 'decide';
  s.pending = { kind: 'bankStock', sq: p.pos };
  return true;
}

// お店を手に入れて通りを独占したら、画面に知らせる（ボーナスの中身は rules.ts の利用料・増資の上限・買収）
function checkMonopoly(s: GameState, sq: number) {
  const map = getMap(s.mapId);
  const st = map.squares[sq].street;
  const p = cur(s);
  if (s.mode !== 'normal' || st == null || !isMonopoly(s, st, p.id)) return;
  s.monopoly = { player: p.id, street: st };
  log(s, p.id, `${map.streets[st].name}を独占！（利用料 +10%・増資の上限 3 倍・買収されない）`);
}

function stepTo(s: GameState, to: number) {
  const p = cur(s);
  p.prev = p.pos;
  p.pos = to;
  s.path.push(to);
  pass(s, to);
}

// 移動せずに別のマスへ飛ぶ（カード）。prev は着いたマスの手前のマスにする
function warp(s: GameState, to: number, prev: number | null) {
  const p = cur(s);
  p.pos = to;
  p.prev = prev;
  s.path.push(to);
  pass(s, to);
}

const isOverNow = (s: GameState) => s.phase === 'over';

function pass(s: GameState, sq: number) {
  const map = getMap(s.mapId);
  const p = cur(s);
  const square = map.squares[sq];
  if (square.kind === 'stamp' && !p.stamps[square.stamp!]) {
    p.stamps[square.stamp!] = true;
    log(s, p.id, `${STAMP_NAMES[square.stamp!]}のスタンプを集めた`);
  }
  if (square.kind === 'bank') atBank(s);
}

function atBank(s: GameState) {
  const map = getMap(s.mapId);
  const p = cur(s);
  s.bankTouched = true;
  // 止まったときだけでなく、通ったときも、スタンプが 4 つそろっていれば昇格して給料
  if (p.stamps.every(Boolean)) {
    p.level += 1;
    const pay = salary(p.level);
    p.cash += pay;
    p.stamps = [false, false, false, false];
    s.salary = { player: p.id, amount: pay, level: p.level };
    log(s, p.id, `昇格！ 段階 ${p.level}。給料 ${pay}G`);
  }
  if (netWorth(s, p.id) >= map.target) {
    s.phase = 'over';
    s.winner = p.id;
    s.overReason = 'target';
    log(s, p.id, `目標 ${map.target.toLocaleString()}G に届いて銀行へ。${p.name}の勝ち！`);
  }
}

function land(s: GameState, sq: number, depth: number) {
  if (isOver(s)) return;
  const map = getMap(s.mapId);
  const p = cur(s);
  const square = map.squares[sq];
  const pr = s.props[sq];
  switch (square.kind) {
    case 'shop': {
      if (pr!.owner == null) {
        // 現金が足りなくても、株を売れば買えるなら選ばせる（その場で株を売れる）
        if (p.cash + sellableCash(s, p.id) >= pr!.value) return decide(s, { kind: 'buyShop', sq });
      } else if (pr!.owner === p.id) {
        if (s.mode === 'normal' && hasInvestRoom(s, square.street!, p.id)) return decide(s, { kind: 'invest', sq });
      } else {
        payFee(s, sq);
        if (isOver(s)) return;
        if (canBuyout(s, sq, p.id)) return decide(s, { kind: 'buyout', sq });
      }
      break;
    }
    case 'lot': {
      if (s.mode === 'easy') {
        if (drawCard(s, depth) || isOver(s)) return;
        break;
      }
      if (pr!.owner == null) {
        if (p.cash + sellableCash(s, p.id) >= pr!.value) return decide(s, { kind: 'buyLot', sq });
      } else if (pr!.owner === p.id) {
        if (pr!.facility === 'ryogae') s.exchangeTouched = true;
      } else {
        payFee(s, sq);
        if (isOver(s)) return;
        if (pr!.facility === 'ryogae') s.exchangeTouched = true;
      }
      break;
    }
    case 'chance':
      if (drawCard(s, depth) || isOver(s)) return;
      break;
    case 'plaza':
      p.closed = true;
      log(s, p.id, '広場でひと休み。次の番までお店はお休み');
      break;
    case 'bank':
    case 'stamp':
      break;
  }
  toStock(s);
}

function hasInvestRoom(s: GameState, street: number, pid: number) {
  const map = getMap(s.mapId);
  return map.squares.some((q) => q.kind === 'shop' && q.street === street && s.props[q.id]?.owner === pid &&
    investCap(s, q.id) > s.props[q.id]!.value) && s.players[pid].cash > 0;
}

function decide(s: GameState, pending: GameState['pending']) {
  s.phase = 'decide';
  s.pending = pending;
}

function toStock(s: GameState) {
  if (isOver(s)) return;
  s.pending = null;
  if (s.mode === 'easy') return nextTurn(s);
  s.phase = 'stock';
}

function payFee(s: GameState, sq: number) {
  const map = getMap(s.mapId);
  const p = cur(s);
  const pr = s.props[sq]!;
  const owner = s.players[pr.owner!];
  const amount = fee(s, sq);
  if (amount === 0) {
    log(s, p.id, `${owner.name}のお店はお休み中。利用料なし`);
    return;
  }
  p.cash -= amount;
  owner.cash += amount;
  log(s, p.id, `${owner.name}に利用料 ${amount}G`);
  const square = map.squares[sq];
  if (s.mode === 'normal' && square.kind === 'shop') {
    const st = square.street!;
    for (const h of s.players) {
      const d = dividendFor(h.shares[st]);
      if (d > 0 && !h.bankrupt) h.cash += d;
    }
    const top = topHolder(s, st);
    if (top != null) s.players[top].cash += Math.round(amount * TOP_HOLDER_RATE);
  }
  settle(s, p.id);
}

// 現金がマイナスなら、お店（安い順に 75%）→ 株の順に自動で売る。それでも足りなければ破産
// 現金がマイナスになったとき。お店を持っていれば、操作のあとで自動の競売に掛ける（runDebts）。
// お店がなければ株を売り、それでも足りなければ破産
function settle(s: GameState, pid: number) {
  const p = s.players[pid];
  if (p.cash >= 0) return;
  if (s.props.some((x) => x?.owner === pid)) return;
  for (let st = 0; st < p.shares.length && p.cash < 0; st++) {
    while (p.shares[st] > 0 && p.cash < 0) {
      const q = sellQuote(s, st, 1);
      p.cash += q.gain;
      p.shares[st] -= STOCK_LOT;
      s.demand[st] = q.demand;
    }
  }
  if (p.cash < 0) {
    p.bankrupt = true;
    p.shares = p.shares.map(() => 0);
    log(s, pid, `${p.name}は破産…`);
    endBy(s, 'bankrupt');
  }
}

// ---------- 競売 ----------
// 入札したときの値：最初は最低価格から（+10 で最低価格ちょうど）、そのあとはいまの値に上乗せ
export function bidPrice(s: GameState, raise: number): number {
  const au = s.auction!;
  return au.leader == null ? au.min + raise - 10 : au.price + raise;
}

// いま操作する人：競売中は入札する人、それ以外は手番の人
export const actor = (s: GameState) => (s.phase === 'auction' && s.auction ? s.auction.bidder : s.turn);

function startAuction(s: GameState, sq: number, seller: number, forced: boolean) {
  const map = getMap(s.mapId);
  const pr = s.props[sq]!;
  const min = Math.max(10, Math.round(pr.value / 2 / 10) * 10);
  const n = s.players.length;
  // 売り手の次の席から順に。破産した人・最低価格を払えない人は入らない
  const active = Array.from({ length: n - 1 }, (_, k) => (seller + 1 + k) % n)
    .filter((i) => !s.players[i].bankrupt && s.players[i].cash >= min);
  s.auction = { sq, seller, min, price: 0, leader: null, bidder: active[0] ?? seller, active, forced, resume: { phase: s.phase, pending: s.pending } };
  s.phase = 'auction';
  s.pending = null;
  log(s, seller, `${s.players[seller].name}が ${map.squares[sq].name} を競売に掛けた（最低 ${min}G${forced ? '・お金が足りないため' : ''}）`);
  if (!active.length) resolveAuction(s);
}

// 次に入札するか決める人へ。一番高い人以外が全員降りたら終わり
function nextBidder(s: GameState) {
  const au = s.auction!;
  const others = au.active.filter((x) => x !== au.leader);
  if (!others.length) return resolveAuction(s);
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const c = (au.bidder + k) % n;
    if (others.includes(c)) { au.bidder = c; return; }
  }
}

function resolveAuction(s: GameState) {
  const map = getMap(s.mapId);
  const au = s.auction!;
  const pr = s.props[au.sq]!;
  const seller = s.players[au.seller];
  const name = map.squares[au.sq].name;
  if (au.leader != null) {
    const buyer = s.players[au.leader];
    buyer.cash -= au.price;
    seller.cash += au.price;
    pr.owner = buyer.id;
    log(s, buyer.id, `${buyer.name}が ${name} を ${au.price}G で落札`);
  } else {
    const got = Math.floor(pr.value * LIQUIDATE_RATE);
    seller.cash += got;
    pr.owner = null;
    pr.value = map.squares[au.sq].base!;
    delete pr.facility;
    log(s, au.seller, `入札なし。銀行が ${name} を ${got}G で買い取った`);
  }
  s.phase = au.resume.phase;
  s.pending = au.resume.pending;
  s.auction = null;
  settle(s, au.seller); // お店がなくなってもまだ足りなければ、株を売る・破産
}

// 操作のあと：現金がマイナスでお店を持つ人がいれば、安いお店から自動で競売に掛ける
function runDebts(s: GameState) {
  if (s.phase === 'over' || s.phase === 'auction') return;
  const n = s.players.length;
  for (let k = 0; k < n; k++) {
    const pid = (s.turn + k) % n;
    const p = s.players[pid];
    if (p.bankrupt || p.cash >= 0) continue;
    const cheapest = s.props.map((pr, i) => ({ pr, i })).filter((x) => x.pr?.owner === pid)
      .sort((a, b) => a.pr!.value - b.pr!.value)[0];
    if (cheapest) return startAuction(s, cheapest.i, pid, true);
    settle(s, pid);
    if (isOverNow(s)) return;
  }
}

function endBy(s: GameState, reason: 'bankrupt' | 'rounds') {
  s.phase = 'over';
  s.pending = null;
  s.overReason = reason;
  let best = -1;
  for (const pl of s.players) {
    if (pl.bankrupt) continue;
    if (best < 0 || netWorth(s, pl.id) > netWorth(s, best)) best = pl.id;
  }
  s.winner = best;
  log(s, null, `ゲーム終了。総資産トップの${s.players[best].name}の勝ち`);
}

function nextTurn(s: GameState) {
  s.turn = (s.turn + 1) % s.players.length;
  if (s.turn === 0) {
    s.round += 1;
    s.demand = s.demand.map((d) => d + (1 - d) * DEMAND_DECAY);
    if (s.round > s.maxRounds) return endBy(s, 'rounds');
  }
  const p = cur(s);
  p.closed = false;
  s.phase = 'roll';
  s.pending = null;
  s.bankTouched = false;
  s.exchangeTouched = false;
  s.dice = null;
  s.moving = null;
  s.lastCard = null;
  s.salary = null;
  s.monopoly = null;
}

// カードで移動したときは移動先の解決まで済ませて true を返す
function drawCard(s: GameState, depth: number): boolean {
  const map = getMap(s.mapId);
  const p = cur(s);
  if (depth > 0) return false; // カードで進んだ先のチャンスでは引かない
  if (s.deck.length === 0) {
    s.deck = CARDS.map((c) => c.id);
    for (let i = s.deck.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s) * (i + 1));
      [s.deck[i], s.deck[j]] = [s.deck[j], s.deck[i]];
    }
  }
  const id = s.deck.pop()!;
  s.lastCard = id;
  const card = CARDS[id];
  log(s, p.id, `チャンス「${card.title}」：${card.text}`);
  const others = s.players.filter((x) => x.id !== p.id && !x.bankrupt);
  const myShops = s.props.filter((x, i) => x?.owner === p.id && map.squares[i].kind === 'shop');
  const randomStreet = () => Math.floor(rand(s) * map.streets.length);
  const nudge = (st: number, f: number) => {
    s.demand[st] = Math.min(DEMAND_MAX, Math.max(DEMAND_MIN, s.demand[st] * f));
  };
  switch (id) {
    case 0: for (const o of others) { o.cash -= 20; p.cash += 20; settle(s, o.id); if (isOver(s)) return false; } break;
    case 1: p.cash += 100; break;
    case 2: p.cash -= 50; break;
    case 3: {
      const bank = map.squares.find((q) => q.kind === 'bank')!.id;
      if (p.pos !== bank) { warp(s, bank, null); if (!isOver(s)) land(s, bank, depth + 1); return true; }
      break;
    }
    case 4: move(s, 3, true, depth + 1); return true;
    case 5: {
      const k = p.stamps.findIndex((x) => !x);
      if (k >= 0) { p.stamps[k] = true; log(s, p.id, `${STAMP_NAMES[k]}のスタンプをもらった`); }
      break;
    }
    case 6: { const st = randomStreet(); if (s.mode === 'normal') { nudge(st, 1.08); log(s, null, `${map.streets[st].name}の人気が上がった`); } else p.cash += 30; break; }
    case 7: { const st = randomStreet(); if (s.mode === 'normal') { nudge(st, 0.92); log(s, null, `${map.streets[st].name}の客足が減った`); } else p.cash -= 30; break; }
    case 8: p.cash += 30 * myShops.length; break;
    case 9: p.cash -= 20 * myShops.length; break;
    case 10: p.cash += 3 * Math.floor(p.shares.reduce((a, b) => a + b, 0) / 10); break;
    case 11: {
      const rich = others.reduce<Player | null>((a, b) => (!a || b.cash > a.cash ? b : a), null);
      if (rich && rich.cash > 0) { const g = Math.min(80, rich.cash); rich.cash -= g; p.cash += g; }
      break;
    }
    case 12: p.cash += (1 + Math.floor(rand(s) * 6)) * 30; break;
    case 13: p.closed = true; break;
    case 14: {
      const d = distances(map, p.pos);
      const target = map.squares
        .filter((q) => q.kind === 'shop' && s.props[q.id]!.owner == null && q.id !== p.pos)
        .sort((a, b) => d[a.id] - d[b.id] || a.id - b.id)[0];
      if (target) {
        const back = map.links[target.id].find((w) => d[w] === d[target.id] - 1) ?? null;
        warp(s, target.id, back);
        if (!isOver(s)) land(s, target.id, depth + 1);
        return true;
      }
      break;
    }
    case 15: for (const x of [p, ...others]) { x.cash -= 30; settle(s, x.id); if (isOver(s)) return false; } break;
    case 16: p.cash += 150; break;
    case 17: p.cash -= Math.round(0.05 * myShops.reduce((a, x) => a + x!.value, 0)); break;
    case 18: p.cash += Math.round(0.2 * Math.max(0, ...myShops.map((x) => x!.value))); break;
    case 19: {
      const poor = others.reduce<Player | null>((a, b) => (!a || b.cash < a.cash ? b : a), null);
      if (poor) { p.cash -= 60; poor.cash += 60; }
      break;
    }
  }
  settle(s, p.id);
  return false;
}

// 画面と CPU 向け：いま選べる増資先（同じ通りの自分の店と、増資できる上限）
export function investOptions(s: GameState): { sq: number; room: number }[] {
  if (s.pending?.kind !== 'invest') return [];
  const map = getMap(s.mapId);
  const street = map.squares[s.pending.sq].street;
  return map.squares
    .filter((q) => q.kind === 'shop' && q.street === street && s.props[q.id]?.owner === s.turn)
    .map((q) => ({ sq: q.id, room: Math.min(investCap(s, q.id) - s.props[q.id]!.value, cur(s).cash) }))
    .filter((x) => x.room > 0);
}

// 株を買えるとき：銀行を通って止まっているとき、銀行に止まった番、両替所に止まった番の終わり
export const canBuyStock = (s: GameState) => {
  if (s.mode !== 'normal') return false;
  if (s.phase === 'decide' && s.pending?.kind === 'bankStock') return true;
  if (s.phase !== 'stock') return false;
  return getMap(s.mapId).squares[s.players[s.turn].pos].kind === 'bank' || s.exchangeTouched;
};
// 株を売れるとき：自分の番のはじめ・終わり、銀行で止まっているとき、お店・空き地を買うか決めているとき（資金づくり）
export const canSellStock = (s: GameState) =>
  s.mode === 'normal' && (s.phase === 'stock' || s.phase === 'roll' ||
    (s.phase === 'decide' && (s.pending?.kind === 'bankStock' || s.pending?.kind === 'buyShop' || s.pending?.kind === 'buyLot')));

function isOver(s: GameState) {
  return s.phase === 'over';
}
