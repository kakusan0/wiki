// テスト用の外部サービスの代わり（Stripe・Resend・LINE・商品情報）。本物には一切つながない。
// 送られたメール・LINE・返金は記録し、GET /__log で取り出せる。
import http from 'node:http';

const port = Number(process.env.FAKE_PORT || 4010);
const pis = new Map();
const log = { mails: [], line: [], refunds: [] };
let n = 0;

http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const form = new URLSearchParams(body);
  const send = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const u = new URL(req.url, 'http://x');

  // テストからの確認用
  if (u.pathname === '/__log') return send(log);

  // Stripe：決済の作成・取得・取消、支払い方法の設定、返金
  if (req.method === 'POST' && u.pathname === '/v1/payment_intents') {
    const pi = { id: 'pi_' + ++n, client_secret: 'cs_' + n, status: 'requires_payment_method', amount: Number(form.get('amount')), amount_received: 0, currency: form.get('currency'), metadata: { order_id: form.get('metadata[order_id]') } };
    pis.set(pi.id, pi);
    return send(pi);
  }
  const cancel = u.pathname.match(/^\/v1\/payment_intents\/(.+)\/cancel$/);
  if (cancel && pis.has(cancel[1])) { pis.get(cancel[1]).status = 'canceled'; return send(pis.get(cancel[1])); }
  const get = u.pathname.match(/^\/v1\/payment_intents\/(.+)$/);
  if (get && pis.has(get[1])) return send(pis.get(get[1]));
  if (u.pathname === '/v1/payment_method_configurations') {
    return send({ data: [{ is_default: true, parent: null, card: { available: true }, apple_pay: { available: true }, google_pay: { available: true }, link: { available: false }, paypay: { available: true } }] });
  }
  if (u.pathname === '/v1/refunds') {
    log.refunds.push({ amount: Number(form.get('amount')), paymentIntent: form.get('payment_intent'), idempotencyKey: req.headers['idempotency-key'] });
    return send({ id: 're_' + log.refunds.length, payment_intent: form.get('payment_intent') });
  }

  // Resend：メール
  if (u.pathname === '/emails') {
    const m = JSON.parse(body);
    log.mails.push({ to: m.to, subject: m.subject, text: m.text, html: m.html || '' });
    return send({ id: 'm' + log.mails.length });
  }

  // LINE
  if (u.pathname === '/v2/bot/message/push' || u.pathname === '/v2/bot/message/reply') {
    log.line.push(JSON.parse(body));
    return send({ sentMessages: [{ id: String(1000 + log.line.length), quoteToken: 'q' }] });
  }

  // 商品情報の検索（バーコードから商品名）
  if (u.pathname.startsWith('/api/v2/product/')) return send({ status: 0 });
  if (u.pathname.endsWith('/itemSearch')) return send({ hits: [] });

  send({ error: { message: 'not found' } }, 404);
}).listen(port, () => console.log('fake services on ' + port));
