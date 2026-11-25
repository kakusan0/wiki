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

test('QR オーダーのページに「画面の一覧」の表が出る（パスと内容）', () => {
  const html = read('wiki/qr-order/index.html');
  assert.match(html, /<section id="pages"[^>]*>\s*<h2[^>]*>画面の一覧<\/h2>/);
  // 上のボタンは、同じページの一覧へ移る
  assert.match(html, /<a class="btn" href="#pages">画面の一覧<\/a>/);
  // 開ける画面はリンク、開けないもの（通知の受け口）は文字だけ
  for (const href of ['/qr-order/', '/qr-order/guide/', '/qr-order/s/shop-001', '/qr-order/staff', '/qr-order/staff/login', '/qr-order/esl/p-001.jpg', '/qr-order/p/p-001'])
    assert.ok(html.includes(`<a href="${href}">`), href);
  assert.match(html, /<code>\/qr-order\/api\/stripe\/webhook<\/code>/);
  assert.match(html, /<code>\/qr-order\/order\/&lt;注文ID&gt;<\/code>/);
  for (const h of ['公式サイト・案内', 'お客様の画面', '店舗スタッフの画面', '電子棚札（ST-GR29000）', '外部サービスからの通知を受け取る URL'])
    assert.ok(html.includes(`<h3>${h}</h3>`), h);
  // 前のページ一覧（/qr-order/wiki、開くたびにパスキー）は使わない
  assert.doesNotMatch(html, /\/qr-order\/wiki|開くたびにパスキー/);
});

test('画面の一覧はグループごとのタブで切り替えられる（スクリプトがなければ全部見える）', () => {
  const html = read('wiki/qr-order/index.html');
  const tabs = [...html.matchAll(/<button type="button" role="tab" id="tab-([\w-]+)" aria-controls="panel-\1" aria-selected="(true|false)"[^>]*>([^<]+)<\/button>/g)];
  assert.deepEqual(tabs.map((t) => t[3]), ['公式サイト・案内', 'お客様の画面', '店舗スタッフの画面', '電子棚札（ST-GR29000）', '外部サービスからの通知を受け取る URL']);
  assert.deepEqual(tabs.map((t) => t[2]), ['true', 'false', 'false', 'false', 'false']);
  // タブの並びはスクリプトが出す（hidden）。パネルは最初から全部見える
  assert.match(html, /<div class="tabs" role="tablist" aria-label="画面の一覧のグループ" hidden>/);
  for (const t of tabs) assert.match(html, new RegExp(`<div role="tabpanel" id="panel-${t[1]}" aria-labelledby="tab-${t[1]}" tabindex="0">`));
  assert.match(html, /<script src="\.\.\/tabs\.js" defer><\/script>/);
  assert.ok(existsSync(new URL('wiki/tabs.js', dist)));
});

test('作品のページの一覧（pages）のデータがそろっている', () => {
  for (const w of WORKS) for (const l of w.links ?? []) assert.ok((l.href.startsWith(`/${w.play}/`) || l.href.startsWith('#')) && l.label, `${w.id} → ${l.href}`);
  for (const w of WORKS.filter((x) => x.pages)) for (const g of w.pages) {
    assert.ok(g.h && g.rows.length, `${w.id} ${g.h}`);
    for (const r of g.rows) assert.ok(r.path.startsWith(`/${w.play}/`) && r.desc && (!r.href || r.href.startsWith(`/${w.play}/`)), `${w.id} ${r.path}`);
  }
});

test('文字はエスケープされる（< や & がそのまま入らない）', () => {
  for (const w of WORKS) assert.doesNotMatch(read(`wiki/${w.id}/index.html`), /<script(?![^>]*>location| src="\.\.\/tabs\.js")/);
});
