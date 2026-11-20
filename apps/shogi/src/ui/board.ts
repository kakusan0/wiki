// 盤と駒台の表示（タップで選んで指す）
import { DROP, Position, isDrop, mDrop, mFrom, mTo, type Move } from '../engine/position';
import { HAND_TYPES, KANJI, isPromoted } from '../engine/rules';
import { squareName } from '../engine/notation';
import { h } from './dom';

export interface BoardView {
  pos: Position;
  flipped: boolean; // 後手を手前にする
  selected: { from: number } | { drop: number } | null;
  targets: Set<number>; // 選んだ駒の行き先
  last: Move | null; // 直前の手
  canAct: boolean; // いま触れるか
  onSquare: (sq: number) => void;
  onHand: (side: 0 | 1, type: number) => void;
  names: [string, string];
  clocks?: [string, string] | null;
  turnLabel?: string;
}

// 駒の絵（五角形に漢字）。後手の駒は 180° 回す
export function pieceSvg(type: number, gote: boolean, small = false): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', `piece${gote ? ' gote' : ''}${small ? ' small' : ''}`);
  svg.setAttribute('aria-hidden', 'true');
  const g = document.createElementNS(NS, 'g');
  if (gote) g.setAttribute('transform', 'rotate(180 50 50)');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M50 6 L80 18 L90 94 L10 94 L20 18 Z');
  path.setAttribute('class', 'koma');
  const text = document.createElementNS(NS, 'text');
  text.setAttribute('x', '50');
  text.setAttribute('y', '66');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('class', `kanji${isPromoted(type) ? ' promoted' : ''}`);
  text.textContent = KANJI[type];
  g.append(path, text);
  svg.append(g);
  return svg;
}

export function renderBoard(v: BoardView): HTMLElement {
  const p = v.pos;
  const w = p.w, hgt = p.h;
  const order = (i: number) => (v.flipped ? p.n - 1 - i : i);
  const lastTo = v.last != null ? mTo(v.last) : -1;
  const lastFrom = v.last != null && !isDrop(v.last) ? mFrom(v.last) : -1;
  const checkKing = p.inCheck() ? p.kings[p.side] : -1;

  const grid = h('div', { class: 'grid', style: { gridTemplateColumns: `repeat(${w}, 1fr)`, gridTemplateRows: `repeat(${hgt}, 1fr)`, aspectRatio: `${w} / ${hgt * 1.08}` } });
  for (let i = 0; i < p.n; i++) {
    const sq = order(i);
    const pc = p.pieceAt(sq);
    const sel = v.selected && 'from' in v.selected && v.selected.from === sq;
    const cls = ['cell'];
    if (sel) cls.push('sel');
    if (v.targets.has(sq)) cls.push(pc ? 'target capture' : 'target');
    if (sq === lastTo) cls.push('last');
    if (sq === lastFrom) cls.push('last-from');
    if (sq === checkKing) cls.push('check');
    const cell = h('button', {
      class: cls.join(' '),
      'aria-label': `${squareName(p, sq)}${pc ? `：${pc.side === 0 ? '先手' : '後手'}の${KANJI[pc.type]}` : ''}`,
      'data-sq': String(sq),
      disabled: !v.canAct && !v.targets.size,
      onclick: () => v.onSquare(sq),
    }, pc ? pieceSvg(pc.type, (pc.side === 1) !== v.flipped) : null);
    grid.append(cell);
  }
  // 筋と段の数字
  const files = h('div', { class: 'files', style: { gridTemplateColumns: `repeat(${w}, 1fr)` } },
    Array.from({ length: w }, (_, x) => h('span', {}, String(v.flipped ? x + 1 : w - x))));
  const KAN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const ranks = h('div', { class: 'ranks', style: { gridTemplateRows: `repeat(${hgt}, 1fr)` } },
    Array.from({ length: hgt }, (_, y) => h('span', {}, KAN[v.flipped ? hgt - 1 - y : y])));

  const hand = (side: 0 | 1) => {
    const items = HAND_TYPES.filter((t) => p.hands[side][t] > 0).map((t) => {
      const sel = v.selected && 'drop' in v.selected && v.selected.drop === t && p.side === side;
      return h('button', {
        class: `hand-piece${sel ? ' sel' : ''}`, 'aria-label': `持ち駒の${KANJI[t]}（${p.hands[side][t]} 枚）`,
        disabled: !v.canAct || p.side !== side, 'data-hand': `${side}:${t}`,
        onclick: () => v.onHand(side, t),
      }, pieceSvg(t, (side === 1) !== v.flipped, true), p.hands[side][t] > 1 ? h('b', {}, String(p.hands[side][t])) : null);
    });
    const mine = (side === 0) !== v.flipped;
    return h('div', { class: `stand ${mine ? 'near' : 'far'}${p.side === side ? ' turn' : ''}` },
      h('div', { class: 'who' },
        h('span', { class: 'mark' }, side === 0 ? '▲' : '△'),
        h('b', {}, v.names[side]),
        v.clocks ? h('span', { class: 'clock', 'data-clock': String(side) }, v.clocks[side]) : null),
      h('div', { class: 'pieces' }, items.length ? items : h('small', {}, '持ち駒なし')));
  };

  const near = v.flipped ? 1 : 0;
  const far = v.flipped ? 0 : 1;
  return h('div', { class: `board-area size-${w}x${hgt}` },
    hand(far),
    h('div', { class: 'board' }, files, h('div', { class: 'board-row' }, grid, ranks)),
    hand(near),
    v.turnLabel ? h('p', { class: 'turn-label', role: 'status' }, v.turnLabel) : null);
}

// 選んだ駒・持ち駒の行き先（合法手から）
export function targetsOf(legal: Move[], sel: BoardView['selected']): Set<number> {
  const out = new Set<number>();
  if (!sel) return out;
  for (const m of legal) {
    if ('from' in sel && !isDrop(m) && mFrom(m) === sel.from) out.add(mTo(m));
    if ('drop' in sel && isDrop(m) && mDrop(m) === sel.drop) out.add(mTo(m));
  }
  return out;
}

export { DROP };
