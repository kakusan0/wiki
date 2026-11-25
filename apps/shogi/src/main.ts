import './style.css';
import { LEVEL_NAMES, type Level } from './engine/ai';
import { Game, canDeclare, type Result } from './engine/game';
import { TSUME, type Tsume } from './data/tsume';
import { Position, isDrop, mDrop, mFrom, mPromo, mTo, mkMove, type Move } from './engine/position';
import { HANDICAPS, KANJI, MOVES, NAME, RULESETS, canPromoteType, type Ruleset } from './engine/rules';
import { mateFirstMoves, solve } from './engine/tsume';
import { askMove, cancelThinking } from './ui/ai-client';
import { MARK_NAMES, MARK_SIGNS, isMateScore, reviewMoves, scoreLabel, scoreText, senteScore, type MoveReview, type PlyEval } from './engine/analysis';
import { startAnalysis, type AnalysisJob } from './ui/analysis-client';
import { fromUsi } from './engine/usi';
import { LISHOGI, RateLimited, clockText, fetchGame, gameIdOf, listLiveGames, playerLabel, startedText, statusText, type LishogiGame } from './ui/lishogi';
import { renderBoard, targetsOf, type BoardView } from './ui/board';
import { h } from './ui/dom';
import { renderOnlineEntry, onlineSession, type OnlineSession } from './ui/online';

const app = document.getElementById('app')!;
const SAVE_KEY = 'shogi/save-v1';
const SOLVED_KEY = 'shogi/solved-v1';
const SETTINGS_KEY = 'shogi/settings-v1';

function load<T>(k: string): T | null { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : null; } catch { return null; } }
function store(k: string, v: unknown) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* 保存できなくても遊べる */ } }

// ---------- 設定 ----------
interface Settings { rules: Ruleset['id']; handicap: string; level: Level; side: 'sente' | 'gote' | 'random'; autoFlip: boolean }
let settings: Settings = { rules: 'standard', handicap: 'even', level: 'beginner', side: 'sente', autoFlip: false, ...(load<Settings>(SETTINGS_KEY) ?? {}) };

// ---------- 対局 ----------
type Mode = 'cpu' | 'local' | 'online' | 'tsume' | 'watch';
interface Session {
  mode: Mode;
  game: Game;
  mySide: 0 | 1 | null; // CPU 戦・オンライン：自分の側。二人対戦（この端末）は null
  level: Level;
  flipped: boolean;
  autoFlip: boolean;
  selected: BoardView['selected'];
  view: number | null; // 棋譜で過去の局面を見ている手数（null は最新）
  thinking: boolean;
  message: string;
  tsume?: Tsume;
  hint?: Move | null;
  names: [string, string];
  analysis?: Analysis;
  watch?: Watch;
}
// Lishogi の対局を観戦しているとき
interface Watch { id: string; info: LishogiGame; error: string; timer: number | null; shown: number }
// 解析の結果。moves は解析を始めたときの棋譜（evals[k] は k 手目のあとの局面）
interface Analysis { moves: Move[]; evals: PlyEval[]; job: AnalysisJob | null }
let session: Session | null = null;
let screen: 'title' | 'game' | 'tsume-list' | 'practice' | 'online' | 'watch-list' = 'title';

function saveGame() {
  if (!session || (session.mode !== 'cpu' && session.mode !== 'local')) return;
  const g = session.game;
  store(SAVE_KEY, g.result ? null : { mode: session.mode, rules: g.rules.id, start: g.startSfen, moves: g.moves, mySide: session.mySide, level: session.level, flipped: session.flipped, autoFlip: session.autoFlip });
}

function stopAnalysis(s: Session | null) {
  s?.analysis?.job?.stop();
  if (s?.analysis) s.analysis.job = null;
}

function startGame(mode: Mode, rules: Ruleset, startSfen: string, opts: Partial<Session> = {}) {
  cancelThinking();
  stopAnalysis(session);
  stopWatch(session);
  const game = new Game(rules, startSfen);
  session = {
    mode, game, mySide: null, level: settings.level, flipped: false, autoFlip: false, selected: null, view: null,
    thinking: false, message: '', names: ['先手', '後手'], ...opts,
  };
  screen = 'game';
  saveGame();
  render();
  void cpuMove();
}

// コンピューターの番なら考えて指す
async function cpuMove() {
  const s = session;
  if (!s || s.mode !== 'cpu' || s.game.result || s.mySide == null || s.game.pos.side === s.mySide || s.thinking) return;
  s.thinking = true;
  render();
  const started = Date.now();
  const r = await askMove(s.game.pos.toSfen(), s.game.rules.id, s.level);
  await new Promise((res) => setTimeout(res, Math.max(0, 350 - (Date.now() - started)))); // 速すぎると見えないので少し待つ
  if (session !== s || r.move == null) return;
  s.thinking = false;
  if (s.game.pos.isLegal(r.move)) s.game.play(r.move);
  saveGame();
  render();
}

function canHumanAct(s: Session): boolean {
  if (s.game.result || s.thinking || s.view != null) return false;
  if (s.mode === 'cpu' || s.mode === 'online') return s.game.pos.side === s.mySide;
  if (s.mode === 'tsume') return s.game.pos.side === 0;
  if (s.mode === 'watch') return false;
  return true;
}

// 盤のマスを押したとき
function onSquare(sq: number) {
  const s = session;
  if (!s || !canHumanAct(s)) return;
  const p = s.game.pos;
  const legal = p.legalMoves();
  const targets = targetsOf(legal, s.selected);
  if (s.selected && targets.has(sq)) {
    const cands = legal.filter((m) => mTo(m) === sq && ('from' in s.selected! ? !isDrop(m) && mFrom(m) === s.selected!.from : isDrop(m) && mDrop(m) === (s.selected as { drop: number }).drop));
    if (cands.length === 2) return askPromotion(cands);
    return humanPlay(cands[0]);
  }
  const pc = p.pieceAt(sq);
  s.selected = pc && pc.side === p.side ? { from: sq } : null;
  render();
}

function onHand(side: 0 | 1, type: number) {
  const s = session;
  if (!s || !canHumanAct(s) || s.game.pos.side !== side) return;
  s.selected = s.selected && 'drop' in s.selected && s.selected.drop === type ? null : { drop: type };
  render();
}

// 成るか成らないかを選ぶ小さな窓
function askPromotion(cands: Move[]) {
  const s = session!;
  const t = Math.abs(s.game.pos.board[mFrom(cands[0])]);
  const promo = cands.find(mPromo)!, keep = cands.find((m) => !mPromo(m))!;
  const dlg = h('div', { class: 'modal', role: 'dialog', 'aria-label': '成りますか？' },
    h('div', { class: 'modal-box' },
      h('p', {}, '成りますか？'),
      h('div', { class: 'btns' },
        h('button', { class: 'btn primary', onclick: () => { dlg.remove(); humanPlay(promo); } }, `成る（${KANJI[t + (t <= 4 ? 8 : 7)] ?? '成'}）`),
        h('button', { class: 'btn', onclick: () => { dlg.remove(); humanPlay(keep); } }, `成らない（${KANJI[t]}）`))));
  document.body.append(dlg);
}

function humanPlay(m: Move) {
  const s = session!;
  s.selected = null;
  s.hint = null;
  if (s.mode === 'tsume') return tsumeMove(m);
  if (s.mode === 'online') { onlineGame?.send(m); return; }
  s.game.play(m);
  if (s.mode === 'local' && s.autoFlip) s.flipped = s.game.pos.side === 1;
  saveGame();
  render();
  void cpuMove();
}

// ---------- 詰将棋 ----------
function tsumeMove(m: Move) {
  const s = session!;
  const t = s.tsume!;
  const left = t.plies - s.game.record.length;
  // 正解かどうか：その手から残りの手数で詰むか
  const ok = mateFirstMoves(s.game.pos, left).includes(m);
  if (!ok) { s.message = '× その手では詰みません。もう一度考えてみましょう。'; render(); return; }
  s.game.play(m);
  if (s.game.result) {
    s.message = `◎ 正解！ ${t.plies} 手で詰みました。`;
    const solved = new Set(load<string[]>(SOLVED_KEY) ?? []);
    solved.add(t.id);
    store(SOLVED_KEY, [...solved]);
    render();
    return;
  }
  s.message = '○ よい手です。相手が受けました。';
  // 受け方：一番長く逃げる手
  const p = s.game.pos;
  let best: Move | null = null;
  let bestLen = -1;
  for (const r of p.legalMoves()) {
    const u = p.make(r);
    const line = solve(p, left - 2);
    p.unmake(r, u);
    const len = line ? line.length : 99;
    if (len > bestLen) { bestLen = len; best = r; }
  }
  render();
  setTimeout(() => { if (session === s && best != null) { s.game.play(best); render(); } }, 450);
}

// ---------- 画面 ----------
function render() {
  document.querySelectorAll('.modal').forEach((x) => x.remove());
  if (screen === 'title') return renderTitle();
  if (screen === 'tsume-list') return renderTsumeList();
  if (screen === 'practice') return renderPractice();
  if (screen === 'online' && !session) return app.replaceChildren(renderOnlineEntry(onlineHandlers()));
  if (screen === 'watch-list' && !session) return renderWatchList();
  if (session) return renderGame(session);
  screen = 'title';
  renderTitle();
}

function header(title: string, back = true) {
  return h('header', { class: 'top' },
    back ? h('button', { class: 'btn sm', onclick: () => { cancelThinking(); stopAnalysis(session); stopWatch(session); if (location.search.includes('lishogi=')) history.replaceState(null, '', location.pathname); onlineGame?.leave(); onlineGame = null; session = null; screen = 'title'; render(); } }, '← もどる') : null,
    h('b', {}, title),
    h('a', { class: 'link', href: '/rules.html', target: '_blank', rel: 'noopener' }, '遊び方'));
}

function renderTitle() {
  const saved = load<{ mode: Mode; rules: Ruleset['id']; start: string; moves: Move[]; mySide: 0 | 1 | null; level: Level; flipped: boolean; autoFlip: boolean }>(SAVE_KEY);
  const radio = <K extends keyof Settings>(key: K, value: Settings[K], label: string) =>
    h('label', { class: 'chip-opt' }, h('input', { type: 'radio', name: key, checked: settings[key] === value, onchange: () => { settings[key] = value; store(SETTINGS_KEY, settings); render(); } }), h('span', {}, label));
  const rules = RULESETS[settings.rules];
  app.replaceChildren(h('div', { class: 'title' },
    header('まちかど将棋', false),
    h('main', { class: 'title-main' },
      h('h1', {}, 'まちかど将棋'),
      h('p', { class: 'lead' }, 'コンピューター対戦・二人対戦・詰将棋・小さい盤。好きな遊び方を選んでください。'),
      saved ? h('button', { class: 'btn primary big', onclick: () => {
        const g = Game.fromMoves(RULESETS[saved.rules], saved.start, saved.moves);
        session = { mode: saved.mode, game: g, mySide: saved.mySide, level: saved.level, flipped: saved.flipped, autoFlip: saved.autoFlip, selected: null, view: null, thinking: false, message: '', names: saved.mode === 'cpu' ? (saved.mySide === 0 ? ['あなた', 'コンピューター'] : ['コンピューター', 'あなた']) : ['先手', '後手'] };
        screen = 'game'; render(); void cpuMove();
      } }, `つづきから（${RULESETS[saved.rules].name}・${saved.moves.length} 手目）`) : null,

      h('section', { class: 'panel' },
        h('h2', {}, '盤の大きさ'),
        h('div', { class: 'chips' }, radio('rules', 'standard', '本将棋（9×9）'), radio('rules', 'mini55', '5五将棋（5×5）'), radio('rules', 'mini34', 'ミニ将棋（3×4）')),
        settings.rules !== 'standard' ? h('p', { class: 'note' }, settings.rules === 'mini55'
          ? '5五将棋：盤も駒も少ない昔からある将棋。1 局が短く、終盤の練習にも。敵陣は一番奥の 1 段。'
          : 'ミニ将棋（本作独自）：3×4 の盤に玉・金・銀。歩は 1 枚ずつ持ち駒から。はじめての人に。') : null),

      h('section', { class: 'panel mode' },
        h('h2', {}, 'コンピューターと対戦'),
        h('div', { class: 'chips' }, (Object.keys(LEVEL_NAMES) as Level[]).map((l) => radio('level', l, LEVEL_NAMES[l]))),
        h('div', { class: 'chips' }, radio('side', 'sente', '先手（先に指す）'), radio('side', 'gote', '後手'), radio('side', 'random', '振り駒')),
        settings.rules === 'standard' ? h('label', { class: 'select' }, '手合い ', h('select', { onchange: (e: Event) => { settings.handicap = (e.target as HTMLSelectElement).value; store(SETTINGS_KEY, settings); } },
          HANDICAPS.map((x) => h('option', { value: x.id, selected: settings.handicap === x.id }, x.name)))) : null,
        settings.rules === 'standard' && settings.handicap !== 'even' ? h('p', { class: 'note' }, '駒落ち：コンピューターが駒を落とした上手（後手）、あなたは下手（先手）。上手から指します。') : null,
        h('button', { class: 'btn primary big', onclick: () => {
          const handi = settings.rules === 'standard' ? HANDICAPS.find((x) => x.id === settings.handicap)! : null;
          const sfen = handi && handi.id !== 'even' ? handi.sfen : rules.start;
          let mySide: 0 | 1 = settings.side === 'gote' ? 1 : settings.side === 'random' ? (Math.random() < 0.5 ? 0 : 1) : 0;
          if (handi && handi.id !== 'even') mySide = 0; // 駒落ちは下手（先手）を持つ
          startGame('cpu', rules, sfen, { mySide, level: settings.level, flipped: mySide === 1, names: mySide === 0 ? ['あなた', 'コンピューター'] : ['コンピューター', 'あなた'] });
        } }, 'コンピューターと対局する')),

      h('section', { class: 'panel mode' },
        h('h2', {}, '二人で対戦'),
        h('label', { class: 'chip-opt' }, h('input', { type: 'checkbox', checked: settings.autoFlip, onchange: (e: Event) => { settings.autoFlip = (e.target as HTMLInputElement).checked; store(SETTINGS_KEY, settings); } }), h('span', {}, '手番の人が手前になるよう盤を回す')),
        h('div', { class: 'btns' },
          h('button', { class: 'btn primary', onclick: () => startGame('local', rules, rules.start, { autoFlip: settings.autoFlip }) }, 'この端末で交代に指す'),
          h('button', { class: 'btn', onclick: () => { screen = 'online'; session = null; render(); } }, 'オンラインで対戦（合言葉）'))),

      h('section', { class: 'panel mode' },
        h('h2', {}, '世界の対局を観戦'),
        h('p', { class: 'note' }, 'Lishogi（世界の人が遊ぶ無料の将棋サイト）でいま指されている対局を、形勢を見ながら観戦します。'),
        h('div', { class: 'btns' },
          h('button', { class: 'btn primary', onclick: () => { screen = 'watch-list'; session = null; render(); } }, '対局中の対局を見る'))),

      h('section', { class: 'panel mode' },
        h('h2', {}, '練習'),
        h('div', { class: 'btns' },
          h('button', { class: 'btn primary', onclick: () => { screen = 'tsume-list'; render(); } }, `詰将棋（${TSUME.length} 問）`),
          h('button', { class: 'btn', onclick: () => { screen = 'practice'; practiceType = 7; render(); } }, '駒の動かし方'))))));
}

function resultText(r: Result, g: Game, s: Session): string {
  const who = (w: 0 | 1) => (s.mySide != null ? (w === s.mySide ? 'あなたの勝ち' : 'あなたの負け') : `${w === 0 ? '先手' : '後手'}の勝ち`);
  switch (r.kind) {
    case 'checkmate': return `${g.record.length} 手で詰み。${who(r.winner)}`;
    case 'resign': return `投了。${who(r.winner)}`;
    case 'timeout': return `時間切れ。${who(r.winner)}`;
    case 'repetition': return '千日手で引き分け';
    case 'perpetual': return `連続王手の千日手。${who(r.winner)}`;
    case 'nyugyoku': return r.winner == null ? '入玉宣言：引き分け' : `入玉宣言。${who(r.winner)}`;
  }
}

function renderGame(s: Session) {
  const g = s.game;
  // 待ったなどで棋譜が変わったら、古い解析は捨てる（手が増えただけなら、そこまでの結果は使える）
  if (s.analysis && (s.analysis.moves.length > g.record.length || s.analysis.moves.some((m, i) => g.moves[i] !== m))) { stopAnalysis(s); s.analysis = undefined; }
  // 棋譜で過去の局面を見ているとき
  const viewGame = s.view != null ? Game.fromMoves(g.rules, g.startSfen, g.moves.slice(0, s.view)) : g;
  const pos = viewGame.pos;
  const canAct = canHumanAct(s);
  const legal = canAct ? pos.legalMoves() : [];
  const turnName = s.names[pos.side];
  const live = s.mode === 'watch' && s.watch?.info.status === 'started';
  const status = s.mode === 'watch' && !live ? statusText(s.watch!.info)
    : g.result ? resultText(g.result, g, s)
    : s.thinking ? 'コンピューターが考えています…'
    : s.mode === 'tsume' ? (pos.side === 0 ? `あなたの番（攻め方）・あと ${s.tsume!.plies - g.record.length} 手` : '受け方が考えています…')
    : `${live ? '対局中・' : ''}${pos.side === 0 ? '▲' : '△'}${turnName}の番${pos.inCheck() ? '・王手！' : ''}`;
  const view: BoardView = {
    pos, flipped: s.flipped, selected: s.selected, targets: canAct ? targetsOf(legal, s.selected) : new Set(),
    last: viewGame.record.at(-1)?.move ?? null, canAct, onSquare, onHand, names: s.names,
    clocks: s.mode === 'online' ? onlineGame?.clocks() ?? null : null,
    turnLabel: status,
  };
  if (s.hint != null) view.targets = new Set([mTo(s.hint)]);
  // 解析の最善手を盤に光らせる（指せないときだけ。過去の局面や終局後）
  const shown = s.view ?? g.record.length;
  // 観戦中（対局が続いている間）は、対局している人の助けにならないよう最善手を出さない
  const best = !canAct && !live ? s.analysis?.evals[shown]?.best ?? null : null;
  if (best != null && s.analysis && viewGame.pos.isLegal(best)) {
    view.targets = new Set([mTo(best)]);
    view.selected = isDrop(best) ? { drop: mDrop(best) } : { from: mFrom(best) };
  }
  const modeName = s.mode === 'cpu' ? `コンピューター対戦（${LEVEL_NAMES[s.level]}）` : s.mode === 'local' ? '二人で対戦' : s.mode === 'online' ? 'オンライン対戦' : s.mode === 'watch' ? 'Lishogi の対局を観戦' : s.tsume!.title;
  const undoN = s.mode === 'cpu' ? (g.pos.side === s.mySide ? 2 : 1) : 1;
  const side = h('aside', { class: 'side' },
    h('section', { class: 'panel status' },
      h('p', { class: `status-text${g.result ? ' over' : ''}` }, status),
      s.message ? h('p', { class: 'message' }, s.message) : null,
      s.mode === 'watch' ? renderWatchInfo(s) : null,
      h('div', { class: 'btns' },
        s.mode === 'cpu' || s.mode === 'local' ? h('button', { class: 'btn', disabled: !g.record.length || s.mode === 'cpu' && g.record.length < undoN, onclick: () => {
          cancelThinking(); s.thinking = false; g.undo(Math.min(undoN, g.record.length)); s.view = null; s.selected = null; if (s.mode === 'local' && s.autoFlip) s.flipped = g.pos.side === 1; saveGame(); render(); void cpuMove();
        } }, '待った') : null,
        s.mode === 'cpu' && !g.result ? h('button', { class: 'btn', disabled: !canAct, onclick: async () => {
          const r = await askMove(g.pos.toSfen(), g.rules.id, 'advanced', true);
          if (r.move != null && session === s) { s.hint = r.move; s.selected = isDrop(r.move) ? { drop: mDrop(r.move) } : { from: mFrom(r.move) }; s.message = 'ヒント：光っている駒を、光っているマスへ。'; render(); }
        } }, 'ヒント') : null,
        s.mode === 'tsume' ? h('button', { class: 'btn', onclick: () => { startTsume(s.tsume!); } }, 'はじめから') : null,
        s.mode === 'tsume' ? h('button', { class: 'btn', onclick: () => showAnswer(s) }, '答えを見る') : null,
        !g.result && s.mode !== 'tsume' && canDeclare(g.pos, g.pos.side) && canAct ? h('button', { class: 'btn', onclick: () => {
          if (s.mode === 'online') { onlineGame?.declare(); return; }
          g.declare(); saveGame(); render();
        } }, '入玉宣言') : null,
        !g.result && s.mode !== 'tsume' && s.mode !== 'watch' ? h('button', { class: 'btn danger', onclick: () => {
          if (!confirm('投了しますか？')) return;
          if (s.mode === 'online') { onlineGame?.resign(); return; }
          g.resign(s.mySide ?? g.pos.side); cancelThinking(); s.thinking = false; saveGame(); render();
        } }, '投了') : null,
        s.mode === 'online' && g.result ? h('button', { class: 'btn primary', id: 'rematch', disabled: !!onlineGame?.state().rematch[s.mySide ?? 0], onclick: () => onlineGame?.rematch() }, 'もう一局') : null,
        h('button', { class: 'btn', onclick: () => { s.flipped = !s.flipped; render(); } }, '盤を回す'))),
    renderKifu(s), renderAnalysis(s));
  // 描き直しても棋譜の一覧のスクロール位置を保つ（解析中は何度も描き直す）
  const scroll = document.querySelector('.kifu .moves')?.scrollTop ?? null;
  app.replaceChildren(h('div', { class: 'game' }, header(modeName), h('main', { class: 'layout' }, h('div', { class: 'main-col' }, renderBoard(view)), side)));
  const list = document.querySelector('.kifu .moves');
  if (list && scroll != null) list.scrollTop = scroll;
  // 観戦中に新しい手が来たら、最新の局面を見ているときは棋譜の一覧のいちばん下を見せる
  if (list && s.watch && s.view == null && g.record.length !== s.watch.shown) list.scrollTop = list.scrollHeight;
  if (s.watch) s.watch.shown = g.record.length;
}

function reviews(s: Session): MoveReview[] {
  const a = s.analysis;
  if (!a) return [];
  return reviewMoves(a.evals, a.moves, s.game.startSfen.split(/\s+/)[1] === 'w' ? 1 : 0);
}

function renderKifu(s: Session): HTMLElement {
  const g = s.game;
  const rv = reviews(s);
  return h('section', { class: 'panel kifu' },
    h('h2', {}, `棋譜（${g.record.length} 手）`),
    h('ol', { class: 'moves' },
      h('li', { class: s.view === 0 ? 'on' : '' }, h('button', { onclick: () => { s.view = 0; render(); } }, '開始局面')),
      g.record.map((r, i) => {
        const m = rv[i]?.mark;
        const sign = m ? MARK_SIGNS[m] : '';
        return h('li', { class: `${s.view === i + 1 ? 'on' : ''}${m ? ` mark-${m}` : ''}` },
          h('button', { onclick: () => { s.view = i + 1 === g.record.length ? null : i + 1; render(); }, title: m ? MARK_NAMES[m] || undefined : undefined },
            `${i + 1}. ${r.name}${r.check ? '（王手）' : ''}`, sign ? h('b', { class: 'mark' }, sign) : null));
      })),
    h('div', { class: 'btns' },
      s.view != null ? h('button', { class: 'btn sm', onclick: () => { s.view = null; render(); } }, '最新の局面へ') : null,
      h('button', { class: 'btn sm', onclick: () => { void navigator.clipboard?.writeText(g.kif(s.names)); s.message = '棋譜（KIF 形式）をコピーしました'; render(); } }, '棋譜をコピー'),
      h('button', { class: 'btn sm', id: 'video', disabled: !g.record.length, onclick: async () => {
        // 動画の仕組みは押したときに読み込む（最初の表示を軽く）
        const { openVideoDialog } = await import('./ui/video-dialog');
        const mode = s.mode === 'cpu' ? `コンピューター対戦（${LEVEL_NAMES[s.level]}）` : s.mode === 'local' ? '二人で対戦' : s.mode === 'online' ? 'オンライン対戦' : s.tsume?.title ?? '';
        openVideoDialog({
          game: g, names: s.names, title: `${g.rules.name}・${mode}`, result: g.result ? resultText(g.result, g, s) : null,
          flipped: s.flipped, viewPly: s.view,
        });
      } }, '動画で保存')));
}

// ---------- 解析 ----------
// 1 局面に使う時間（ミリ秒）。小さい盤は早く深く読めるので短く
const analysisMs = (g: Game) => (g.rules.id === 'standard' ? 400 : 200);
const canAnalyze = (s: Session) => s.mode !== 'tsume' && s.game.record.length > 0 && (s.mode !== 'online' || !!s.game.result);
const watchLive = (s: Session) => s.mode === 'watch' && s.watch?.info.status === 'started';

// 観戦中は、手が増えるたびに増えたぶんだけ解析する（自動）
function followAnalysis(s: Session) {
  if (s.mode !== 'watch' || s.analysis?.job) return;
  const g = s.game;
  const a: Analysis = s.analysis ?? { moves: [], evals: [], job: null };
  let from = 0;
  while (a.evals[from]) from++;
  if (from > g.record.length) return;
  a.moves = g.moves;
  s.analysis = a;
  a.job = startAnalysis(g.startSfen, g.rules.id, a.moves, analysisMs(g), (k, ev) => {
    a.evals[k] = ev;
    if (session === s && s.analysis === a) render();
  }, () => {
    a.job = null;
    if (session === s && s.analysis === a) { render(); followAnalysis(s); }
  }, from);
}

function runAnalysis(s: Session) {
  stopAnalysis(s);
  const g = s.game;
  const moves = g.moves;
  const a: Analysis = { moves, evals: [], job: null };
  s.analysis = a;
  a.job = startAnalysis(g.startSfen, g.rules.id, moves, analysisMs(g), (k, ev) => {
    a.evals[k] = ev;
    if (session === s && s.analysis === a) render();
  }, () => {
    a.job = null;
    if (session === s && s.analysis === a) render();
  });
  render();
}

// 評価値のグラフ（先手が上、後手が下）。押すとその局面へ
function evalGraph(s: Session, a: Analysis): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 300, H = 120, CAP = 2000;
  const n = Math.max(a.moves.length, 1);
  const x = (k: number) => (k / n) * W;
  const y = (v: number) => H / 2 - (Math.max(-CAP, Math.min(CAP, v)) / CAP) * (H / 2 - 4);
  const el = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    return e;
  };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'eval-graph', role: 'img', 'aria-label': '評価値のグラフ。上が先手有利、下が後手有利' }) as SVGSVGElement;
  svg.append(el('rect', { x: 0, y: 0, width: W, height: H / 2, class: 'eg-sente' }), el('rect', { x: 0, y: H / 2, width: W, height: H / 2, class: 'eg-gote' }));
  svg.append(el('line', { x1: 0, y1: H / 2, x2: W, y2: H / 2, class: 'eg-axis' }));
  const startSide = s.game.startSfen.split(/\s+/)[1] === 'w' ? 1 : 0;
  const pts: string[] = [];
  a.evals.forEach((e, k) => {
    if (!e) return;
    const side = ((startSide + k) % 2) as 0 | 1;
    const v = senteScore(e, side);
    pts.push(`${x(k).toFixed(1)},${y(isMateScore(v) ? Math.sign(v) * CAP : v).toFixed(1)}`);
  });
  if (pts.length) {
    svg.append(el('polygon', { points: `0,${H / 2} ${pts.join(' ')} ${pts.at(-1)!.split(',')[0]},${H / 2}`, class: 'eg-area' }));
    svg.append(el('polyline', { points: pts.join(' '), class: 'eg-line' }));
  }
  // 悪手の印
  reviews(s).forEach((r) => {
    if (r.mark !== 'mistake' && r.mark !== 'blunder') return;
    const e = a.evals[r.ply];
    if (!e) return;
    const v = senteScore(e, ((startSide + r.ply) % 2) as 0 | 1);
    svg.append(el('circle', { cx: x(r.ply), cy: y(isMateScore(v) ? Math.sign(v) * CAP : v), r: 3.5, class: `eg-dot ${r.mark}` }));
  });
  const shown = s.view ?? s.game.record.length;
  if (shown <= a.moves.length) svg.append(el('line', { x1: x(shown), y1: 0, x2: x(shown), y2: H, class: 'eg-now' }));
  svg.addEventListener('click', (ev) => {
    const box = svg.getBoundingClientRect();
    const k = Math.round(((ev.clientX - box.left) / box.width) * n);
    const ply = Math.max(0, Math.min(a.moves.length, k));
    s.view = ply === s.game.record.length ? null : ply;
    render();
  });
  return svg;
}

function renderAnalysis(s: Session): HTMLElement | null {
  const g = s.game;
  if (!canAnalyze(s) && !s.analysis) return null;
  const a = s.analysis;
  const total = (a?.moves.length ?? g.record.length) + 1;
  const doneN = a ? a.evals.filter(Boolean).length : 0;
  const running = !!a?.job;
  const stale = !!a && !running && a.moves.length < g.record.length;
  const secs = Math.ceil(((g.record.length + 1) * analysisMs(g)) / 1000);
  const auto = s.mode === 'watch';
  const head = auto ? h('p', { class: 'note', role: 'status' }, running ? `形勢を読んでいます… ${doneN}/${g.record.length + 1} 局面` : '新しい手が指されると、自動で形勢を読みます。')
    : h('div', { class: 'btns' },
    running ? h('button', { class: 'btn sm', onclick: () => { stopAnalysis(s); render(); } }, '解析をやめる')
      : canAnalyze(s) && (!a || stale || doneN < total) ? h('button', { class: 'btn sm primary', id: 'analyze', onclick: () => runAnalysis(s) }, a ? 'もう一度解析する' : `解析する（約 ${secs} 秒）`) : null,
    running ? h('span', { class: 'note', role: 'status' }, `解析中… ${doneN}/${total} 局面`) : null);
  if (!a) {
    return h('section', { class: 'panel analysis' }, h('h2', {}, '解析'),
      h('p', { class: 'note' }, auto ? '形勢を読む準備をしています。' : 'コンピューターが一局をふり返り、局面ごとの形勢（評価値）と最善手、悪手・疑問手を調べます。'), head);
  }
  const startSide = g.startSfen.split(/\s+/)[1] === 'w' ? 1 : 0;
  const rv = reviews(s);
  const shown = s.view ?? g.record.length;
  const e = a.evals[shown];
  const v = e ? senteScore(e, ((startSide + shown) % 2) as 0 | 1) : null;
  const r = shown >= 1 ? rv[shown - 1] : undefined;
  const count = (side: 0 | 1, m: MoveReview['mark']) => rv.filter((x) => x.side === side && x.mark === m).length;
  const hideBest = watchLive(s);
  const here = [
    v != null ? h('p', { class: 'eval-now' }, h('b', {}, `評価値 ${scoreText(v)}`), `（${scoreLabel(v)}）`) : shown <= a.moves.length ? h('p', { class: 'note' }, 'この局面はまだ解析していません') : null,
    r && g.record[shown - 1] ? h('p', { class: `review mark-${r.mark}` }, `${shown}. ${g.record[shown - 1].name}：`,
      r.mark === 'best' ? '最善手' : r.mark === 'good' ? `よい手${r.bestName && !hideBest ? `（最善は ${r.bestName}）` : ''}` : `${MARK_NAMES[r.mark]}${hideBest ? '' : `。最善は ${r.bestName ?? '—'}`}（${Math.round(r.loss)} 点の損）`) : null,
    hideBest ? h('p', { class: 'note' }, '対局が続いている間は、最善手を出しません（対局している人の助けにならないように）。終局すると出ます。') : null,
    e?.bestName && !hideBest ? h('p', { class: 'note' }, `この局面の最善手：${e.bestName}${!canHumanAct(s) ? '（盤で光っている手）' : ''}`) : null,
  ];
  return h('section', { class: 'panel analysis' },
    h('h2', {}, '解析'),
    evalGraph(s, a),
    h('p', { class: 'note eg-legend' }, '上が先手有利、下が後手有利。グラフを押すとその局面へ。'),
    ...here,
    doneN >= total ? h('table', { class: 'tally' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, '疑問手'), h('th', {}, '悪手'), h('th', {}, '大悪手'))),
      h('tbody', {}, ([0, 1] as const).map((sd) => h('tr', {}, h('th', {}, `${sd === 0 ? '▲' : '△'}${s.names[sd]}`),
        h('td', {}, String(count(sd, 'dubious'))), h('td', {}, String(count(sd, 'mistake'))), h('td', {}, String(count(sd, 'blunder'))))))) : null,
    head);
}

// ---------- Lishogi の観戦 ----------
const WATCH_MS = 4000; // 対局中の手を読みにいく間隔
let watchList: { games: LishogiGame[] | null; error: string; loading: boolean } = { games: null, error: '', loading: false };

function stopWatch(s: Session | null) {
  if (s?.watch?.timer != null) { clearTimeout(s.watch.timer); s.watch.timer = null; }
}

const lishogiStart = (info: LishogiGame) => info.initialSfen ?? RULESETS.standard.start;

// Lishogi の手（USI）を盤に足す。読めない手があれば、そこまでにする
function applyMoves(g: Game, usis: string[], from: number): string {
  for (let i = from; i < usis.length; i++) {
    if (g.result) return '';
    const m = fromUsi(g.pos, usis[i]);
    if (m == null) return `${i + 1} 手目（${usis[i]}）が読めませんでした`;
    g.play(m);
  }
  return '';
}

async function startWatch(id: string) {
  stopAnalysis(session); stopWatch(session); cancelThinking();
  watchList.error = ''; watchList.loading = true; render();
  let info: LishogiGame;
  try { info = await fetchGame(id); } catch (e) {
    watchList.loading = false; watchList.error = e instanceof RateLimited ? 'Lishogi が混んでいます。1 分ほど待ってからもう一度お試しください。' : (e as Error).message; render(); return;
  }
  watchList.loading = false;
  if (info.variant !== 'standard') { watchList.error = 'この対局は本将棋ではないので見られません（Lishogi の変わり将棋）'; render(); return; }
  let game: Game;
  try { game = new Game(RULESETS.standard, lishogiStart(info)); } catch { watchList.error = '対局のはじめの局面が読めませんでした'; render(); return; }
  const error = applyMoves(game, info.moves, 0);
  const s: Session = {
    mode: 'watch', game, mySide: null, level: settings.level, flipped: false, autoFlip: false, selected: null, view: null, thinking: false,
    message: '', names: [playerLabel(info.players.sente), playerLabel(info.players.gote)], watch: { id: info.id, info, error, timer: null, shown: 0 },
  };
  session = s; screen = 'game';
  history.replaceState(null, '', `?lishogi=${info.id}`);
  render();
  followAnalysis(s);
  scheduleWatch(s, WATCH_MS);
}

function scheduleWatch(s: Session, ms: number) {
  const w = s.watch!;
  if (w.info.status !== 'started') return;
  w.timer = window.setTimeout(() => void pollWatch(s), ms);
}

async function pollWatch(s: Session) {
  const w = s.watch!;
  w.timer = null;
  if (session !== s) return;
  if (document.hidden) return scheduleWatch(s, WATCH_MS); // 見ていない間は読みにいかない
  let info: LishogiGame;
  try { info = await fetchGame(w.id); } catch (e) {
    if (session !== s) return;
    const limited = e instanceof RateLimited;
    w.error = limited ? 'Lishogi が混んでいるので、1 分待ってから読み直します' : `読み直せませんでした（${(e as Error).message}）。少しして読み直します`;
    render();
    return scheduleWatch(s, limited ? 60_000 : WATCH_MS * 3);
  }
  if (session !== s) return;
  const g = s.game;
  const same = g.record.length <= info.moves.length && w.info.moves.slice(0, g.record.length).every((u, i) => info.moves[i] === u);
  w.error = '';
  if (same) {
    if (info.moves.length > g.record.length) {
      w.error = applyMoves(g, info.moves, g.record.length);
      if (s.view === g.record.length) s.view = null;
    }
  } else {
    // 手が入れ替わった（めったにない）：はじめから並べ直す
    stopAnalysis(s); s.analysis = undefined; s.view = null;
    s.game = new Game(RULESETS.standard, lishogiStart(info));
    w.error = applyMoves(s.game, info.moves, 0);
  }
  w.info = info;
  render();
  followAnalysis(s);
  scheduleWatch(s, WATCH_MS);
}

function renderWatchInfo(s: Session): HTMLElement {
  const w = s.watch!;
  const i = w.info;
  return h('div', { class: 'watch-info' },
    h('p', { class: 'note' }, [i.rated ? 'レーティング戦' : '練習対局', clockText(i)].filter(Boolean).join('・')),
    i.status === 'started' ? h('p', { class: 'live' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), `対局中（${WATCH_MS / 1000} 秒ごとに新しい手を読みます）`) : null,
    w.error ? h('p', { class: 'message' }, w.error) : null,
    h('p', { class: 'note' }, h('a', { href: `${LISHOGI}/${i.id}`, target: '_blank', rel: 'noopener' }, 'Lishogi で開く'), '・対局のデータ：Lishogi（lishogi.org）'));
}

async function loadWatchList() {
  watchList = { ...watchList, loading: true, error: '' };
  render();
  try { watchList.games = await listLiveGames(); } catch (e) {
    watchList.error = e instanceof RateLimited ? 'Lishogi が混んでいます。1 分ほど待ってからもう一度お試しください。' : `一覧を読めませんでした（${(e as Error).message}）`;
  }
  watchList.loading = false;
  if (screen === 'watch-list') render();
}

function renderWatchList() {
  if (!watchList.games && !watchList.loading && !watchList.error) { void loadWatchList(); return; }
  const input = h('input', { type: 'text', class: 'text', placeholder: 'https://lishogi.org/xxxxxxxx', 'aria-label': 'Lishogi の対局の URL か ID', autocomplete: 'off', enterkeyhint: 'go' });
  const open = () => {
    const id = gameIdOf(input.value);
    if (!id) { watchList.error = 'Lishogi の対局の URL（例 https://lishogi.org/AbCd1234）か、8 文字の ID を入れてください'; render(); return; }
    void startWatch(id);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  const games = watchList.games ?? [];
  app.replaceChildren(h('div', {},
    header('世界の対局を観戦'),
    h('main', { class: 'title-main' },
      h('p', { class: 'lead' }, 'Lishogi（世界の人が遊ぶ無料でオープンソースの将棋サイト）で、いま指されている本将棋の対局です。選ぶと盤に並べ、新しい手が指されるたびに形勢を読みます。'),
      watchList.error ? h('p', { class: 'message', role: 'alert' }, watchList.error) : null,
      h('section', { class: 'panel' },
        h('h2', {}, 'いま注目の対局'),
        watchList.loading && !games.length ? h('p', { class: 'note', role: 'status' }, '読み込んでいます…') : null,
        !watchList.loading && watchList.games && !games.length ? h('p', { class: 'note' }, 'いま対局中の注目の対局はありません。少ししてから「新しくする」を押してください。') : null,
        h('ul', { class: 'watch-list' }, games.map((g) => h('li', {},
          h('button', { class: 'btn watch-game', onclick: () => void startWatch(g.id) },
            h('span', { class: 'vs' }, `▲${playerLabel(g.players.sente)}`, h('small', {}, ' 対 '), `△${playerLabel(g.players.gote)}`),
            h('small', {}, [startedText(g), clockText(g), g.rated ? 'レーティング戦' : ''].filter(Boolean).join('・')))))),
        h('div', { class: 'btns' }, h('button', { class: 'btn sm', disabled: watchList.loading, onclick: () => void loadWatchList() }, watchList.loading ? '読み込み中…' : '新しくする')),
        h('p', { class: 'note' }, '一覧は少し前の様子です。開くと最新の手まで並べます。')),
      h('section', { class: 'panel' },
        h('h2', {}, 'URL で開く'),
        h('p', { class: 'note' }, 'Lishogi で見つけた対局の URL を貼り付けます。終わった対局も開けます（解析も使えます）。'),
        h('div', { class: 'row' }, input, h('button', { class: 'btn primary', disabled: watchList.loading, onclick: open }, '観戦する'))),
      h('p', { class: 'note' }, '対局のデータは Lishogi（lishogi.org）の公開 API から、この端末が直接読み込みます。対局が続いている間は、最善手を出しません。'))));
}

// ---------- 詰将棋の一覧 ----------
function startTsume(t: Tsume) {
  startGame('tsume', RULESETS.standard, t.sfen, { tsume: t, mySide: 0, names: ['攻め方（あなた）', '受け方'], message: `${t.plies} 手で詰ませてください。王手の連続で詰ませます。` });
}

function showAnswer(s: Session) {
  const p = Position.fromSfen(s.tsume!.sfen);
  const line = solve(p, s.tsume!.plies) ?? [];
  const g = new Game(RULESETS.standard, s.tsume!.sfen);
  for (const m of line) g.play(m);
  s.message = `答え：${g.record.map((r) => r.name).join(' ')}`;
  render();
}

function renderTsumeList() {
  const solved = new Set(load<string[]>(SOLVED_KEY) ?? []);
  app.replaceChildren(h('div', {},
    header('詰将棋'),
    h('main', { class: 'title-main' },
      h('p', { class: 'lead' }, `攻め方（あなた）は王手を続けて、受け方の玉を詰ませます。解いた問題：${solved.size}/${TSUME.length}`),
      [1, 3, 5].map((n) => h('section', { class: 'panel' },
        h('h2', {}, `${n} 手詰め`),
        h('div', { class: 'tsume-grid' }, TSUME.filter((t) => t.plies === n).map((t) =>
          h('button', { class: `btn tsume${solved.has(t.id) ? ' solved' : ''}`, onclick: () => startTsume(t) }, t.title.replace(`${n}手詰め `, ''), solved.has(t.id) ? h('small', {}, '✓ 解いた') : null))))))));
}

// ---------- 駒の動かし方 ----------
let practiceType = 7;
let practicePos = 40; // 5五
function renderPractice() {
  const p = Position.fromSfen('9/9/9/9/9/9/9/9/9 b - 1');
  p.board[practicePos] = practiceType;
  p.rehash();
  const moves = p.legalMoves().filter((m) => !isDrop(m));
  const targets = new Set(moves.map(mTo));
  const view: BoardView = {
    pos: p, flipped: false, selected: { from: practicePos }, targets, last: null, canAct: true, names: ['あなた', ''],
    onSquare: (sq) => { if (targets.has(sq)) { practicePos = sq; render(); } },
    onHand: () => {},
  };
  const desc: Record<number, string> = {
    7: '飛車：たて・よこに、何マスでも進めます。成ると竜（斜めにも 1 マス）。',
    6: '角：ななめに、何マスでも進めます。成ると馬（たて・よこにも 1 マス）。',
    5: '金：前・ななめ前・よこ・後ろに 1 マス。ななめ後ろには行けません。',
    4: '銀：前・ななめ前・ななめ後ろに 1 マス。よこと後ろには行けません。',
    3: '桂：2 つ前の左右に跳びます。間に駒があっても跳べます。',
    2: '香：前にだけ、何マスでも進めます。',
    1: '歩：前に 1 マスだけ。成るとと金（金と同じ動き）。',
    8: '玉：まわり 8 マスのどこへでも 1 マス。取られたら負け。',
    14: '竜：飛車の動き＋ななめに 1 マス。', 13: '馬：角の動き＋たて・よこに 1 マス。', 9: 'と金：金と同じ動き。',
  };
  app.replaceChildren(h('div', {},
    header('駒の動かし方'),
    h('main', { class: 'layout' },
      h('div', { class: 'main-col' }, renderBoard(view)),
      h('aside', { class: 'side' },
        h('section', { class: 'panel' },
          h('h2', {}, '駒を選ぶ'),
          h('div', { class: 'chips' }, [8, 7, 6, 5, 4, 3, 2, 1, 14, 13, 9].map((t) =>
            h('button', { class: `btn sm${t === practiceType ? ' on' : ''}`, onclick: () => { practiceType = t; practicePos = 40; render(); } }, NAME[t]))),
          h('p', { class: 'desc' }, desc[practiceType] ?? ''),
          h('p', { class: 'note' }, '光っているマスを押すと、駒がそこへ動きます。盤の端に近づくと動ける場所が変わります。'),
          h('p', { class: 'note' }, `動ける方向：${(MOVES[practiceType].step.length + MOVES[practiceType].slide.length)} 方向${MOVES[practiceType].slide.length ? '（うち走る方向あり）' : ''}${canPromoteType(practiceType) ? '・敵陣で成れる' : ''}`))))));
}

// ---------- オンライン ----------
let onlineGame: OnlineSession | null = null;
function onlineHandlers() {
  return {
    onStart: (o: OnlineSession) => {
      onlineGame = o;
      const st = o.state();
      session = { mode: 'online', game: st.game, mySide: st.you, level: 'beginner', flipped: st.you === 1, autoFlip: false, selected: null, view: null, thinking: false, message: '', names: st.names };
      screen = 'game';
      render();
    },
    onUpdate: (o: OnlineSession) => {
      if (!session || session.mode !== 'online') return;
      const st = o.state();
      if (st.you !== session.mySide) { session.mySide = st.you; session.flipped = st.you === 1; } // もう一局で先後が入れ替わった
      if (st.game.record.length !== session.game.record.length) { session.selected = null; session.view = null; }
      session.game = st.game;
      session.names = st.names;
      session.message = st.message;
      render();
    },
    onTick: () => { document.querySelectorAll<HTMLElement>('[data-clock]').forEach((el) => { const c = onlineGame?.clocks(); if (c) el.textContent = c[Number(el.dataset.clock)]; }); },
    render,
  };
}

// 招待 URL（?room=合言葉）から開いたとき
const params = new URLSearchParams(location.search);
const room = params.get('room');
if (room) { screen = 'online'; onlineSession.pendingCode = room.toUpperCase(); }
// 観戦の URL（?lishogi=対局の ID）から開いたとき
const watchId = gameIdOf(params.get('lishogi') ?? '');
if (watchId) { screen = 'watch-list'; watchList.games = []; void startWatch(watchId); }
render();
void mkMove;
