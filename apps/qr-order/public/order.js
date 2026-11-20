(() => {
  const $ = (id) => document.getElementById(id);
  const yen = (n) => '¥' + n.toLocaleString('ja-JP');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const dt = (s) => new Date(s).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const orderId = location.pathname.split('/')[3] || '';
  // メールのリンクに付く合言葉（古いメールのリンクを見分けるため）
  const mailKey = new URLSearchParams(location.search).get('m');
  const mailQuery = mailKey ? '?m=' + encodeURIComponent(mailKey) : '';
  const started = Date.now();

  // スクリーンショットではなく実際の画面であることが分かるよう現在時刻を動かす
  setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('ja-JP'); }, 1000);

  function row(label, value, cls) {
    const tr = el('tr', cls);
    tr.append(el('td', null, label), el('td', 'num', value));
    return tr;
  }

  function render(o) {
    $('store-name').textContent = o.store.name;
    $('contact-link').href = '/qr-order/contact/' + encodeURIComponent(o.store.id) + '?order=' + encodeURIComponent(o.id);
    $('contact-link').hidden = o.status === 'pending';
    if (window.rememberOrder && o.status !== 'pending') window.rememberOrder(o.store.id, o.id);
    $('shop-link').href = '/qr-order/s/' + encodeURIComponent(o.store.id);
    $('return-link').href = '/qr-order/return/' + encodeURIComponent(o.id);
    $('return-link').hidden = o.status === 'pending' || o.status === 'refunded';
    $('shop-link').hidden = o.status === 'pending';
    $('ticket-icon').hidden = !(o.status === 'paid' || o.status === 'handed_over');
    // 支払いが済んだらカートを空にする
    if (o.status !== 'pending') { try { localStorage.removeItem('cart:' + o.store.id); } catch { /* 無視 */ } }
    $('ticket').className = 'card ticket ' + o.status;
    const view = {
      pending: ['お支払いを確認しています…', 'まだお支払いは完了していません。このままお待ちください。'],
      paid: ['お支払い完了', 'ご利用ありがとうございました。この画面が購入の証明になります。'],
      handed_over: ['お支払い完了', 'ご利用ありがとうございました。この画面が購入の証明になります。'],
      refunded: ['返金済み', 'このご注文は返金されました。'],
    }[o.status];
    $('state').textContent = view[0];
    const paid = o.status === 'paid' || o.status === 'handed_over';
    const ageWait = paid && o.ageCheckRequired && !o.ageChecked;
    $('hint').textContent = ageWait
      ? '年齢確認が必要な商品が含まれています。店舗スタッフにこの画面を見せて、年齢の確認を受けてください。'
      : view[1] + (paid && o.ageCheckRequired ? ' 年齢確認済みです。' : '');
    if (ageWait) $('state').textContent = 'お支払い完了・年齢確認待ち';
    if (paid) $('ticket').className = 'card ticket paid' + (ageWait ? ' age-wait' : '');
    const showNo = o.status === 'paid' || o.status === 'handed_over';
    $('pickup').hidden = !showNo;
    $('no-label').hidden = !showNo;
    $('age-law').hidden = !o.ageCheckRequired;
    $('pickup').textContent = o.pickupNo == null ? '…' : String(o.pickupNo).padStart(3, '0');

    $('receipt').hidden = o.status === 'pending';
    $('receipt-head').textContent = [
      o.store.name,
      o.store.invoiceNumber ? '登録番号 ' + o.store.invoiceNumber : null,
      o.paidAt ? '取引日時 ' + dt(o.paidAt) : null,
      '注文ID ' + o.id,
    ].filter(Boolean).join(' / ');
    $('lines').replaceChildren(
      ...o.items.map((i) => row(i.name + (i.taxRate === 8 ? ' ※' : '') + ' × ' + i.qty, yen(i.unitPrice * i.qty))),
      row('合計（税込）', yen(o.total), 'sum'),
      ...(o.refundedAmount > 0 ? [row('返金済み', '−' + yen(o.refundedAmount))] : []),
      ...o.tax.map((t) => row(t.rate + '%対象 ' + yen(t.subtotal) + '（内消費税）', yen(t.tax))),
    );
  }

  async function poll() {
    let next = 3000;
    try {
      const res = await fetch('/qr-order/api/orders/' + encodeURIComponent(orderId) + mailQuery, { cache: 'no-store' });
      if (res.status === 410) {
        // 返品・交換を受け付けたあと、それより前に送った購入完了メールのリンクで開かれた
        $('state').textContent = 'このメールのリンクは使えません';
        $('hint').textContent = '返品・交換のお申し込みを受け付けたため、購入完了メールのリンクは無効になりました。後からお送りした「返品・交換のお申し込みを受け付けました」のメールのリンクから開いてください。';
        return;
      }
      if (res.status === 404) {
        $('state').textContent = 'ご注文が見つかりません';
        return;
      }
      if (res.ok) {
        const o = await res.json();
        render(o);
        if (o.status === 'refunded') return;
        // 支払い完了後は、年齢確認や返金の反映だけを見ればよいので間隔をあける
        if (o.status !== 'pending') next = o.ageCheckRequired && !o.ageChecked ? 4000 : 30000;
        if (o.status === 'pending') {
          next = 2000;
          if (Date.now() - started > 5 * 60 * 1000) {
            $('state').textContent = 'お支払いを確認できませんでした';
            $('hint').textContent = 'お支払いが完了していない可能性があります。店舗スタッフにお声がけください。';
            return;
          }
        }
      }
    } catch { /* 通信エラー時は再試行 */ }
    setTimeout(poll, next);
  }
  poll();
})();
