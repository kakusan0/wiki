// サービスワーカー：通信できないときに案内の画面を出すだけ。
// 画面やプログラムは保存しない（価格や決済の処理が古いまま動くのを避けるため、常に最新を取りに行く）
const CACHE = 'offline-v1';
const OFFLINE_URL = '/qr-order/offline'; // 拡張子なしが正規のアドレス（.html 付きは転送されるため保存に使えない）

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' }))));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return; // ページの表示以外には関与しない
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE_URL)));
});
