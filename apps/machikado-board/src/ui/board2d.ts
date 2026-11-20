// 2D の盤面（CSS グリッド）
import { arrow, getMap } from '../game/maps';
import { fee, isMonopoly, netWorth } from '../game/rules';
import type { GameState } from '../game/state';
import { FACILITY_NAMES, STAMP_NAMES } from '../game/state';
import { CARDS } from '../game/cards';
import { h, g } from './dom';

export const STAMP_ICONS = ['🍞', '🌸', '📖', '🔑'];

export interface BoardView {
  tokens?: number[]; // 演出中のコマの位置（なければ state の位置）
  selected: number | null;
  onSelect: (sq: number) => void;
  choices?: number[]; // 分かれ道で選べるマス
  highlightStreet?: number | null; // 点滅させる通り（株式市場で選んだ通り）
  me?: number; // 自分の席（自分のコマを目立たせる）
  landing?: Map<number, string>; // 止まる候補のマス → 表示する文字（サイコロの目など）
  trail?: number[]; // これから通るマス（サイコロを振ったあと）
  dest?: number; // 到着するマス
  destText?: string; // 到着マスの札の文字（「ここに止まる」「到着」）
  stepsLeft?: number; // 残りの歩数（コマの上に出す）
  message?: string;
}

export function renderBoard(s: GameState, v: BoardView): HTMLElement {
  const map = getMap(s.mapId);
  const n = Math.max(map.width, map.height);
  const size = n >= 10 ? 10 : n >= 8 ? 8 : 6;
  const board = h('div', { class: `board grid-${size}`, style: {
    gridTemplateColumns: `repeat(${map.width}, 1fr)`, gridTemplateRows: `repeat(${map.height}, 1fr)`,
    aspectRatio: `${map.width} / ${map.height}`,
  } });
  // 道（つながっているマスの間の線）
  map.squares.forEach((sq) => map.links[sq.id].forEach((w) => {
    if (w < sq.id) return;
    const b = map.squares[w];
    board.append(h('span', { class: `road ${b.x !== sq.x ? 'h' : 'v'}`, style: {
      gridColumn: b.x !== sq.x ? `${sq.x + 1} / ${b.x + 2}` : String(sq.x + 1),
      gridRow: b.y !== sq.y ? `${sq.y + 1} / ${b.y + 2}` : String(sq.y + 1),
    } }));
  }));
  const choices = new Set(v.choices ?? []);
  map.squares.forEach((sq) => {
    const { x, y } = sq;
    const pr = s.props[sq.id];
    const owner = pr?.owner != null ? s.players[pr.owner] : null;
    const street = sq.street != null ? map.streets[sq.street] : null;
    let icon = '';
    let sub = '';
    if (sq.kind === 'bank') { icon = '🏦'; sub = '銀行'; }
    if (sq.kind === 'stamp') { icon = STAMP_ICONS[sq.stamp!]; sub = STAMP_NAMES[sq.stamp!]; }
    if (sq.kind === 'chance') { icon = '？'; sub = 'チャンス'; }
    if (sq.kind === 'plaza') { icon = '⛲'; sub = '広場'; }
    if (sq.kind === 'lot') {
      icon = pr?.facility === 'yatai' ? '🏮' : pr?.facility === 'ryogae' ? '💱' : '🌱';
      sub = pr?.facility ? FACILITY_NAMES[pr.facility] : s.mode === 'easy' ? 'チャンス' : '空き地';
    }
    // 独占中の通り（ふつうモード）：王冠と金色の帯
    const mono = s.mode === 'normal' && owner && sq.kind === 'shop' && isMonopoly(s, sq.street!, owner.id);
    const fresh = mono && s.monopoly?.street === sq.street; // この番に独占したばかり
    const cell = h('button', {
      class: `sq k-${sq.kind}${owner ? ' owned' : ''}${mono ? ' mono' : ''}${fresh ? ' fresh' : ''}${v.selected === sq.id ? ' sel' : ''}${choices.has(sq.id) ? ' choice' : ''}${v.landing?.has(sq.id) ? ' landing' : ''}${v.dest === sq.id ? ' dest' : ''}${s.phase === 'auction' && s.auction?.sq === sq.id ? ' auction' : ''}${v.trail?.includes(sq.id) && v.dest !== sq.id ? ' trail' : ''}${v.highlightStreet != null && sq.street === v.highlightStreet ? ' blink' : ''}`,
      style: {
        gridColumn: String(x + 1), gridRow: String(y + 1),
        '--street': street?.color ?? 'transparent', '--owner': owner?.color ?? 'transparent',
      },
      title: sq.name,
      'aria-label': sq.name,
      onclick: () => v.onSelect(sq.id),
    },
    street ? h('span', { class: 'strip' }) : null,
    sq.kind === 'shop'
      ? [h('span', { class: 'nm' }, sq.name), h('span', { class: 'val' }, g(pr!.value)),
        owner ? null : h('span', { class: 'fee vacant' }, '空き店舗')]
      : [h('span', { class: 'ic' }, icon), h('span', { class: 'nm' }, sub)],
    // 頭上のピン：持ち主の色の札に利用料（休み中は「休業」）
    owner ? h('span', {
      class: `pin${owner.closed ? ' off' : ''}`, style: { '--pc': owner.closed ? '#8890A8' : owner.color },
      title: `${owner.name}のお店・利用料 ${fee(s, sq.id)}G${mono ? '・通りを独占中' : ''}`,
    }, mono ? h('span', { class: 'crown', 'aria-label': '独占' }, '♛') : null, owner.closed ? '休業' : `${fee(s, sq.id).toLocaleString()}G`) : null,
    choices.has(sq.id) && s.pending?.kind === 'direction' ? h('span', { class: 'arrow' }, arrow(map, s.pending.sq, sq.id)) : null,
    v.landing?.has(sq.id) ? h('span', { class: 'land', title: '止まる候補' }, v.landing.get(sq.id)!) : null,
    v.dest === sq.id ? h('span', { class: 'dest-tag' }, v.destText ?? '到着') : null,
    s.phase === 'auction' && s.auction?.sq === sq.id ? h('span', { class: 'auction-tag' }, s.auction.leader == null ? `競売中 最低${g(s.auction.min)}` : `競売中 ${g(s.auction.price)}`) : null,
    );
    board.append(cell);
  });

  // コマ
  const pos = v.tokens ?? s.players.map((p) => p.pos);
  s.players.forEach((p, i) => {
    if (p.bankrupt) return;
    const { x, y } = map.squares[pos[i]];
    const same = s.players.filter((q, j) => j < i && !q.bankrupt && pos[j] === pos[i]).length;
    const mine = v.me === i;
    board.append(h('span', {
      class: `token${i === s.turn ? ' now' : ''}${mine ? ' me' : ''}`,
      style: {
        gridColumn: String(x + 1), gridRow: String(y + 1), background: p.color,
        translate: `${-(same % 2) * 12}px ${-Math.floor(same / 2) * 12}px`,
      },
      'aria-label': `${p.name} のコマ${mine ? '（あなた）' : ''}`,
    }, p.name.slice(0, 1), mine && !(i === s.turn && v.stepsLeft) ? h('span', { class: 'me-tag' }, 'あなた') : null,
      i === s.turn && v.stepsLeft ? h('span', { class: 'steps-tag' }, `あと ${v.stepsLeft}`) : null));
  });

  // 盤の上の帯（マップ名・サイコロ・カード）
  const card = s.lastCard != null ? CARDS[s.lastCard] : null;
  const leader = [...s.players].sort((a, b) => netWorth(s, b.id) - netWorth(s, a.id))[0];
  const info = h('div', { class: 'board-info' },
    h('div', { class: 'row' },
      h('b', { class: 'title' }, map.name),
      h('span', {}, `目標 ${g(map.target)}・${s.round} 周目`),
      h('span', {}, `トップ：${leader.name} ${g(netWorth(s, leader.id))}`),
      s.dice ? h('span', { class: 'dice', 'aria-label': `サイコロ ${s.dice}` }, '⚀⚁⚂⚃⚄⚅'[s.dice - 1]) : null),
    s.monopoly ? h('div', { class: 'card mono', role: 'status' }, h('b', {}, `♛ ${s.players[s.monopoly.player].name}が${map.streets[s.monopoly.street].name}を独占！`), ' 利用料 +10%・増資の上限 3 倍・買収されない') : null,
    s.salary ? h('div', { class: 'card salary', role: 'status' }, h('b', {}, `${s.players[s.salary.player].name}が昇格！`), ` 段階 ${s.salary.level}・給料 ${g(s.salary.amount)}`) : null,
    card ? h('div', { class: 'card' }, h('b', {}, card.title), ' ', card.text) : null,
    v.message ? h('div', { class: 'msg dest-msg', role: 'status' }, v.message) : null,
  );
  return h('div', { class: 'board2d' }, info, board);
}
