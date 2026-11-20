// 1 つのサイトの中で、作品を /<作品>/ の下に置くための道具。
// 作品の Worker には頭の /<作品> を外したリクエストを渡し、返ってきた応答のパスを /<作品>/… に戻す。

export interface Fetcher { fetch(req: Request): Promise<Response>; }

/** /<base>/rest → /rest に付け替えたリクエスト（クエリや本文・ヘッダーはそのまま） */
export function strip(req: Request, base: string): Request {
  const url = new URL(req.url);
  url.pathname = url.pathname.slice(base.length) || '/';
  return new Request(url.toString(), req);
}

const isLocal = (v: string) => v.startsWith('/') && !v.startsWith('//');
/** 作品の中のパス（/x）を、サイトのパス（/<base>/x）にする。すでに付いていれば、そのまま */
export function addBase(v: string, base: string): string {
  if (!isLocal(v) || v === base || v.startsWith(base + '/')) return v;
  return base + v;
}

/** Set-Cookie の Path を作品の下にする（作品どうしで混ざらないように） */
export function cookiePath(cookie: string, base: string): string {
  if (/;\s*path=/i.test(cookie)) return cookie.replace(/(;\s*path=)([^;]*)/i, (_m, k: string, p: string) => k + addBase(p.trim() || '/', base));
  return `${cookie}; Path=${base}/`;
}

const ATTRS = ['href', 'src', 'action', 'formaction', 'poster'];
/** 応答の転送先・Cookie・HTML の中のパスを、作品の下に直す */
export function fixResponse(res: Response, base: string, rewriteHtml = true): Response {
  if (res.status === 101) return res; // WebSocket はそのまま
  const loc = res.headers.get('Location');
  const cookies = typeof (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie() : [];
  const html = rewriteHtml && (res.headers.get('content-type') ?? '').includes('text/html') && typeof HTMLRewriter !== 'undefined';
  if (!loc && !cookies.length && !html) return res;
  const out = new Response(res.body, res);
  if (loc) out.headers.set('Location', addBase(loc, base));
  if (cookies.length) {
    out.headers.delete('Set-Cookie');
    for (const c of cookies) out.headers.append('Set-Cookie', cookiePath(c, base));
  }
  if (!html) return out;
  const rw = new HTMLRewriter();
  for (const a of ATTRS) {
    rw.on(`[${a}]`, { element(el) { const v = el.getAttribute(a); if (v !== null) el.setAttribute(a, addBase(v, base)); } });
  }
  return rw.transform(out);
}

/** 作品のフォルダーだけを見る ASSETS。見つからない画面は、作品の index.html を返す（作品ごとの SPA） */
export function scopedAssets(assets: Fetcher, base: string, spa: boolean): Fetcher {
  return {
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);
      url.pathname = addBase(url.pathname, base);
      const res = await assets.fetch(new Request(url.toString(), req));
      if (res.status !== 404 || !spa || req.method !== 'GET') return res;
      const accept = req.headers.get('Accept') ?? '';
      if (!accept.includes('text/html') && /\.[a-z0-9]+$/i.test(url.pathname)) return res;
      url.pathname = `${base}/`; // 作品の入口（index.html）
      return assets.fetch(new Request(url.toString(), req));
    },
  };
}
