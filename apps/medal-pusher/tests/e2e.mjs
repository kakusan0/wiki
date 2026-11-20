// 画面テスト（PC とスマホ）。ビルドした画面を vite preview で開いて操作する
// 使い方：npm run e2e
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright';

const PORT = 4196;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
let failed = 0;
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
async function step(name, fn) {
  try { await fn(); results.push(`✓ ${name}`); } catch (e) { failed++; results.push(`✗ ${name}\n    ${(e?.message ?? String(e)).split('\n')[0]}`); }
}
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* もう止まっている */ } };
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* 起動中 */ } await new Promise((r) => setTimeout(r, 200)); }

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [label, opts] of [['PC', { viewport: { width: 1280, height: 800 } }], ['スマホ', devices['iPhone 13']]]) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const st = () => page.evaluate(() => window.__medal.state());

  await step(`${label}：タイトルから始めて、今日のメダルを受け取る`, async () => {
    await page.goto(`${BASE}/?fast`);
    await page.getByRole('heading', { name: /星海の/ }).waitFor();
    await page.click('#start');
    const w0 = (await st()).wallet;
    await page.click('#claim');
    assert((await st()).wallet >= w0 + 50, '50 枚もらえる');
    await page.click('#daily');
    await page.getByText('今日の分は受け取りました').waitFor();
    await page.getByRole('button', { name: '閉じる' }).click();
  });

  await step(`${label}：3D が描けていて、はみ出さない`, async () => {
    const lit = await page.evaluate(() => window.__medal.sample());
    assert(lit > 3000, `明るい点 ${lit}`);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    assert(w[0] <= w[1] + 1, `横にはみ出す ${w}`);
  });

  await step(`${label}：投入・連続投入・狙い・自動`, async () => {
    const i0 = (await st()).inserted;
    for (let i = 0; i < 5; i++) { await page.click('#insert'); await page.waitForTimeout(60); }
    assert((await st()).inserted > i0, '投入で入る');
    await page.locator('#aim').fill('80');
    const i1 = (await st()).inserted;
    await page.locator('#hold').dispatchEvent('pointerdown');
    await page.waitForTimeout(800);
    await page.locator('#hold').dispatchEvent('pointerup');
    assert((await st()).inserted > i1 + 3, '連続投入で何枚も入る');
    await page.click('#auto');
    await page.waitForTimeout(600);
    await page.click('#auto');
    // 時間がたつと、台から落ちたメダルが戻ってくる
    const w2 = (await st()).wallet;
    await page.waitForFunction((w) => window.__medal.state().wallet > w, w2, { timeout: 20000 });
  });

  await step(`${label}：ボールがルーレットに入ると結果が出る`, async () => {
    await page.evaluate(() => window.__medal.ball());
    await page.waitForFunction(() => window.__medal.state().roulette, null, { timeout: 5000 });
    await page.waitForFunction(() => !window.__medal.state().roulette, null, { timeout: 10000 });
  });

  await step(`${label}：ジャックポット`, async () => {
    const w0 = (await st()).wallet;
    await page.evaluate(() => window.__medal.jackpot());
    await page.getByRole('heading', { name: '星海ジャックポット' }).waitFor();
    await page.click('#jp-ok');
    assert((await st()).pool === 500, 'ジャックポットが元に戻る');
    await page.waitForFunction((w) => window.__medal.state().wallet > w, w0, { timeout: 10000 });
  });

  await step(`${label}：記録と設定`, async () => {
    await page.getByRole('button', { name: '記録と設定' }).click();
    await page.getByText('航海の記録').waitFor();
    await page.getByRole('button', { name: '控えめ' }).click();
    assert(await page.getByRole('button', { name: '控えめ' }).getAttribute('aria-pressed') === 'true', '控えめが選ばれる');
    await page.getByRole('button', { name: '閉じる' }).click();
  });

  await step(`${label}：読み込み直してもメダルが残る`, async () => {
    await page.waitForTimeout(2500); // 2 秒ごとに保存
    const w = (await st()).wallet;
    await page.reload();
    await page.click('#start');
    const w2 = (await st()).wallet;
    assert(Math.abs(w2 - w) <= 30, `保存 ${w} → ${w2}`);
  });

  await step(`${label}：画面のエラーがない`, async () => { assert(!errs.length, errs.join(' / ')); });
  await ctx.close();
}
await browser.close();
stop();
console.log(results.join('\n'));
console.log(failed ? `\n${failed} 件失敗` : `\nすべて成功（${results.length} 件）`);
process.exit(failed ? 1 : 0);
