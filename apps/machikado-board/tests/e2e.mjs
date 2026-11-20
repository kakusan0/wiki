// 画面テスト（Playwright）。ビルド済みの dist を wrangler dev（オンライン対戦のサーバーつき）で配信して、実際のブラウザで遊ぶ
// 使い方：npm run e2e
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = 4179;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
let failed = 0;

async function step(name, fn) {
  try {
    await fn();
    results.push(`✓ ${name}`);
  } catch (e) {
    failed++;
    results.push(`✗ ${name}\n    ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
function assert(ok, msg) { if (!ok) throw new Error(msg); }

const server = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', mkdtempSync(join(tmpdir(), 'mb-e2e-'))],
  { stdio: 'ignore', detached: true });
for (let i = 0; i < 150; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* まだ起動中 */ }
  await new Promise((r) => setTimeout(r, 300));
}

// この作業環境に入っているブラウザがあれば使う（CI では playwright install で入れる）
const local = '/opt/pw-browsers/chromium';
const browser = await chromium.launch({
  ...(existsSync(local) && !process.env.CI ? { executablePath: local } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function newPage(viewport, settings) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE);
  if (settings) {
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem('machikado-board/settings-v1', JSON.stringify(s));
    }, settings);
    await page.reload();
  }
  return { page, errors };
}

// 自分の番を最後まで進める（分かれ道・購入・ターン終了）。買ったお店の数を返す
async function playMyTurn(page, { buy = true, viaBoard = false } = {}) {
  let bought = 0;
  let forks = 0;
  await page.getByRole('button', { name: 'サイコロを振る' }).click();
  for (let k = 0; k < 20; k++) {
    await page.waitForTimeout(400);
    const dirs = page.locator('.actions .dirs button');
    if (await dirs.count()) {
      forks++;
      const lit = page.locator('.sq.choice');
      if (viaBoard && await lit.count()) await lit.first().click({ force: true });
      else await dirs.first().click();
      continue;
    }
    const buyBtn = page.locator('.actions button', { hasText: 'で買う' });
    if (buy && await buyBtn.count() && await buyBtn.isEnabled()) { await buyBtn.click(); bought++; continue; }
    const skip = page.locator('.actions button', { hasText: /見送る|増資しない/ });
    if (await skip.count()) { await skip.first().click(); continue; }
    const end = page.locator('.actions button', { hasText: 'ターンを終える' });
    if (await end.count()) { await end.click(); break; }
  }
  // CPU 3 人の番が終わって、また自分の番になるまで待つ
  await page.waitForSelector('.actions button:has-text("サイコロを振る")', { timeout: 90_000 });
  return { bought, forks };
}

const base = { mode: 'normal', cpu: 'normal', name: 'テスト', fast: true, detail: 'low' };

for (const [label, viewport] of [['PC', { width: 1280, height: 900 }], ['スマホ', { width: 390, height: 844 }]]) {
  await step(`${label}：2D で開始して 4 ターン遊び、分かれ道を選んでお店を買える`, async () => {
    const { page, errors } = await newPage(viewport, { ...base, mapId: 'corner', view: '2d' });
    await page.getByRole('button', { name: 'はじめる' }).click();
    let bought = 0, forks = 0;
    for (let i = 0; i < 4; i++) {
      const r = await playMyTurn(page, { viaBoard: i % 2 === 1 });
      bought += r.bought; forks += r.forks;
    }
    assert(forks > 0, '分かれ道に一度も止まらなかった');
    // 自分の番でサイコロを振る前は、止まる候補のマスに目の数が出る
    const lands = await page.locator('.sq .land').allTextContents();
    // 分かれ道が続くと候補は 12 マスを超えることがある。形と、1〜6 の目がすべて出ていることを確かめる
    assert(lands.length >= 1 && lands.every((x) => /^🎲[1-6](・[1-6])*$/.test(x)), `止まる候補の表示がおかしい：${lands.join(' ')}`);
    const shown = new Set(lands.flatMap((x) => x.replace('🎲', '').split('・')));
    assert([1, 2, 3, 4, 5, 6].every((d) => shown.has(String(d))), `出ていない目がある：${[...shown].join(',')}`);
    // マップの上に自分の情報。ほかの人の情報は「プレイヤー」タブ
    assert(await page.locator('.me-bar').count() === 1, 'マップの上に自分の情報がない');
    assert((await page.locator('.me-bar').textContent()).includes('現金'), '自分の情報に現金がない');
    assert(await page.locator('.layout .side .pl').count() === 0, '盤面タブにほかの人の情報が残っている');
    await page.getByRole('tab', { name: 'プレイヤー' }).click();
    assert(await page.locator('.players-tab .pl').count() === 4, 'プレイヤータブに 4 人いない');
    await page.getByRole('tab', { name: '盤面' }).click();
    // 自分のコマは 1 つだけ目立たせて「あなた」と出る
    assert(await page.locator('.token.me').count() === 1, '自分のコマの目印がない');
    assert((await page.locator('.token.me').textContent()).includes('あなた'), '自分のコマに「あなた」がない');
    const owned = await page.locator('.sq.owned').count();
    assert(owned >= bought, `買ったお店が盤面に出ていない（${owned}/${bought}）`);
    // 持ち主のいるマスには、利用料のピンが立つ
    const pins = await page.locator('.sq .pin').allTextContents();
    assert(pins.length === owned, `ピンの数が合わない（${pins.length}/${owned}）`);
    assert(pins.every((x) => /^♛?([\d,]+G|休業)$/.test(x)), `ピンの文字がおかしい：${pins.join(' ')}`); // 独占中は王冠付き
    // サイコロを振ると、到着マスに印が出る（止まったあとは自分のコマがいるマス）
    await page.waitForSelector('.actions button:has-text("サイコロを振る")', { timeout: 90_000 });
    await page.getByRole('button', { name: 'サイコロを振る' }).click();
    // 分かれ道の上から振ったときは、すぐ方向を選ぶ場面になる（到着マスは選んだあとに決まる）
    await page.waitForSelector('.sq.dest, .actions .dirs button', { timeout: 10000 });
    if (await page.locator('.actions .dirs button').count() === 0) {
      assert(await page.locator('.sq.dest').count() === 1, '到着マスの印が 1 つでない');
    }
    for (let k = 0; k < 20; k++) {
      await page.waitForTimeout(400);
      const dirs = page.locator('.actions .dirs button');
      if (await dirs.count()) { await dirs.first().click(); continue; }
      const skip = page.locator('.actions button', { hasText: /見送る|増資しない|終えて進む/ });
      if (await skip.count()) { await skip.first().click(); continue; }
      const end = page.locator('.actions button', { hasText: 'ターンを終える' });
      if (await end.count()) {
        const destName = await page.locator('.sq.dest').getAttribute('aria-label');
        const meAt = await page.locator('.token.me').evaluate((el) => {
          const r = el.getBoundingClientRect();
          const cells = [...document.querySelectorAll('.sq')];
          const hit = cells.find((c) => { const b = c.getBoundingClientRect(); return r.left + r.width / 2 > b.left && r.left + r.width / 2 < b.right && r.top + r.height / 2 > b.top && r.top + r.height / 2 < b.bottom; });
          return hit?.getAttribute('aria-label');
        });
        assert(destName === meAt, `到着マス（${destName}）と自分のコマのマス（${meAt}）が違う`);
        await end.click();
        break;
      }
    }
    assert(errors.length === 0, `エラー：${errors.join(' / ')}`);
    await page.close();
  });
}

await step('3D：回した視点は「視点を戻す」と自分の番の始まりで基本の向き（地図の上が画面の上）に戻る', async () => {
  const { page, errors } = await newPage({ width: 1280, height: 900 }, { ...base, mapId: 'corner', view: '3d' });
  await page.getByRole('button', { name: 'はじめる' }).click();
  const yaw = () => page.evaluate(() => Number(document.querySelector('.board3d').dataset.yaw));
  await page.waitForFunction(() => document.querySelector('.board3d')?.dataset.yaw != null);
  const drag = async () => {
    const box = await page.locator('.board3d canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  await page.waitForTimeout(800);
  await drag();
  assert(Math.abs(await yaw()) > 0.5, `回っていない ${await yaw()}`);
  await page.getByRole('button', { name: '視点を戻す' }).click();
  await page.waitForTimeout(900);
  assert(Math.abs(await yaw()) < 0.02, `ボタンで戻らない ${await yaw()}`);
  // 回したまま自分の番を終える → 相手の番のあと、次の自分の番が来たら戻る
  await drag();
  assert(Math.abs(await yaw()) > 0.5, '回っていない（2 回目）');
  await playMyTurn(page, { buy: false });
  await page.getByRole('button', { name: 'サイコロを振る' }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(900);
  assert(Math.abs(await yaw()) < 0.02, `自分の番で戻らない ${await yaw()}`);
  assert(errors.length === 0, `エラー：${errors.join(' / ')}`);
  await page.close();
});

await step('株式市場タブ：銀行で自動で開き、行を押すと 2D の通りが点滅し、終えると盤面に戻る。銀行以外では開かない', async () => {
  const { page, errors } = await newPage({ width: 1280, height: 900 }, { ...base, mapId: 'corner', view: '3d' });
  await page.getByRole('button', { name: 'はじめる' }).click();
  // 銀行のひとつ手前（パン工房）に、銀行へ向かう向きで立たせて、つづきから
  await page.evaluate(() => {
    const k = 'machikado-board/save-v1';
    const s = JSON.parse(localStorage.getItem(k));
    s.players[0].pos = 1; s.players[0].prev = 2;
    localStorage.setItem(k, JSON.stringify(s));
  });
  await page.reload();
  await page.getByRole('button', { name: /つづきから/ }).click();
  await page.getByRole('button', { name: 'サイコロを振る' }).click();
  // 銀行を通る（止まって株式市場）か、銀行に止まる（ターンの終わりに株式市場）
  await page.waitForSelector('.layout.market', { timeout: 15000 });
  assert(await page.locator('.actions button', { hasText: /株の売り買いを終えて進む|ターンを終える/ }).count() === 1, '銀行での操作がない');
  assert(await page.locator('.layout.market').count() === 1, '株式市場タブが開かない');
  assert(await page.locator('.tab.on', { hasText: '株式市場' }).count() === 1, 'タブが選ばれていない');
  await page.locator('.stocks.wide tbody tr').nth(0).click();
  const blink = await page.locator('.sq.blink').count();
  assert(blink === 3, `あさひ通り（3 軒）が点滅しない（${blink}）`);
  await page.locator('.stocks.wide tbody tr').nth(0).click();
  assert(await page.locator('.sq.blink').count() === 0, 'もう一度押しても点滅が止まらない');
  // マップのお店を押すと、その通りの情報が株式市場の表より上に出て、通りが点滅する
  await page.locator('.layout.market .sq[aria-label="パン工房"]').click();
  await page.waitForSelector('.street-info');
  assert(await page.locator('.street-info .btn.buy:not([disabled])').count() >= 1, '銀行なのに通りの詳細の「買う」が押せない');
  const shopRows = await page.locator('.street-info .shops tbody tr').count();
  assert(shopRows === 3, `あさひ通りのお店の一覧が 3 行でない（${shopRows}）`);
  const above = await page.evaluate(() => document.querySelector('.street-info').getBoundingClientRect().top
    < document.querySelector('.stocks.wide').getBoundingClientRect().top);
  assert(above, '通りの情報が株式市場の表より上にない');
  assert(await page.locator('.sq.blink').count() === 3, 'マップで押した通りが点滅しない');
  await page.getByRole('button', { name: '選択を外す' }).click();
  assert(await page.locator('.street-info').count() === 0, '選択を外しても通りの情報が消えない');
  // 売り買いを終えて進む（銀行を通ったとき）。そのあと銀行以外で止まったら、株式市場は開かない
  for (let k = 0; k < 20; k++) {
    const go = page.locator('.actions button', { hasText: /株の売り買いを終えて進む|見送る|増資しない/ });
    if (await go.count()) { await go.first().click(); await page.waitForTimeout(500); continue; }
    const dirs = page.locator('.actions .dirs button');
    if (await dirs.count()) { await dirs.first().click(); await page.waitForTimeout(500); continue; }
    const end = page.locator('.actions button', { hasText: 'ターンを終える' });
    if (await end.count()) {
      const atBank = (await page.locator('.actions').textContent()).includes('銀行にいるので');
      if (!atBank) assert(await page.locator('.layout.market').count() === 0, '銀行以外なのに株式市場タブが開いた');
      await end.click();
      break;
    }
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('.actions button:has-text("サイコロを振る")', { timeout: 90_000 });
  assert(await page.locator('.board3d').count() === 1, '盤面（3D）に戻らない');
  assert(errors.length === 0, `エラー：${errors.join(' / ')}`);
  await page.close();
});

await step('ダークモード：株式市場で選んだ通りの「買う」ボタンの文字が背景に埋もれない', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('machikado-board/settings-v1', JSON.stringify(s)); }, { ...base, mapId: 'corner', view: '2d' });
  await page.reload();
  await page.getByRole('button', { name: 'はじめる' }).click();
  await page.evaluate(() => { const k = 'machikado-board/save-v1'; const s = JSON.parse(localStorage.getItem(k)); s.players[0].pos = 1; s.players[0].prev = 2; localStorage.setItem(k, JSON.stringify(s)); });
  await page.reload();
  await page.getByRole('button', { name: /つづきから/ }).click();
  await page.getByRole('button', { name: 'サイコロを振る' }).click();
  await page.waitForSelector('.layout.market', { timeout: 15000 });
  await page.locator('.stocks.wide tbody tr').nth(1).click();
  const diff = await page.evaluate(() => {
    const b = document.querySelector('.stocks.wide tr.picked .btn.buy');
    const rgb = (c) => c.match(/\d+/g).slice(0, 3).map(Number);
    const lum = ([r, g, bl]) => 0.299 * r + 0.587 * g + 0.114 * bl;
    const cs = getComputedStyle(b);
    return Math.abs(lum(rgb(cs.color)) - lum(rgb(cs.backgroundColor)));
  });
  assert(diff > 60, `ボタンの文字と背景の明るさの差が小さい（${diff.toFixed(0)}）`);
  await ctx.close();
});

await step('スマホ：横に払う（フリック）とタブが移る。縦や 3D の盤面の上では移らない', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE);
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('machikado-board/settings-v1', JSON.stringify(s)); }, { ...base, mapId: 'corner', view: '2d' });
  await page.reload();
  await page.getByRole('button', { name: 'はじめる' }).click();
  // 指の動きを作る（touchstart → touchend）
  const swipe = (sel, dx, dy) => page.evaluate(([sel, dx, dy]) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 200);
    const touch = (cx, cy) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
    el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [touch(x, y)], changedTouches: [touch(x, y)] }));
    el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [touch(x + dx, y + dy)] }));
  }, [sel, dx, dy]);
  const current = async () => (await page.locator('.tab.on').textContent()).replace('買えます', '').trim();
  assert(await current() === '盤面', 'はじめのタブが盤面でない');
  await swipe('.me-bar', -120, 5);
  assert(await current() === '株式市場', `左へ払っても株式市場に移らない（${await current()}）`);
  await swipe('.tab-body', -120, 0);
  assert(await current() === 'プレイヤー', `もう一度左へ払ってもプレイヤーに移らない（${await current()}）`);
  await swipe('.tab-body', -120, 0);
  assert(await current() === 'プレイヤー', '右端より先へ移った');
  await swipe('.tab-body', 120, 0);
  assert(await current() === '株式市場', '右へ払っても戻らない');
  await swipe('.tab-body', 30, 160);
  assert(await current() === '株式市場', '縦に払ったのにタブが変わった');
  await page.getByRole('tab', { name: '盤面' }).click();
  await page.getByRole('button', { name: '3D' }).click();
  await page.waitForSelector('.board3d canvas');
  await swipe('.board3d canvas', -150, 0);
  assert(await current() === '盤面', '3D の盤面の上で払ったのにタブが変わった');
  assert(errors.length === 0, `エラー：${errors.join(' / ')}`);
  await ctx.close();
});

for (const [mapId, view] of [['cross', '3d'], ['twin', '2d'], ['hills', '3d']]) {
  await step(`新しいマップ（${mapId}・${view.toUpperCase()}）：開いて 2 ターン遊べる`, async () => {
    const { page, errors } = await newPage({ width: 1280, height: 900 }, { ...base, mapId, view });
    await page.getByRole('button', { name: 'はじめる' }).click();
    for (let i = 0; i < 2; i++) await playMyTurn(page);
    assert(errors.length === 0, `エラー：${errors.join(' / ')}`);
    await page.close();
  });
}

await step('競売：自分のお店を競売に掛けると、CPU がせり上げて落札し、代金が入る', async () => {
  const { page, errors } = await newPage({ width: 1280, height: 900 }, { ...base, mapId: 'corner', view: '2d', cpu: 'hard' });
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'はじめる' }).click();
  await page.evaluate(() => { const k = 'machikado-board/save-v1'; const s = JSON.parse(localStorage.getItem(k)); s.props[1].owner = 0; s.props[1].value = 160; localStorage.setItem(k, JSON.stringify(s)); });
  await page.reload();
  await page.getByRole('button', { name: /つづきから/ }).click();
  const cash0 = await page.locator('.me-bar .nums b').first().textContent();
  await page.locator('.sq[aria-label="パン工房"]').click();
  await page.locator('.info button', { hasText: '競売に掛ける' }).click();
  await page.waitForSelector('.actions h2:has-text("競売")');
  assert(await page.locator('.sq.auction').count() === 1, '競売中のマスの印がない');
  await page.waitForSelector('.actions button:has-text("サイコロを振る")', { timeout: 30_000 }); // 競売が終わって元の場面へ
  const cash1 = await page.locator('.me-bar .nums b').first().textContent();
  const n = (x) => Number(x.replace(/[^0-9]/g, ''));
  assert(n(cash1) > n(cash0), `代金が入っていない（${cash0} → ${cash1}）`);
  assert((await page.locator('.log').textContent()).includes('落札') || (await page.locator('.log').textContent()).includes('銀行が'), 'できごとに競売の結果がない');
  assert(errors.length === 0, `エラー：${errors.join(' / ')}`);
  await page.close();
});

await step('保存と再開：再読み込みで「つづきから」になり、同じ状態に戻る', async () => {
  const { page, errors } = await newPage({ width: 1280, height: 900 }, { ...base, mapId: 'harbor', view: '2d' });
  await page.getByRole('button', { name: 'はじめる' }).click();
  await playMyTurn(page);
  const cash = await page.locator('.me-bar .nums b').first().textContent();
  await page.reload();
  const resume = page.getByRole('button', { name: /つづきから/ });
  assert(await resume.count() === 1, '「つづきから」がない');
  await resume.click();
  const after = await page.locator('.me-bar .nums b').first().textContent();
  assert(after === cash, `現金が戻っていない（${cash} → ${after}）`);
  assert(errors.length === 0, `エラー：${errors.join(' / ')}`);
  await page.close();
});

await step('3D：切り替えると立体の盤面が出て、サイコロを振って遊べる', async () => {
  const { page, errors } = await newPage({ width: 1280, height: 900 }, { ...base, mapId: 'grand', view: '2d' });
  await page.getByRole('button', { name: 'はじめる' }).click();
  await page.getByRole('button', { name: '3D' }).click();
  await page.waitForSelector('.board3d canvas');
  await page.waitForTimeout(800);
  const tris = Number(await page.locator('.board3d').getAttribute('data-triangles'));
  assert(tris > 1000, `三角形が少なすぎる（${tris}）`);
  // スタートの銀行は分かれ道：選べるマスの数だけ、家の上に名前の札が出る
  const st0 = await newPage({ width: 1280, height: 900 }, { ...base, mapId: 'corner', view: '3d' });
  await st0.page.getByRole('button', { name: 'はじめる' }).click();
  await st0.page.getByRole('button', { name: 'サイコロを振る' }).click();
  await st0.page.waitForSelector('.actions .dirs button', { timeout: 15000 });
  await st0.page.waitForTimeout(300);
  const dirs = await st0.page.locator('.actions .dirs button').count();
  const labels = Number(await st0.page.locator('.board3d').getAttribute('data-choices'));
  assert(dirs === 2 && labels === dirs, `分かれ道の札の数が合わない（札 ${labels}・選択肢 ${dirs}）`);
  // 方向のボタンは「この道へ進む」と「止まる：〇〇」を分けて出す（止まる場所と取り違えないように）
  const dirTexts = await st0.page.locator('.actions .dirs button').allTextContents();
  assert(dirTexts.every((x) => x.includes('この道へ進む') && x.includes('止まる：')), `方向のボタンの文字：${dirTexts.join(' / ')}`);
  assert(st0.errors.length === 0, `エラー：${st0.errors.join(' / ')}`);
  await st0.page.close();
  await playMyTurn(page);
  // 1 周すれば、だれかがお店を買っていて、頭上にピンが立つ
  const pins3d = Number(await page.locator('.board3d').getAttribute('data-pins'));
  assert(pins3d >= 1, `3D のピンがない（${pins3d}）`);
  // 細かさを「高」にすると三角形が増える
  await page.locator('.top select').selectOption('high');
  await page.waitForTimeout(800);
  const hi = Number(await page.locator('.board3d').getAttribute('data-triangles'));
  assert(hi > tris * 3, `細かさを上げても三角形が増えない（${tris} → ${hi}）`);
  assert(errors.length === 0, `エラー：${errors.join(' / ')}`);
  await page.close();
});

await step('遊び方ページ：チャンスカード 20 種とマップの目標が出る', async () => {
  const page = await browser.newPage();
  await page.goto(`${BASE}/rules.html`);
  await page.waitForSelector('h1:has-text("遊び方")');
  assert(await page.locator('.cards tr').count() === 20, 'カードが 20 種ない');
  assert(await page.locator('text=ちいさな四つ角').count() > 0, 'マップの目標がない');
  await page.close();
});


await step('オンライン：部屋を作って合言葉で入り、2 人で対戦できる（相手の画面に操作が届く）', async () => {
  const errs = [];
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  for (const p of [A, B]) {
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE);
    await p.evaluate((s) => localStorage.setItem('machikado-board/settings-v1', JSON.stringify(s)), { ...base, mapId: 'corner', view: '2d' });
    await p.reload();
  }
  await A.locator('input[aria-label="あなたの名前"]').fill('あい');
  await A.getByRole('button', { name: '合言葉で部屋を作る' }).click();
  await A.waitForSelector('.lobby .code');
  const code = (await A.locator('.lobby .code').textContent()).trim();
  assert(/^[A-Z2-9]{6}$/.test(code), `合言葉が出ない：${code}`);
  await B.locator('input[aria-label="あなたの名前"]').fill('びい');
  await B.locator('input[aria-label="合言葉"]').fill(code);
  await B.getByRole('button', { name: '合言葉で入る' }).click();
  await A.waitForSelector('.seats li:nth-child(2)');
  assert((await A.locator('.seats').textContent()).includes('びい'), '相手の名前が待合室に出ない');
  await A.getByRole('button', { name: 'この人数で始める' }).click();
  await A.waitForSelector('.top .online');
  await B.waitForSelector('.top .online');
  // 最初の手番は A（席 0）。A がサイコロを振ると、B の画面のできごとに出る
  await A.getByRole('button', { name: 'サイコロを振る' }).click();
  await B.waitForFunction(() => document.querySelector('.log')?.textContent?.includes('サイコロは'), null, { timeout: 15000 });
  // B の画面では A の番なので操作できない
  assert(await B.getByRole('button', { name: 'サイコロを振る' }).count() === 0, '相手の番なのに B がサイコロを振れる');
  // 定型メッセージが相手に届く
  await A.locator('.emotes button').first().click();
  await B.waitForSelector('.me-bar .toast', { timeout: 10000 }); // 定型メッセージは自分の帯の下に出る
  // B が再読み込みしても、同じ対戦に戻れる
  await B.reload();
  await B.waitForSelector('.top .online', { timeout: 15000 });
  assert(errs.length === 0, `エラー：${errs.join(' / ')}`);
  await ctxA.close();
  await ctxB.close();
});

await browser.close();
try { process.kill(-server.pid, 'SIGTERM'); } catch { /* もう止まっている */ }
console.log(results.join('\n'));
console.log(failed ? `\n${failed} 件失敗` : `\nすべて成功（${results.length} 件）`);
process.exit(failed ? 1 : 0);
