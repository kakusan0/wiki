// 機能テスト：サーバーに正しい操作と誤った操作を送り、受け付けるべきものだけを受け付けるかを確かめる。
// tests/run.mjs から呼ばれる（単体では動かさない）。結果は RESULTS_FILE に書く。
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const B = process.env.BASE_URL;
const FAKE = process.env.FAKE_URL;
const SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const ROOT = new URL('..', import.meta.url).pathname;
const PERSIST = process.env.PERSIST_DIR;
/** テスト用データベースに SQL を実行する */
const sql = (q) => JSON.parse(execSync(`npx wrangler d1 execute DB -c tests/wrangler.test.jsonc --local --persist-to "${PERSIST}" --json --command "${q}"`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString())[0].results;
/** 代わりのサーバーが受け取ったメール */
const mails = async () => (await (await fetch(FAKE + '/__log')).json()).mails;
const ADMIN = 'staff_session=testtoken';
const STAFF = 'staff_session=stafftoken';
const IN_STORE = { lat: 35.7101, lng: 139.8106, accuracy: 30 };
const results = [];
let seq = {};
function rec(area, title, expected, ok, actual) {
  seq[area] = (seq[area] || 0) + 1;
  const id = area + '-' + String(seq[area]).padStart(2, '0');
  results.push({ id, area, title, expected, actual: String(actual), result: ok ? '合格' : '不合格' });
  console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + title + ' :: ' + actual);
}
const j = async (method, path, body, opt = {}) => {
  const res = await fetch(B + path, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(opt.cookie ? { Cookie: opt.cookie } : {}), ...(opt.headers || {}) }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  let data = null; const t = await res.text(); try { data = JSON.parse(t); } catch { data = t; }
  return { status: res.status, data, loc: res.headers.get('location') };
};
const piOf = {};
const webhook = async (order, total, override = {}) => {
  const pi = { id: piOf[order], status: 'succeeded', currency: 'jpy', amount_received: total, metadata: { order_id: order }, ...override };
  const raw = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: pi } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex');
  return j('POST', '/api/stripe/webhook', raw, { headers: { 'Stripe-Signature': `t=${t},v1=${sig}` } });
};
const newOrder = async (items, extra = {}) => { const r = await j('POST', '/api/orders', { storeId: 'shop-001', items, geo: IN_STORE, ...extra }); if (r.data?.orderId) piOf[r.data.orderId] = 'pi_' + r.data.clientSecret.slice(3); return r; };

const jpeg = fs.readFileSync(new URL('./photo.jpg', import.meta.url)).toString('base64');

// ===== 購入 =====
let r = await j('GET', '/api/stores/shop-001');
rec('B', '店舗の情報と販売中の商品を表示できる', '200 と商品一覧', r.status === 200 && r.data.products?.length >= 4, `${r.status} / 商品 ${r.data.products?.length} 件`);
r = await j('POST', '/api/orders', { storeId: 'shop-001', items: [{ productId: 'p-001', qty: 1 }] });
rec('B', '位置情報なしでは注文できない', '400 location_required', r.status === 400 && r.data.error === 'location_required', `${r.status} ${r.data.error}`);
r = await newOrder([{ productId: 'p-001', qty: 1 }], { geo: { lat: 35.7101, lng: 139.8106, accuracy: 5000 } });
rec('B', '測位の誤差が大きすぎる場合は注文できない', '400 location_inaccurate', r.status === 400 && r.data.error === 'location_inaccurate', `${r.status} ${r.data.error}`);
r = await newOrder([{ productId: 'p-001', qty: 1 }], { geo: { lat: 35.6812, lng: 139.7671, accuracy: 30 } });
rec('B', '店舗から離れた場所（約 4km）からは注文できない', '403 out_of_store', r.status === 403 && r.data.error === 'out_of_store', `${r.status} ${r.data.error}`);
r = await newOrder([{ productId: 'p-001', qty: 21 }]);
rec('B', '1 商品 21 個以上は注文できない', '400 bad_request', r.status === 400, `${r.status} ${r.data.error}`);
r = await newOrder([{ productId: 'p-zzz', qty: 1 }]);
rec('B', '存在しない商品は注文できない', '409 product_unavailable', r.status === 409 && r.data.error === 'product_unavailable', `${r.status} ${r.data.error}`);
r = await newOrder([{ productId: 'p-005', qty: 1 }]);
rec('B', '年齢制限商品は 20 歳以上の確認なしでは注文できない', '400 age_confirmation_required', r.status === 400 && r.data.error === 'age_confirmation_required', `${r.status} ${r.data.error}`);
r = await newOrder([{ productId: 'p-001', qty: 1 }], { email: 'not-an-email' });
rec('B', 'メールアドレスの形式が不正なら受け付けない', '400 bad_email', r.status === 400 && r.data.error === 'bad_email', `${r.status} ${r.data.error}`);
r = await newOrder([{ productId: 'p-001', qty: 2 }, { productId: 'p-004', qty: 1 }], { email: 'buyer@example.com', items: [{ productId: 'p-001', qty: 2 }, { productId: 'p-004', qty: 1 }, { productId: 'p-001', qty: 0 }] });
rec('B', '数量 0 の行を含む不正な注文は受け付けない', '400 bad_request', r.status === 400, `${r.status} ${r.data.error}`);
r = await newOrder([{ productId: 'p-001', qty: 2 }, { productId: 'p-004', qty: 1 }], { email: 'buyer@example.com' });
const O1 = r.data.orderId;
rec('B', '店内から正しい注文を作成でき、金額はサーバーの価格で計算される', '201、合計 ¥660（180×2＋300）', r.status === 201 && r.data.total === 660 && !!r.data.clientSecret, `${r.status} 合計 ¥${r.data.total}`);
let o = await j('GET', '/api/orders/' + O1);
rec('B', '支払い前の注文は「未払い」のまま', 'status = pending', o.data.status === 'pending', o.data.status);
r = await webhook(O1, 500);
o = await j('GET', '/api/orders/' + O1);
rec('B', '決済額が注文額と違う通知では支払い済みにしない', 'pending のまま', o.data.status === 'pending', `通知 ${r.status} → ${o.data.status}`);
r = await j('POST', '/api/stripe/webhook', JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { metadata: { order_id: O1 } } } }), { headers: { 'Stripe-Signature': 't=1,v1=00' } });
rec('B', '署名が正しくない決済通知は拒否する', '400 invalid_signature', r.status === 400, `${r.status} ${r.data.error}`);
r = await webhook(O1, 660);
o = await j('GET', '/api/orders/' + O1);
rec('B', '正しい決済通知で支払い済みになり、注文番号が付く', 'status = paid、注文番号あり', o.data.status === 'paid' && o.data.pickupNo > 0, `${o.data.status} / 注文番号 ${String(o.data.pickupNo).padStart(3, '0')}`);
rec('B', '購入の証明に税率ごとの消費税が表示される', '8% と 10% の内訳', o.data.tax?.length === 2, JSON.stringify(o.data.tax?.map((t) => `${t.rate}%:¥${t.tax}`)));
const r2 = await webhook(O1, 660);
const o2 = await j('GET', '/api/orders/' + O1);
rec('B', '同じ決済通知が 2 回届いても二重に処理しない', '注文番号が変わらない', o2.data.pickupNo === o.data.pickupNo, `${r2.status} / 注文番号 ${o2.data.pickupNo}`);
await new Promise((res) => setTimeout(res, 500));
const m1 = (await mails()).find((m) => m.to.includes('buyer@example.com') && m.subject.includes('ご購入ありがとうございます'));
rec('B', '購入完了メールが入力したアドレスへ送られる', '宛先 buyer@example.com・件名に注文番号', !!m1 && m1.subject.includes('注文番号'), m1 ? '送信を確認：' + m1.subject : '見つからない');

// 年齢確認
r = await newOrder([{ productId: 'p-005', qty: 1 }], { ageConfirmed: true });
const O2 = r.data.orderId; await webhook(O2, 300);
o = await j('GET', '/api/orders/' + O2);
rec('A', '年齢制限商品の注文は支払い後「年齢確認待ち」になる', 'ageCheckRequired=true、未確認', o.data.ageCheckRequired === true && !o.data.ageChecked, `required=${o.data.ageCheckRequired} checked=${o.data.ageChecked}`);
r = await j('POST', `/api/staff/orders/${O2}/age-check`, {}, { cookie: STAFF });
o = await j('GET', '/api/orders/' + O2);
rec('A', 'スタッフが年齢確認をすると、お客様の画面が完了になる', '確認済み', r.status === 200 && o.data.ageChecked === true, `${r.status} checked=${o.data.ageChecked}`);
r = await j('POST', `/api/staff/orders/${O2}/age-check`, {}, { cookie: STAFF });
rec('A', '確認済みの注文をもう一度確認することはできない', '409', r.status === 409, r.status);

// ===== 返金 =====
r = await j('POST', `/api/staff/orders/${O1}/refund`, { amount: 100, requestId: 'qa-refund-0001' }, { cookie: STAFF });
rec('M', '一般スタッフは返金できない（管理者のみ）', '403 admin_only', r.status === 403, `${r.status} ${r.data.error}`);
r = await j('POST', `/api/staff/orders/${O1}/refund`, { amount: 1000, requestId: 'qa-refund-0002' }, { cookie: ADMIN });
rec('M', '注文額を超える返金はできない', '400 bad_amount', r.status === 400 && r.data.error === 'bad_amount', `${r.status} ${r.data.error} 残り ¥${r.data.remaining}`);
r = await j('POST', `/api/staff/orders/${O1}/refund`, { amount: 180, requestId: 'qa-refund-0003' }, { cookie: ADMIN });
rec('M', '管理者は一部の金額だけ返金できる', '返金 ¥180、残り ¥480', r.status === 200 && r.data.refunded === 180 && r.data.remaining === 480, `${r.status} 返金 ¥${r.data.refunded} 残り ¥${r.data.remaining}`);
r = await j('POST', `/api/staff/orders/${O1}/refund`, { amount: 180, requestId: 'qa-refund-0003' }, { cookie: ADMIN });
o = await j('GET', '/api/orders/' + O1);
rec('M', '同じ返金操作を 2 回送っても二重に返金しない', '返金済み ¥180 のまま', o.data.refundedAmount === 180, `${r.status} 返金済み ¥${o.data.refundedAmount}`);
const both = await Promise.all([1, 2].map(() => j('POST', `/api/staff/orders/${O1}/refund`, { amount: 100, requestId: 'qa-refund-0004' }, { cookie: ADMIN })));
o = await j('GET', '/api/orders/' + O1);
rec('M', '同じ返金操作が同時に 2 つ届いても、1 回分だけ返金する', '返金済み ¥280（180＋100）', o.data.refundedAmount === 280, `${both.map((x) => x.status).join('/')} 返金済み ¥${o.data.refundedAmount}`);

// ===== 返品・交換 =====
r = await newOrder([{ productId: 'p-002', qty: 2 }], { email: 'buyer2@example.com' });
const O3 = r.data.orderId; await webhook(O3, 700);
await new Promise((res) => setTimeout(res, 300));
// 購入完了メールのリンクに付いた合言葉
const receipt3 = (await mails()).find((m) => m.to.includes('buyer2@example.com'));
const oldToken = ((receipt3 && receipt3.html.match(/\?m=([0-9a-f]+)/)) || [])[1];
const ret = (extra) => j('POST', `/api/orders/${O3}/returns`, { reason: 'defect', wanted: 'refund', detail: 'キャップが割れていて中身がこぼれていた', agree: true, items: [{ productId: 'p-002', qty: 1 }], photos: [{ kind: 'whole', data: jpeg }, { kind: 'defect', data: jpeg }], geo: IN_STORE, ...extra });
r = await j('GET', `/api/orders/${O3}/returns?m=${oldToken}`);
rec('R', '購入完了メールのリンクで返品の画面を開ける', '200、申し込める', r.status === 200 && r.data.open === true, `${r.status} open=${r.data.open}`);
r = await ret({ geo: undefined });
rec('R', '位置情報なしでは申し込めない', '400 location_required', r.data.error === 'location_required', `${r.status} ${r.data.error}`);
r = await ret({ detail: '破損' });
rec('R', '状況の説明が 5 文字未満なら理由を示して断る', '400 detail_too_short', r.data.error === 'detail_too_short', `${r.status} ${r.data.error}`);
r = await ret({ photos: [{ kind: 'whole', data: jpeg }] });
rec('R', '写真が 1 枚だけでは申し込めない（2 枚以上）', '400 photos_required', r.data.error === 'photos_required', `${r.status} ${r.data.error}`);
r = await ret({ photos: [{ kind: 'defect', data: jpeg }, { kind: 'label', data: jpeg }] });
rec('R', '「商品の全体」の写真がなければ申し込めない', '400 photos_required', r.data.error === 'photos_required', `${r.status} ${r.data.error}`);
r = await ret({ photos: [{ kind: 'whole', data: Buffer.from('<svg/>').toString('base64') + 'AAAA' }, { kind: 'defect', data: jpeg }] });
rec('R', 'JPEG 以外のファイルは写真として受け付けない', '400 bad_photo', r.data.error === 'bad_photo', `${r.status} ${r.data.error}`);
r = await ret({ items: [{ productId: 'p-002', qty: 3 }] });
rec('R', '購入数より多い数量は申し込めない', '409 items_unavailable', r.data.error === 'items_unavailable', `${r.status} ${r.data.error}`);
r = await ret({ geo: IN_STORE });
rec('R', '申し込みは 1 時間に 6 回まで（いたずら防止）', '7 回目は 429 too_many_requests', r.status === 429 && r.data.error === 'too_many_requests', `${r.status} ${r.data.error}`);
sql("DELETE FROM rate_limits WHERE key LIKE 'return%'");
r = await ret({ photos: [{ kind: 'whole', data: jpeg }, { kind: 'defect', data: jpeg }, { kind: 'label', data: jpeg }, { kind: 'other', data: jpeg }, { kind: 'other', data: jpeg }], });
const R1 = r.data.id;
rec('R', '正しい内容（写真 5 枚）で申し込める', '201、受付番号あり、受付メール送信', r.status === 201 && !!r.data.code && r.data.mailed === true, `${r.status} 受付 #${r.data.code} mailed=${r.data.mailed}`);
await new Promise((res) => setTimeout(res, 300));
const m2 = (await mails()).find((m) => m.to.includes('buyer2@example.com') && m.subject.includes('返品・交換のお申し込みを受け付けました'));
rec('R', '受付メールが購入完了メールと同じ宛先に届く', '宛先 buyer2@example.com、件名「返品・交換のお申し込みを受け付けました」', !!m2, m2 ? '送信を確認' : '見つからない');
r = await j('GET', `/api/orders/${O3}?m=${oldToken}`);
rec('R', '受付後、購入完了メールのリンクは無効になる', '410 mail_revoked', r.status === 410 && r.data.error === 'mail_revoked', `${r.status} ${r.data.error}`);
r = await j('GET', `/api/orders/${O3}`);
rec('R', '購入の証明の画面（メール以外から）は引き続き開ける', '200', r.status === 200, r.status);

r = await j('POST', `/api/staff/returns/${R1}/decide`, { decision: 'refund' }, { cookie: STAFF });
rec('R', '一般スタッフは返品を承認できない（管理者のみ）', '403', r.status === 403, `${r.status} ${r.data.error}`);
r = await j('POST', `/api/staff/returns/${R1}/decide`, { decision: 'reject' }, { cookie: ADMIN });
rec('R', '却下にはお客様へのメッセージが必須', '400 note_required', r.data.error === 'note_required', `${r.status} ${r.data.error}`);
r = await j('POST', `/api/staff/returns/${R1}/decide`, { decision: 'refund', note: '商品をお持ちください' }, { cookie: ADMIN });
rec('R', '管理者が「承認（返金）」できる', '200', r.status === 200, r.status);
r = await j('POST', `/api/staff/returns/${R1}/complete`, {}, { cookie: ADMIN });
o = await j('GET', '/api/orders/' + O3);
rec('R', '商品の回収後に完了すると、対象商品の代金が返金される', '返金 ¥350（サンドイッチ 1 個）', r.status === 200 && r.data.refunded === 350 && o.data.refundedAmount === 350, `${r.status} 返金 ¥${r.data.refunded}`);
const rs = await j('GET', '/api/staff/returns?store=shop-001', undefined, { cookie: ADMIN });
const ph = rs.data.returns.find((x) => x.id === R1).photos[0];
const img = await fetch(`${B}/api/staff/returns/${R1}/photos/${ph.id}`, { headers: { Cookie: ADMIN } });
rec('R', 'スタッフは申し込みの写真を開ける', '200 image/jpeg', img.status === 200 && img.headers.get('content-type') === 'image/jpeg', `${img.status} ${img.headers.get('content-type')}`);
const img2 = await fetch(`${B}/api/staff/returns/${R1}/photos/${ph.id}`);
rec('R', 'ログインしていない人は写真を開けない', '401', img2.status === 401, img2.status);

// ===== 問い合わせ =====
r = await j('POST', `/api/orders/${O3}/chat`, { body: '受け取り方法を教えてください' });
rec('C', '注文についてチャットで問い合わせできる', '201 または 200', r.status === 200 || r.status === 201, r.status);
r = await j('POST', `/api/orders/${O3}/chat`, { body: 'あ'.repeat(501) });
rec('C', '501 文字以上のメッセージは送れない', '400', r.status === 400, `${r.status} ${r.data.error}`);
const th = await j('GET', '/api/staff/chat?store=shop-001', undefined, { cookie: STAFF });
const thread = th.data.threads?.find((t) => t.orderNo === o.data.pickupNo) || th.data.threads?.[0];
r = await j('POST', `/api/staff/chat/${thread.id}`, { body: '店頭でお渡しします' }, { cookie: STAFF, headers: { Origin: new URL(B).origin } });
const msgs = await j('GET', `/api/orders/${O3}/chat?after=0`);
rec('C', 'スタッフの返信がお客様の画面に届く', '店舗スタッフのメッセージが表示される', msgs.data.messages?.some((m) => m.sender !== 'customer' && m.body === '店頭でお渡しします'), `${r.status} / ${msgs.data.messages?.length} 件`);
r = await j('POST', `/api/staff/chat/${thread.id}`, { body: 'x' }, { cookie: STAFF, headers: { Origin: 'https://evil.example' } });
rec('S', '他のサイトからの書き込み（CSRF）を拒否する', '403 forbidden', r.status === 403, `${r.status} ${r.data.error}`);

// ===== 管理画面（Web 削除済み）・API 認証 =====
r = await j('GET', '/staff');
rec('S', 'Web 版の店舗管理画面（/staff）は削除されており 404 を返す', '404', r.status === 404, r.status);
r = await j('GET', '/staff/login');
rec('S', 'Web 版のスタッフログイン画面（/staff/login）は削除されており 404 を返す', '404', r.status === 404, r.status);
r = await j('GET', '/api/staff/orders?store=shop-001');
rec('S', 'ログインしていないと管理用のデータは取れない', '401', r.status === 401, r.status);
r = await j('GET', '/api/staff/orders?store=shop-001', undefined, { cookie: 'staff_session=forged' });
rec('S', '偽のログイン情報では管理用のデータは取れない', '401', r.status === 401, r.status);
r = await j('GET', '/guide/staff');
rec('S', 'Web 版のスタッフ用ガイド（/guide/staff）は削除されており 404 を返す', '404', r.status === 404, r.status);
r = await j('GET', '/wiki');
rec('S', 'ページ一覧（/wiki）は、作品 wiki の「画面の一覧」へ移る（パスキーの確認なし）', '301 → /wiki/qr-order/#pages', r.status === 301 && new URL(r.loc || '', B).pathname === '/wiki/qr-order/' && (r.loc || '').endsWith('#pages'), `${r.status} → ${r.loc}`);
r = await j('POST', '/api/staff/products', { storeId: 'shop-001', name: 'テスト商品', price: 120, taxRate: 8 }, { cookie: STAFF, headers: { Origin: new URL(B).origin } });
rec('M', '一般スタッフは商品を登録できない（管理者のみ）', '403', r.status === 403, r.status);
r = await j('POST', '/api/staff/products', { storeId: 'shop-001', name: 'テスト商品', price: 120, taxRate: 8, barcode: '4901234567894' }, { cookie: ADMIN, headers: { Origin: new URL(B).origin } });
rec('M', '登録済みのバーコードと同じ商品は登録できない', '409', r.status === 409, `${r.status} ${r.data.error}`);
r = await j('POST', '/api/staff/products', { storeId: 'shop-001', name: 'テスト商品', price: 120, taxRate: 8 }, { cookie: ADMIN, headers: { Origin: new URL(B).origin } });
const P = r.data.id || r.data.product?.id;
rec('M', '管理者は商品を登録できる', '201', r.status === 201 || r.status === 200, `${r.status} ${P}`);
r = await j('POST', `/api/staff/products/${P}/availability`, { available: false }, { cookie: STAFF, headers: { Origin: new URL(B).origin } });
const ord = await newOrder([{ productId: P, qty: 1 }]);
rec('M', 'スタッフが販売を止めた商品は注文できない', '停止 200、注文 409', r.status === 200 && ord.status === 409, `停止 ${r.status} / 注文 ${ord.status} ${ord.data.error}`);
r = await j('DELETE', `/api/staff/products/${P}`, undefined, { cookie: ADMIN, headers: { Origin: new URL(B).origin } });
rec('M', '管理者は商品を削除できる', '200', r.status === 200, r.status);
r = await j('GET', '/api/staff/orders?store=shop-001', undefined, { cookie: STAFF });
rec('M', '注文一覧に支払い済みの注文と店舗からの距離が表示される', '支払い済みの注文あり、距離あり', r.status === 200 && JSON.stringify(r.data).includes('geoDistance'), `${r.status}`);

// ===== E：電子棚札 =====
/** JPEG の形式（ベースラインか、幅・高さ、色の間引きの有無）を読む */
function jpegInfo(buf) {
  for (let i = 2; i < buf.length - 9; ) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      const comps = buf[i + 9];
      const sampling = [...Array(comps)].map((_, k) => buf[i + 11 + k * 3]);
      return { baseline: marker === 0xc0, height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7), noSubsampling: sampling.every((v) => v === 0x11) };
    }
    i += 2 + len;
  }
  return null;
}
const eslImg = async (path, headers = {}) => { const res = await fetch(B + path, { headers }); return { status: res.status, type: res.headers.get('content-type'), etag: res.headers.get('etag'), buf: Buffer.from(await res.arrayBuffer()) }; };
let e1 = await eslImg('/esl/p-001.jpg');
const info = jpegInfo(e1.buf) || {};
rec('E', '棚札の画像は、ST-GR29000 の画面と同じ 296×128 のベースライン JPEG（色の間引きなし）', '296×128、ベースライン、4:4:4', e1.status === 200 && e1.type === 'image/jpeg' && info.width === 296 && info.height === 128 && info.baseline && info.noSubsampling, `${e1.status} ${info.width}×${info.height} baseline=${info.baseline} 4:4:4=${info.noSubsampling}`);
let e2 = await eslImg('/esl/p-001.jpg', { 'If-None-Match': e1.etag });
rec('E', '内容が変わっていなければ、同じ画像として 304 を返す（基地局の取り直しを減らす）', '304', e2.status === 304, e2.status);
sql("UPDATE products SET price = 190 WHERE id = 'p-001'");
e2 = await eslImg('/esl/p-001.jpg', { 'If-None-Match': e1.etag });
rec('E', '価格を変えると、新しい画像になる', '200、ETag が変わる', e2.status === 200 && e2.etag !== e1.etag, `${e2.status} ETag ${e2.etag === e1.etag ? '同じ' : '変化'}`);
sql("UPDATE products SET price = 180 WHERE id = 'p-001'");
await j('POST', '/api/staff/products/p-002/availability', { available: false }, { cookie: STAFF, headers: { Origin: new URL(B).origin } });
const off = await eslImg('/esl/p-002.jpg'); const on = await eslImg('/esl/p-003.jpg');
await j('POST', '/api/staff/products/p-002/availability', { available: true }, { cookie: STAFF, headers: { Origin: new URL(B).origin } });
rec('E', '無効にした商品の画像も返す（棚札に「販売停止」と表示）', '200 の JPEG', off.status === 200 && off.type === 'image/jpeg' && off.etag !== on.etag, off.status);
r = await j('GET', '/esl/p-zzz.jpg');
const bad = await j('GET', '/esl/..%2Fsecret.jpg');
rec('E', '存在しない商品・不正な名前には画像を返さない', '404', r.status === 404 && bad.status === 404, `${r.status} / ${bad.status}`);
r = await j('GET', '/p/p-003');
rec('E', '棚札の QR の短いアドレスは、その商品をカートに入れる画面へ移る', '302 → /s/shop-001?add=p-003', r.status === 302 && (r.loc || '').endsWith('/s/shop-001?add=p-003'), `${r.status} → ${(r.loc || '').replace(B, '')}`);


fs.writeFileSync(process.env.RESULTS_FILE, JSON.stringify(results, null, 1));
