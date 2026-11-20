// 読み取り枠：画面に見えている枠の中だけを切り出して読み取る（枠の表示と実際の読み取り範囲を一致させる）
(() => {
  /**
   * 枠（guide）が映像のどの部分に当たるかを、映像の画素で返す。
   * 映像は object-fit: cover で表示しているので、はみ出して見えていない部分を考慮する。
   */
  window.scanRegion = (video, guide) => {
    const vw = video.videoWidth, vh = video.videoHeight;
    const vr = video.getBoundingClientRect(), gr = guide.getBoundingClientRect();
    if (!vw || !vh || !vr.width || !vr.height || !gr.width || !gr.height) return { sx: 0, sy: 0, sw: vw, sh: vh };
    const scale = Math.max(vr.width / vw, vr.height / vh); // cover の拡大率
    const offX = (vw * scale - vr.width) / 2, offY = (vh * scale - vr.height) / 2; // 左右・上下にはみ出している量
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const sx = clamp((gr.left - vr.left + offX) / scale, 0, vw - 1);
    const sy = clamp((gr.top - vr.top + offY) / scale, 0, vh - 1);
    const sw = clamp(gr.width / scale, 1, vw - sx);
    const sh = clamp(gr.height / scale, 1, vh - sy);
    return { sx: Math.round(sx), sy: Math.round(sy), sw: Math.round(sw), sh: Math.round(sh) };
  };

  /** 枠の中の映像を canvas に描く（細い線が潰れないよう、長辺 960px までで等倍に近く保つ） */
  window.drawScanRegion = (video, guide, canvas) => {
    const r = window.scanRegion(video, guide);
    const scale = Math.min(1, 960 / Math.max(r.sw, r.sh));
    canvas.width = Math.max(1, Math.round(r.sw * scale));
    canvas.height = Math.max(1, Math.round(r.sh * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, canvas.width, canvas.height);
    return ctx;
  };

  /** 読み取れた瞬間に枠を光らせる */
  window.flashGuide = (guide) => {
    guide.classList.remove('hit');
    void guide.offsetWidth;
    guide.classList.add('hit');
  };
})();
