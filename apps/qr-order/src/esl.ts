// 電子棚札（SoluM ST-GR29000：2.9 インチ、296×128、白・黒・赤）に表示する画像を作る。
// OpenEPaperLink の基地局が「7 - Image URL」で定期的に取りに来る。
// 基地局は縮小できないため、画面と同じ 296×128 のベースライン JPEG（4:4:4）を返す。色は白・黒・赤の 3 色だけを使う。
import qrcode from 'qrcode-generator';
import encodeJpeg from './vendor/jpeg-encoder.js';
// 東雲ビットマップフォント（16 ドット、パブリックドメイン）を、文字ごとのビットマップにしたもの（scripts/build-esl-font.py で作成）
import fontBin from './vendor/shinonome16.bin';

export const ESL_W = 296;
export const ESL_H = 128;
const BLACK = 1, RED = 2; // 0 は白
const RGB: [number, number, number][] = [[255, 255, 255], [0, 0, 0], [255, 0, 0]];

// ---- フォント ----
let font: { cps: Uint32Array; widths: Uint8Array; bits: Uint8Array } | null = null;
function loadFont() {
  if (font) return font;
  const view = new DataView(fontBin);
  const n = view.getUint32(0, true);
  const cps = new Uint32Array(n);
  for (let i = 0; i < n; i++) cps[i] = view.getUint32(4 + i * 4, true);
  const widths = new Uint8Array(fontBin, 4 + n * 4, n);
  const bits = new Uint8Array(fontBin, 4 + n * 5, n * 32);
  font = { cps, widths, bits };
  return font;
}
function glyph(cp: number): number {
  const { cps } = loadFont();
  let lo = 0, hi = cps.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cps[mid] === cp) return mid;
    if (cps[mid] < cp) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
/** 文字の幅（ドット）。フォントにない文字は「〓」の幅で数える */
function charWidth(ch: string, scale = 1): number {
  const g = glyph(ch.codePointAt(0)!);
  return (g < 0 ? 16 : loadFont().widths[g]) * scale;
}
export function textWidth(text: string, scale = 1): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch, scale);
  return w;
}

class Canvas {
  px = new Uint8Array(ESL_W * ESL_H);
  set(x: number, y: number, c: number) {
    if (x >= 0 && y >= 0 && x < ESL_W && y < ESL_H) this.px[y * ESL_W + x] = c;
  }
  rect(x: number, y: number, w: number, h: number, c: number) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  /** 文字を描く（scale 倍に拡大）。描いた幅を返す */
  text(x: number, y: number, text: string, c: number, scale = 1): number {
    const f = loadFont();
    let cx = x;
    for (const ch of text) {
      const g = glyph(ch.codePointAt(0)!) >= 0 ? glyph(ch.codePointAt(0)!) : glyph(0x3013); // ない文字は「〓」
      const w = g >= 0 ? f.widths[g] : 16;
      if (g >= 0) {
        for (let row = 0; row < 16; row++) {
          const v = (f.bits[g * 32 + row * 2] << 8) | f.bits[g * 32 + row * 2 + 1];
          for (let col = 0; col < w; col++) if ((v >> (15 - col)) & 1) this.rect(cx + col * scale, y + row * scale, scale, scale, c);
        }
      }
      cx += w * scale;
    }
    return cx - x;
  }
  jpeg(): Uint8Array<ArrayBuffer> {
    const rgba = new Uint8Array(ESL_W * ESL_H * 4);
    for (let i = 0; i < this.px.length; i++) {
      const [r, g, b] = RGB[this.px[i]];
      rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = 255;
    }
    // 品質 100：色の境目がにじまず、白・黒・赤がそのまま残る
    return encodeJpeg({ data: rgba, width: ESL_W, height: ESL_H }, 100).data;
  }
}

/** 幅に収まるように行を分ける。収まらない分は最後の行を「…」で切る */
export function wrap(text: string, maxWidth: number, maxLines: number, scale = 1): string[] {
  const lines: string[] = [];
  let line = '';
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (textWidth(line + ch, scale) > maxWidth) {
      lines.push(line);
      line = '';
      if (lines.length === maxLines) {
        // 最後の行に「…」を付けて切る
        let last = lines[maxLines - 1];
        while (last && textWidth(last + '…', scale) > maxWidth) last = [...last].slice(0, -1).join('');
        lines[maxLines - 1] = last + '…';
        return lines;
      }
    }
    line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

export type EslProduct = { name: string; price: number; taxRate: number; ageRestricted: boolean; available: boolean; qrText: string };

/**
 * 棚札の画像：左に商品の QR コード（読み取るとカートに入る）、右に商品名・価格（赤）。
 * 販売を止めた商品は、QR を出さずに「販売停止中」と表示する。
 */
export function renderEsl(p: EslProduct): Uint8Array<ArrayBuffer> {
  const c = new Canvas();
  let x0: number;
  if (p.available) {
    // QR：周りに 2 マス以上の余白を取り、縦 128 ドットに収まる最大の倍率で描く
    const qr = qrcode(0, 'M');
    qr.addData(p.qrText);
    qr.make();
    const n = qr.getModuleCount();
    const scale = Math.max(1, Math.floor(ESL_H / (n + 4)));
    const size = n * scale;
    const ox = Math.floor((ESL_H - size) / 2), oy = Math.floor((ESL_H - size) / 2);
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) c.rect(ox + col * scale, oy + r * scale, scale, scale, BLACK);
    x0 = ESL_H + 2;
  } else {
    // QR の代わりに大きく「販売停止」と出す（読み取られても、カートには入らない）
    c.text(16, 16, '販売', RED, 3);
    c.text(16, 64, '停止', RED, 3);
    x0 = ESL_H + 2;
  }
  const w = ESL_W - x0 - 4;
  // 商品名（最大 3 行）
  const lines = wrap(p.name, w, 3);
  lines.forEach((l, i) => c.text(x0, 6 + i * 18, l, BLACK));
  if (!p.available) {
    c.text(x0, 74, '販売停止中', RED, 1);
    return c.jpeg();
  }
  // 価格（税込）：数字を 2 倍の大きさで、赤
  const price = p.price.toLocaleString('ja-JP');
  const yen = '円';
  let scale = 2;
  if (textWidth(price + yen, 2) > w) scale = 1;
  const py = 62;
  const pw = c.text(x0, py, price, RED, scale);
  c.text(x0 + pw, py + (scale === 2 ? 16 : 0), yen, RED, 1);
  // 税込の表示。年齢確認が必要な商品は、同じ行（入らなければ次の行）に赤で添える
  const ty = py + 16 * scale + 2;
  const tax = '（税込' + (p.taxRate === 8 ? '・軽減税率' : '') + '）';
  const tw = c.text(x0, ty, tax, BLACK, 1);
  if (p.ageRestricted) {
    const age = '※年齢確認';
    if (tw + textWidth(age) <= w) c.text(x0 + tw, ty, age, RED, 1);
    else c.text(x0, Math.min(ty + 16, ESL_H - 16), age, RED, 1);
  }
  return c.jpeg();
}
