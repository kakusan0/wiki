// 画面：タイトル・台・操作・毎日のメダル・記録と設定・ジャックポット
import './style.css';
import { Game, SAIL_MAX, POCKET_INFO, type SaveData } from './game/game';
import { DAILY, canClaim, claim, dayKey, nextIndex, type DailyState } from './game/daily';
import { h } from './ui/dom';
import { Scene3D } from './ui/scene';
import { play as sound, setMuted } from './ui/sound';

const SAVE_KEY = 'medal/save-v1', SET_KEY = 'medal/settings-v1', DAILY_KEY = 'medal/daily-v1';
const load = <T,>(k: string): T | null => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } };
const store = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できない */ } };

interface Settings { sound: boolean; vibe: boolean; fx: 'full' | 'normal' | 'lite' }
const settings: Settings = { sound: true, vibe: true, fx: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'lite' : 'full', ...(load<Partial<Settings>>(SET_KEY) ?? {}) };
setMuted(!settings.sound);
let daily: DailyState = load<DailyState>(DAILY_KEY) ?? { last: null, streak: 0 };
const params = new URLSearchParams(location.search);
const SPEED = params.has('fast') ? 8 : 1; // 画面テスト用

const app = document.getElementById('app')!;
const mobile = matchMedia('(pointer: coarse)').matches;
const game = new Game(Math.random, load<SaveData>(SAVE_KEY));
let scene: Scene3D | null = null;
try { scene = new Scene3D(game, mobile); } catch (e) { console.warn(e); }
if (scene) scene.lite = settings.fx === 'lite';
const vibe = (p: number | number[]) => { if (settings.vibe) navigator.vibrate?.(p); };
const save = () => store(SAVE_KEY, game.save());

// ---------- 画面の部品 ----------
const medalsEl = h('b', { class: 'num', id: 'medals' }, '0');
const jpEl = h('b', { class: 'num gold', id: 'jp' }, '0');
const sailEl = h('span', { class: 'sails', 'aria-label': '帆ゲージ' });
const dailyBadge = h('span', { class: 'badge' }, '1');
const popups = h('div', { class: 'popups', 'aria-live': 'polite' });
const aimInput = h('input', { id: 'aim', type: 'range', min: '-100', max: '100', value: '0', 'aria-label': '狙う位置' }) as HTMLInputElement;
const insertBtn = h('button', { class: 'btn primary big', id: 'insert', type: 'button' }, '投入');
const holdBtn = h('button', { class: 'btn outline', id: 'hold', type: 'button' }, '連続投入');
const autoBtn = h('button', { class: 'btn ghost', id: 'auto', type: 'button', 'aria-pressed': 'false' }, '自動');
const hint = h('p', { class: 'hint', role: 'status' }, '');
const modalBox = h('div', { class: 'modal-root' });

app.replaceChildren(h('div', { class: 'app' },
  scene ? scene.canvas : h('div', { class: 'stage nogl' }, h('p', {}, 'この端末では 3D 表示が使えません。')),
  h('header', { class: 'top' },
    h('button', { class: 'icon menu', type: 'button', 'aria-label': '記録と設定', onclick: () => showSettings() }),
    h('div', { class: 'box' }, h('span', {}, '所持メダル'), medalsEl),
    h('div', { class: 'box jp' }, h('span', {}, 'ジャックポット'), jpEl, sailEl),
    h('button', { class: 'icon daily', id: 'daily', type: 'button', 'aria-label': '毎日のメダル', onclick: () => showDaily() }, '配給', dailyBadge)),
  popups,
  h('div', { class: 'controls' },
    hint,
    h('div', { class: 'aimrow' }, h('span', { 'aria-hidden': 'true' }, '左'), aimInput, h('span', { 'aria-hidden': 'true' }, '右')),
    h('div', { class: 'row' }, autoBtn, holdBtn, insertBtn)),
  modalBox));
// 設定ボタンの絵（歯車の代わりに 3 本線）
app.querySelector('.top .menu')!.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>';

// ---------- 操作 ----------
let holding = false;
let auto = false;
const aim = () => Number(aimInput.value) / 100;
aimInput.addEventListener('input', () => { if (scene) scene.aim = aim(); });
const once = () => { if (game.insert(aim())) { sound('insert'); vibe(5); } else if (game.wallet <= 0) noMedals(); };
insertBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); once(); holding = true; });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) insertBtn.addEventListener(ev, () => { holding = false; });
insertBtn.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); once(); } });
holdBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); holding = true; });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel'] as const) holdBtn.addEventListener(ev, () => { holding = false; });
autoBtn.addEventListener('click', () => { auto = !auto; autoBtn.textContent = auto ? '自動 ON' : '自動'; autoBtn.setAttribute('aria-pressed', String(auto)); });
// 台をなぞって狙う
if (scene) {
  const s = scene;
  let dragging = false;
  const setAimFrom = (e: PointerEvent) => {
    const r = s.canvas.getBoundingClientRect();
    const a = s.aimFromScreen((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    aimInput.value = String(Math.round(a * 100)); s.aim = a;
  };
  s.canvas.addEventListener('pointerdown', (e) => { dragging = true; setAimFrom(e); });
  s.canvas.addEventListener('pointermove', (e) => { if (dragging) setAimFrom(e); });
  window.addEventListener('pointerup', () => { dragging = false; });
}

function noMedals() {
  hint.textContent = canClaim(daily, dayKey(new Date())) ? 'メダルがありません。「配給」で今日のメダルを受け取れます' : 'メダルがありません。台の上のメダルが落ちるのを待つか、明日の配給を待ちましょう';
}

// ---------- 出来事 ----------
let payoutAcc = 0, payoutT = 0;
function handleEvents() {
  for (const e of game.events) {
    switch (e.k) {
      case 'chucker': sound('chucker'); scene?.doFlash(0.3, '#5CE1E6'); vibe(15); break;
      case 'slotStart': if (e.reach) setTimeout(() => sound('reach'), 1000 / SPEED); break;
      case 'slotStop':
        if (e.win) { sound('win'); scene?.say('そろった！', 'ボール獲得', '#FFE38A'); scene?.doFlash(0.8); scene?.doShake(0.08); vibe([30, 40, 30]); }
        else sound('miss');
        break;
      case 'ball': scene?.say('星図ルーレット', 'ボールが入った', '#A8F3F5', 2); break;
      case 'rouletteStart': break;
      case 'roulette': {
        const info = POCKET_INFO[e.pocket];
        if (e.pocket === 'sail') { sound('sail'); scene?.say(`帆 ${Math.min(game.gauge, SAIL_MAX)} / ${SAIL_MAX}`, e.amount ? `+${e.amount} 枚` : '', '#FF9C88'); }
        else if (e.amount > 0) { sound('prize'); scene?.say(`${info.name}  +${e.amount}`, 'メダルが流れ込む', info.color); }
        scene?.doFlash(0.5, info.color);
        break;
      }
      case 'jackpot': showJackpot(e.amount); break;
      case 'payout': payoutAcc += e.n; sound('payout'); break;
      default: break;
    }
  }
  game.events = [];
}

function popup(n: number) {
  const el = h('div', { class: 'pop' }, `+${n}`);
  popups.append(el);
  setTimeout(() => el.remove(), 1400);
}

// ---------- 毎日・設定・ジャックポット ----------
function modal(...children: (HTMLElement | null)[]) {
  const box = h('div', { class: 'modal', role: 'dialog' }, h('div', { class: 'modal-box' }, ...children));
  modalBox.replaceChildren(box);
  return box;
}
const closeModal = () => modalBox.replaceChildren();

function showDaily() {
  const today = dayKey(new Date());
  const can = canClaim(daily, today);
  const idx = nextIndex(daily, today);
  modal(
    h('h2', {}, '今日の配給'),
    h('p', { class: 'note' }, '毎日 1 回、メダルを受け取れます。続けて来るほど 7 日目に向けて増えます。'),
    h('div', { class: 'days' }, DAILY.map((a, i) => h('div', { class: `day ${i < idx || (!can && i === idx) ? 'done' : i === idx ? 'today' : ''}` }, h('small', {}, `${i + 1} 日目`), h('b', {}, String(a))))),
    can ? h('button', { class: 'btn primary big', id: 'claim', type: 'button', onclick: () => {
      const r = claim(daily, today);
      if (!r) return;
      daily = r.state; store(DAILY_KEY, daily);
      game.give(r.amount); save(); sound('claim'); popup(r.amount);
      hint.textContent = '';
      closeModal();
    } }, `${DAILY[idx]} 枚を受け取る`) : h('p', { class: 'done-msg' }, '今日の分は受け取りました。また明日。'),
    h('p', { class: 'fine' }, 'メダルはゲームの中だけのものです。買うこと、お金や景品に換えることはできません。'),
    h('button', { class: 'btn ghost', type: 'button', onclick: closeModal }, '閉じる'));
}

function showSettings() {
  const r = game.records;
  const seg = (v: Settings['fx'], label: string) => h('button', { class: `seg ${settings.fx === v ? 'on' : ''}`, type: 'button', 'aria-pressed': String(settings.fx === v), onclick: () => { settings.fx = v; store(SET_KEY, settings); if (scene) scene.lite = v === 'lite'; showSettings(); } }, label);
  const toggle = (k: 'sound' | 'vibe', label: string) => h('label', { class: 'toggle' }, label, h('input', { type: 'checkbox', checked: settings[k], onchange: (e: Event) => { settings[k] = (e.target as HTMLInputElement).checked; store(SET_KEY, settings); setMuted(!settings.sound); } }));
  modal(
    h('h2', {}, '航海の記録'),
    h('div', { class: 'stats' },
      h('div', {}, h('small', {}, 'いちばん多く持った'), h('b', {}, r.maxWallet.toLocaleString('ja-JP'))),
      h('div', {}, h('small', {}, 'ジャックポット'), h('b', {}, `${r.jackpots} 回`)),
      h('div', {}, h('small', {}, '入れたメダル'), h('b', {}, r.inserted.toLocaleString('ja-JP'))),
      h('div', {}, h('small', {}, '最高のジャックポット'), h('b', {}, r.best.toLocaleString('ja-JP')))),
    h('h2', {}, '設定'),
    toggle('sound', '音'), toggle('vibe', '振動（スマホ）'),
    h('div', { class: 'segs', role: 'group', 'aria-label': '演出の強さ' }, seg('full', '派手'), seg('normal', 'ふつう'), seg('lite', '控えめ')),
    h('button', { class: 'btn danger', type: 'button', onclick: () => {
      if (!confirm('メダルと記録を最初からにしますか？')) return;
      localStorage.removeItem(SAVE_KEY); location.reload();
    } }, 'メダルと記録を最初からにする'),
    h('button', { class: 'btn ghost', type: 'button', onclick: closeModal }, '閉じる'));
}

function showJackpot(amount: number) {
  sound('jackpot'); vibe([60, 50, 60, 50, 200]);
  scene?.doFlash(2.5); scene?.doShake(0.25);
  scene?.say('ジャックポット', `+${amount.toLocaleString('ja-JP')} 枚`, '#FFE38A', 6, true);
  const num = h('b', { class: 'jp-num' }, '+0');
  const rain = h('div', { class: 'rain', 'aria-hidden': 'true' }, Array.from({ length: settings.fx === 'lite' ? 8 : 36 }, (_, i) => h('span', { style: { left: `${(i * 37) % 100}%`, animationDelay: `${(i % 9) * 0.15}s`, animationDuration: `${1.4 + (i % 5) * 0.2}s` } })));
  const box = modal(rain, h('p', { class: 'jp-label' }, '満帆'), h('h2', { class: 'jp-title' }, '星海ジャックポット'), num, h('p', { class: 'note' }, 'メダルが台へ流れ込みます（多いぶんは直接もらえます）'),
    h('button', { class: 'btn primary big', id: 'jp-ok', type: 'button', onclick: closeModal }, '受け取って航海を続ける'));
  box.classList.add('jackpot');
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / (1600 / SPEED));
    num.textContent = `+${Math.round(amount * (1 - (1 - k) ** 3)).toLocaleString('ja-JP')}`;
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

// ---------- タイトル ----------
function showTitle() {
  const can = canClaim(daily, dayKey(new Date()));
  const box = modal(
    h('p', { class: 'kicker' }, 'メダルプッシャー'),
    h('h1', { class: 'logo' }, '星海の', h('br'), '宝船'),
    h('p', { class: 'note' }, `所持メダル ${game.wallet.toLocaleString('ja-JP')} 枚`),
    h('button', { class: 'btn primary big', id: 'start', type: 'button', onclick: () => { closeModal(); sound('claim'); if (can) showDaily(); } }, '航海に出る'),
    h('p', { class: 'fine' }, '台をなぞるか下のつまみで狙う位置を決めて、「投入」でメダルを落とします。メダルはゲームの中だけのものです。'));
  box.classList.add('title');
}

// ---------- 毎コマ ----------
let last = performance.now(), acc = 0, saveT = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt * SPEED;
  let steps = 0;
  while (acc >= 1 / 60 && steps < 10 * SPEED) {
    // 押している間・自動のときは、決まった間隔で入れる（画面の速さに関係なく）
    if (holding || auto) { if (game.insert(aim())) sound('insert'); else if (game.wallet <= 0) { noMedals(); if (auto) autoBtn.click(); } }
    game.update(1 / 60); acc -= 1 / 60; steps++; handleEvents();
  }
  if (steps >= 10 * SPEED) acc = 0;
  payoutT += dt;
  if (payoutAcc > 0 && payoutT > 0.5) { popup(payoutAcc); payoutAcc = 0; payoutT = 0; }
  medalsEl.textContent = game.wallet.toLocaleString('ja-JP');
  jpEl.textContent = game.pool.toLocaleString('ja-JP');
  sailEl.textContent = '帆 ' + '▲'.repeat(game.gauge) + '△'.repeat(Math.max(0, SAIL_MAX - game.gauge));
  dailyBadge.hidden = !canClaim(daily, dayKey(new Date()));
  insertBtn.toggleAttribute('disabled', game.wallet <= 0);
  if (game.wallet > 0 && hint.textContent?.startsWith('メダルがありません')) hint.textContent = '';
  if (scene) {
    const r = scene.canvas.parentElement!.getBoundingClientRect();
    scene.resize(r.width, r.height);
    scene.render(dt * SPEED);
  }
  saveT += dt;
  if (saveT > 2) { save(); saveT = 0; }
  requestAnimationFrame(frame);
}
addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// 画面テスト用
(window as unknown as { __medal: unknown }).__medal = {
  game, sample: () => scene?.sample() ?? Promise.resolve(0),
  jackpot: () => game.jackpot(),
  ball: () => { game.rouletteQueue++; },
  state: () => ({ inserted: game.records.inserted, wallet: game.wallet, pool: game.pool, gauge: game.gauge, stock: game.stock, field: game.sim.fieldCount(), slot: !!game.slot, roulette: !!game.roulette }),
};

if (scene) scene.aim = 0;
showTitle();
requestAnimationFrame(frame);
