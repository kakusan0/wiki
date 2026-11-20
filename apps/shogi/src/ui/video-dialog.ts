// 「動画で保存」の窓：形・速さ・範囲・向きを選び、作って保存する
import type { Game } from '../engine/game';
import { h } from './dom';
import { SIZES, drawFrame, positions, type Shape, type VideoSpec } from './video-frame';
import { encodeVideo, type Encoded } from './video-encode';
import { timeline, type Speed } from './video-timeline';

export interface VideoOptions {
  game: Game;
  names: [string, string];
  title: string;
  result: string | null;
  flipped: boolean;
  viewPly: number | null; // 棋譜で過去の局面を見ているときの手数
}

const SHAPES: { id: Shape; label: string }[] = [{ id: 'portrait', label: '縦長 9:16' }, { id: 'landscape', label: '横長 16:9' }, { id: 'square', label: '正方形' }];
const SPEEDS: { id: Speed; label: string }[] = [{ id: 'slow', label: 'ゆっくり' }, { id: 'normal', label: 'ふつう' }, { id: 'fast', label: 'はやい' }];
const FPS = 30;

export function openVideoDialog(o: VideoOptions) {
  const total = o.game.record.length;
  const st = { shape: 'portrait' as Shape, speed: 'normal' as Speed, upTo: 'all' as 'all' | 'view', flipped: o.flipped, small: matchMedia('(pointer: coarse)').matches };
  let busy: AbortController | null = null;
  let result: Encoded | null = null;
  const preview = h('canvas', { class: 'video-preview', 'aria-label': '動画の最初の場面' }) as HTMLCanvasElement;
  const bar = h('div', { class: 'video-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, h('i'));
  const status = h('p', { class: 'video-status', role: 'status' }, '');
  const actions = h('div', { class: 'btns' });
  const box = h('div', { class: 'modal-box video-box' });
  const dlg = h('div', { class: 'modal', role: 'dialog', 'aria-label': '動画で保存' }, box);
  const plies = () => (st.upTo === 'view' && o.viewPly != null ? o.viewPly : total);
  const spec = (scale: number): VideoSpec => ({ game: o.game, plies: plies(), names: o.names, title: o.title, result: plies() === total ? o.result : null, flipped: st.flipped, shape: st.shape, scale });
  const close = () => { busy?.abort(); dlg.remove(); };

  const radio = <T extends string>(name: string, list: { id: T; label: string }[], cur: () => T, set: (v: T) => void) =>
    h('div', { class: 'chips', role: 'radiogroup', 'aria-label': name }, list.map((x) => h('label', { class: 'chip-opt' },
      h('input', { type: 'radio', name: `video-${name}`, value: x.id, checked: cur() === x.id, onchange: () => { set(x.id); result = null; render(); } }), h('span', {}, x.label))));

  function drawPreview() {
    const s = spec(0.25);
    const [w, hh] = SIZES[s.shape];
    preview.width = w * 0.25; preview.height = hh * 0.25;
    const t = timeline(s.plies, st.speed, FPS);
    const pos = positions(o.game, s.plies);
    // 最初の手が動いたあとの場面を見せる
    drawFrame(preview.getContext('2d')!, s, t, Math.min(t.total - 1, t.intro + Math.min(s.plies, 3) * t.perMove), pos);
  }

  function render() {
    const t = timeline(plies(), st.speed, FPS);
    box.replaceChildren(
      h('h2', {}, '動画で保存'),
      h('p', { class: 'note' }, `棋譜を 1 手ずつ再生する動画を作ります（${plies()} 手・約 ${Math.round(t.total / FPS)} 秒）。`),
      h('div', { class: 'video-grid' },
        h('div', { class: 'video-opts' },
          h('h3', {}, '形'), radio('形', SHAPES, () => st.shape, (v) => { st.shape = v; }),
          h('h3', {}, '速さ'), radio('速さ', SPEEDS, () => st.speed, (v) => { st.speed = v; }),
          o.viewPly != null && o.viewPly < total ? h('div', {}, h('h3', {}, '範囲'), radio('範囲', [{ id: 'all', label: `最後まで（${total} 手）` }, { id: 'view', label: `いま見ている ${o.viewPly} 手まで` }], () => st.upTo, (v) => { st.upTo = v; })) : null,
          h('h3', {}, '盤の向き'), radio('向き', [{ id: 's', label: '先手が手前' }, { id: 'g', label: '後手が手前' }], () => (st.flipped ? 'g' : 's'), (v) => { st.flipped = v === 'g'; }),
          h('label', { class: 'chip-opt' }, h('input', { type: 'checkbox', id: 'video-small', checked: st.small, onchange: (e: Event) => { st.small = (e.target as HTMLInputElement).checked; result = null; render(); } }), h('span', {}, '小さめに作る（速い・ファイルが軽い）'))),
        preview),
      bar, status, actions);
    drawPreview();
    renderActions();
  }

  function renderActions() {
    const btns: HTMLElement[] = [];
    if (busy) btns.push(h('button', { class: 'btn', type: 'button', onclick: () => busy?.abort() }, '中止'));
    else if (result) {
      const r = result;
      const name = `shogi-${new Date().toISOString().slice(0, 10)}-${plies()}te.${r.ext}`;
      const url = URL.createObjectURL(r.blob);
      btns.push(h('a', { class: 'btn primary', id: 'video-save', href: url, download: name }, `保存する（${r.ext.toUpperCase()}・${(r.blob.size / 1e6).toFixed(1)} MB）`));
      const file = new File([r.blob], name, { type: r.mime });
      if (navigator.canShare?.({ files: [file] })) btns.push(h('button', { class: 'btn', type: 'button', onclick: () => { void navigator.share({ files: [file], title: '将棋の動画' }).catch(() => {}); } }, '写真・アプリへ送る'));
      btns.push(h('button', { class: 'btn', type: 'button', onclick: () => { result = null; render(); } }, '作り直す'));
    } else btns.push(h('button', { class: 'btn primary', id: 'video-make', type: 'button', disabled: plies() === 0, onclick: make }, '動画を作る'));
    btns.push(h('button', { class: 'btn', type: 'button', onclick: close }, '閉じる'));
    actions.replaceChildren(...btns);
  }

  async function make() {
    busy = new AbortController();
    result = null;
    renderActions();
    status.textContent = '作っています…';
    const scale = st.small ? 0.5 : 1;
    const s = spec(scale);
    const t = timeline(s.plies, st.speed, FPS);
    const pos = positions(o.game, s.plies);
    const [w, hh] = SIZES[s.shape];
    try {
      await document.fonts?.ready;
      result = await encodeVideo({
        width: Math.round(w * scale), height: Math.round(hh * scale), fps: FPS, frames: t.total,
        draw: (i, ctx) => drawFrame(ctx, s, t, i, pos),
        onProgress: (k) => { (bar.firstChild as HTMLElement).style.width = `${Math.round(k * 100)}%`; bar.setAttribute('aria-valuenow', String(Math.round(k * 100))); },
        signal: busy.signal,
      });
      status.textContent = 'できました。';
    } catch (e) {
      status.textContent = (e as Error).name === 'AbortError' ? '中止しました。' : `作れませんでした：${(e as Error).message}`;
      (bar.firstChild as HTMLElement).style.width = '0%';
    }
    busy = null;
    renderActions();
  }

  document.body.append(dlg);
  render();
  dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
