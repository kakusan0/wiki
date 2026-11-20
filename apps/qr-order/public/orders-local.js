// この端末で購入した注文の一覧（問い合わせで注文を選ぶために使う。端末の中だけに保存し、サーバーには送らない）
(() => {
  const key = (store) => 'orders:' + store;
  window.rememberOrder = (storeId, orderId) => {
    try {
      const list = JSON.parse(localStorage.getItem(key(storeId)) || '[]').filter((id) => id !== orderId);
      list.unshift(orderId);
      localStorage.setItem(key(storeId), JSON.stringify(list.slice(0, 10)));
    } catch { /* 保存できなくても、ほかの機能には影響しない */ }
  };
  window.rememberedOrders = (storeId) => {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(key(storeId)) || '[]'); } catch { /* 空として扱う */ }
    try { const last = localStorage.getItem('lastOrder:' + storeId); if (last && !list.includes(last)) list.push(last); } catch { /* 無視 */ }
    return list;
  };
})();
