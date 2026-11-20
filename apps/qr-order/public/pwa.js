// ホーム画面に追加して、アプリのように起動できるようにする
(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/qr-order/sw.js').catch(() => { /* 対応していなくても通常どおり使える */ }); });
  }

  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return; // すでにアプリとして開いている

  let promptEvent = null;
  let button = null;

  function place() {
    if (button || !document.querySelector('link[rel="manifest"]')) return;
    const host = document.querySelector('.theme-switch')?.parentElement || document.querySelector('footer') || document.querySelector('main');
    if (!host) return;
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'install-button';
    button.textContent = 'ホーム画面に追加';
    button.onclick = async () => {
      if (promptEvent) {
        promptEvent.prompt();
        const choice = await promptEvent.userChoice.catch(() => null);
        promptEvent = null;
        if (choice && choice.outcome === 'accepted') button.remove();
        return;
      }
      // iPhone / iPad はブラウザから追加の画面を出せないので、手順を案内する
      alert('ブラウザの共有ボタン（四角から矢印が出ているアイコン）を押し、「ホーム画面に追加」を選んでください。');
    };
    host.append(button);
  }

  // Android / PC の Chrome・Edge：追加できる状態になると通知が来る
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptEvent = e;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place); else place();
  });
  window.addEventListener('appinstalled', () => { if (button) button.remove(); });

  // iPhone / iPad の Safari：通知が来ないので、最初から案内のボタンを出す
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) document.addEventListener('DOMContentLoaded', () => setTimeout(place, 0));
})();
