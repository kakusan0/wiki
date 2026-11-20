// 表示の明るさ：ブラウザ自動（既定）/ ライト / ダーク。選択は端末に保存する
(() => {
  const KEY = 'theme';
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  const saved = () => {
    try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch { return 'auto'; }
  };
  /** 実際に表示される明るさ（自動のときは端末・ブラウザの設定に従う） */
  window.effectiveTheme = () => { const s = saved(); return s === 'auto' ? (media.matches ? 'dark' : 'light') : s; };

  function apply() {
    const s = saved();
    if (s === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', s);
    for (const b of document.querySelectorAll('.theme-switch button')) b.setAttribute('aria-pressed', String(b.dataset.value === s));
    document.dispatchEvent(new CustomEvent('themechange', { detail: window.effectiveTheme() }));
  }

  window.setTheme = (value) => {
    try { if (value === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, value); } catch { /* 保存できなくても今回の表示は切り替える */ }
    apply();
  };

  // 画面が描かれる前に反映して、一瞬だけ別の色が見えるのを防ぐ
  apply();
  media.addEventListener('change', () => { if (saved() === 'auto') apply(); });

  // 切り替えボタンを置く（[data-theme-slot] があればそこ、なければフッターか本文の末尾）
  document.addEventListener('DOMContentLoaded', () => {
    const slot = document.querySelector('[data-theme-slot]') || document.querySelector('footer') || document.querySelector('main') || document.body;
    const group = document.createElement('div');
    group.className = 'theme-switch';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', '表示の明るさ');
    for (const [value, label] of [['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.value = value;
      b.textContent = label;
      b.onclick = () => window.setTheme(value);
      group.append(b);
    }
    slot.append(group);
    apply();
  });
})();
