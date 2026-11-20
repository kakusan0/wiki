// 画面テスト（PC とスマホ・3D と 2D）。ビルドした画面を vite preview で開き、タップで最後まで遊ぶ
// 使い方：npm run e2e
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright';

const PORT = 4184;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
let failed = 0;
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
async function step(name, fn) {
  try { await fn(); results.push(`✓ ${name}`); } catch (e) { failed++; results.push(`✗ ${name}\n    ${(e?.message ?? String(e)).split('\n')[0]}`); }
}

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* もう止まっている */ } };
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* 起動中 */ }
  await new Promise((r) => setTimeout(r, 200));
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// 札をタップする（3D でも 2D でも、画面上の位置を聞いて押す）
async function tapCard(page, id) {
  let pos = null;
  for (let k = 0; k < 30 && !pos; k++) { pos = await page.evaluate((i) => window.__hana.screenOf(i), id); if (!pos) await page.waitForTimeout(100); }
  assert(pos, `札 ${id} が見つからない`);
  const box = await page.locator('.stage, .table2d').first().boundingBox();
  await page.mouse.click(box.x + pos[0] * box.width, box.y + pos[1] * box.height);
}

// 自分の番が来たら、選べる手の 1 つ目をタップで指す。最後まで（または max 手）
async function playThrough(page, { months = 3, maxSteps = 400, koikoiOnce = false } = {}) {
  let koikoiDone = false;
  const misses = {};
  let sawKoikoi = false;
  for (let i = 0; i < maxSteps; i++) {
    await page.waitForFunction(() => window.__hana.ready() || document.querySelector('.modal'), null, { timeout: 30000 });
    const v = await page.evaluate(() => window.__hana.view());
    if (v.phase === 'over') { await page.locator('[data-modal="over"]').waitFor(); return { v, sawKoikoi }; }
    if (v.phase === 'roundEnd') { await page.click('#next', { timeout: 8000 }).catch(async () => { throw new Error(`次へが押せない modal=${await page.evaluate(() => document.querySelector('.modal')?.dataset.modal)}`); }); await page.waitForFunction((r) => window.__hana.view().round !== r || window.__hana.view().phase === 'over', v.round); continue; }
    if (v.turn !== v.me || !v.legal.length) { await page.waitForFunction((s) => window.__hana.view().seq !== s, v.seq, { timeout: 30000 }); continue; }
    if (v.phase === 'koikoi') {
      sawKoikoi = true;
      const sel = koikoiOnce && !koikoiDone ? '#koikoi' : '#stop';
      if (sel === '#koikoi') koikoiDone = true;
      await page.click(sel, { timeout: 8000 }).catch(async () => { throw new Error(`${sel} が押せない modal=${await page.evaluate(() => document.querySelector('.modal')?.dataset.modal)} seq=${v.seq}`); });
    } else if (v.phase === 'drawChoose') {
      await tapCard(page, v.legal[0].target);
    } else {
      const a = v.legal[0];
      await tapCard(page, a.card);
      const m = v.field.filter((f) => f >> 2 === a.card >> 2);
      if (m.length === 0) {
        const ok = await page.click('#discard', { timeout: 3000 }).then(() => true, () => false);
        if (!ok) {
          const info = await page.evaluate((id) => ({ pos: window.__hana.screenOf(id), msg: document.querySelector('.msg')?.textContent, at: (() => { const p = window.__hana.screenOf(id); const el = document.elementFromPoint(p[0] * innerWidth, p[1] * innerHeight); return el?.className || el?.tagName; })() }), a.card);
          console.log('選べなかった', a.card, JSON.stringify(info));
          misses[v.seq] = (misses[v.seq] ?? 0) + 1;
          if (misses[v.seq] < 3) continue;
          throw new Error(`場に出すが出ない ${JSON.stringify(info)}`);
        }
      }
      else if (m.length === 2) await tapCard(page, a.target);
      else await tapCard(page, a.card);
    }
    try { await page.waitForFunction((s) => window.__hana.view().seq !== s, v.seq, { timeout: 4000 }); }
    catch {
      // 動きの途中で押してしまったときは、もう一度（同じ局面で 3 回まで）
      misses[v.seq] = (misses[v.seq] ?? 0) + 1;
      if (misses[v.seq] < 3) { await page.evaluate(() => document.querySelector('.modal [data-close]')?.click()); continue; }
      throw new Error(`進まない：${v.phase} ${JSON.stringify(v.legal[0])} field=${v.field} hand=${v.hand} sel=${await page.evaluate(() => document.querySelector('.msg')?.textContent)} modal=${await page.evaluate(() => document.querySelector('.modal')?.dataset.modal)}`);
    }
  }
  throw new Error('終わらない');
}

for (const [label, ctxOpts] of [['PC', { viewport: { width: 1280, height: 800 } }], ['スマホ', devices['iPhone 13']]]) {
  for (const render of label === 'PC' ? ['3d', '2d', '3d-lite'] : ['3d', '2d']) {
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|Failed to load resource|fonts/.test(m.text())) errs.push(m.text()); });
    page.on('dialog', (d) => d.accept());
    await page.goto(`${BASE}/?fast`);
    await page.evaluate((r) => localStorage.setItem('hanafuda/settings-v1', JSON.stringify({ level: 'normal', months: 3, render: r.replace('-lite', ''), fx: r.endsWith('lite') ? 'lite' : 'full' })), render);
    const tag = `${label}・${render.toUpperCase()}`;

    await step(`${tag}：タイトル`, async () => {
      await page.goto(`${BASE}/?fast`);
      await page.getByRole('heading', { name: /電光花札/ }).waitFor();
      const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      assert(w[0] <= w[1] + 1, `横にはみ出す ${w}`);
    });

    await step(`${tag}：3 か月を最後までタップで遊ぶ（こいこいも）`, async () => {
      await page.click('#start-cpu');
      if (render.startsWith('3d')) {
        await page.locator('canvas.stage').waitFor();
        // WebGL で描けている（真っ黒ではない）
        await page.waitForTimeout(400);
        const lit = await page.evaluate(() => window.__hana.sample());
        assert(lit > 2000, `3D が描けていない（明るい点 ${lit}）`);
      } else await page.locator('.table2d').waitFor();
      const { v } = await playThrough(page, { koikoiOnce: true });
      assert(v.results.length === 3, `3 か月 ${v.results.length}`);
      const sum = [0, 1].map((p) => v.results.filter((r) => r.winner === p).reduce((a, r) => a + r.points, 0));
      assert(sum[0] === v.scores[0] && sum[1] === v.scores[1], '点の合計');
      await page.click('#again');
      await page.waitForFunction(() => window.__hana.view()?.round === 1 && window.__hana.view()?.results.length === 0);
    });

    await step(`${tag}：取り札を見る・途中から再開`, async () => {
      await page.waitForFunction(() => window.__hana.ready());
      await page.click('#show-captured');
      await page.locator('[data-modal="captured"]').waitFor();
      await page.getByRole('button', { name: '閉じる' }).click();
      await page.goto(`${BASE}/?fast`);
      await page.click('#resume');
      await page.waitForFunction(() => window.__hana.ready());
    });

    await step(`${tag}：画面のエラーがない`, async () => { assert(!errs.length, errs.join(' / ')); });
    await ctx.close();
  }
}

await step('遊び方のページ', async () => {
  const page = await browser.newPage();
  await page.goto(`${BASE}/rules.html`);
  await page.getByRole('heading', { name: '遊び方' }).waitFor();
  assert(await page.locator('.deck-list img').count() === 48, '48 枚の絵');
  await page.close();
});

await browser.close();
stop();
console.log(results.join('\n'));
console.log(failed ? `\n${failed} 件失敗` : `\nすべて成功（${results.length} 件）`);
process.exit(failed ? 1 : 0);
