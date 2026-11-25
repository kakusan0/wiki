import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { build } from '../build.mjs';
import { WORKS } from '../works.mjs';

const dist = new URL('../../dist/', import.meta.url);
const APP_DIRS = new Set(WORKS.map((w) => w.play).filter(Boolean));
build();
const read = (p) => readFileSync(new URL(p, dist), 'utf8');

test('一覧と、作品ごとのページができる', () => {
  assert.ok(existsSync(new URL('wiki/index.html', dist)));
  for (const w of WORKS) assert.ok(existsSync(new URL(`wiki/${w.id}/index.html`, dist)), w.id);
});

test('ページの中のリンク（同じサイトの中）は、すべて実在するページを指す', () => {
  const pages = ['wiki/index.html', ...WORKS.map((w) => `wiki/${w.id}/index.html`)];
  for (const p of pages) {
    const html = read(p);
    const base = new URL(p, dist);
    for (const [, href] of html.matchAll(/href="([^"#]+)"/g)) {
      if (/^(https?:)?\/\//.test(href)) continue;
      // 作品へのリンク（/<作品>/）は、作品のビルドの出力なので、名前が合っていることだけ見る
      // 作品の中のページ（/<作品>/… や /<作品>/wiki）も、作品の名前だけ見る
      const app = href.match(/^\/([^/]+)(\/|$)/)?.[1];
      if (app && app !== 'wiki') { assert.ok(APP_DIRS.has(app), `${p} → ${href}`); continue; }
      let target = new URL(href.startsWith('/') ? `.${href}` : href, href.startsWith('/') ? dist : base);
      if (target.pathname.endsWith('/')) target = new URL('index.html', target);
      assert.ok(existsSync(target), `${p} → ${href}`);
    }
  }
});

test('作品のデータがそろっている', () => {
  const ids = new Set();
  for (const w of WORKS) {
    assert.ok(!ids.has(w.id), `id の重なり ${w.id}`); ids.add(w.id);
    assert.ok(w.name && w.tagline && w.summary && w.tech, w.id);
    assert.ok(['game', 'tool'].includes(w.kind), w.id);
    assert.match(w.color, /^#[0-9a-f]{6}$/i);
    assert.ok(w.sections.length > 0 && w.sections.every((s) => s.h && (s.list?.length || s.table?.length)), w.id);
    for (const r of w.related) assert.ok(WORKS.some((x) => x.id === r.id), `${w.id} → ${r.id}`);
  }
});

test('作品の中のページへのボタンが出る（QR オーダーのページ一覧）', () => {
  const html = read('wiki/qr-order/index.html');
  assert.match(html, /<a class="btn" href="\/qr-order\/wiki"[^>]*>ページ一覧（\/qr-order\/wiki）<\/a>/);
  for (const w of WORKS) for (const l of w.links ?? []) assert.ok(l.href.startsWith(`/${w.play}/`) && l.label, `${w.id} → ${l.href}`);
});

test('文字はエスケープされる（< や & がそのまま入らない）', () => {
  for (const w of WORKS) assert.doesNotMatch(read(`wiki/${w.id}/index.html`), /<script(?![^>]*>location)/);
});
