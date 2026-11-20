// お問い合わせチャット（お客様側）。店舗のスタッフは LINE で受け答えする。
// この画面は、購入の証明（購入完了）の画面か、返品・交換の画面からだけ開く。
// 問い合わせの対象は、開いた元の画面の注文に決まる（選び直しはしない）。注文ごとに 1 つのやり取りにまとまる。
(async () => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const showError = (msg) => { $('error').textContent = msg; $('error').hidden = !msg; };
  const time = (s) => new Date(s).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const no = (n) => String(n ?? '').padStart(3, '0');

  const storeId = decodeURIComponent(location.pathname.split('/')[3] || '');
  const params = new URLSearchParams(location.search);
  const orderId = params.get('order') || '';
  const fromReturn = params.get('from') === 'return';
  $('back').href = !orderId ? '/qr-order/s/' + encodeURIComponent(storeId) : (fromReturn ? '/qr-order/return/' : '/qr-order/order/') + encodeURIComponent(orderId);
  $('back').setAttribute('aria-label', fromReturn ? '返品・交換の画面へ戻る' : '購入の証明の画面へ戻る');

  const hideForm = (msg) => { $('form').hidden = true; $('empty').hidden = true; showError(msg); };
  if (!orderId) return hideForm('お問い合わせは、購入の証明の画面、または返品・交換の画面の「店舗にチャットで問い合わせる」から開いてください。');

  // 開いた元の画面の注文（支払いが済んだ、この店舗の注文のみ）
  let order;
  try {
    const res = await fetch('/qr-order/api/orders/' + encodeURIComponent(orderId), { cache: 'no-store' });
    if (!res.ok) throw new Error();
    order = await res.json();
    if (order.status === 'pending' || order.store.id !== storeId) throw new Error();
  } catch {
    return hideForm('注文が見つかりません。購入の証明の画面から開き直してください。');
  }
  $('store-name').textContent = order.store.name + ' お問い合わせ';
  document.title = order.store.name + ' | お問い合わせ';
  $('order-summary').textContent = '注文番号 ' + no(order.pickupNo) + '　' + time(order.paidAt || order.createdAt) + '　¥' + order.total.toLocaleString('ja-JP');
  $('order-pick').hidden = false;
  if (window.rememberOrder) window.rememberOrder(storeId, orderId);

  let lastId = 0;
  const seen = new Set();
  function add(m) {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    lastId = Math.max(lastId, m.id);
    const row = el('div', 'chat-msg ' + (m.sender === 'customer' ? 'mine' : 'theirs'));
    row.append(el('div', 'chat-who', m.sender === 'customer' ? 'あなた' : '店舗スタッフ'), el('div', 'chat-bubble', m.body), el('div', 'chat-time', time(m.createdAt)));
    $('log').append(row);
    $('empty').hidden = true;
    row.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }
  async function load() {
    try {
      const res = await fetch('/qr-order/api/orders/' + encodeURIComponent(orderId) + '/chat?after=' + lastId, { cache: 'no-store' });
      if (!res.ok) return;
      for (const m of (await res.json()).messages) add(m);
    } catch { /* 通信できないときは次の機会に取り直す */ }
  }

  $('body').addEventListener('input', () => { $('count').textContent = $('body').value.length + ' / 500'; });
  $('form').onsubmit = async (ev) => {
    ev.preventDefault();
    const text = $('body').value.trim();
    if (!text) return;
    const btn = ev.target.querySelector('button');
    btn.disabled = true;
    showError('');
    try {
      const res = await fetch('/qr-order/api/orders/' + encodeURIComponent(orderId) + '/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: text }) });
      if (res.status === 429) throw new Error('送信の回数が多すぎます。少し待ってからもう一度お試しください。');
      if (!res.ok) throw new Error('送信できませんでした。もう一度お試しください。');
      add((await res.json()).message);
      $('body').value = '';
      $('count').textContent = '0 / 500';
    } catch (e) {
      showError(e.message || '送信できませんでした。通信状況を確認してください。');
    }
    btn.disabled = false;
  };

  await load();
  // 返信を待つ：画面を見ているあいだだけ、数秒おきに確認する
  setInterval(() => { if (!document.hidden) load(); }, 4000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
})();
