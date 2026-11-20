// 画面の切り替えと、対局の進行（コンピューター対戦・オンライン対戦）
import './style.css';
import { CARDS, KIND_NAMES } from './game/cards';
import { apply, newGame, type Action, type Ev, type Player, type State } from './game/koikoi';
import { LEVEL_NAMES, chooseAction, potential, type Level } from './game/ai';
import { viewOf, type View } from './game/view';
import { DEFAULT_OPTIONS, basePoints, yakuOf, type Options } from './game/yaku';
import { cardUrl } from './ui/art';
import { h } from './ui/dom';
import { play as sound, isMuted, setMuted } from './ui/sound';
import { Table2D } from './ui/table2d';
import { Table3D } from './ui/table3d';
import { onlineEntry, onlineState, type OnlineDriver } from './ui/online';

const app = document.getElementById('app')!;
const SETTINGS_KEY = 'hanafuda/settings-v1';
const SAVE_KEY = 'hanafuda/save-v1';
const load = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const store = (k: string, v: unknown) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない */ } };

interface Settings { level: Level; months: number; render: '3d' | '2d'; fx: 'full' | 'lite'; opts: Options }
const settings: Settings = { level: 'normal', months: 6, render: '3d', fx: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'lite' : 'full', ...(load<Partial<Settings>>(SETTINGS_KEY) ?? {}), opts: { ...DEFAULT_OPTIONS, ...(load<Settings>(SETTINGS_KEY)?.opts ?? {}) } };
const saveSettings = () => store(SETTINGS_KEY, settings);

// ---------- 対局の相手（コンピューター・オンライン）を同じ形で扱う ----------
export interface Driver {
  mode: 'cpu' | 'online';
  me: Player;
  names: [string, string];
  send(a: Action): void;
  shown(v: View): void; // 演出が終わった
  leave(): void;
  emote?(n: number): void;
  rematch?(): void;
  status?(): string; // 通信の様子など
}

function cpuDriver(level: Level, opts: Options, saved: State | null, onView: (v: View) => void): Driver {
  const s = saved ?? newGame((Math.random() * 2 ** 31) | 0, opts);
  const me: Player = 0;
  let stopped = false;
  const emit = () => { store(SAVE_KEY, s.phase === 'over' ? null : { s, level }); onView(viewOf(s, me)); };
  const d: Driver = {
    mode: 'cpu', me, names: ['あなた', `相手（${LEVEL_NAMES[level]}）`],
    send(a) { const r = apply(s, me, a); if (!r.ok) toast(r.error); emit(); },
    shown(v) {
      if (stopped || v.seq !== s.seq || s.turn !== 1 || !['play', 'drawChoose', 'koikoi'].includes(s.phase)) return;
      setTimeout(() => {
        if (stopped || v.seq !== s.seq) return;
        apply(s, 1, chooseAction(s, 1, level));
        emit();
      }, s.phase === 'koikoi' ? 900 : 650);
    },
    leave() { stopped = true; },
  };
  queueMicrotask(emit);
  return d;
}

// ---------- 対局の画面 ----------
type Table = Table3D | Table2D;
interface Game { finaleDone: boolean; pendingYaku: Extract<Ev, { k: 'yaku' }> | null; driver: Driver; table: Table; view: View | null; selected: number | null; cheer: number; supporters: number; modal: string | null; shown: number }
let game: Game | null = null;
const SPEED = new URLSearchParams(location.search).has('fast') ? 0.05 : 1; // 画面テスト用

function makeTable(): Table {
  if (settings.render === '3d') { const t = Table3D.create(); if (t) { t.setLite(settings.fx === 'lite'); return t; } toast('3D 表示が使えないため、2D で表示します'); }
  return new Table2D();
}

export function startGame(make: (onView: (v: View) => void) => Driver) {
  game?.driver.leave();
  game?.table.destroy();
  const table = makeTable();
  table.speed = SPEED;
  const g: Game = { finaleDone: false, pendingYaku: null, driver: null as unknown as Driver, table, view: null, selected: null, cheer: 0, supporters: 1200, modal: null, shown: -1 };
  game = g;
  table.onPick = (id) => onPick(g, id);
  renderGameShell(g);
  g.driver = make((v) => onView(g, v));
}

function onView(g: Game, v: View) {
  if (game !== g) return;
  g.view = v;
  g.selected = null;
  g.table.setInteraction({ pickable: new Set(), selected: null, targets: new Set() });
  void g.table.update(v, {
    onEvent: (ev) => onEvent(g, ev, v),
    onSound: (s) => sound(s),
    onCue: (name) => { if (name === 'yaku' && g.pendingYaku) { const y = g.pendingYaku; g.pendingYaku = null; yakuBanner(g, y); } },
  }).then(() => {
    if (game !== g || g.view !== v) return;
    refresh(g);
    g.shown = v.seq;
    g.driver.shown(v);
  });
  refreshPlates(g);
}

function onEvent(g: Game, ev: Ev | { k: 'deal'; round: number; dealer: Player }, v: View) {
  const me = g.driver.me;
  const nm = (p: Player) => (p === me ? 'あなた' : g.driver.names[p]);
  switch (ev.k) {
    case 'deal': {
      const last = ev.round >= v.opts.months;
      g.table.setMood(last ? 'final' : g.cheer > 0.85 ? 'cheer' : 'normal');
      if (!last) { banner(`第 ${ev.round} 月`, `親：${nm(ev.dealer)}`, '', 'slash'); break; }
      // 最終決戦：カウントダウン
      ['3', '2', '1'].forEach((n, i) => setTimeout(() => { if (game === g) { banner(n, '', 'final', 'count'); sound('count'); sound('beat'); } }, i * 520 * SPEED));
      setTimeout(() => { if (game === g) { banner('最終決戦', `${v.opts.months} 月目・これが最後の勝負`, 'final', 'slash'); sound('final'); } }, 1560 * SPEED);
      break;
    }
    case 'yaku':
      // 3D は演出の決めの瞬間（合図）に文字を出す。2D はすぐ出す
      if (g.table instanceof Table3D) g.pendingYaku = ev; else { yakuBanner(g, ev); sound('yaku'); }
      g.table.doPulse();
      if (ev.p === me) bumpCheer(g, 0.25);
      break;
    case 'koikoi':
      banner('こいこい！', `${nm(ev.p)}が勝負を続けます`, ev.p === me ? 'gold' : 'red', 'break');
      if (!(g.table instanceof Table3D)) sound('koikoi');
      g.table.doBurst();
      if (ev.p === me) bumpCheer(g, 0.15);
      break;
    case 'play': case 'draw':
      if (ev.p === me && ev.took.some((c) => CARDS[c].kind === 'hikari' || CARDS[c].tag)) bumpCheer(g, 0.06);
      break;
    case 'end': {
      const r = ev.result;
      if (r.winner != null && r.reason === 'stop') banner('勝負！', `${nm(r.winner)}の上がり`, r.winner === me ? 'gold' : 'red', 'break');
      if (r.winner === me) sound('win'); else if (r.winner != null) sound('lose');
      break;
    }
  }
}

// 応援ゲージ：自分の役の見込みと点差から決まり、良い場面で跳ね上がる（得点には関係しない演出）
function bumpCheer(g: Game, add: number) { g.cheer = Math.min(1, g.cheer + add); applyCheer(g); }
function applyCheer(g: Game) {
  const v = g.view;
  if (v) {
    const base = Math.min(1, potential(v.captured[g.driver.me]) / 70 + Math.max(0, v.scores[g.driver.me] - v.scores[1 - g.driver.me]) / 80);
    g.cheer = Math.max(base, g.cheer * 0.98);
  }
  g.table.cheer = g.cheer;
  g.supporters = Math.round(1200 + g.cheer ** 1.5 * 248_000);
  const bar = document.querySelector<HTMLElement>('.cheer i');
  if (bar) bar.style.width = `${Math.round(g.cheer * 100)}%`;
  const num = document.querySelector<HTMLElement>('.cheer b');
  if (num) num.textContent = g.supporters.toLocaleString('ja-JP');
  document.querySelector('.cheer')?.classList.toggle('full', g.cheer >= 0.85);
  if (g.cheer >= 0.85 && v && v.round < v.opts.months) g.table.setMood('cheer');
}

function renderGameShell(g: Game) {
  app.replaceChildren(h('div', { class: 'game' },
    g.table.canvas,
    h('header', { class: 'hud-top' },
      h('button', { class: 'btn sm ghost', onclick: () => { if (g.driver.mode === 'cpu' || confirm('対局をやめますか？')) { g.driver.leave(); g.table.destroy(); game = null; showTitle(); } } }, '← もどる'),
      h('b', { class: 'round' }, ''),
      h('span', { class: 'net' }, ''),
      h('button', { class: 'btn sm ghost', 'aria-label': '音', onclick: (e: Event) => { setMuted(!isMuted()); (e.currentTarget as HTMLElement).textContent = isMuted() ? '🔇' : '🔊'; } }, isMuted() ? '🔇' : '🔊'),
      h('a', { class: 'btn sm ghost', href: '/rules.html', target: '_blank', rel: 'noopener' }, '遊び方')),
    h('div', { class: 'plate opp' }), h('div', { class: 'plate me' }),
    h('div', { class: 'cheer', title: '応援ゲージ（演出です。得点には関係しません）' }, h('span', {}, '応援'), h('div', { class: 'bar' }, h('i')), h('span', { class: 'who' }, h('b', {}, '1,200'), ' 人')),
    h('div', { class: 'msg', role: 'status' }, ''),
    h('div', { class: 'actions' }),
    h('div', { class: 'banners', 'aria-live': 'polite' })));
}

function plate(g: Game, p: Player): (HTMLElement | null)[] {
  const v = g.view!;
  const cap = v.captured[p];
  const count = (k: string) => cap.filter((id) => CARDS[id].kind === k).length;
  const ys = yakuOf(cap, v.opts);
  return [
    h('div', { class: 'name' }, h('b', {}, g.driver.names[p]), v.dealer === p ? h('span', { class: 'tag' }, '親') : null, v.koikoi[p] ? h('span', { class: 'tag hot' }, `こいこい ${v.koikoi[p]}`) : null,
      v.turn === p && ['play', 'drawChoose', 'koikoi'].includes(v.phase) ? h('span', { class: 'turn' }, '手番') : null),
    h('div', { class: 'score' }, h('b', {}, String(v.scores[p])), ' 点'),
    h('div', { class: 'counts' }, (['hikari', 'tane', 'tan', 'kasu'] as const).map((k) => h('span', {}, `${KIND_NAMES[k]} ${count(k)}`))),
    ys.length ? h('div', { class: 'yaku' }, ys.map((y) => `${y.name} ${y.points}`).join('・')) : null,
  ];
}

function refreshPlates(g: Game) {
  const v = g.view;
  if (!v) return;
  const me = g.driver.me, opp: Player = me === 0 ? 1 : 0;
  document.querySelector('.plate.me')?.replaceChildren(...plate(g, me).filter((x): x is HTMLElement => !!x));
  document.querySelector('.plate.opp')?.replaceChildren(...plate(g, opp).filter((x): x is HTMLElement => !!x));
  const round = document.querySelector('.hud-top .round');
  if (round) round.textContent = `第 ${v.round} 月 / ${v.opts.months}`;
  const net = document.querySelector('.hud-top .net');
  if (net) net.textContent = g.driver.status?.() ?? '';
  applyCheer(g);
}

const matchesIn = (v: View, card: number) => v.field.filter((f) => f >> 2 === card >> 2);

function refresh(g: Game) {
  const v = g.view;
  if (!v) return;
  if (v.phase !== 'over') g.finaleDone = false;
  refreshPlates(g);
  const me = g.driver.me;
  const myTurn = v.turn === me && v.legal.length > 0;
  let msg = '';
  const inter = { pickable: new Set<number>(), selected: g.selected, targets: new Set<number>() };
  const actions: HTMLElement[] = [];
  if (v.phase === 'play' && myTurn) {
    v.hand.forEach((c) => inter.pickable.add(c));
    if (g.selected != null) {
      const m = matchesIn(v, g.selected);
      m.forEach((c) => inter.targets.add(c));
      msg = m.length === 0 ? '合わせる札がありません。もう一度押すか「場に出す」で場に置きます'
        : m.length === 2 ? '光っている札のどちらを取るか選んでください'
        : '光っている札を押すか、もう一度押すと取ります';
      if (m.length === 0) actions.push(h('button', { class: 'btn primary', id: 'discard', onclick: () => send(g, { type: 'play', card: g.selected! }) }, '場に出す'));
    } else msg = '手札から出す札を選んでください';
  } else if (v.phase === 'drawChoose' && myTurn) {
    matchesIn(v, v.pendingDraw!).forEach((c) => inter.targets.add(c));
    msg = 'めくった札で、どちらを取るか選んでください';
  } else if (v.phase === 'koikoi' && myTurn) {
    msg = '役ができました';
    showKoikoi(g);
  } else if (v.phase === 'roundEnd') {
    showRoundEnd(g);
  } else if (v.phase === 'over') {
    showOver(g);
  } else msg = `${g.driver.names[v.turn]}の番です`;
  if (v.phase !== 'koikoi' && v.phase !== 'roundEnd' && v.phase !== 'over') closeModal();
  actions.push(h('button', { class: 'btn sm', id: 'show-captured', onclick: () => showCaptured(g) }, '取り札を見る'));
  if (g.driver.emote) for (const [i, t] of EMOTES.entries()) actions.push(h('button', { class: 'btn sm emote', onclick: () => g.driver.emote!(i) }, t));
  document.querySelector('.msg')!.textContent = msg;
  document.querySelector('.actions')?.replaceChildren(...actions);
  g.table.setInteraction(inter);
}

export const EMOTES = ['よし！', 'こいこい！', 'まいった', 'おみごと'];

function onPick(g: Game, id: number) {
  const v = g.view;
  if (!v || v.turn !== g.driver.me) return;
  if (v.phase === 'drawChoose') { if (matchesIn(v, v.pendingDraw!).includes(id)) send(g, { type: 'pickDraw', target: id }); return; }
  if (v.phase !== 'play') return;
  if (v.hand.includes(id)) {
    if (g.selected === id) {
      const m = matchesIn(v, id);
      if (m.length !== 2) return send(g, { type: 'play', card: id });
      return;
    }
    g.selected = id;
    sound('select');
    return refresh(g);
  }
  if (g.selected != null && matchesIn(v, g.selected).includes(id)) {
    const m = matchesIn(v, g.selected);
    send(g, { type: 'play', card: g.selected, ...(m.length === 2 ? { target: id } : {}) });
  }
}

function send(g: Game, a: Action) {
  g.selected = null;
  g.table.setInteraction({ pickable: new Set(), selected: null, targets: new Set() });
  document.querySelector('.msg')!.textContent = '';
  g.driver.send(a);
}

// ---------- 小さな窓 ----------
function modal(id: string, ...children: (HTMLElement | null)[]) {
  const g = game!;
  if (g.modal === id && document.querySelector('.modal')) return;
  closeModal();
  g.modal = id;
  document.querySelector('.game')?.append(h('div', { class: 'modal', role: 'dialog', 'data-modal': id }, h('div', { class: 'modal-box' }, ...children)));
}
function closeModal() { document.querySelector('.modal')?.remove(); if (game) game.modal = null; }

function yakuList(ys: { name: string; points: number; cards: number[] }[]) {
  return h('ul', { class: 'yaku-list' }, ys.map((y) => h('li', {},
    h('span', { class: 'yn' }, y.name), h('b', {}, `${y.points} 点`),
    h('div', { class: 'mini' }, y.cards.slice(0, 10).map((c) => h('img', { src: cardUrl(c), alt: CARDS[c].name, title: CARDS[c].name }))))));
}

function showKoikoi(g: Game) {
  const v = g.view!;
  const ys = yakuOf(v.captured[g.driver.me], v.opts);
  const base = basePoints(ys);
  modal(`koikoi-${v.seq}`,
    h('h2', { class: 'big' }, '役ができました'),
    yakuList(ys),
    h('p', { class: 'note' }, `いま上がると ${base} 点${v.opts.double7 && base >= 7 ? '（7 点以上で倍）' : ''}${v.koikoi[1 - g.driver.me] ? '（相手がこいこいしているので倍）' : ''}。こいこいすると続けて役を増やせますが、相手が先に上がると相手の点が倍になります。`),
    h('div', { class: 'btns' },
      h('button', { class: 'btn big danger', id: 'koikoi', onclick: () => { closeModal(); send(g, { type: 'koikoi' }); } }, 'こいこい'),
      h('button', { class: 'btn big primary', id: 'stop', onclick: () => { closeModal(); send(g, { type: 'stop' }); } }, '勝負（上がる）')));
}

function showRoundEnd(g: Game) {
  const v = g.view!;
  const r = v.results.at(-1)!;
  const me = g.driver.me;
  const who = r.winner == null ? '流れ（引き分け）' : r.winner === me ? 'あなたの勝ち' : `${g.driver.names[r.winner]}の勝ち`;
  const reason = r.reason === 'teshi' ? '手四（同じ月の札 4 枚）' : r.reason === 'kuttsuki' ? 'くっつき（同じ月 2 枚が 4 組）' : r.reason === 'exhausted' ? '手札がなくなりました' : '';
  const last = v.round >= v.opts.months;
  modal(`end-${v.round}`,
    h('h2', { class: `big ${r.winner === me ? 'win' : r.winner == null ? '' : 'lose'}` }, who),
    reason ? h('p', {}, reason) : null,
    r.yaku.length ? yakuList(r.yaku) : null,
    r.winner != null ? h('p', { class: 'pts' }, `${r.base} 点${r.doubles.length ? ` → ${r.doubles.join('・')} → ` : ' → '}`, h('b', {}, `${r.points} 点`)) : null,
    h('p', { class: 'scores' }, `あなた ${v.scores[me]} 点 ／ ${g.driver.names[1 - me]} ${v.scores[1 - me]} 点`),
    h('div', { class: 'btns' }, h('button', { class: 'btn big primary', id: 'next', onclick: (e: Event) => { (e.currentTarget as HTMLButtonElement).disabled = true; if (!last) closeModal(); g.driver.send({ type: 'next' }); } }, last ? '結果を見る' : '次の月へ')));
}

function showOver(g: Game) {
  const v = g.view!;
  const me = g.driver.me;
  const win = v.scores[me] > v.scores[1 - me], draw = v.scores[me] === v.scores[1 - me];
  if (g.modal !== 'over' && !g.finaleDone) {
    g.finaleDone = true;
    if (g.table instanceof Table3D) void g.table.finale(win);
    banner(draw ? '引き分け' : win ? '完全勝利' : '敗北', '', win ? 'gold' : 'red', 'slash');
    setTimeout(() => { if (game === g && g.view?.phase === 'over') { g.modal = null; showOver(g); } }, 1800 * SPEED);
    g.modal = 'over-wait';
    return;
  }
  modal('over',
    h('h2', { class: `big ${win ? 'win' : draw ? '' : 'lose'}` }, draw ? '引き分け' : win ? 'あなたの勝ち！' : 'あなたの負け'),
    h('p', { class: 'scores' }, `あなた ${v.scores[me]} 点 ／ ${g.driver.names[1 - me]} ${v.scores[1 - me]} 点`),
    h('ol', { class: 'history' }, v.results.map((r, i) => h('li', {}, `第 ${i + 1} 月：${r.winner == null ? '流れ' : `${r.winner === me ? 'あなた' : '相手'} +${r.points}（${r.yaku.map((y) => y.name).join('・') || (r.reason === 'teshi' ? '手四' : 'くっつき')}）`}`))),
    h('div', { class: 'btns' },
      g.driver.mode === 'cpu' ? h('button', { class: 'btn big primary', id: 'again', onclick: () => startCpu() }, 'もう一度') : h('button', { class: 'btn big primary', id: 'rematch', onclick: (e: Event) => { (e.currentTarget as HTMLButtonElement).disabled = true; g.driver.rematch?.(); } }, 'もう一局'),
      h('button', { class: 'btn big', onclick: () => { g.driver.leave(); g.table.destroy(); game = null; showTitle(); } }, 'タイトルへ')));
}

function showCaptured(g: Game) {
  const v = g.view!;
  const me = g.driver.me;
  const box = (p: Player) => h('section', {},
    h('h3', {}, g.driver.names[p]),
    (['hikari', 'tane', 'tan', 'kasu'] as const).map((k) => {
      const cs = v.captured[p].filter((id) => CARDS[id].kind === k);
      return h('div', { class: 'cap-row' }, h('span', {}, `${KIND_NAMES[k]} ${cs.length}`), h('div', { class: 'mini' }, cs.map((c) => h('img', { src: cardUrl(c), alt: CARDS[c].name, title: CARDS[c].name }))));
    }));
  const prev = g.modal;
  modal('captured', h('h2', {}, '取り札'), box(me), box(me === 0 ? 1 : 0),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { closeModal(); if (prev) refresh(g); } }, '閉じる')));
}

// ---------- 大きな文字の演出 ----------
// style：slash＝斬り込む、break＝突き破る、count＝数字、yaku＝一文字ずつ
function banner(text: string, sub = '', kind: '' | 'gold' | 'red' | 'final' = '', style: '' | 'slash' | 'break' | 'count' | 'yaku' = '') {
  const box = document.querySelector('.banners');
  if (!box) return null;
  const chars = [...text].map((ch, i) => h('span', { style: { '--d': `${i * 0.06}s` } }, ch));
  const el = h('div', { class: `banner ${kind} ${style} ${settings.fx === 'lite' ? 'lite' : ''}` }, h('div', { class: 'bt', 'data-text': text }, chars), sub ? h('div', { class: 'bs' }, sub) : null);
  box.append(el);
  setTimeout(() => el.remove(), Math.max(400, (style === 'count' ? 600 : style === 'yaku' ? 2600 : 2200) * SPEED));
  return el;
}
function yakuBanner(g: Game, ev: Extract<Ev, { k: 'yaku' }>) {
  const me = g.driver.me;
  const who = ev.p === me ? 'あなた' : g.driver.names[ev.p];
  const el = banner(ev.yaku.map((y) => y.name).join('・'), `${who}　0 点`, ev.p === me ? 'gold' : 'red', 'yaku');
  const sub = el?.querySelector('.bs');
  if (!sub) return;
  let n = 0;
  const step = () => { n++; sub.textContent = `${who}　${n} 点`; if (n < ev.base) setTimeout(step, Math.max(10, 90 * SPEED)); };
  setTimeout(step, 250 * SPEED);
}
function toast(text: string) {
  const el = h('div', { class: 'toast', role: 'alert' }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 2600);
}

// ---------- タイトル ----------
function startCpu(saved: { s: State; level: Level } | null = null) {
  const level = saved?.level ?? settings.level;
  startGame((onView) => cpuDriver(level, { ...settings.opts, months: settings.months }, saved?.s ?? null, onView));
}

function showTitle() {
  history.replaceState(null, '', location.pathname + (SPEED < 1 ? '?fast' : ''));
  const saved = load<{ s: State; level: Level }>(SAVE_KEY);
  const chip = <T,>(name: string, cur: T, val: T, label: string, set: (v: T) => void) =>
    h('label', { class: 'chip' }, h('input', { type: 'radio', name, checked: cur === val, onchange: () => { set(val); saveSettings(); showTitle(); } }), h('span', {}, label));
  const check = (key: keyof Options, label: string) =>
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!settings.opts[key], onchange: (e: Event) => { (settings.opts[key] as boolean) = (e.target as HTMLInputElement).checked; saveSettings(); } }), h('span', {}, label));
  app.replaceChildren(h('div', { class: 'title' },
    h('div', { class: 'title-bg', 'aria-hidden': 'true' }, Array.from({ length: 12 }, (_, i) => h('img', { src: cardUrl([0, 8, 28, 40, 44, 20, 24, 36, 4, 12, 16, 32][i]), style: { '--i': String(i), top: `${8 + ((i * 37) % 72)}%` } }))),
    h('main', { class: 'title-main' },
      h('h1', {}, h('span', {}, '電光花札'), h('small', {}, 'こいこい')),
      h('p', { class: 'lead' }, '光の空間に浮かぶ花札で、こいこい勝負。'),
      saved ? h('button', { class: 'btn big primary', id: 'resume', onclick: () => startCpu(saved) }, `つづきから（第 ${saved.s.round} 月・${saved.s.scores[0]} 対 ${saved.s.scores[1]}）`) : null,
      h('section', { class: 'panel' },
        h('h2', {}, 'コンピューターと対戦'),
        h('div', { class: 'chips' }, (Object.keys(LEVEL_NAMES) as Level[]).map((l) => chip('level', settings.level, l, LEVEL_NAMES[l], (v) => { settings.level = v; }))),
        h('div', { class: 'chips' }, [3, 6, 12].map((m) => chip('months', settings.months, m, `${m} か月`, (v) => { settings.months = v; }))),
        h('button', { class: 'btn big primary', id: 'start-cpu', onclick: () => { store(SAVE_KEY, null); startCpu(); } }, '勝負をはじめる')),
      h('section', { class: 'panel' },
        h('h2', {}, 'オンライン対戦'),
        h('p', { class: 'note' }, '合言葉で部屋を作り、友だちと対戦します。'),
        h('button', { class: 'btn big', id: 'online', onclick: () => showOnline() }, '合言葉で対戦する')),
      h('section', { class: 'panel' },
        h('h2', {}, '設定'),
        h('div', { class: 'chips' }, chip<Settings['fx']>('fx', settings.fx, 'full', '演出：派手', (v) => { settings.fx = v; }), chip<Settings['fx']>('fx', settings.fx, 'lite', '演出：控えめ', (v) => { settings.fx = v; })),
        h('div', { class: 'chips' }, chip<Settings['render']>('render', settings.render, '3d', '3D 表示', (v) => { settings.render = v; }), chip<Settings['render']>('render', settings.render, '2d', '2D 表示（軽い）', (v) => { settings.render = v; })),
        h('div', { class: 'checks' },
          check('drinks', '花見で一杯・月見で一杯'), check('sakeAsKasu', '菊に盃をカスにも数える'),
          check('double7', '7 点以上は倍'), check('koikoiDouble', 'こいこいした相手から上がると倍'))),
      h('p', { class: 'foot' }, h('a', { href: '/rules.html' }, '遊び方・役の一覧')))));
}

function showOnline() {
  game?.driver.leave(); game?.table.destroy(); game = null;
  app.replaceChildren(onlineEntry({
    render: showOnline,
    back: showTitle,
    start: (make: (onView: (v: View) => void) => OnlineDriver) => startGame(make),
    opts: () => ({ ...settings.opts, months: settings.months }),
  }));
}

// 画面テスト用：札の画面上の位置
(window as unknown as { __hana: unknown }).__hana = {
  screenOf: (id: number) => game?.table.screenOf(id) ?? null,
  view: () => game?.view ?? null,
  sample: () => game?.table.sample() ?? Promise.resolve(0),
  ready: () => !!game?.view && game.shown === game.view.seq,
};

const room = new URLSearchParams(location.search).get('room');
if (room) { onlineState.pendingCode = room.toUpperCase(); showOnline(); } else showTitle();
