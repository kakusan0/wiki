import './style.css';
import { decide } from './game/ai';
import { MAPS, getMap, landingAfter, landingByDice } from './game/maps';
import type { Action, CpuLevel, GameState, Mode } from './game/state';
import { actor, apply, canBuyStock, newGame } from './game/turn';
import { OnlineClient, createRoom, findMatch, savedSession, type RoomView } from './net/online';
import { renderBoard, type BoardView } from './ui/board2d';
import { createBoard3D, DETAIL_NAMES, DICE_MS, type Board3D, type Detail } from './ui/board3d';
import { h } from './ui/dom';
import { renderActions, renderInfo, renderLog, renderMe, renderPlayers, renderStocks, renderStreetInfo } from './ui/panels';

const SAVE_KEY = 'machikado-board/save-v1';
const SETTINGS_KEY = 'machikado-board/settings-v1';
const MUTE_KEY = 'machikado-board/mute-v1';
const app = document.getElementById('app')!;

interface Settings {
  mapId: string; mode: Mode; cpu: CpuLevel; name: string; fast: boolean; view: '2d' | '3d'; detail: Detail;
  hideNames: boolean; // オンラインで相手の名前を表示しない
}
const CPU_LABEL: Record<CpuLevel, string> = { easy: 'やさしい', normal: 'ふつう', hard: 'つよい' };
const phone = window.matchMedia('(max-width: 600px)').matches;
const defaults: Settings = {
  mapId: 'corner', mode: 'normal', cpu: 'normal', name: 'あなた', fast: false, view: '3d', detail: phone ? 'mid' : 'high', hideNames: false,
};

function load<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function store(key: string, v: unknown) {
  try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch { /* 保存できなくても遊べる */ }
}

let settings: Settings = { ...defaults, ...(load<Settings>(SETTINGS_KEY) ?? {}) };
let state: GameState | null = null;
let tokens: number[] | undefined;
let selected: number | null = null;
let busy = false;
let timer: number | undefined;
let board3d: Board3D | null = null;
let no3d = false; // WebGL が使えない端末

// オンライン
let online: OnlineClient | null = null;
let room: RoomView | null = null;
let netStatus: 'connecting' | 'open' | 'closed' = 'closed';
let notice = '';
let remainUntil = 0; // 自分の判断の締め切り（この端末の時計で）
let tick: number | undefined;
// コマが動いているあいだの道すじと到着マス（画面の演出用）
let moving: { trail: number[]; dest: number; step: number; label: string } | null = null;
const queue: RoomView[] = [];
const bubbles = new Map<number, { text: string; until: number }>();
const muted = new Set<number>(load<number[]>(MUTE_KEY) ?? []);

// 株式市場タブ：株を買えるときに自動で開き、終わったら盤面に戻す
let tab: 'board' | 'market' | 'players' = 'board'; // Tab 型と同じ
let autoKey = ''; // 自動で開いた「買える場面」の目印
let pickStreet: number | null = null; // 株式市場で選んだ通り（2D の盤面で点滅）
let scrollToPick = false; // 選んだ通りの情報まで画面を動かす

function get3d(): Board3D | null {
  if (no3d) return null;
  if (!board3d) {
    board3d = createBoard3D(settings.detail);
    if (!board3d) no3d = true;
  }
  return board3d;
}
const use3d = () => settings.view === '3d' && !!get3d();
const mySeat = () => (room ? room.you : 0);

const delay = (ms: number) => new Promise((r) => { timer = window.setTimeout(r, settings.fast ? ms / 3 : ms); });

// サイコロとコマの移動を見せる（1 人用・オンライン共通）
async function present(prev: GameState, next: GameState, type: Action['type']) {
  // 銀行での株の売り買いを終えて進むときも、コマの移動を見せる
  const resumes = type === 'skip' && prev.pending?.kind === 'bankStock';
  if (type === 'roll' || type === 'move' || resumes) {
    busy = true;
    state = { ...prev, dice: next.dice, pending: null };
    // 進む道と到着マスを、動き出す前から見せる
    const path = next.path;
    const map = getMap(next.mapId);
    const dest = path[path.length - 1];
    const fork = next.pending?.kind === 'direction';
    const dice = type === 'roll' && next.dice ? `🎲${next.dice}` : '';
    const who = prev.turn === mySeat() ? '' : `${prev.players[prev.turn].name}：`;
    moving = {
      trail: path.slice(1), dest, step: 0,
      label: fork ? `${who}${dice} 分かれ道まで進んで方向を選ぶ` : `${who}${dice} ${map.squares[dest].name} に止まる`,
    };
    if (type === 'roll' && use3d()) {
      // 3D はサイコロが転がって止まるのを見せてからコマを動かす
      render();
      await delay(DICE_MS + 150);
    }
    for (const [k, sq] of next.path.slice(1).entries()) {
      tokens = prev.players.map((p, i) => (i === prev.turn ? sq : p.pos));
      moving.step = k + 1;
      render();
      await delay(170);
    }
    tokens = undefined;
    moving = null;
    busy = false;
  }
  state = next;
  render();
}

async function act(a: Action) {
  if (!state || busy) return;
  if (online) {
    if (actor(state) !== mySeat()) return; // 競売中は入札する人
    online.act(a);
    return;
  }
  const prev = state;
  let next: GameState;
  try { next = apply(prev, a); } catch (e) { console.warn(e); return; }
  await present(prev, next, a.type);
  store(SAVE_KEY, next.phase === 'over' ? null : next);
  void cpuStep();
}

async function cpuStep() {
  if (online || !state || state.phase === 'over' || busy) return;
  const p = state.players[actor(state)]; // 競売中は入札する人
  if (!p.cpu) return;
  await delay(state.phase === 'roll' ? 650 : 450);
  if (!state || busy || online) return;
  await act(decide(state));
}

// ---------- オンライン ----------
function goOnline(code: string) {
  online?.leave();
  room = null;
  state = null;
  notice = '';
  queue.length = 0;
  history.replaceState(null, '', `/?room=${code}`);
  online = new OnlineClient(code, settings.name, {
    onView: (v) => { queue.push(v); void drain(); },
    onEmote: (seat, id) => {
      if (muted.has(seat)) return;
      bubbles.set(seat, { text: online?.emotes[id] ?? '', until: Date.now() + 4000 });
      render();
      window.setTimeout(render, 4100);
    },
    onError: (msg, fatal) => {
      notice = msg;
      if (fatal) { online = null; room = null; state = null; history.replaceState(null, '', '/'); }
      render();
    },
    onStatus: (st) => { netStatus = st; render(); },
  });
  online.connect();
  window.clearInterval(tick);
  tick = window.setInterval(() => { if (room && (room.remainMs != null || room.autoStartIn != null || !room.game)) updateTimers(); }, 1000);
  render();
}

// 届いた状態を順番に見せる（演出の途中で次が届いても、順に処理する）
let draining = false;
async function drain() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    const v = queue.shift()!;
    const prev = state;
    const prevMoves = room?.moves ?? -1;
    room = v;
    remainUntil = v.remainMs != null ? Date.now() + v.remainMs : 0;
    // 1 手だけ進んだときは、サイコロとコマの動きを見せる（つなぎ直しなどで飛んだときはそのまま表示）
    if (v.game && prev && v.last && v.moves === prevMoves + 1 && v.last.seat === prev.turn) {
      await present(prev, v.game, v.last.type);
    } else {
      state = v.game;
      render();
    }
  }
  draining = false;
}

function leaveOnline() {
  online?.leave();
  online = null;
  room = null;
  state = null;
  window.clearInterval(tick);
  history.replaceState(null, '', '/');
  render();
}

function updateTimers() {
  const el = document.querySelector('[data-timer]');
  if (el && remainUntil) el.textContent = `残り ${Math.max(0, Math.ceil((remainUntil - Date.now()) / 1000))} 秒`;
  const a = document.querySelector('[data-autostart]');
  if (a && room?.autoStartIn != null) a.textContent = `まもなく開始（約 ${Math.max(0, Math.ceil(room.autoStartIn / 1000))} 秒）`;
}

// 相手の名前を隠す設定のとき、表示用の状態の名前を置き換える
function shown(s: GameState): GameState {
  if (!online || !settings.hideNames) return s;
  const me = mySeat();
  const alias = s.players.map((p, i) => (i === me || p.cpu ? p.name : `相手${i + 1}`));
  const fix = (text: string) => s.players.reduce((t, p, i) => (alias[i] === p.name ? t : t.replaceAll(p.name, alias[i])), text);
  return {
    ...s,
    players: s.players.map((p, i) => ({ ...p, name: alias[i] })),
    log: s.log.map((e) => ({ ...e, text: fix(e.text) })),
  };
}

// ---------- 画面 ----------
function render() {
  if (online && !state) return renderLobby();
  if (!state) return renderSetup();
  const s = shown(state);
  const me = mySeat();
  // 自分の番で株を買える場面になったら株式市場タブを開き、場面が終わったら盤面に戻す
  const chance = s.mode === 'normal' && s.turn === me && !busy && canBuyStock(s);
  const key = chance ? `${s.round}:${s.turn}:${s.phase}:${s.pending?.kind ?? ''}` : '';
  if (key && key !== autoKey) { tab = 'market'; autoKey = key; }
  if (!key && autoKey && !busy) { tab = 'board'; autoKey = ''; pickStreet = null; }
  const view = h('div', { class: 'game' },
    h('header', { class: 'top' },
      h('b', {}, 'まちかど商店街ボード'),
      h('span', { class: 'mode' }, s.mode === 'easy' ? 'かんたん' : 'ふつう'),
      online ? h('span', { class: 'mode online' }, `オンライン・${online.code}${netStatus !== 'open' ? '（再接続中…）' : ''}`) : null,
      h('div', { class: 'seg', role: 'group', 'aria-label': '盤面の表示' },
        (['2d', '3d'] as const).map((v) => h('button', {
          class: `btn sm${settings.view === v ? ' on' : ''}`, 'aria-pressed': String(settings.view === v),
          onclick: () => { settings.view = v; store(SETTINGS_KEY, settings); render(); },
        }, v.toUpperCase()))),
      settings.view === '3d' && !no3d ? h('label', { class: 'detail' }, '細かさ ',
        h('select', { onchange: (e: Event) => {
          settings.detail = (e.target as HTMLSelectElement).value as Detail; store(SETTINGS_KEY, settings);
          board3d?.setDetail(settings.detail); render();
        } }, (Object.keys(DETAIL_NAMES) as Detail[]).map((d) => h('option', { value: d, selected: settings.detail === d }, DETAIL_NAMES[d])))) : null,
      h('label', { class: 'fast' }, h('input', { type: 'checkbox', checked: settings.fast, onchange: (e: Event) => {
        settings.fast = (e.target as HTMLInputElement).checked; store(SETTINGS_KEY, settings);
      } }), ' 早送り'),
      h('a', { href: '/rules.html', target: '_blank', rel: 'noopener', class: 'link' }, '遊び方'),
      h('button', { class: 'btn sm', onclick: () => {
        if (online) {
          if (s.phase !== 'over' && !confirm('対戦をぬけますか？（あなたの席はコンピューターが代わりに進めます）')) return;
          window.clearTimeout(timer); busy = false; leaveOnline();
          return;
        }
        if (s.phase !== 'over' && !confirm('いまのゲームをやめてタイトルに戻りますか？（途中経過は消えます）')) return;
        window.clearTimeout(timer); busy = false; state = null; store(SAVE_KEY, null); render();
      } }, online ? 'ぬける' : 'やめる')),
    renderTabs(s),
    h('div', { class: `tab-body${slideFrom ? ` slide-${slideFrom}` : ''}` },
      tab === 'players' ? renderPlayersTab(s)
        : tab === 'market' && s.mode === 'normal' ? renderMarket(s)
        : h('main', { class: 'layout' },
          h('div', { class: 'board-wrap' }, renderMe(s, me, latestBubble(s)), boardEl(s)),
          h('div', { class: 'side' },
            online ? renderOnlineBar(s) : null,
            renderActions(s, act, busy, me),
            renderInfo(s, selected, act, me, busy),
            renderStocks(s, act, busy, me),
            renderLog(s)))));
  slideFrom = null;
  app.replaceChildren(view);
  updateTimers();
  if (scrollToPick) {
    scrollToPick = false;
    // 選んだ通りの情報が画面の外なら、見える位置まで動かす
    const el = document.querySelector('.street-info, .layout.market .info');
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
}

// オンライン中：残り時間・定型メッセージ・ミュート
function renderOnlineBar(s: GameState): HTMLElement {
  const me = mySeat();
  const turnIsMine = s.turn === me && s.phase !== 'over';
  return h('section', { class: 'panel online-bar' },
    room?.remainMs != null && s.phase !== 'over'
      ? h('p', { class: `timer${turnIsMine ? ' mine' : ''}` }, turnIsMine ? 'あなたの番：' : `${s.players[s.turn].name}の番：`,
        h('b', { 'data-timer': '' }, ''), turnIsMine ? '（過ぎるとコンピューターが代わりに進めます）' : '')
      : null,
    h('div', { class: 'emotes', role: 'group', 'aria-label': '定型メッセージ' },
      (online?.emotes ?? []).map((t, i) => h('button', { class: 'btn sm', onclick: () => online?.emote(i) }, t))),
    h('details', { class: 'mutes' }, h('summary', {}, '表示の設定'),
      h('label', {}, h('input', { type: 'checkbox', checked: settings.hideNames, onchange: (e: Event) => {
        settings.hideNames = (e.target as HTMLInputElement).checked; store(SETTINGS_KEY, settings); render();
      } }), ' 相手の名前を表示しない'),
      s.players.map((p, i) => (i === me || p.cpu ? null : h('label', {}, h('input', { type: 'checkbox', checked: muted.has(i), onchange: (e: Event) => {
        if ((e.target as HTMLInputElement).checked) muted.add(i); else muted.delete(i);
        store(MUTE_KEY, [...muted]);
      } }), ` ${p.name}のメッセージを表示しない`)))));
}

// 定型メッセージ（オンライン）のうち、いま出しているもの。自分の帯の下に出す
function latestBubble(s: GameState): string | null {
  let best: { seat: number; until: number; text: string } | null = null;
  for (const [seat, b] of bubbles) if (b.until > Date.now() && (!best || b.until > best.until)) best = { seat, ...b };
  return best ? `${s.players[best.seat].name}「${best.text}」` : null;
}

// プレイヤータブ：全員の情報（お店・持ち株）とできごと
function renderPlayersTab(s: GameState): HTMLElement {
  const me = mySeat();
  return h('main', { class: 'layout players-tab' },
    h('div', { class: 'side' },
      renderPlayers(s, {
        you: me, detailed: true,
        status: (pid) => {
          const seat = room?.seats[pid];
          if (!online || !seat || seat.cpu) return null;
          return seat.connected ? null : '切断中（CPU が代わりに進めます）';
        },
        bubble: (pid) => { const b = bubbles.get(pid); return b && b.until > Date.now() ? b.text : null; },
      })),
    h('div', { class: 'side' }, renderActions(s, act, busy, me), renderLog(s)));
}

function renderTabs(s: GameState): HTMLElement | null {
  const chance = s.mode === 'normal' && s.turn === mySeat() && !busy && canBuyStock(s);
  const btn = (id: 'board' | 'market' | 'players', label: string, badge?: string) => h('button', {
    class: `tab${tab === id ? ' on' : ''}`, role: 'tab', 'aria-selected': String(tab === id),
    onclick: () => { tab = id; render(); },
  }, label, badge ? h('span', { class: 'badge' }, badge) : null);
  const order = tabOrder(s);
  return h('div', { class: 'tabs-wrap' },
    h('nav', { class: 'tabs', role: 'tablist', 'aria-label': '表示の切り替え' },
      btn('board', '盤面'), s.mode === 'normal' ? btn('market', '株式市場', chance ? '買えます' : undefined) : null, btn('players', 'プレイヤー')),
    // スマホ：いま何番目のタブか（横に払って移れる）
    h('div', { class: 'tab-dots', 'aria-hidden': 'true' }, order.map((id) => h('i', { class: id === tab ? 'on' : '' })),
      h('small', {}, '← 横に払ってタブを移動 →')));
}

// ---------- フリック（横に払う）でタブを移る ----------
type Tab = 'board' | 'market' | 'players';
let slideFrom: 'left' | 'right' | null = null; // 新しいタブの中身をどちらから滑り込ませるか
const tabOrder = (s: GameState): Tab[] => (s.mode === 'normal' ? ['board', 'market', 'players'] : ['board', 'players']);

function moveTab(dir: 1 | -1) {
  if (!state) return;
  const order = tabOrder(state);
  const i = Math.max(0, order.indexOf(tab));
  const j = i + dir;
  if (j < 0 || j >= order.length) return; // 端では止まる
  tab = order[j];
  slideFrom = dir > 0 ? 'right' : 'left';
  render();
}

// フリックとして扱わない場所：3D の盤面（回転のドラッグ）、入力欄、横にスクロールできる要素の中
function swipeBlocked(el: EventTarget | null): boolean {
  for (let n = el as HTMLElement | null; n && n !== document.body; n = n.parentElement) {
    if (n.matches?.('.board3d, input, select, textarea')) return true;
    if (n.scrollWidth > n.clientWidth + 2 && ['auto', 'scroll'].includes(getComputedStyle(n).overflowX)) return true;
  }
  return false;
}

let swipe: { x: number; y: number; t: number } | null = null;
document.addEventListener('touchstart', (e) => {
  swipe = null;
  if (e.touches.length !== 1 || !state || swipeBlocked(e.target)) return;
  const t = e.touches[0];
  swipe = { x: t.clientX, y: t.clientY, t: Date.now() };
}, { passive: true });
document.addEventListener('touchmove', (e) => { if (e.touches.length !== 1) swipe = null; }, { passive: true });
document.addEventListener('touchend', (e) => {
  const st = swipe;
  swipe = null;
  if (!st || e.changedTouches.length !== 1) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - st.x, dy = t.clientY - st.y;
  if (Date.now() - st.t > 600 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
  moveTab(dx < 0 ? 1 : -1); // 左へ払うと次のタブ
}, { passive: true });

// 株式市場タブ：左に 2D の盤面（選んだ通りが点滅）、右に操作と株式市場
function renderMarket(s: GameState): HTMLElement {
  const me = mySeat();
  const map = getMap(s.mapId);
  // マップのお店を押したら、その通りを選ぶ（表の行も黄色くなり、通りのマスが点滅）
  const v: BoardView = { selected, highlightStreet: pickStreet, me: mySeat(), landing: landingFor(s), ...arrivalFor(s), onSelect: (sq) => {
    const q = map.squares[sq];
    if (q.kind === 'shop') {
      const again = selected === sq;
      selected = again ? null : sq;
      pickStreet = again ? null : q.street!;
    } else {
      selected = selected === sq ? null : sq;
    }
    scrollToPick = true;
    render();
  } };
  const pickedNonShop = selected != null && map.squares[selected].kind !== 'shop';
  return h('main', { class: 'layout market' },
    h('div', { class: 'board-wrap' }, renderMe(s, me, latestBubble(s)), renderBoard(s, v)),
    h('div', { class: 'side' },
      renderActions(s, act, busy, me),
      // 選んだ通りの情報は、株式市場の表より上に出す
      pickStreet != null
        ? renderStreetInfo(s, act, busy, me, pickStreet, selected, () => { pickStreet = null; selected = null; render(); })
        : null,
      pickedNonShop ? renderInfo(s, selected, act, me, busy) : null,
      renderStocks(s, act, busy, me, {
        wide: true, highlight: pickStreet,
        onPick: (st) => { pickStreet = pickStreet === st ? null : st; selected = null; scrollToPick = true; render(); },
      })));
}

// 止まる候補：自分の番でサイコロを振る前は目ごと（🎲3 など）、分かれ道では選んだ先で止まるマス
function landingFor(s: GameState): Map<number, string> | undefined {
  if (s.turn !== mySeat() || busy || s.phase === 'over') return undefined;
  const map = getMap(s.mapId);
  const p = s.players[s.turn];
  if (s.phase === 'roll') {
    const out = new Map<number, string>();
    for (const [sq, ds] of landingByDice(map, p.pos, p.prev)) out.set(sq, `🎲${ds.join('・')}`);
    return out;
  }
  if (s.pending?.kind === 'direction' && s.moving) {
    const out = new Map<number, string>();
    for (const o of s.pending.options) for (const sq of landingAfter(map, o, p.pos, s.moving.left - 1)) out.set(sq, '止まる');
    return out;
  }
  return undefined;
}

// 到着マスの表示：動いているあいだは「ここに止まる」、止まったあとはその番の終わりまで「到着」
function arrivalFor(s: GameState): Pick<BoardView, 'trail' | 'dest' | 'destText' | 'stepsLeft' | 'message'> {
  if (moving) {
    return {
      trail: moving.trail.slice(moving.step), dest: moving.dest, destText: 'ここに止まる',
      stepsLeft: moving.trail.length - moving.step, message: moving.label,
    };
  }
  const p = s.players[s.turn];
  const last = s.path[s.path.length - 1];
  if ((s.phase === 'decide' || s.phase === 'stock') && s.dice && s.path.length > 1 && last === p.pos && s.pending?.kind !== 'direction') {
    const who = s.turn === mySeat() ? '' : `${p.name}：`;
    return { dest: p.pos, destText: '到着', message: `${who}🎲${s.dice} ${getMap(s.mapId).squares[p.pos].name} に到着` };
  }
  return {};
}

function boardEl(s: GameState): HTMLElement {
  const human = s.turn === mySeat() && !busy;
  const choices = human && s.pending?.kind === 'direction' ? s.pending.options : undefined;
  const v: BoardView = { tokens, selected, choices, me: mySeat(), landing: landingFor(s), ...arrivalFor(s), onSelect: (sq) => {
    if (choices?.includes(sq)) { void act({ type: 'move', to: sq }); return; }
    selected = selected === sq ? null : sq; render();
  } };
  if (settings.view === '3d') {
    const b = get3d();
    if (b) {
      b.update(s, v);
      return b.el;
    }
    return h('div', {}, h('p', { class: 'notice' }, 'この端末では 3D の盤面を表示できないため、2D で表示しています。'), renderBoard(s, v));
  }
  return renderBoard(s, v);
}

// 対戦が始まる前の待合室
function renderLobby() {
  const r = room;
  const code = online!.code;
  const invite = `${location.origin}${import.meta.env.BASE_URL}?room=${code}`;
  const map = r ? getMap(r.mapId) : null;
  app.replaceChildren(h('div', { class: 'setup lobby' },
    h('h1', {}, r?.isPrivate === false ? '相手を探しています' : '対戦の待合室'),
    netStatus !== 'open' ? h('p', { class: 'lead' }, 'サーバーにつないでいます…') : null,
    notice ? h('p', { class: 'error', role: 'alert' }, notice) : null,
    r ? h('p', { class: 'lead' }, `${map!.name}・${r.mode === 'easy' ? 'かんたん' : 'ふつう'}・空いた席の CPU：${CPU_LABEL[r.cpu ?? 'normal']}`) : null,
    r?.isPrivate ? h('div', { class: 'panel' },
      h('h2', {}, '合言葉'),
      h('p', { class: 'code' }, code),
      h('p', {}, 'この合言葉か、下の URL を一緒に遊ぶ人に送ってください。'),
      h('div', { class: 'btns' },
        h('button', { class: 'btn', onclick: () => { void navigator.clipboard?.writeText(invite); notice = 'URL をコピーしました'; render(); } }, '招待 URL をコピー'),
        navigator.share ? h('button', { class: 'btn', onclick: () => { void navigator.share({ title: 'まちかど商店街ボード', text: `合言葉 ${code} で一緒に遊ぼう`, url: invite }).catch(() => {}); } }, '送る') : null)) : null,
    r ? h('div', { class: 'panel' },
      h('h2', {}, `参加者（${r.seats.length}/4）`),
      h('ol', { class: 'seats' }, r.seats.map((s0, i) => h('li', {}, s0.name, i === r.you ? '（あなた）' : ''))),
      r.autoStartIn != null ? h('p', { 'data-autostart': '' }, '') : null,
      !r.isPrivate && r.seats.length === 1 ? h('p', {}, '1 分待っても相手が来ないときは、コンピューターと始められます。') : null,
      r.isPrivate && !r.host ? h('p', {}, '部屋を作った人が始めるのを待っています。') : null,
      h('p', { class: 'note' }, '空いた席にはコンピューターが入ります。') ) : null,
    r?.canStart ? h('button', { class: 'btn primary big', onclick: () => online?.start() }, r.isPrivate ? 'この人数で始める' : 'コンピューターと始める') : null,
    h('button', { class: 'btn', onclick: leaveOnline }, 'やめる')));
  updateTimers();
}

function renderSetup() {
  const saved = load<GameState>(SAVE_KEY);
  const radio = <K extends keyof Settings>(key: K, value: Settings[K], label: string, sub: string) =>
    h('label', { class: 'opt' },
      h('input', { type: 'radio', name: key, checked: settings[key] === value, onchange: () => { settings[key] = value; } }),
      h('span', {}, h('b', {}, label), h('small', {}, sub)));
  const name = h('input', { type: 'text', value: settings.name, maxlength: '8', 'aria-label': 'あなたの名前' });
  const codeIn = h('input', { type: 'text', maxlength: '6', placeholder: '例：AB23CD', 'aria-label': '合言葉', autocapitalize: 'characters' });
  const keep = () => { settings.name = name.value.trim() || 'あなた'; store(SETTINGS_KEY, settings); };
  const goWith = async (p: Promise<{ code?: string; error?: string }>) => {
    keep();
    const r = await p;
    if (r.code) goOnline(r.code);
    else { notice = r.error ?? 'うまくいきませんでした'; render(); }
  };
  const resume = savedSession();
  app.replaceChildren(h('div', { class: 'setup' },
    h('h1', {}, 'まちかど商店街ボード'),
    h('p', { class: 'lead' }, 'お店を買って、増資して、株で稼いで。目標の総資産に届いたら銀行へ戻ろう。'),
    notice ? h('p', { class: 'error', role: 'alert' }, notice) : null,
    saved ? h('button', { class: 'btn primary big', onclick: () => { state = saved; render(); void cpuStep(); } },
      `つづきから（${saved.round} 周目）`) : null,
    resume ? h('button', { class: 'btn big', onclick: () => goOnline(resume.code) }, `オンライン対戦に戻る（${resume.code}）`) : null,
    h('fieldset', {}, h('legend', {}, 'マップ'),
      MAPS.map((m) => radio('mapId', m.id, m.name, `${m.squares.length} マス・目標 ${m.target.toLocaleString()}G`))),
    h('fieldset', {}, h('legend', {}, 'モード'),
      radio('mode', 'normal', 'ふつう', '通り・株・買収・空き地あり'),
      radio('mode', 'easy', 'かんたん', '株なし。隣どうしのお店をそろえると利用料アップ')),
    h('label', { class: 'name' }, 'あなたの名前 ', name),

    h('h2', { class: 'sub' }, '1 人で遊ぶ'),
    h('fieldset', {}, h('legend', {}, 'コンピューターの強さ'),
      radio('cpu', 'easy', CPU_LABEL.easy, ''), radio('cpu', 'normal', CPU_LABEL.normal, ''), radio('cpu', 'hard', CPU_LABEL.hard, '')),
    h('button', { class: 'btn primary big', onclick: () => {
      keep();
      const cpuNames = ['ミナト', 'サクラ', 'ホシノ'];
      state = newGame({
        mapId: settings.mapId, mode: settings.mode, seed: (Math.random() * 2 ** 31) | 0,
        players: [{ name: settings.name, cpu: null }, ...cpuNames.map((n) => ({ name: n, cpu: settings.cpu }))],
      });
      selected = null;
      notice = '';
      store(SAVE_KEY, state);
      render();
    } }, saved ? 'あたらしく始める' : 'はじめる'),

    h('h2', { class: 'sub' }, 'オンラインで遊ぶ'),
    h('p', { class: 'note' }, '知らない人とも遊べます。チャットはなく、決まったメッセージだけ送れます。名前は 8 文字までで、ふさわしくない名前は「プレイヤーN」になります。空いた席には、上で選んだ強さの CPU が入ります（相手探しは、同じ強さを選んだ人どうし）。'),
    h('button', { class: 'btn primary big', onclick: () => void goWith(findMatch(settings.mapId, settings.mode, settings.cpu)) }, '相手を探す'),
    h('div', { class: 'btns' },
      h('button', { class: 'btn', onclick: () => void goWith(createRoom(settings.mapId, settings.mode, settings.cpu)) }, '合言葉で部屋を作る'),
      codeIn,
      h('button', { class: 'btn', onclick: () => {
        const c = codeIn.value.trim().toUpperCase();
        if (!/^[A-HJ-NP-Z2-9]{6}$/.test(c)) { notice = '合言葉は 6 文字です'; render(); return; }
        keep();
        goOnline(c);
      } }, '合言葉で入る')),
    h('a', { href: '/rules.html', class: 'link rules-link' }, '遊び方を見る'),
    h('p', { class: 'build' }, `版：${__BUILD__}`)));
}

// 招待 URL（?room=合言葉）から開いたとき
const fromUrl = new URLSearchParams(location.search).get('room')?.toUpperCase();
if (fromUrl && /^[A-HJ-NP-Z2-9]{6}$/.test(fromUrl)) goOnline(fromUrl);
else render();
if (state) void cpuStep();
