// 画面のテスト（PC とスマホ）。ビルドした画面を vite preview で開き、各モードを操作する
// 使い方：npm run e2e
import { spawn } from 'node:child_process';
import { chromium, devices } from 'playwright';
import { createServer } from 'vite';

const PORT = 4183;
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];
let failed = 0;
const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
async function step(name, fn) {
  try { await fn(); results.push(`✓ ${name}`); } catch (e) { failed++; results.push(`✗ ${name}\n    ${(e?.message ?? String(e)).split('\n')[0]}`); }
}

// 詰将棋の答えを計算するため、ルールの中身を読み込む
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
const { TSUME } = await vite.ssrLoadModule('/src/data/tsume.ts');
const { Position, mFrom, mTo, mDrop, isDrop, mPromo } = await vite.ssrLoadModule('/src/engine/position.ts');
const { solve } = await vite.ssrLoadModule('/src/engine/tsume.ts');

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--strictPort'], { stdio: 'ignore', detached: true });
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* もう止まっている */ } };
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* 起動中 */ }
  await new Promise((r) => setTimeout(r, 200));
}

const sq = (file, rank) => (rank - 1) * 9 + (9 - file);
const browser = await chromium.launch();

for (const [label, ctxOpts] of [['PC', { viewport: { width: 1280, height: 860 } }], ['スマホ', devices['iPhone 13']]]) {
  const ctx = await browser.newContext({ ...ctxOpts, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  const title = async () => { await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.goto(BASE); };
  const click = (s) => page.click(`[data-sq="${s}"]`);
  const kifu = () => page.locator('.kifu .moves').innerText();
  const noOverflow = async () => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert(w[0] <= w[1] + 1, `横にはみ出す ${w}`);
  };

  await step(`${label}：タイトル`, async () => {
    await title();
    await page.getByRole('heading', { name: 'まちかど将棋' }).waitFor();
    await noOverflow();
  });

  await step(`${label}：二人対戦で指す・成る・持ち駒を打つ・待った`, async () => {
    await title();
    await page.getByRole('button', { name: 'この端末で交代に指す' }).click();
    assert(await page.locator('.grid .cell').count() === 81, '81 マス');
    await noOverflow();
    await click(sq(7, 7)); await click(sq(7, 6));
    await click(sq(3, 3)); await click(sq(3, 4));
    await click(sq(8, 8)); await click(sq(2, 2));
    await page.getByRole('dialog', { name: '成りますか？' }).waitFor();
    await page.getByRole('button', { name: /^成る/ }).click();
    await click(sq(3, 1)); await click(sq(2, 2));
    await page.click('[data-hand="0:6"]');
    await click(sq(5, 5));
    const k = await kifu();
    for (const s of ['▲7六歩', '△3四歩', '▲2二角成', '△同　銀', '▲5五角打']) assert(k.includes(s), `棋譜に ${s}：${k}`);
    await page.getByRole('button', { name: '待った' }).click();
    assert(!(await kifu()).includes('▲5五角打'), '待ったで戻る');
    // 途中から再開できる
    await page.goto(BASE);
    await page.getByRole('button', { name: /つづきから/ }).click();
    assert((await kifu()).includes('△同　銀'), '再開');
  });

  await step(`${label}：対局を動画で保存する`, async () => {
    // 「つづきから」の 4 手の対局で、正方形・はやい・小さめを作る
    await page.click('#video');
    const dlg = page.getByRole('dialog', { name: '動画で保存' });
    await dlg.waitFor();
    await dlg.getByText('正方形').click();
    await dlg.getByText('はやい').click();
    if (!(await page.locator('#video-small').isChecked())) await page.locator('#video-small').check();
    await noOverflow();
    await page.click('#video-make');
    const save = page.locator('#video-save');
    await save.waitFor({ timeout: 60000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), save.click()]);
    const path = await dl.path();
    const { readFileSync } = await import('node:fs');
    const buf = readFileSync(path);
    assert(buf.length > 2000, `動画が小さすぎる ${buf.length}`);
    const webm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    const mp4 = buf.slice(4, 8).toString() === 'ftyp';
    assert(webm || mp4, '動画の形式（WebM か MP4）');
    assert(/^shogi-\d{4}-\d\d-\d\d-4te\.(webm|mp4)$/.test(dl.suggestedFilename()), `ファイル名 ${dl.suggestedFilename()}`);
    // 縦長も作れる
    await page.getByRole('button', { name: '作り直す' }).click();
    await dlg.getByText('縦長 9:16').click();
    await page.click('#video-make');
    await page.locator('#video-save').waitFor({ timeout: 60000 });
    await page.getByRole('button', { name: '閉じる' }).click();
  });

  await step(`${label}：対局を再生する（自動で進む・1 手ずつ・速さ・キー）`, async () => {
    // 「つづきから」の 4 手の対局
    const pos = () => page.locator('.replay-pos').innerText();
    const on = () => page.locator('.kifu .moves li.on').innerText();
    await page.getByRole('button', { name: 'はやい' }).click();
    await page.click('#replay');
    assert((await page.locator('#replay').innerText()).includes('停止'), '再生中は停止ボタン');
    await page.waitForFunction(() => document.querySelector('.replay-pos')?.textContent?.startsWith('2 手目'), null, { timeout: 5000 });
    assert((await on()).startsWith('2. △3四歩'), `棋譜の一覧も一緒に進む：${await on()}`);
    await page.waitForFunction(() => document.querySelector('.replay-pos')?.textContent?.includes('（最新）'), null, { timeout: 10000 });
    assert((await page.locator('#replay').innerText()).includes('再生'), '最後まで来たら止まる');
    await noOverflow();
    // 1 手ずつ
    await page.getByRole('button', { name: '1 手戻る' }).click();
    assert((await pos()).startsWith('3 手目'), await pos());
    await page.getByRole('button', { name: '開始局面へ' }).click();
    assert((await pos()).startsWith('開始局面'), await pos());
    // キー（PC）：→ で進む、スペースで再生、← で戻ると止まる
    if (label === 'PC') {
      await page.locator('body').click({ position: { x: 2, y: 2 } });
      await page.keyboard.press('ArrowRight');
      assert((await pos()).startsWith('1 手目'), await pos());
      await page.keyboard.press(' ');
      assert((await page.locator('#replay').innerText()).includes('停止'), 'スペースで再生');
      await page.keyboard.press('ArrowLeft');
      assert((await page.locator('#replay').innerText()).includes('再生'), '手で動かすと止まる');
    }
    await page.getByRole('button', { name: '最新の局面へ' }).click();
    assert((await pos()).includes('（最新）'), await pos());
    await page.getByRole('button', { name: 'ふつう' }).click();
  });

  await step(`${label}：対局を解析する（評価値・最善手・悪手の印）`, async () => {
    // 「つづきから」の 4 手（▲2二角成 で角を交換）の対局
    await page.click('#analyze');
    await page.getByText('解析中').waitFor();
    await page.locator('.analysis .tally').waitFor({ timeout: 30000 });
    assert(await page.locator('.analysis .eval-graph polyline').count() === 1, 'グラフ');
    await noOverflow();
    // 過去の局面を開くと、その手の評価と最善手が出て、盤に最善手が光る
    await page.locator('.kifu .moves li').nth(1).click();
    await page.locator('.analysis .review').waitFor();
    assert(/^1\. ▲7六歩：/.test(await page.locator('.analysis .review').innerText()), '1 手目の評価');
    assert(/最善手：△/.test(await page.locator('.analysis').innerText()), '最善手');
    assert(await page.locator('.grid .cell.target').count() === 1, '最善手が光る');
    // グラフを押すと局面が変わる
    const g = await page.locator('.analysis .eval-graph').boundingBox();
    await page.mouse.click(g.x + 2, g.y + g.height / 2);
    assert(await page.locator('.kifu .moves li.on').innerText() === '開始局面', 'グラフで開始局面へ');
    // 待ったで棋譜が変わると、解析は捨てる
    await page.getByRole('button', { name: '最新の局面へ' }).click();
    await page.getByRole('button', { name: '待った' }).click();
    assert(await page.locator('.analysis .eval-graph').count() === 0, '古い解析は消える');
  });

  await step(`${label}：Lishogi の対局を観戦する（一覧・新しい手・形勢）`, async () => {
    // Lishogi の API は本物を呼ばず、決まった答えを返す。読むたびに 1 手ずつ進む対局
    const MOVES = ['7g7f', '3c3d', '2g2f', '8c8d', '2f2e', '8d8e'];
    let polls = 0;
    const game = (n, status = 'started') => ({
      id: 'TestGame', rated: true, variant: 'standard', status, ...(status === 'started' ? {} : { winner: 'sente' }),
      players: { sente: { user: { name: 'sakura' }, rating: 1850 }, gote: { user: { name: 'kaede' }, rating: 1790 } },
      moves: MOVES.slice(0, n).join(' '), clock: { initial: 600, increment: 0, byoyomi: 30, periods: 1 },
    });
    // 強い人の一覧（このアプリのサーバー）：sakura は上位、kaede・ume は入っていない
    let anyonePlaying = true;
    await page.route('**/api/lishogi/top', (route) => route.fulfill({ json: { players: [
      { id: 'sakura', name: 'sakura', rating: 2400, title: null }, { id: 'momo', name: 'momo', rating: 2300, title: null },
    ] } }));
    await page.route('https://lishogi.org/**', (route) => {
      const u = new URL(route.request().url());
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (u.pathname === '/api/users/status') {
        return route.fulfill({ headers: cors, json: [{ id: 'sakura', name: 'sakura', playing: anyonePlaying }, { id: 'momo', name: 'momo', online: true }] });
      }
      if (u.pathname === '/api/user/sakura/current-game') return route.fulfill({ headers: cors, json: game(2) });
      if (u.pathname === '/api/user/momo/current-game') return route.fulfill({ headers: cors, json: { ...game(4, 'resign'), id: 'MomoLast', players: { sente: { user: { name: 'momo' }, rating: 2300 }, gote: { user: { name: 'ume' }, rating: 1500 } } } });
      if (u.pathname === '/game/export/MomoLast') return route.fulfill({ headers: cors, json: { ...game(4, 'resign'), id: 'MomoLast' } });
      if (u.pathname === '/game/export/TestGame') {
        polls++;
        const n = Math.min(2 + polls, MOVES.length);
        return route.fulfill({ headers: { ...cors, 'Content-Type': 'application/json' }, body: JSON.stringify(game(n, n === MOVES.length ? 'resign' : 'started')) });
      }
      return route.fulfill({ status: 404, headers: cors, body: '{}' });
    });
    await title();
    await page.getByRole('button', { name: '強い人の対局を見る' }).click();
    const item = page.locator('.watch-game');
    await item.first().waitFor();
    assert(await item.count() === 1, '強い人の対局だけが一覧に出る');
    assert((await item.innerText()).includes('★sakura（1850）'), '強い人に ★、名前とレーティング');
    assert(!(await item.innerText()).includes('★kaede'), '上位でない人に ★ はつかない');
    assert((await page.locator('.title-main').innerText()).includes('上位 2 人（2300 以上）'), '強い人の決め方を出す');
    await noOverflow();
    await item.click();
    await page.locator('.watch-info .live').waitFor();
    assert(/TestGame$/.test(page.url().split('lishogi=')[1] ?? ''), 'URL に対局の ID');
    // 4 秒ごとに読み直して、手が増えていく
    await page.waitForFunction(() => document.querySelectorAll('.kifu .moves li').length >= 6, null, { timeout: 30000 });
    assert(await page.locator('.analysis .eval-graph').count() === 1, '形勢のグラフが自動で出る');
    assert(await page.getByRole('button', { name: '投了' }).count() === 0, '観戦では投了できない');
    assert((await page.locator('.analysis').innerText()).includes('最善手を出しません'), '対局中は最善手を出さない');
    // 終局すると読みにいくのをやめ、最善手も出る
    await page.getByText('投了。先手の勝ち').first().waitFor({ timeout: 30000 });
    assert(await page.locator('.watch-info .live').count() === 0, '終局したら「対局中」を消す');
    assert((await kifu()).includes('△8五歩'), '最後の手まで並ぶ');
    await page.locator('.analysis .tally').waitFor({ timeout: 30000 });
    await page.locator('.kifu .moves li').nth(1).click();
    assert(/最善手：△/.test(await page.locator('.analysis').innerText()), '終局後は最善手が出る');
    const before = polls;
    await page.waitForTimeout(5000);
    assert(polls === before, `終局後は読みにいかない（${before}→${polls}）`);
    await noOverflow();
    // URL で開く：形が違えば知らせる
    await page.getByRole('button', { name: '← もどる' }).click();
    assert(!page.url().includes('lishogi='), 'もどると URL から消える');
    // 強い人が誰も対局中でなければ、そう出して、上位の人の最近の対局を開ける
    anyonePlaying = false;
    await page.getByRole('button', { name: '強い人の対局を見る' }).click();
    await page.getByRole('button', { name: '新しくする' }).click();
    await page.getByText('いま対局中の強い人はいません').waitFor();
    assert(await page.locator('.watch-game').count() === 0, '一覧は空');
    await noOverflow();
    await page.locator('.top-players li').nth(1).getByRole('button', { name: '最近の対局' }).click();
    await page.getByText('投了。先手の勝ち').first().waitFor();
    await page.getByRole('button', { name: '← もどる' }).click();
    await page.getByRole('button', { name: '強い人の対局を見る' }).click();
    await page.getByLabel('Lishogi の対局の URL か ID').fill('https://example.com/x');
    await page.getByRole('button', { name: '観戦する' }).click();
    await page.getByRole('alert').waitFor();
    await page.unroute('https://lishogi.org/**');
    await page.unroute('**/api/lishogi/top');
  });

  await step(`${label}：コンピューターと対局`, async () => {
    await title();
    await page.getByRole('button', { name: 'コンピューターと対局する' }).click();
    await click(sq(2, 7)); await click(sq(2, 6));
    await page.locator('.kifu .moves li').nth(2).waitFor({ timeout: 15000 });
    assert((await kifu()).includes('△'), 'コンピューターが指す');
    await page.getByRole('button', { name: 'ヒント' }).click();
    await page.getByText('ヒント：').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: '投了' }).click();
    await page.getByText('投了。あなたの負け').first().waitFor();
  });

  await step(`${label}：駒落ち（角落ち）`, async () => {
    await title();
    await page.selectOption('.select select', 'bishop');
    await page.getByRole('button', { name: 'コンピューターと対局する' }).click();
    await page.locator('.kifu .moves li').nth(1).waitFor({ timeout: 15000 }); // 上手が先に指す
    assert(await page.locator('[aria-label*="後手の角"]').count() === 0, '後手の角がない');
  });

  await step(`${label}：小さい盤（5五・3×4）`, async () => {
    await title();
    await page.getByText('5五将棋（5×5）').click();
    await page.getByRole('button', { name: 'この端末で交代に指す' }).click();
    assert(await page.locator('.grid .cell').count() === 25, '25 マス');
    await noOverflow();
    await title();
    await page.getByText('ミニ将棋（3×4）').click();
    await page.getByRole('button', { name: 'コンピューターと対局する' }).click();
    assert(await page.locator('.grid .cell').count() === 12, '12 マス');
    assert(await page.locator('[data-hand="0:1"]').count() === 1, '歩を持っている');
  });

  await step(`${label}：詰将棋を解く（1・3 手詰め）`, async () => {
    for (const t of [TSUME.find((x) => x.plies === 1), TSUME.find((x) => x.plies === 3)]) {
      await page.goto(BASE);
      await page.getByRole('button', { name: /^詰将棋/ }).click();
      await page.getByRole('button', { name: new RegExp(`^${t.title.split(' ')[1]}`) }).nth(t.plies === 1 ? 0 : 1).click();
      const p = Position.fromSfen(t.sfen);
      const line = solve(p, t.plies);
      for (let i = 0; i < line.length; i += 2) {
        const m = line[i];
        if (isDrop(m)) await page.click(`[data-hand="0:${mDrop(m)}"]`); else await click(mFrom(m));
        await click(mTo(m));
        if (await page.getByRole('dialog', { name: '成りますか？' }).isVisible().catch(() => false)) {
          await page.getByRole('button', { name: mPromo(m) ? /^成る/ : /^成らない/ }).click();
        }
        // 受け方は解き手と同じ「最も長く逃げる手」を選ぶので、手順どおりに進む
        if (i + 2 < line.length) await page.locator('.kifu .moves li').nth(i + 2).waitFor({ timeout: 5000 });
      }
      await page.getByText('正解！').waitFor({ timeout: 5000 });
    }
  });

  await step(`${label}：駒の動かし方`, async () => {
    await page.goto(BASE);
    await page.getByRole('button', { name: '駒の動かし方' }).click();
    await page.getByRole('button', { name: '桂', exact: true }).click();
    assert(await page.locator('.cell.target').count() === 2, '桂は 2 か所');
    await page.getByRole('button', { name: '飛', exact: true }).click();
    assert(await page.locator('.cell.target').count() === 16, '飛車は 16 か所');
  });

  await step(`${label}：オンラインの入口`, async () => {
    await page.goto(BASE);
    await page.getByRole('button', { name: 'オンラインで対戦（合言葉）' }).click();
    await page.fill('#join-code', 'ab');
    await page.click('#join-room');
    await page.getByText('合言葉は 6 文字です').waitFor();
    await noOverflow();
  });

  await step(`${label}：画面のエラーがない`, async () => { assert(!errs.length, errs.join(' / ')); });
  await ctx.close();
}

await browser.close();
await vite.close();
stop();
console.log(results.join('\n'));
console.log(failed ? `\n${failed} 件失敗` : `\nすべて成功（${results.length} 件）`);
process.exit(failed ? 1 : 0);
