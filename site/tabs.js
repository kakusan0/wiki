// 作品のページのタブ（画面の一覧など）。スクリプトが動いたときだけタブを出し、選んだパネルだけを見せる。
// キーボード：← → で隣のタブ、Home・End で最初・最後のタブへ移る（WAI-ARIA のタブの作法）
for (const list of document.querySelectorAll('[role="tablist"]')) {
  const tabs = [...list.querySelectorAll('[role="tab"]')];
  const panelOf = (t) => document.getElementById(t.getAttribute('aria-controls'));
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      panelOf(t).hidden = !on;
    }
    if (focus) tab.focus();
  };
  list.hidden = false;
  list.parentElement.classList.add('has-tabs');
  select(tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0], false);
  list.addEventListener('click', (e) => { const t = e.target.closest('[role="tab"]'); if (t) select(t, false); });
  list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    select(tabs[(next + tabs.length) % tabs.length], true);
  });
}
