// 現在地（GPS など）を取得する。位置そのものはサーバーで店舗からの距離に変えて使い、保存しない
(() => {
  let last = null; // { lat, lng, accuracy, at }
  let inflight = null;
  const MESSAGES = {
    unsupported: 'この端末・ブラウザでは位置情報を使えません。別のブラウザ（iPhone は Safari、Android は Chrome）でお試しください。',
    denied: '位置情報の利用が許可されていません。ブラウザ（または端末）の設定で、このサイトの位置情報を「許可」にしてから、もう一度お試しください。',
    unavailable: '現在地を取得できませんでした。端末の位置情報（GPS）をオンにして、もう一度お試しください。',
    timeout: '現在地の取得に時間がかかっています。屋外や窓の近くで、もう一度お試しください。',
  };
  const makeError = (code) => { const e = new Error(MESSAGES[code]); e.code = code; return e; };
  const errCode = (err) => (err && err.code === 1 ? 'denied' : err && err.code === 3 ? 'timeout' : 'unavailable');
  const readPos = (opts) => new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), at: Date.now() }),
      reject,
      opts,
    );
  });
  /** 現在地を返す。maxAgeMs 以内に取得したものがあれば、それを使う */
  window.getGeo = (maxAgeMs = 120000) => {
    if (last && Date.now() - last.at < maxAgeMs) return Promise.resolve(last);
    if (!navigator.geolocation) return Promise.reject(makeError('unsupported'));
    if (inflight) return inflight;
    // まず高精度（GPS 優先）を試し、屋内や PC などで取れなければ低精度（Wi-Fi / 基地局）へフォールバックする
    inflight = readPos({ enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 })
      .catch((err) => {
        if (err && err.code === 1) throw err; // 許可拒否はフォールバックしても同じなので即失敗
        return readPos({ enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
      })
      .then((pos) => { last = pos; return pos; })
      .catch((err) => { throw makeError(errCode(err)); })
      .finally(() => { inflight = null; });
    return inflight;
  };
  window.geoPayload = (g) => ({ lat: g.lat, lng: g.lng, accuracy: g.accuracy });
})();
