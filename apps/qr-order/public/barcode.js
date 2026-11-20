// 商品バーコード（JAN / EAN-13・EAN-8・UPC-A）をカメラ映像から読み取る。映像は端末内だけで処理する
(() => {
  let reader = null;
  function getReader() {
    if (reader || !window.ZXing) return reader;
    const Z = window.ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A]);
    reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    return reader;
  }

  /** 8・12・13 桁で、末尾のチェックデジットが正しいか（読み間違いを弾く） */
  window.validBarcode = (s) => {
    if (!/^(\d{8}|\d{12,13})$/.test(s)) return false;
    const d = [...s].map(Number);
    const check = d.pop();
    const sum = d.reverse().reduce((a, n, i) => a + n * (i % 2 === 0 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === check;
  };

  /** canvas に描いた映像からバーコードを読む。読めなければ null */
  window.readBarcode = (canvas) => {
    const r = getReader();
    if (!r) return null;
    try {
      const Z = window.ZXing;
      const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
      const text = r.decodeWithState(bitmap).getText();
      return window.validBarcode(text) ? text : null;
    } catch {
      return null; // このフレームには写っていない
    } finally {
      r.reset();
    }
  };
})();
