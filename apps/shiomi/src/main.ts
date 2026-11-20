// 入口：?mode=train / ?mode=truck で、どちらの乗り物を動かすかを決める。
// 選んだほうの画面（index.html の template）を出してから、その乗り物のプログラムを読み込む。
const MODES = { train: () => import('./train/main'), truck: () => import('./truck/main') } as const;
type Mode = keyof typeof MODES;

const mode = new URLSearchParams(location.search).get('mode') as Mode | null;
if (mode && mode in MODES) {
  const tpl = document.getElementById(`tpl-${mode}`) as HTMLTemplateElement;
  document.body.prepend(tpl.content.cloneNode(true));
  document.body.dataset.mode = mode;
  // どちらの画面からも、はじめの画面へ戻れる
  const back = document.createElement('a');
  back.className = 'to-menu'; back.href = './'; back.textContent = '← はじめの画面';
  document.body.append(back);
  await MODES[mode]();
} else {
  document.getElementById('menu')!.hidden = false;
}

export {};
