// 地図アプリのリンクや、貼り付けた座標から、緯度・経度を読み取る
// 対応：「35.7100, 139.8107」「35°42'36.2"N 139°48'38.6"E」、Google マップ（@緯度,経度 / !3d緯度!4d経度 / q= / ll= / query=）、Apple マップ（ll= / q=）
(() => {
  const valid = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  const pair = (a, b) => { const lat = parseFloat(a), lng = parseFloat(b); return valid(lat, lng) ? { lat, lng } : null; };
  function dms(text) {
    const re = /(\d{1,3})[°度]\s*(\d{1,2})['′分]\s*([\d.]+)["″秒]?\s*([NSEW北南東西])/gi;
    const parts = [...text.matchAll(re)].map((m) => {
      const v = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
      const h = m[4].toUpperCase();
      return { v: /[SW南西]/.test(h) ? -v : v, lat: /[NS北南]/.test(h) };
    });
    const la = parts.find((p) => p.lat), lo = parts.find((p) => !p.lat);
    return la && lo && valid(la.v, lo.v) ? { lat: la.v, lng: lo.v } : null;
  }
  window.parseLatLng = (raw) => {
    const text = String(raw || '').trim();
    if (!text) return null;
    let s = text;
    try { s = decodeURIComponent(text); } catch { /* そのまま使う */ }
    const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
    const tries = [
      new RegExp('!3d' + num + '!4d' + num),                    // Google マップの場所のデータ（ピンの位置）
      new RegExp('[?&](?:q|query|ll|center|daddr|destination)=' + num + '\\s*,\\s*' + num),
      new RegExp('@' + num + ',' + num),                        // Google マップの表示位置
      new RegExp('^' + num + '\\s*[,、\\s]\\s*' + num + '$'),    // 座標だけ
    ];
    for (const re of tries) { const m = s.match(re); if (m) { const p = pair(m[1], m[2]); if (p) return p; } }
    return dms(s);
  };
  /** 共有用の短いリンク（maps.app.goo.gl など）は、ブラウザでは中身を読めないのでサーバーで展開する */
  window.isShortMapLink = (raw) => /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(String(raw || '').trim());
})();
