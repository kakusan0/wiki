// 手番の操作・プレイヤー一覧・株式市場・ログ・マスの詳細
import { arrow, getMap, stopsVia } from '../game/maps';
import {
  BUYOUT_MULT, MAX_SHARES, STOCK_LOT, buyQuote, canBuyout, fee, feeRate, investCap, investRoom, isMonopoly, netWorth, salary, streetInvestRoom,
  sellQuote, shopAssets, stockAssets, stockPrice, topHolder,
} from '../game/rules';
import type { Action, GameState } from '../game/state';
import { FACILITY_NAMES, STAMP_NAMES } from '../game/state';
import { bidPrice, canBuyStock, canSellStock, investOptions } from '../game/turn';
import { STAMP_ICONS } from './board2d';
import { h, g } from './dom';

export type Act = (a: Action) => void;

export interface PlayerExtras { status?: (pid: number) => string | null; bubble?: (pid: number) => string | null; you?: number; detailed?: boolean }

export function renderPlayers(s: GameState, x: PlayerExtras = {}): HTMLElement {
  const map = getMap(s.mapId);
  return h('section', { class: 'panel players', 'aria-label': 'プレイヤー' },
    s.players.map((p) => {
      const nw = netWorth(s, p.id);
      return h('div', { class: `pl${p.id === s.turn ? ' now' : ''}${p.bankrupt ? ' out' : ''}`, style: { '--pc': p.color } },
        h('div', { class: 'row' },
          h('span', { class: 'dot' }),
          h('b', { class: 'pname' }, p.name, x.you === p.id && p.name !== 'あなた' ? h('small', { class: 'you' }, '（あなた）') : null),
          x.status?.(p.id) ? h('span', { class: 'status' }, x.status(p.id)) : null,
          h('span', { class: 'lv' }, `段階 ${p.level}`),
          h('span', { class: 'stamps', 'aria-label': 'スタンプ' },
            p.stamps.map((ok, i) => h('span', { class: ok ? 'on' : 'off', title: STAMP_NAMES[i] }, STAMP_ICONS[i]))),
        ),
        h('div', { class: 'row nums' },
          h('span', {}, '現金 ', h('b', {}, g(p.cash))),
          h('span', {}, '総資産 ', h('b', {}, g(nw))),
        ),
        x.detailed ? h('div', { class: 'row nums detail' },
          h('span', {}, 'お店 ', h('b', {}, `${shopCount(s, p.id)} 軒`), ` (${g(shopAssets(s, p.id))})`),
          s.mode === 'normal' ? h('span', {}, '株 ', h('b', {}, g(stockAssets(s, p.id)))) : null) : null,
        x.detailed && s.mode === 'normal' && p.shares.some((n) => n > 0)
          ? h('div', { class: 'shares' }, getMap(s.mapId).streets.map((st, i) => (p.shares[i] > 0
            ? h('span', {}, h('i', { style: { background: st.color } }), `${st.name} ${p.shares[i]}株`) : null)))
          : null,
        x.bubble?.(p.id) ? h('div', { class: 'bubble', role: 'status' }, x.bubble(p.id)) : null,
        h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(Math.round(nw)), 'aria-valuemax': String(map.target) },
          h('i', { style: { width: `${Math.min(100, (nw / map.target) * 100)}%` } })),
      );
    }));
}

const shopCount = (s: GameState, pid: number) => {
  const map = getMap(s.mapId);
  return s.props.filter((x, i) => x?.owner === pid && map.squares[i].kind === 'shop').length;
};

// マップの上の帯：自分の情報（現金・総資産・目標までの進み・段階とスタンプ・お店・株）
export function renderMe(s: GameState, me: number, toast?: string | null): HTMLElement {
  const map = getMap(s.mapId);
  const p = s.players[me];
  const nw = netWorth(s, me);
  const turn = s.phase === 'over' ? 'ゲーム終了' : s.turn === me ? 'あなたの番' : `${s.players[s.turn].name}の番`;
  return h('section', { class: 'me-bar', style: { '--pc': p.color }, 'aria-label': 'あなたの情報' },
    h('div', { class: 'who' }, h('span', { class: 'dot' }), h('b', {}, p.name), p.name === 'あなた' ? null : h('small', {}, '（あなた）'),
      h('span', { class: `turn${s.turn === me ? ' mine' : ''}` }, turn)),
    h('div', { class: 'nums' },
      h('span', {}, '現金 ', h('b', {}, g(p.cash))),
      h('span', {}, '総資産 ', h('b', {}, g(nw))),
      h('span', {}, '段階 ', h('b', {}, String(p.level))),
      h('span', { class: 'stamps', 'aria-label': 'スタンプ' },
        p.stamps.map((ok, i) => h('span', { class: ok ? 'on' : 'off', title: STAMP_NAMES[i] }, STAMP_ICONS[i]))),
      h('span', {}, 'お店 ', h('b', {}, `${shopCount(s, me)} 軒`)),
      s.mode === 'normal' ? h('span', {}, '株 ', h('b', {}, g(stockAssets(s, me)))) : null),
    h('div', { class: 'goal' },
      h('div', { class: 'bar', role: 'progressbar', 'aria-valuenow': String(Math.round(nw)), 'aria-valuemax': String(map.target) },
        h('i', { style: { width: `${Math.min(100, (nw / map.target) * 100)}%` } })),
      h('small', {}, `目標 ${g(map.target)}まで あと ${g(Math.max(0, map.target - nw))}`)),
    toast ? h('div', { class: 'toast', role: 'status' }, toast) : null);
}

// 現金が足りないとき：あといくら必要かと、その場で株を売るボタン（通りごとに 10 株ずつ）
function raiseCash(s: GameState, act: Act, price: number): HTMLElement | string {
  const p = s.players[s.turn];
  if (p.cash >= price || s.mode !== 'normal') return ''; // append に渡すので空文字
  const map = getMap(s.mapId);
  return h('div', { class: 'raise' },
    h('p', {}, h('b', {}, `現金が ${g(price - p.cash)} 足りません。`), '株を売ると買えます（売るたびに株価は少し下がります）。'),
    h('div', { class: 'btns' }, map.streets.map((st, i) => {
      if (p.shares[i] <= 0) return null;
      const q = sellQuote(s, i, 1);
      return h('button', { class: 'btn sm sell', onclick: () => act({ type: 'sellStock', street: i, lots: 1 }) },
        h('span', { class: 'chip', style: { background: st.color } }), `${st.name} 10 株を売る（+${g(q.gain)}）`);
    })));
}

export function renderActions(s: GameState, act: Act, busy: boolean, mySeat = 0): HTMLElement {
  const map = getMap(s.mapId);
  const p = s.players[s.turn];
  const box = h('section', { class: 'panel actions', 'aria-live': 'polite' });
  if (s.phase === 'over') {
    const w = s.players[s.winner!];
    box.append(h('h2', {}, `${w.name}の勝ち！`),
      h('p', {}, s.overReason === 'target' ? '目標の総資産に届いて銀行に戻りました。'
        : s.overReason === 'bankrupt' ? 'だれかが破産したので、総資産で順位を決めました。' : '決められた周回が終わりました。'),
      h('ol', { class: 'rank' }, [...s.players].sort((a, b) => netWorth(s, b.id) - netWorth(s, a.id))
        .map((x) => h('li', {}, `${x.name}　${g(netWorth(s, x.id))}`))));
    return box;
  }
  if (s.phase === 'auction' && s.auction) {
    box.append(...renderAuction(s, act, busy, mySeat));
    return box;
  }
  if (s.turn !== mySeat || busy) {
    box.append(h('p', { class: 'wait' }, `${p.name}の番です…`));
    return box;
  }
  const btn = (label: string, a: Action, cls = '', disabled = false) =>
    h('button', { class: `btn ${cls}`, disabled, onclick: () => act(a) }, label);

  if (s.phase === 'roll') {
    box.append(h('h2', {}, 'あなたの番'),
      h('p', {}, `スタンプ ${p.stamps.filter(Boolean).length}/4。そろえて銀行に戻ると給料 ${g(salary(p.level + 1))}。`),
      btn('サイコロを振る', { type: 'roll' }, 'primary big'));
  }
  if (s.phase === 'decide' && s.pending) {
    const sq = map.squares[s.pending.sq];
    const pr = s.props[sq.id]!;
    switch (s.pending.kind) {
      case 'bankStock': {
        const sal = s.salary;
        box.append(h('h2', {}, '銀行（株式市場）'),
          h('p', {}, `${sal && sal.player === s.turn ? `給料 ${g(sal.amount)} をもらいました。` : '銀行を通りました。'}銀行にいる間は、株を売り買いできます（株式市場タブ）。終わったら、あと ${s.moving?.left ?? 0} マス進みます。`),
          h('div', { class: 'btns' }, btn('株の売り買いを終えて進む', { type: 'skip' }, 'primary big')));
        break;
      }
      case 'direction': {
        const pend = s.pending;
        box.append(h('h2', {}, '分かれ道'),
          h('p', {}, `どちらの道へ進みますか？（あと ${s.moving?.left ?? 0} マス。来た道へは戻れません）ボタンの下に、その道で止まるマスを出しています。`),
          h('div', { class: 'btns dirs' }, pend.options.map((o) => {
            const stops = stopsVia(map, pend.sq, o, s.moving?.left ?? 1).map((sq) => stopLabel(s, sq));
            return h('button', { class: 'btn primary dir', onclick: () => act({ type: 'move', to: o }) },
              h('span', { class: 'go' }, `${arrow(map, pend.sq, o)} この道へ進む`),
              h('span', { class: 'stop' }, `止まる：${stops.join(' または ')}`));
          })));
        break;
      }
      case 'buyShop':
        box.append(h('h2', {}, `${sq.name}（空き店舗）`),
          h('p', {}, `${map.streets[sq.street!]?.name ?? ''}・価格 ${g(pr.value)}。買うと、ほかの人が止まったとき利用料が入ります。`),
          raiseCash(s, act, pr.value),
          h('div', { class: 'btns' }, btn(`${g(pr.value)} で買う`, { type: 'buyShop' }, 'primary', p.cash < pr.value), btn('見送る', { type: 'skip' })));
        break;
      case 'buyLot':
        box.append(h('h2', {}, '空き地'),
          h('p', {}, `${g(pr.value)} で施設を建てられます。屋台村：利用料 40G＋自分のお店 1 軒につき 15G。両替所：止まった人は、その番に株を買える小さな銀行（両替所の利用料 30G）。`),
          raiseCash(s, act, pr.value),
          h('div', { class: 'btns' },
            btn('屋台村を建てる', { type: 'buyLot', facility: 'yatai' }, 'primary', p.cash < pr.value),
            btn('両替所を建てる', { type: 'buyLot', facility: 'ryogae' }, 'primary', p.cash < pr.value),
            btn('見送る', { type: 'skip' })));
        break;
      case 'buyout': {
        const owner = s.players[pr.owner!];
        const price = pr.value * BUYOUT_MULT;
        box.append(h('h2', {}, '買収しますか？'),
          h('p', {}, `${owner.name}の${sq.name}（価値 ${g(pr.value)}）を ${g(price)} で買い取れます。7 割は${owner.name}に、3 割は銀行に入ります。`),
          h('div', { class: 'btns' }, btn(`${g(price)} で買収`, { type: 'buyout' }, 'danger', !canBuyout(s, sq.id, p.id)), btn('見送る', { type: 'skip' })));
        break;
      }
      case 'invest': {
        const opts = investOptions(s);
        box.append(h('h2', {}, '増資できます'),
          h('p', {}, '同じ通りの自分のお店に増資すると、お店の価値・利用料・株価が上がります。'));
        for (const o of opts) {
          const q = map.squares[o.sq];
          const v = s.props[o.sq]!.value;
          const steps = [...new Set([Math.min(50, o.room), Math.round(o.room / 2), o.room])].filter((x) => x > 0);
          box.append(h('div', { class: 'invest' },
            h('div', {}, h('b', {}, q.name), ` ${g(v)} → 上限 ${g(investCap(s, o.sq))}`),
            h('div', { class: 'btns' }, steps.map((a) => btn(`+${g(a)}`, { type: 'invest', sq: o.sq, amount: a }, 'primary')))));
        }
        box.append(btn('増資しない', { type: 'skip' }));
        break;
      }
    }
  }
  if (s.phase === 'stock') {
    box.append(h('h2', {}, 'ターンの終わり'),
      h('p', {}, canBuyStock(s)
        ? (map.squares[p.pos].kind === 'bank' ? '銀行にいるので、株を買えます（株式市場タブ）。' : '両替所に止まったので、株を買えます（株式市場タブ）。')
        : '株は売ることだけできます。買うには銀行に寄りましょう（通るだけでも買えます）。'),
      btn('ターンを終える', { type: 'endTurn' }, 'primary big'));
  }
  return box;
}

export interface StockOptions {
  wide?: boolean; // 株式市場タブ用の広い表
  highlight?: number | null; // 選んでいる通り（盤面で点滅させる）
  onPick?: (street: number) => void; // 行を押したとき
}

// 止まるマスの短い説明（例「喫茶こもれび（空き店舗）」「ミナトのお店 魚市場」）
function stopLabel(s: GameState, sq: number): string {
  const q = getMap(s.mapId).squares[sq];
  const pr = s.props[sq];
  if (q.kind === 'shop') return pr?.owner == null ? `${q.name}（空き店舗）` : pr.owner === s.turn ? `${q.name}（自分のお店）` : `${q.name}（${s.players[pr.owner].name}のお店）`;
  return q.kind === 'chance' ? 'チャンス' : q.name;
}

// 「買う」が押せない理由（押せるときは null）
function buyReason(s: GameState, busy: boolean, mySeat: number): string | null {
  if (s.mode !== 'normal' || s.phase === 'over') return null;
  if (s.turn !== mySeat || busy) return 'あなたの番になると売り買いできます。';
  if (!canBuyStock(s)) return '株を買えるのは銀行にいるときだけです（通るだけでも買えます）。売るのはいつでもできます。';
  return null;
}

// 1 つの通りの「買う」「売る」ボタン（lots は 10 株の単位の数）
function tradeButtons(s: GameState, act: Act, busy: boolean, mySeat: number, i: number, lots: number): HTMLElement[] {
  const p = s.players[s.turn];
  const me = s.players[mySeat] ?? p;
  const mine = s.turn === mySeat && !busy;
  const canBuy = mine && canBuyStock(s);
  const canSell = mine && canSellStock(s);
  const buy = buyQuote(s, i, lots);
  const sell = me.shares[i] >= lots * STOCK_LOT ? sellQuote(s, i, lots) : null;
  return [
    h('button', { class: 'btn sm buy', disabled: !canBuy || p.cash < buy.cost || p.shares[i] + lots * STOCK_LOT > MAX_SHARES,
      title: `${lots * STOCK_LOT} 株 ${g(buy.cost)}`,
      onclick: () => act({ type: 'buyStock', street: i, lots }) }, lots === 1 ? '買う' : `買う×${lots * STOCK_LOT}`),
    h('button', { class: 'btn sm sell', disabled: !canSell || !sell,
      title: sell ? `${lots * STOCK_LOT} 株 ${g(sell.gain)}` : '', onclick: () => act({ type: 'sellStock', street: i, lots }) }, lots === 1 ? '売る' : `売る×${lots * STOCK_LOT}`),
  ];
}

// 株式市場タブ：選んだ通り（レーン）の情報。株の売り買いと、通りのお店の一覧
export function renderStreetInfo(s: GameState, act: Act, busy: boolean, mySeat: number, street: number,
  selectedSq: number | null, onClear: () => void): HTMLElement {
  const map = getMap(s.mapId);
  const st = map.streets[street];
  const me = s.players[mySeat];
  const shops = map.squares.filter((q) => q.kind === 'shop' && q.street === street);
  const owners = new Set(shops.map((q) => s.props[q.id]?.owner));
  const monoOwner = owners.size === 1 ? [...owners][0] : null;
  const top = topHolder(s, street);
  const buy = buyQuote(s, street, 1);
  return h('section', { class: 'panel street-info', 'aria-label': `${st.name}の情報`, style: { '--street': st.color } },
    h('div', { class: 'head' },
      h('span', { class: 'chip', style: { background: st.color } }),
      h('h2', {}, st.name),
      monoOwner != null ? h('span', { class: 'mono-tag' }, `♛ ${s.players[monoOwner].name}が独占中`) : null,
      h('button', { class: 'btn sm clear', onclick: onClear }, '選択を外す')),
    h('dl', { class: 'facts' },
      h('div', {}, h('dt', {}, '株価'), h('dd', {}, g(stockPrice(s, street)))),
      h('div', {}, h('dt', {}, '需給'), h('dd', { class: s.demand[street] > 1.005 ? 'up' : s.demand[street] < 0.995 ? 'down' : '' }, `×${s.demand[street].toFixed(2)}`)),
      h('div', {}, h('dt', {}, '10 株の代金'), h('dd', {}, g(buy.cost))),
      h('div', {}, h('dt', {}, '増資の余地'), h('dd', {}, g(streetInvestRoom(s, street)))),
      h('div', {}, h('dt', {}, 'あなたの持ち株'), h('dd', {}, `${me.shares[street]} 株`)),
      h('div', {}, h('dt', {}, '筆頭株主'), h('dd', {}, top != null ? s.players[top].name : 'なし'))),
    h('div', { class: 'btns' }, tradeButtons(s, act, busy, mySeat, street, 1), tradeButtons(s, act, busy, mySeat, street, 5)),
    buyReason(s, busy, mySeat) ? h('p', { class: 'reason' }, buyReason(s, busy, mySeat)) : null,
    h('table', { class: 'shops' },
      h('thead', {}, h('tr', {}, h('th', {}, 'お店'), h('th', {}, '持ち主'), h('th', {}, '価値'), h('th', {}, '利用料'), h('th', {}, '増資の余地'))),
      h('tbody', {}, shops.map((q) => {
        const pr = s.props[q.id]!;
        const owner = pr.owner != null ? s.players[pr.owner] : null;
        return h('tr', { class: selectedSq === q.id ? 'picked' : '' },
          h('td', {}, q.name),
          h('td', {}, owner ? [h('span', { class: 'dot', style: { background: owner.color } }), owner.name] : '空き店舗'),
          h('td', { class: 'num' }, g(pr.value)),
          h('td', { class: 'num' }, !owner ? '―' : owner.closed ? '休業' : g(fee(s, q.id))),
          h('td', { class: 'num' }, !owner ? '―' : [g(investRoom(s, q.id)), h('small', { class: 'cap' }, `上限 ${g(investCap(s, q.id))}`)]));
      }))),
    h('p', { class: 'note' }, '増資の余地：持ち主があと増資できる金額（上限 − いまの価値）。増資されると、その通りの株価が上がります。'));
}

export function renderStocks(s: GameState, act: Act, busy: boolean, mySeat = 0, o: StockOptions = {}): HTMLElement | null {
  if (s.mode !== 'normal') return null;
  const map = getMap(s.mapId);
  const me = s.players[mySeat] ?? s.players[s.turn];
  const shops = (i: number) => map.squares.filter((q) => q.kind === 'shop' && q.street === i);
  const trade = (i: number, lots: number) => tradeButtons(s, act, busy, mySeat, i, lots);
  const head = o.wide
    ? ['通り', '株価', '需給', '10株の代金', '増資の余地', 'お店', '持ち株', '']
    : ['通り', '株価', '増資の余地', 'あなた', ''];
  return h('section', { class: `panel stocks${o.wide ? ' wide' : ''}`, 'aria-label': '株式市場' },
    h('h2', {}, '株式市場'),
    o.onPick ? h('p', { class: 'note' }, '行を押すと、その通りのマスが盤面で点滅します。') : null,
    buyReason(s, busy, mySeat) ? h('p', { class: 'reason' }, buyReason(s, busy, mySeat)) : null,
    h('table', {},
      h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))),
      h('tbody', {}, map.streets.map((st, i) => {
        const top = topHolder(s, i);
        const pick = () => o.onPick?.(i);
        return h('tr', {
          class: `${o.onPick ? 'pickable' : ''}${o.highlight === i ? ' picked' : ''}`,
          tabindex: o.onPick ? '0' : null,
          'aria-pressed': o.onPick ? String(o.highlight === i) : null,
          onclick: (e: Event) => { if (!(e.target as HTMLElement).closest('button')) pick(); },
          onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } },
        },
          h('td', {}, h('span', { class: 'chip', style: { background: st.color } }), st.name,
            top != null ? h('small', { class: 'top', style: { color: s.players[top].color } }, ` 筆頭:${s.players[top].name}`) : null),
          h('td', { class: 'num' }, g(stockPrice(s, i))),
          o.wide ? h('td', { class: `num ${s.demand[i] > 1.005 ? 'up' : s.demand[i] < 0.995 ? 'down' : ''}` }, `×${s.demand[i].toFixed(2)}`) : null,
          o.wide ? h('td', { class: 'num' }, g(buyQuote(s, i, 1).cost)) : null,
          h('td', { class: 'num', title: 'その通りのお店に、あと増資できる金額の合計' }, g(streetInvestRoom(s, i))),
          o.wide ? h('td', { class: 'num', title: 'あなたのお店／通りのお店の数' }, `${shops(i).filter((q) => s.props[q.id]?.owner === mySeat).length}/${shops(i).length}軒`) : null,
          h('td', { class: 'num' }, `${me.shares[i]} 株`),
          h('td', { class: 'trade' }, o.wide ? h('div', { class: 'grid2' }, trade(i, 1), trade(i, 5)) : trade(i, 1)),
        );
      }))),
    h('p', { class: 'note' }, '株を買えるのは銀行（止まったとき・通ったとき）と両替所です。10 株単位。売るのは自分の番ならいつでも。利用料が払われるたびに 2 株につき 1G の配当、筆頭株主（50 株以上）は利用料の 10%。「増資の余地」が大きい通りほど、これから増資されて株価が上がる見込みがあります。'));
}

// 競売の欄：いまの値・一番高い人・まだ降りていない人。自分の番なら入札のボタン
function renderAuction(s: GameState, act: Act, busy: boolean, mySeat: number): HTMLElement[] {
  const au = s.auction!;
  const map = getMap(s.mapId);
  const name = map.squares[au.sq].name;
  const seller = s.players[au.seller];
  const mine = au.bidder === mySeat && !busy;
  const me = s.players[mySeat];
  const out: HTMLElement[] = [
    h('h2', {}, `競売：${name}`),
    h('p', {}, `売り手：${seller.name}${au.forced ? '（利用料が払えないため自動で競売）' : ''}・お店の価値 ${g(s.props[au.sq]!.value)}`),
    h('div', { class: 'auction-board' },
      h('div', {}, h('small', {}, 'いまの値'), h('b', {}, au.leader == null ? `まだ入札なし（最低 ${g(au.min)}）` : g(au.price))),
      h('div', {}, h('small', {}, '一番高い人'), h('b', {}, au.leader == null ? '―' : s.players[au.leader].name)),
      h('div', {}, h('small', {}, 'まだ降りていない人'), h('b', {}, au.active.map((i) => s.players[i].name).join('・') || '―'))),
  ];
  if (au.bidder === mySeat && au.seller !== mySeat) {
    out.push(h('p', { class: 'auction-you' }, mine ? 'あなたの番です。値を上げるか、降りるかを選んでください。' : '…'),
      h('div', { class: 'btns' },
        [10, 50, 100].map((r) => {
          const price = bidPrice(s, r);
          return h('button', { class: 'btn primary', disabled: !mine || me.cash < price, onclick: () => act({ type: 'bid', raise: r }) },
            au.leader == null && r === 10 ? `最低価格 ${g(price)} で入札` : `+${r}G（${g(price)}）で入札`);
        }),
        h('button', { class: 'btn', disabled: !mine, onclick: () => act({ type: 'pass' }) }, '降りる')));
  } else {
    out.push(h('p', { class: 'wait' }, `${s.players[au.bidder].name}が考え中…`));
  }
  return out;
}

export function renderInfo(s: GameState, sqId: number | null, act?: Act, mySeat = 0, busy = false): HTMLElement | null {
  if (sqId == null) return null;
  const map = getMap(s.mapId);
  const sq = map.squares[sqId];
  const pr = s.props[sqId];
  const lines: (string | HTMLElement)[] = [];
  if (sq.kind === 'shop') {
    const st = map.streets[sq.street!];
    const owner = pr!.owner != null ? s.players[pr!.owner] : null;
    lines.push(`${st.name}・基本価格 ${g(sq.base!)}・いまの価値 ${g(pr!.value)}`);
    if (owner) {
      lines.push(`持ち主 ${owner.name}・利用料 ${g(fee(s, sqId))}（${Math.round(feeRate(s, sqId) * 100)}%）`);
      if (s.mode === 'normal') {
        lines.push(`増資の上限 ${g(investCap(s, sqId))}${isMonopoly(s, sq.street!, owner.id) ? '（独占中）' : ''}`);
        lines.push(`買収価格 ${g(pr!.value * BUYOUT_MULT)}${isMonopoly(s, sq.street!, owner.id) ? '（独占中は買収できない）' : ''}`);
      }
    } else lines.push('空き店舗。止まると買えます。');
  } else if (sq.kind === 'lot' && pr) {
    lines.push(pr.owner != null ? `${s.players[pr.owner].name}の${FACILITY_NAMES[pr.facility!]}・利用料 ${g(fee(s, sqId))}` : `空き地。${g(pr.value)} で施設を建てられます。`);
  } else {
    const text: Record<string, string> = {
      bank: '通るか止まると、スタンプ 4 つで昇格・給料。総資産が目標に届いていれば勝ち。株も買えます。',
      stamp: '通るか止まるとスタンプがもらえます。',
      chance: 'チャンスカードを引きます。',
      plaza: '止まると、次の自分の番まで自分のお店がお休み（利用料が入らない）。',
      lot: 'かんたんモードではチャンスマスになります。',
    };
    lines.push(text[sq.kind] ?? '');
  }
  // 自分の番のはじめか終わりなら、自分のお店（施設）を競売に掛けられる
  let auctionBtn: HTMLElement | null = null;
  if (act && pr?.owner === mySeat && s.turn === mySeat && !busy && (s.phase === 'roll' || s.phase === 'stock')) {
    const min = Math.max(10, Math.round(pr.value / 2 / 10) * 10);
    auctionBtn = h('button', { class: 'btn', onclick: () => {
      if (confirm(`${sq.name}を競売に掛けますか？（最低価格 ${g(min)}。だれも入札しなければ銀行が ${g(Math.floor(pr.value * 0.75))} で買い取ります）`)) act({ type: 'auction', sq: sqId });
    } }, `競売に掛ける（最低価格 ${g(min)}）`);
  }
  return h('section', { class: 'panel info' }, h('h2', {}, sq.name), lines.map((l) => h('p', {}, l)), auctionBtn);
}

export function renderLog(s: GameState): HTMLElement {
  return h('section', { class: 'panel log', 'aria-label': 'できごと' },
    h('h2', {}, 'できごと'),
    h('ol', {}, s.log.slice(-40).reverse().map((e) => h('li', {
      style: { '--pc': e.player != null ? s.players[e.player].color : '#8890A8' },
    }, e.text))));
}

export function summary(s: GameState, pid: number) {
  return { cash: s.players[pid].cash, shops: shopAssets(s, pid), stocks: stockAssets(s, pid) };
}
