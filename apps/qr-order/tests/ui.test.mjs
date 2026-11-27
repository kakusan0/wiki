// 画面テスト：ブラウザを自動で操作し、お客様とスタッフが実際に行う手順を画面上で確かめる。
// tests/run.mjs から呼ばれる（単体では動かさない）。結果は RESULTS_FILE に書く。
import fs from 'node:fs';
import { chromium, devices } from 'playwright';

const B = process.env.BASE_URL;
const OID = 'ui-order-1'; // fixtures.sql の、購入完了メールを送った注文
const MAIL = 'uitoken0001'; // その購入完了メールのリンクの合言葉
const PHOTO = new URL('./photo.jpg', import.meta.url).pathname;
const IN_STORE = { latitude: 35.7101, longitude: 139.8106, accuracy: 30 };
const out = [];
// 電子棚札（E）は機能テストにも 7 件あるので、画面テストは E-08 から数える
const seq = { E: 7 };
const rec = (area, title, expected, ok, actual) => {
  seq[area] = (seq[area] || 0) + 1;
  const id = area + '-' + String(seq[area]).padStart(2, '0');
  out.push({ id, area, title, expected, actual: String(actual), result: ok ? '合格' : '不合格' });
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' :: ' + actual);
};
const text = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim();

const b = await chromium.launch();
const errs = [];
const watch = (page) => page.on('pageerror', (e) => errs.push(String(e)));
const staffContext = async (opt) => {
  const ctx = await b.newContext(opt);
  await ctx.addCookies([{ name: 'staff_session', value: 'testtoken', url: B }]);
  return ctx;
};
const openStaff = async (page, tab) => {
  await page.goto(B + '/staff');
  await page.waitForFunction(() => document.getElementById('who').textContent.length > 0);
  if (tab) await page.click(`[data-tab=${tab}]`);
};

try {
  // ===== U：お客様の画面 =====
  for (const [name, opt] of [['PC（1280px）', { viewport: { width: 1280, height: 800 } }], ['スマホ（Pixel 7）', devices['Pixel 7']]]) {
    const c = await b.newContext(opt);
    const q = await c.newPage(); watch(q);
    await q.goto(B + '/'); await q.waitForLoadState('networkidle');
    const ov = await q.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    const h2 = await q.locator('h2').count();
    rec('U', `公式サイトが ${name} で崩れずに表示される`, '横にはみ出さない、各章が表示される', !ov && h2 >= 7, `はみ出し=${ov} 章=${h2}`);
    await c.close();
  }
  const phone = await b.newContext({ ...devices['Pixel 7'], permissions: ['geolocation'], geolocation: IN_STORE });
  await phone.grantPermissions(['geolocation'], { origin: B });
  // 店内の現在地を返すようにする。ブラウザの位置情報の模擬は、環境（GitHub Actions など）によって応答しないことがあるため
  await phone.addInitScript((g) => {
    const pos = () => ({ coords: { latitude: g.latitude, longitude: g.longitude, accuracy: g.accuracy }, timestamp: Date.now() });
    navigator.geolocation.getCurrentPosition = (ok) => setTimeout(() => ok(pos()), 10);
    navigator.geolocation.watchPosition = (ok) => { setTimeout(() => ok(pos()), 10); return 1; };
  }, IN_STORE);
  const p = await phone.newPage(); p.setDefaultTimeout(15000); watch(p);
  await p.goto(B + '/s/shop-001?add=p-003'); await p.waitForSelector('#cart-bar:not([hidden])');
  rec('U', '商品の QR を読み取ると、その商品がカートに入る', 'カートに 1 点', (await text(p.locator('#cart-bar'))).startsWith('1'), await text(p.locator('#cart-bar')));
  const entries = await p.locator('#contact-icon, #contact-link').count();
  rec('U', 'お店のページには問い合わせの入口がない', '入口 0 件', entries === 0, entries + ' 件');
  await p.goto(B + '/order/' + OID + '?m=' + MAIL); await p.waitForSelector('#contact-link:not([hidden])');
  rec('U', '購入完了メールのリンクで購入の証明が開く', '「お支払い完了」', (await p.locator('#state').innerText()).includes('お支払い完了'), await p.locator('#state').innerText());
  await p.click('#contact-link'); await p.waitForSelector('#order-pick:not([hidden])');
  const summary = await p.locator('#order-summary').innerText();
  rec('U', '購入の証明から問い合わせを開くと、その注文に決まっている（選択欄なし）', '注文番号 077 を表示、選択欄なし', (await p.locator('select').count()) === 0 && summary.includes('077'), summary);
  await p.fill('#body', '袋が破れていました'); await p.click('#form button'); await p.waitForSelector('.chat-msg');
  rec('U', '問い合わせのメッセージを送信できる', '自分のメッセージが表示される', (await p.locator('.chat-msg.mine').count()) === 1, (await p.locator('.chat-msg').count()) + ' 件');
  await p.goto(B + '/return/' + OID + '?m=' + MAIL); await p.waitForSelector('#form:not([hidden])');
  const req = await p.locator('legend .req').count();
  rec('U', '返品の画面の各項目に「必須」が表示される', '6 項目すべてに「必須」', req === 6, req + ' 項目');
  await p.locator('.ret-item input[type=checkbox]').first().check(); await p.fill('#detail', '破損');
  await p.locator('.slot').nth(0).locator('input[type=file]').setInputFiles(PHOTO); await p.waitForSelector('.thumb img');
  await p.locator('.slot').nth(1).locator('input[type=file]').setInputFiles(PHOTO); await p.waitForFunction(() => document.querySelectorAll('.thumb img').length === 2);
  await p.check('#agree'); await p.click('#submit'); await p.waitForTimeout(300);
  const e1 = await p.locator('#error').innerText();
  rec('U', '説明が短いときは、送信前に理由を表示する', '「5 文字以上」の案内', e1.includes('5 文字以上'), e1.slice(0, 40));
  await p.fill('#detail', '袋が破れていて中身がこぼれていました'); await p.click('#submit');
  // 受け付けられなかったときは、画面に出た理由を結果に残す
  await p.waitForSelector('.gate strong', { timeout: 30000 }).catch(async (e) => { throw new Error('返品の申し込みが完了しない（画面の表示：' + (await p.locator('#error').innerText().catch(() => '')) + ' / 位置情報：' + (await p.locator('#geo-state').innerText().catch(() => '')) + '）'); });
  const done = await text(p.locator('.gate').first());
  rec('U', '写真を付けて返品・交換を申し込める', '受付番号と、受付メールを送った旨', done.includes('受け付けました') && done.includes('受付のメール'), done.slice(0, 50));
  await p.goto(B + '/order/' + OID + '?m=' + MAIL); await p.waitForTimeout(1200);
  rec('U', '受付後に購入完了メールのリンクを開くと「使えません」と表示', '案内を表示', (await p.locator('#state').innerText()).includes('使えません'), await p.locator('#state').innerText());
  await p.goto(B + '/return/' + OID); await p.waitForSelector('#contact-link'); await p.click('#contact-link'); await p.waitForSelector('#order-pick:not([hidden])'); await p.waitForTimeout(500);
  const back = new URL(await p.locator('#back').evaluate((a) => a.href)).pathname;
  rec('U', '返品の画面から問い合わせを開くと、同じ注文のやり取りが続く', '先のメッセージが表示、戻ると返品の画面', (await p.locator('.chat-msg').count()) >= 1 && back.startsWith('/qr-order/return/'), `${await p.locator('.chat-msg').count()} 件 / 戻り先 ${back.split('/')[2]}`);
  await p.goto(B + '/contact/shop-001'); await p.waitForTimeout(500);
  rec('U', '注文なしで問い合わせ画面を開くと、開き方を案内する', '送信欄を出さず案内', await p.locator('#form').isHidden(), (await p.locator('#error').innerText()).slice(0, 30));

  // ===== K：お客様画面の URL API =====
  const noLogin = await fetch(B + '/api/staff/stores/shop-001/customer-url');
  rec('K', 'ログインしていないと URL を取得できない', '401', noLogin.status === 401, noLogin.status);

  // ===== E：電子棚札（QR 読み取り → カート） =====
  const decoded = await p.evaluate(async (src) => {
    await new Promise((ok, ng) => { if (window.jsQR) return ok(); const sc = document.createElement('script'); sc.src = '/qr-order/vendor/jsQR.js'; sc.onload = ok; sc.onerror = ng; document.head.append(sc); });
    const im = new Image(); im.src = src; await im.decode();
    const cv = document.createElement('canvas'); cv.width = im.width * 4; cv.height = im.height * 4;
    const g = cv.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(im, 0, 0, cv.width, cv.height);
    const d = g.getImageData(0, 0, cv.width, cv.height);
    const qr = window.jsQR(d.data, d.width, d.height);
    return qr ? qr.data : null;
  }, B + '/esl/p-003.jpg');
  rec('E', '棚札の画像の QR コードを読み取れ、中身はその商品の短いアドレス', '/p/p-003', decoded === B + '/p/p-003', (decoded || '読み取れない').replace(B, ''));
  const shop = await phone.newPage(); watch(shop);
  await shop.goto(decoded || B + '/p/p-003'); await shop.waitForSelector('#cart-bar:not([hidden])');
  rec('E', '棚札の QR から開くと、その商品がカートに入る', '緑茶 500ml が 1 点', (await text(shop.locator('#cart-bar'))).includes('150'), await text(shop.locator('#cart-bar')));
  await shop.close();

  // ===== Q：削除した機能 =====
  await p.goto(B + '/s/shop-001?from=staff'); await p.waitForTimeout(1000);
  const st = await staffContext({ viewport: { width: 1280, height: 850 } });
  const staffTools = await st.newPage(); await staffTools.goto(B + '/s/shop-001?from=staff'); await staffTools.waitForTimeout(1000);
  const tools = await staffTools.locator('#staff-tools, #screen-scan, #image-scan').count(); await staffTools.close();
  rec('Q', 'ログイン中に以前のスタッフ用のアドレス（?from=staff）で開いても、スタッフ用の読み取りは表示されない', '表示しない', tools === 0, `ボタン ${tools} 件`);
  await st.close();
  rec('U', '画面の操作中にプログラムのエラーが起きない', 'エラー 0 件', errs.length === 0, errs.length + ' 件 ' + errs.join(' / ').slice(0, 80));
} catch (e) {
  rec('U', '画面テストが最後まで実行できる', '途中で止まらない', false, String(e).slice(0, 120));
} finally {
  await b.close();
  fs.writeFileSync(process.env.RESULTS_FILE, JSON.stringify(out, null, 1));
}
