// 2D の場（WebGL が使えないとき・軽くしたいとき）。同じ操作を DOM の画像で行う
import { CARDS } from '../game/cards';
import type { Ev, Player } from '../game/koikoi';
import type { View } from '../game/view';
import { BACK, cardUrl } from './art';
import { h } from './dom';
import type { EventHooks, Interaction } from './table3d';

const KIND_ORDER = { hikari: 0, tane: 1, tan: 2, kasu: 3 } as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Table2D {
  readonly canvas: HTMLElement; // 3D と同じ名前（画面に置く要素）
  private view: View | null = null;
  private inter: Interaction = { pickable: new Set(), selected: null, targets: new Set() };
  private queue: Promise<void> = Promise.resolve();
  private seen = { round: 0, events: 0 };
  onPick: (id: number) => void = () => {};
  cheer = 0;
  speed = 1;

  constructor() { this.canvas = h('div', { class: 'table2d' }); }
  destroy() { this.canvas.remove(); }
  setMood(kind: 'normal' | 'final' | 'cheer') { this.canvas.dataset.mood = kind; }
  doBurst() { this.canvas.classList.remove('shake'); void this.canvas.offsetWidth; this.canvas.classList.add('shake'); }
  doPulse() {}
  setInteraction(i: Interaction) { this.inter = i; this.render(); }
  screenOf(id: number): [number, number] | null {
    const el = this.canvas.querySelector<HTMLElement>(`[data-card="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect(), c = this.canvas.getBoundingClientRect();
    return [(r.left + r.width / 2 - c.left) / c.width, (r.top + r.height / 2 - c.top) / c.height];
  }
  sample(): Promise<number> { return Promise.resolve(0); }
  pendingPick() { return this.view?.phase === 'drawChoose'; }

  update(v: View, hooks: EventHooks): Promise<void> {
    this.queue = this.queue.then(async () => {
      const S = (ms: number) => sleep(ms * this.speed);
      if (v.round !== this.seen.round) { this.seen = { round: v.round, events: 0 }; }
      const evs = v.events.slice(this.seen.events);
      this.seen.events = v.events.length;
      for (const ev of evs) {
        hooks.onEvent?.(ev as Ev);
        if (ev.k === 'play' || ev.k === 'draw') { hooks.onSound?.(ev.k === 'draw' ? 'flip' : 'slap'); await S(250); }
        if (ev.k === 'yaku') await S(1600);
        if (ev.k === 'koikoi') await S(700);
      }
      this.view = v;
      this.render();
    });
    return this.queue;
  }

  private img(id: number, extra = '', small = false) {
    const pick = this.inter.pickable.has(id) || this.inter.targets.has(id);
    const cls = ['card2d', small ? 'small' : '', this.inter.selected === id ? 'sel' : '', this.inter.targets.has(id) ? 'target' : '', pick ? 'pick' : '', extra].filter(Boolean).join(' ');
    return h(pick ? 'button' : 'span', { class: cls, 'data-card': String(id), 'aria-label': CARDS[id].name, onclick: pick ? () => this.onPick(id) : undefined },
      h('img', { src: cardUrl(id), alt: '' }));
  }

  private caps(p: Player) {
    const v = this.view!;
    const groups: number[][] = [[], [], [], []];
    for (const id of v.captured[p]) groups[KIND_ORDER[CARDS[id].kind]].push(id);
    return h('div', { class: 'caps2d' }, groups.map((g) => h('div', { class: 'grp' }, g.sort((a, b) => a - b).map((id) => this.img(id, '', true)))));
  }

  private render() {
    const v = this.view;
    if (!v) return;
    const opp: Player = v.me === 0 ? 1 : 0;
    this.canvas.replaceChildren(
      h('div', { class: 'row opp' }, Array.from({ length: v.oppHand }, () => h('span', { class: 'card2d small back' }, h('img', { src: cardUrl(BACK), alt: '' })))),
      this.caps(opp),
      h('div', { class: 'mid' },
        h('div', { class: 'deck2d' }, h('img', { src: cardUrl(BACK), alt: '山' }), h('b', {}, String(v.deck))),
        h('div', { class: 'field2d' }, v.field.map((id) => this.img(id))),
        v.pendingDraw != null && v.phase === 'drawChoose' ? h('div', { class: 'reveal2d' }, h('small', {}, 'めくった札'), this.img(v.pendingDraw, 'revealed')) : null),
      this.caps(v.me),
      h('div', { class: 'row hand2d' }, v.hand.map((id) => this.img(id))),
    );
  }
}
