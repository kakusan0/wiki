// 現在地（GPS など）を取得する。位置そのものはサーバーで店舗からの距離に変えて使い、保存しない
(() => {
  let last = null; // { lat, lng, accuracy, at }
  const MESSAGES = {
    unsupported: 'この端末・ブラウザでは位置情報を使えません。別のブラウザ（iPhone は Safari、Android は Chrome）でお試しください。',
    denied: '位置情報の利用が許可されていません。ブラウザ（または端末）の設定で、このサイトの位置情報を「許可」にしてから、もう一度お試しください。',
    unavailable: '現在地を取得できませんでした。端末の位置情報（GPS）をオンにして、もう一度お試しください。',
    timeout: '現在地の取得に時間がかかっています。屋外や窓の近くで、もう一度お試しください。',
  };
  /** 現在地を返す。maxAgeMs 以内に取得したものがあれば、それを使う */
  window.getGeo = (maxAgeMs = 120000) => new Promise((resolve, reject) => {
    if (last && Date.now() - last.at < maxAgeMs) return resolve(last);
    const fail = (code) => { const e = new Error(MESSAGES[code]); e.code = code; reject(e); };
    if (!navigator.geolocation) return fail('unsupported');
    navigator.geolocation.getCurrentPosition(
      (p) => { last = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), at: Date.now() }; resolve(last); },
      (err) => fail(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
  window.geoPayload = (g) => ({ lat: g.lat, lng: g.lng, accuracy: g.accuracy });
})();
