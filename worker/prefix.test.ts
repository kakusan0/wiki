// 入口の道具のテスト：node --test worker/prefix.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strip, addBase, cookiePath, fixResponse, scopedAssets, type Fetcher } from './prefix.ts';

test('頭の /<作品> を外す（クエリ・本文・ヘッダーはそのまま）', async () => {
  const r = strip(new Request('https://x.dev/shogi/api/rooms?a=1', { method: 'POST', body: 'hi', headers: { 'X-A': '1' } }), '/shogi');
  const u = new URL(r.url);
  assert.equal(u.pathname + u.search, '/api/rooms?a=1');
  assert.equal(r.method, 'POST');
  assert.equal(r.headers.get('X-A'), '1');
  assert.equal(await r.text(), 'hi');
  assert.equal(new URL(strip(new Request('https://x.dev/shogi/'), '/shogi').url).pathname, '/');
});

test('作品の中のパスだけに頭を付ける', () => {
  assert.equal(addBase('/login', '/netspeed'), '/netspeed/login');
  assert.equal(addBase('/netspeed/x', '/netspeed'), '/netspeed/x');
  assert.equal(addBase('/netspeed', '/netspeed'), '/netspeed');
  assert.equal(addBase('//cdn.example/a.js', '/netspeed'), '//cdn.example/a.js');
  assert.equal(addBase('https://a.example/', '/netspeed'), 'https://a.example/');
  assert.equal(addBase('rel/a.png', '/netspeed'), 'rel/a.png');
  assert.equal(addBase('/netspeedy', '/netspeed'), '/netspeed/netspeedy');
});

test('Cookie の Path を作品の下にする', () => {
  assert.equal(cookiePath('s=1; Path=/; HttpOnly', '/netspeed'), 's=1; Path=/netspeed/; HttpOnly');
  assert.equal(cookiePath('s=1; path=/api', '/netspeed'), 's=1; path=/netspeed/api');
  assert.equal(cookiePath('s=1; HttpOnly', '/netspeed'), 's=1; HttpOnly; Path=/netspeed/');
});

test('転送先と Cookie を直す。WebSocket には触れない', () => {
  const h = new Headers({ Location: '/login?next=/' });
  h.append('Set-Cookie', 'a=1; Path=/');
  h.append('Set-Cookie', 'b=2; Path=/');
  const out = fixResponse(new Response(null, { status: 302, headers: h }), '/netspeed');
  assert.equal(out.headers.get('Location'), '/netspeed/login?next=/');
  assert.deepEqual(out.headers.getSetCookie(), ['a=1; Path=/netspeed/', 'b=2; Path=/netspeed/']);
  const plain = new Response('{}', { headers: { 'content-type': 'application/json' } });
  assert.equal(fixResponse(plain, '/netspeed'), plain);
});

function fakeAssets(files: Record<string, string>): Fetcher & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async fetch(req: Request) {
      const p = new URL(req.url).pathname;
      seen.push(p);
      return p in files ? new Response(files[p], { headers: { 'content-type': 'text/html' } }) : new Response('404', { status: 404 });
    },
  };
}

test('作品のフォルダーだけを見る。見つからない画面は作品の入口へ', async () => {
  const a = fakeAssets({ '/shogi/': 'top', '/shogi/a.js': 'js' });
  const s = scopedAssets(a, '/shogi', true);
  assert.equal(await (await s.fetch(new Request('https://x.dev/a.js'))).text(), 'js');
  const page = await s.fetch(new Request('https://x.dev/game/1', { headers: { Accept: 'text/html' } }));
  assert.equal(await page.text(), 'top');
  // ないファイル（拡張子つき）は 404 のまま
  assert.equal((await s.fetch(new Request('https://x.dev/missing.png'))).status, 404);
  // SPA でない作品は 404 のまま
  assert.equal((await scopedAssets(a, '/shogi', false).fetch(new Request('https://x.dev/game/1', { headers: { Accept: 'text/html' } }))).status, 404);
  assert.ok(a.seen.every((p) => p.startsWith('/shogi/')));
});

test('まとめた作品の前のパスは、いまのパスへ移す', async () => {
  const { movedTo } = await import('./moved.ts');
  assert.equal(movedTo(new URL('https://x.dev/truck/?auto&job=toStation')), 'https://x.dev/shiomi/?auto=&job=toStation&mode=truck');
  assert.equal(movedTo(new URL('https://x.dev/train-sim/')), 'https://x.dev/shiomi/?mode=train');
  assert.equal(movedTo(new URL('https://x.dev/wiki/truck/')), 'https://x.dev/wiki/shiomi/');
  assert.equal(movedTo(new URL('https://x.dev/shiomi/')), null);
  assert.equal(movedTo(new URL('https://x.dev/wiki/shogi/')), null);
});
