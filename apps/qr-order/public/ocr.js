// バーコードの下に印字された数字（JAN）を文字認識で読む。バーコードの線が読めないときの補助。
// 認識は端末内で行い、映像は送信しない。認識用のプログラムは最初に使うときだけ読み込む
(() => {
  let workerPromise = null;
  let busy = false;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('load ' + src));
      document.head.append(s);
    });
  }

  function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        if (!window.Tesseract) await loadScript('/qr-order/vendor/tesseract/tesseract.min.js');
        const worker = await window.Tesseract.createWorker('eng', 1, {
          workerPath: '/qr-order/vendor/tesseract/worker.min.js',
          corePath: '/qr-order/vendor/tesseract',
          langPath: '/qr-order/vendor/tesseract/lang',
          workerBlobURL: false,
          gzip: true,
        });
        // 数字と空白だけを認識させる。空白を許さないと、数字の間のすき間が余計な数字として読まれる
        await worker.setParameters({ tessedit_char_whitelist: '0123456789 ', tessedit_pageseg_mode: '11' });
        return worker;
      })().catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
  }

  /** 認識した文字から、チェックデジットが合う 13 桁・8 桁の番号を探す */
  function findCode(text) {
    for (const line of text.split('\n')) {
      const digits = line.replace(/\D/g, '');
      for (const len of [13, 8]) {
        for (let i = 0; i + len <= digits.length; i++) {
          const c = digits.slice(i, i + len);
          // 8 桁は偶然一致しやすいので、行がちょうど 8 桁のときだけ採用する
          if ((len === 13 || digits.length === 8) && window.validBarcode(c)) return c;
        }
      }
    }
    return null;
  }

  window.ocrBusy = () => busy;

  let ready = false;

  /**
   * canvas の映像から番号を読む。読めなければ null。同時に 1 件だけ処理する。
   * onInfo には途中経過を渡す：{ stage: 'loading' }（認識の準備中）、{ stage: 'text', text }（いま読めている数字）
   */
  window.readDigits = async (canvas, onInfo) => {
    if (busy || !window.validBarcode) return null;
    busy = true;
    try {
      if (!ready && onInfo) onInfo({ stage: 'loading' });
      // 認識中に映像が書き換わらないよう、写しを取って渡す
      const copy = document.createElement('canvas');
      copy.width = canvas.width; copy.height = canvas.height;
      copy.getContext('2d').drawImage(canvas, 0, 0);
      const worker = await getWorker();
      ready = true;
      const { data } = await worker.recognize(copy);
      const text = data.text || '';
      if (onInfo) {
        // 数字がいちばん多く写っている行を、いま読めている内容として見せる
        const best = text.split('\n').map((l) => l.replace(/[^\d ]/g, '').replace(/ +/g, ' ').trim()).sort((a, b) => b.replace(/ /g, '').length - a.replace(/ /g, '').length)[0] || '';
        onInfo({ stage: 'text', text: best.slice(0, 24) });
      }
      return findCode(text);
    } catch {
      return null;
    } finally {
      busy = false;
    }
  };
})();
