// 作品 wiki を作る：dist/wiki/ に一覧、dist/wiki/<作品>/ に作品ごとのページ。
// 道具なし（node だけ）で動く。node build.mjs
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { WORKS } from './works.mjs';
import { OWNER } from './site.mjs';

const OUT = new URL('../dist/', import.meta.url);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KIND = { game: 'ゲーム', tool: '道具' };
// 作品は同じサイトの /<作品>/ にある
export const playUrl = (w) => (w.play ? `/${w.play}/` : null);
// 作品のコードは、このリポジトリの apps/<作品>/ にある
export const repoUrl = (w) => `https://github.com/${OWNER}/wiki/tree/main/apps/${w.id}`;
const byId = new Map(WORKS.map((w) => [w.id, w]));
const css = readFileSync(new URL('./style.css', import.meta.url), 'utf8');

function page({ title, desc, body, depth }) {
  // style.css は dist/wiki/ にある。一覧（depth 1）からは ./、作品のページ（depth 2）からは ../
  const up = depth >= 2 ? '../'.repeat(depth - 1) : './';
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@500;700;900&family=Barlow+Semi+Condensed:wght@600;700&display=swap">
<link rel="stylesheet" href="${up}style.css">
</head>
<body>
${body}
</body>
</html>
`;
}

const emblem = (w) => `<span class="emblem" style="--c:${w.color}" aria-hidden="true">${esc(w.name[0])}</span>`;
const tags = (w) => `<ul class="tags">${w.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;

function card(w) {
  return `<li class="card" style="--c:${w.color}">
  <a href="./${w.id}/">
    ${emblem(w)}
    <span class="card-text"><b>${esc(w.name)}</b><span>${esc(w.tagline)}</span></span>
  </a>
  ${tags(w)}
</li>`;
}

function index() {
  const groups = Object.entries(KIND).map(([k, label]) => {
    const list = WORKS.filter((w) => w.kind === k);
    return `<section aria-labelledby="h-${k}"><h2 id="h-${k}">${label}<small>${list.length} 作品</small></h2><ul class="cards">${list.map(card).join('')}</ul></section>`;
  }).join('');
  const body = `<header class="top">
  <div class="wrap">
    <p class="eyebrow">kakusan0 の作品</p>
    <h1>作品 wiki</h1>
    <p class="lead">ブラウザで遊ぶゲームと、暮らしの道具の一覧です。どれもスマホで開けて、このサイトの中で遊べます。作品の名前から、遊び方や仕組みのページへ進めます。</p>
  </div>
</header>
<main class="wrap">${groups}
  <section aria-labelledby="h-link" class="links-note">
    <h2 id="h-link">作品どうしのつながり</h2>
    <p><a href="./shiomi/">潮見とひかり野線</a>では、電車とトラックが同じ潮見の町の荷物でつながっています。トラックで潮見貨物駅に運んだコンテナを貨物列車が山ノ口へ運び、帰りの列車が持ち帰った荷物がトラックの依頼になります。</p>
  </section>
</main>
${footer()}`;
  return page({ title: '作品 wiki', desc: 'kakusan0 の作品（ゲームと道具）の一覧と、遊び方・仕組み', body, depth: 1 });
}

function section(s) {
  let inner = '';
  if (s.list) inner += `<ul class="list">${s.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  if (s.table) inner += `<div class="tbl"><table><thead><tr><th scope="col">操作</th><th scope="col">働き</th></tr></thead><tbody>${s.table.map(([k, v]) => `<tr><th scope="row"><kbd>${esc(k)}</kbd></th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div>`;
  if (s.note) inner += `<p class="note">${esc(s.note)}</p>`;
  return `<section><h2>${esc(s.h)}</h2>${inner}</section>`;
}

function work(w) {
  const play = playUrl(w);
  const nav = WORKS.map((x) => `<li${x === w ? ' aria-current="page"' : ''}><a href="../${x.id}/">${emblem(x)}<span>${esc(x.name)}</span></a></li>`).join('');
  const related = w.related.length ? `<section><h2>つながり</h2><ul class="list">${w.related.map((r) => `<li><a href="../${r.id}/">${esc(byId.get(r.id).name)}</a>：${esc(r.note)}</li>`).join('')}</ul></section>` : '';
  const body = `<header class="top" style="--c:${w.color}">
  <div class="wrap">
    <nav class="crumbs" aria-label="現在地"><a href="../">作品 wiki</a> <span aria-hidden="true">›</span> ${KIND[w.kind]}</nav>
    <div class="hero">
      ${emblem(w)}
      <div>
        <h1>${esc(w.name)}</h1>
        <p class="lead">${esc(w.tagline)}</p>
      </div>
    </div>
    ${tags(w)}
    <p class="actions">
      ${play ? `<a class="btn primary" href="${play}">${w.kind === 'game' ? '遊ぶ' : '開く'}</a>` : `<span class="btn off" title="公開先は準備中です">公開先は準備中</span>`}
      ${(w.links ?? []).map((l) => `<a class="btn" href="${esc(l.href)}"${l.note ? ` title="${esc(l.note)}"` : ''}>${esc(l.label)}</a>`).join('\n      ')}
      <a class="btn" href="${repoUrl(w)}">コード（GitHub）</a>
    </p>
  </div>
</header>
<div class="wrap layout">
  <main>
    <p class="summary">${esc(w.summary)}</p>
    ${w.sections.map(section).join('')}
    ${related}
    <section><h2>作り</h2><p>${esc(w.tech)}</p></section>
  </main>
  <aside aria-label="ほかの作品"><h2>作品</h2><ul class="side">${nav}</ul></aside>
</div>
${footer()}`;
  return page({ title: `${w.name}｜作品 wiki`, desc: w.tagline, body, depth: 2 });
}

function footer() {
  return `<footer class="foot"><div class="wrap"><p>作品の名前・町・会社・絵柄は、すべて架空の独自のものです。</p></div></footer>`;
}

export function build() {
  // 作品の出力（dist/<作品>/）は消さず、wiki のところだけ作り直す
  rmSync(new URL('wiki/', OUT), { recursive: true, force: true });
  mkdirSync(new URL('wiki/', OUT), { recursive: true });
  writeFileSync(new URL('wiki/style.css', OUT), css);
  writeFileSync(new URL('wiki/index.html', OUT), index());
  for (const w of WORKS) {
    mkdirSync(new URL(`wiki/${w.id}/`, OUT), { recursive: true });
    writeFileSync(new URL(`wiki/${w.id}/index.html`, OUT), work(w));
  }
  // トップは /wiki/ へ案内する
  writeFileSync(new URL('index.html', OUT), page({ title: '作品 wiki', desc: '作品 wiki へ', depth: 0, body: '<main class="wrap"><p class="lead">作品の一覧は <a href="./wiki/">作品 wiki</a> にあります。</p></main><script>location.replace("./wiki/")</script>' }).replace('href="./style.css"', 'href="./wiki/style.css"'));
  writeFileSync(new URL('404.html', OUT), page({ title: 'ページが見つかりません｜作品 wiki', desc: '', depth: 0, body: '<main class="wrap"><h1>ページが見つかりません</h1><p class="lead"><a href="/wiki/">作品 wiki の一覧</a>へ戻ってください。</p></main>' }).replace('href="./style.css"', 'href="/wiki/style.css"'));
  return WORKS.length;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(`作品 wiki：${build()} 作品のページを作りました`);
