import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import qrcode from 'qrcode-generator';
import staffHtml from './staff.html';
import loginHtml from './login.html';
import setupHtml from './setup.html';
import displayHtml from './display.html';
import guideStaffHtml from './guide-staff.html';
import wikiHtml from './wiki.html';
import { receiptHtml, returnAcceptedHtml } from './mail';
import { renderEsl } from './esl';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

type Env = {
  /** 1 つのサイトの中で公開するときのパスの頭（例 /qr-order）。入口の Worker が渡す */
  BASE_PATH?: string;
  DB: D1Database;
  ASSETS: Fetcher;
  STRIPE_SECRET_KEY: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  /** 最初の管理者になるメールアドレス。このアドレスは初回セットアップ時に自動で管理者として登録される */
  OWNER_EMAIL?: string;
  /** '1' の間だけ、OWNER_EMAIL のパスキーを確認コードで登録し直せる（端末紛失時の復旧用。済んだら削除する） */
  OWNER_RECOVERY?: string;
  /** メール送信（Resend）の API キーと差出人アドレス */
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  /** 任意。両方を設定すると注文作成時に Turnstile の確認を必須にする */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** 任意。支払済注文の保存日数（既定 2922 日 = 約8年） */
  ORDER_RETENTION_DAYS?: string;
  /** テスト用。通常は未設定 */
  STRIPE_API_BASE?: string;
  TURNSTILE_VERIFY_URL?: string;
  MAIL_API_BASE?: string;
  /** 返品・交換を申し込める期間（日）。既定 7 日 */
  RETURN_WINDOW_DAYS?: string;
  /** LINE 公式アカウント（Messaging API）のチャネルアクセストークンとチャネルシークレット。問い合わせチャットを LINE で受けるのに使う */
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_CHANNEL_SECRET?: string;
  LINE_API_BASE?: string;
  /** Android アプリの署名鍵の SHA-256 フィンガープリント（カンマ区切りで複数可）。設定すると、アプリがサイトを全画面で開ける */
  ANDROID_CERT_SHA256?: string;
  /** Android アプリのパッケージ名（カンマ区切り）。未設定なら android/app/build.gradle.kts の 2 つ */
  ANDROID_PACKAGES?: string;
  /** 任意。Yahoo!ショッピング商品検索 API の Client ID。設定するとバーコードから商品名を引ける範囲が広がる */
  YAHOO_CLIENT_ID?: string;
  YAHOO_API_BASE?: string;
  OFF_API_BASE?: string;
};

type Session = { id: string; username: string; role: 'admin' | 'staff'; /** パスキーで本人確認した時刻（ミリ秒） */ authAt: number };

type OrderRow = {
  id: string;
  store_id: string;
  status: 'pending' | 'paid' | 'handed_over' | 'refunded';
  total: number;
  payment_intent_id: string | null;
  pickup_no: number | null;
  created_at: string;
  paid_at: string | null;
  handed_over_at: string | null;
  handed_over_by: string | null;
  refunded_at: string | null;
  refunded_amount: number;
  age_check_required: number;
  age_checked_at: string | null;
  age_checked_by: string | null;
  geo_distance_m: number | null;
  geo_accuracy_m: number | null;
  receipt_email: string | null;
  receipt_sent_at: string | null;
  mail_token: string | null;
  origin: string | null;
};

type ItemRow = { order_id: string; name: string; unit_price: number; tax_rate: number; qty: number; age_restricted: number };

type PaymentIntent = {
  id: string;
  status: string;
  amount_received: number;
  currency: string;
  metadata?: Record<string, string>;
};

const MIN_AMOUNT_JPY = 50; // Stripe の JPY 最低決済額
const MAX_PRICE_JPY = 1_000_000;
const MAX_LINES = 50;
const MAX_QTY = 20;
const SESSION_COOKIE = 'staff_session';
const SESSION_HOURS = 12;
const PENDING_TTL_HOURS = 24;

const app = new Hono<{ Bindings: Env; Variables: { session: Session } }>();
type C = Context<{ Bindings: Env; Variables: { session: Session } }>;
/** このアプリの公開先のパスの頭（ないときは空） */
const bp = (c: { env: Env }) => c.env.BASE_PATH ?? '';
/** QR・メール・案内に入れる、このアプリの入口（オリジン＋パスの頭）。パスキーの確かめには使わない */
const site = (c: { env: Env; req: { url: string } }) => new URL(c.req.url).origin + bp(c);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

// ---------- 共通 ----------

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) =>
  [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
const randomHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const nowIso = () => new Date().toISOString();
/** 日本時間の日付（YYYY-MM-DD） */
const jstDate = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

// ---------- QR コードの定期更新 ----------
// 更新間隔ごとに変わる合言葉（トークン）を QR の URL に入れる。有効な QR を読み取ると「入店確認」が発行され、
// 更新が有効な店舗では、入店確認がないと注文できない（古い QR の写真や URL の使い回しを防ぐ）

type StoreQr = { id: string; name: string; qr_rotate_minutes: number; qr_secret: string };
const ROTATE_CHOICES = [0, 1, 5, 15, 60, 1440];
const PASS_HOURS = 3;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

async function getStoreQr(env: Env, id: string): Promise<StoreQr | null> {
  let row = await env.DB.prepare(`SELECT id, name, qr_rotate_minutes, qr_secret FROM stores WHERE id = ?`).bind(id).first<StoreQr>();
  if (row && !row.qr_secret) {
    await env.DB.prepare(`UPDATE stores SET qr_secret = ? WHERE id = ? AND qr_secret IS NULL`).bind(randomHex(32), id).run();
    row = await env.DB.prepare(`SELECT id, name, qr_rotate_minutes, qr_secret FROM stores WHERE id = ?`).bind(id).first<StoreQr>();
  }
  return row;
}

/** いまの時間枠（age = 0）または 1 つ前の時間枠（age = 1）の合言葉 */
async function qrToken(store: StoreQr, age = 0): Promise<string> {
  const window = Math.floor(Date.now() / (store.qr_rotate_minutes * 60_000)) - age;
  return (await hmacHex(store.qr_secret, `qr:${store.id}:${window}`)).slice(0, 20);
}

/** 切り替わった直後に読み取っても通るよう、1 つ前の QR までは有効にする */
async function validQrToken(store: StoreQr, token: unknown): Promise<boolean> {
  if (typeof token !== 'string' || token.length !== 20) return false;
  const t = enc.encode(token);
  return timingSafeEqual(t, enc.encode(await qrToken(store, 0))) || timingSafeEqual(t, enc.encode(await qrToken(store, 1)));
}

async function issuePass(store: StoreQr): Promise<{ pass: string; expiresAt: number }> {
  const expiresAt = Date.now() + PASS_HOURS * 3600_000;
  return { pass: `${expiresAt}.${(await hmacHex(store.qr_secret, `pass:${store.id}:${expiresAt}`)).slice(0, 32)}`, expiresAt };
}

async function validPass(store: StoreQr, pass: unknown): Promise<boolean> {
  if (typeof pass !== 'string') return false;
  const [exp, sig] = pass.split('.');
  if (!/^\d{13}$/.test(exp ?? '') || Number(exp) < Date.now() || (sig ?? '').length !== 32) return false;
  return timingSafeEqual(enc.encode(sig), enc.encode((await hmacHex(store.qr_secret, `pass:${store.id}:${exp}`)).slice(0, 32)));
}

/** QR に入れる URL。更新が有効なら合言葉を付ける */
async function qrUrl(origin: string, store: StoreQr, productId?: string): Promise<string> {
  const url = new URL(`${origin}/s/${encodeURIComponent(store.id)}`);
  if (productId) url.searchParams.set('add', productId);
  if (store.qr_rotate_minutes > 0) url.searchParams.set('t', await qrToken(store));
  return url.toString();
}

// ---------- 位置情報（GPS） ----------
// お客様の端末から送られた現在地を、店舗からの距離に変えて使う。位置そのもの（緯度・経度）は保存しない
const GEO_MAX_ACCURACY_M = 1000;
type Geo = { lat: number; lng: number; accuracy: number };
function parseGeo(v: unknown): Geo | null {
  const g = v as { lat?: unknown; lng?: unknown; accuracy?: unknown } | null;
  if (!g || typeof g.lat !== 'number' || typeof g.lng !== 'number' || typeof g.accuracy !== 'number') return null;
  if (!(Math.abs(g.lat) <= 90 && Math.abs(g.lng) <= 180 && g.accuracy >= 0 && g.accuracy <= 100_000)) return null;
  return { lat: g.lat, lng: g.lng, accuracy: g.accuracy };
}
/** 2 点間の距離（メートル） */
function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = 6_371_000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}
type StoreGeo = { lat: number | null; lng: number | null; geofence_m: number };
const storeGeo = (env: Env, id: string) => env.DB.prepare(`SELECT lat, lng, geofence_m FROM stores WHERE id = ?`).bind(id).first<StoreGeo>();
/** 店舗からの距離（店舗の位置が未設定なら null） */
const geoDistance = (store: StoreGeo | null, g: Geo) =>
  store && store.lat != null && store.lng != null ? Math.round(distanceM(store.lat, store.lng, g.lat, g.lng)) : null;

const clientIp = (c: C) => c.req.header('CF-Connecting-IP') ?? 'unknown';

/** 一定時間あたりの回数制限。上限を超えたら false */
async function rateLimit(env: Env, name: string, subject: string, limit: number, windowSec: number): Promise<boolean> {
  const nowSec = Math.floor(Date.now() / 1000);
  const window = Math.floor(nowSec / windowSec);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count`,
  )
    .bind(`${name}:${window}:${subject}`, (window + 2) * windowSec)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

// ---------- Stripe ----------

class StripeError extends Error {
  constructor(public status: number, public type: string, public code: string, detail = '') {
    super(`stripe ${status} ${type} ${code} ${detail}`.replace(/\s+/g, ' ').trim().slice(0, 300));
  }
}

async function stripe<T>(
  env: Env,
  method: 'GET' | 'POST',
  path: string,
  params?: Record<string, string>,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let body: string | undefined;
  if (params) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = new URLSearchParams(params).toString();
  }
  const base = env.STRIPE_API_BASE || 'https://api.stripe.com';
  const res = await fetch(`${base}/v1${path}`, { method, headers, body });
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; type?: string; code?: string; param?: string };
  };
  if (!res.ok) {
    console.error(`Stripe ${path} ${res.status}: ${json.error?.message ?? ''}`);
    // 認証エラー以外は、原因特定のため Stripe の説明文も残す（リクエスト内容の不備の説明で、鍵は含まれない）
    const detail = res.status === 401 ? '' : `param=${json.error?.param ?? ''} ${json.error?.message ?? ''}`;
    throw new StripeError(res.status, json.error?.type ?? '', json.error?.code ?? '', detail);
  }
  return json;
}

async function verifyStripeSignature(body: string, header: string | undefined, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  let t = '';
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    if (k === 'v1') sigs.push(v);
  }
  const ts = Number(t);
  if (!ts || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = enc.encode(hex(await crypto.subtle.sign('HMAC', key, enc.encode(`${t}.${body}`))));
  return sigs.some((s) => timingSafeEqual(enc.encode(s), expected));
}

// ---------- 注文 ----------

/** 決済成功を確認できた注文だけを「支払済」にし、注文番号を発行する。何度呼ばれても結果は同じ。 */
async function markPaid(env: Env, order: OrderRow, pi: PaymentIntent): Promise<void> {
  if (order.status !== 'pending') return;
  if (
    pi.status !== 'succeeded' ||
    pi.currency !== 'jpy' ||
    pi.amount_received !== order.total ||
    pi.metadata?.order_id !== order.id ||
    (order.payment_intent_id && order.payment_intent_id !== pi.id)
  ) {
    console.warn('payment does not match order', order.id, pi.id);
    return;
  }
  const upd = await env.DB.prepare(
    `UPDATE orders SET status = 'paid', paid_at = ?, payment_intent_id = ? WHERE id = ? AND status = 'pending'`,
  )
    .bind(nowIso(), pi.id, order.id)
    .run();
  if (upd.meta.changes !== 1) return; // 別のリクエストが先に処理済み
  // 注文番号は日本時間の日付が変わると 1 から振り直す
  const row = await env.DB.prepare(
    `UPDATE stores
     SET last_pickup_no = CASE WHEN pickup_date = ?1 THEN last_pickup_no % 999 + 1 ELSE 1 END, pickup_date = ?1
     WHERE id = ?2 RETURNING last_pickup_no`,
  )
    .bind(jstDate(), order.store_id)
    .first<{ last_pickup_no: number }>();
  await env.DB.prepare(`UPDATE orders SET pickup_no = ? WHERE id = ?`).bind(row!.last_pickup_no, order.id).run();
  await sendReceipt(env, order.id);
}

const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

/** メールのリンクに付ける合言葉（推測されない長さの乱数） */
const mailToken = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 古いメールのリンク（?m= の合言葉が今のものと違う）で開かれたか */
const staleMailLink = (order: { mail_token: string | null }, m: string | undefined) => !!m && m !== order.mail_token;

/** 購入完了メールを送る。二重送信しないよう先に送信済みの印を付け、失敗したら戻す（1時間ごとの定期処理が再送する） */
async function sendReceipt(env: Env, orderId: string): Promise<void> {
  const now = nowIso();
  const order = await env.DB.prepare(
    `UPDATE orders SET receipt_sent_at = ?, mail_token = COALESCE(mail_token, ?) WHERE id = ? AND status = 'paid' AND receipt_email IS NOT NULL AND receipt_sent_at IS NULL
     RETURNING id, store_id, total, pickup_no, paid_at, receipt_email, origin, age_check_required, mail_token`,
  )
    .bind(now, mailToken(), orderId)
    .first<{
      id: string;
      store_id: string;
      total: number;
      pickup_no: number | null;
      paid_at: string;
      receipt_email: string;
      origin: string | null;
      age_check_required: number;
      mail_token: string;
    }>();
  if (!order) return;
  const m = `?m=${order.mail_token}`;

  let sent = false;
  try {
    const store = await env.DB.prepare(`SELECT name, invoice_number FROM stores WHERE id = ?`)
      .bind(order.store_id)
      .first<{ name: string; invoice_number: string | null }>();
    const { results: items } = await env.DB.prepare(
      `SELECT order_id, name, unit_price, tax_rate, qty, age_restricted FROM order_items WHERE order_id = ?`,
    )
      .bind(order.id)
      .all<ItemRow>();
    const pickup = String(order.pickup_no ?? '').padStart(3, '0');
    const paidAt = new Date(order.paid_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'long', timeStyle: 'short' });
    const lines = [
      `${store!.name} でのご購入ありがとうございます。`,
      '',
      `注文番号: ${pickup}`,
      '',
      'お支払いが完了しました。購入の内容は、下記のページでも確認できます。',
      ...(order.origin ? [`${order.origin}/order/${order.id}${m}`] : []),
      ...(order.age_check_required ? ['', '年齢確認が必要な商品が含まれています。店舗スタッフに年齢の確認を受けてください。', '20 歳未満の者の飲酒・喫煙は法律で禁止されています。'] : []),
      '',
      '--- ご利用明細 ---',
      `店舗: ${store!.name}`,
      ...(store!.invoice_number ? [`登録番号: ${store!.invoice_number}`] : []),
      `取引日時: ${paidAt}`,
      `注文ID: ${order.id}`,
      '',
      ...items.map((i) => `${i.name}${i.tax_rate === 8 ? ' ※' : ''} × ${i.qty}  ${yen(i.unit_price * i.qty)}`),
      '',
      `合計（税込）: ${yen(order.total)}`,
      ...taxSummary(items).map((t) => `${t.rate}%対象 ${yen(t.subtotal)}（内消費税 ${yen(t.tax)}）`),
      ...(items.some((i) => i.tax_rate === 8) ? ['※は軽減税率（8%）対象商品です。'] : []),
      '',
      ...(order.origin ? [`商品に不良・誤りがあったときは、お支払いから ${returnWindowDays(env)} 日以内に、写真を添えて返品・交換を申し込めます（お客様のご都合による返品はお受けできません）。`, `${order.origin}/return/${order.id}${m}`, '', '返品の条件などは、下記の「特定商取引法に基づく表記」をご覧ください。', `${order.origin}/legal/tokushoho`, ''] : []),
      'このメールは、ご購入時に入力されたメールアドレスへ自動で送信しています。',
      'お心当たりがない場合は、このメールを破棄してください。',
    ];
    const html = receiptHtml({
      storeName: store!.name,
      invoiceNumber: store!.invoice_number,
      orderNo: pickup,
      orderId: order.id,
      paidAt,
      total: order.total,
      items: items.map((i) => ({ name: i.name, qty: i.qty, amount: i.unit_price * i.qty, reduced: i.tax_rate === 8 })),
      tax: taxSummary(items),
      ageCheck: order.age_check_required === 1,
      orderUrl: order.origin ? `${order.origin}/order/${order.id}${m}` : null,
      returnUrl: order.origin ? `${order.origin}/return/${order.id}${m}` : null,
      returnDays: returnWindowDays(env),
      legalUrl: order.origin ? `${order.origin}/legal/tokushoho` : null,
    });
    sent = await sendMail(env, order.receipt_email, `【${store!.name}】ご購入ありがとうございます（注文番号 ${pickup}）`, lines.join('\n'), html);
  } catch (e) {
    console.error(e);
  }
  // 送れたときは、返品・交換の受付メールを同じ宛先へ送るため、申込期限まで宛先を残す（定期処理が消去する）
  if (!sent) {
    await env.DB.prepare(`UPDATE orders SET receipt_sent_at = NULL WHERE id = ? AND receipt_sent_at = ?`).bind(order.id, now).run();
  }
}

function getOrder(env: Env, id: string) {
  return env.DB.prepare(`SELECT * FROM orders WHERE id = ?`).bind(id).first<OrderRow>();
}

/** 税率ごとの税込合計と内消費税（1注文・1税率につき端数処理1回、切り捨て） */
function taxSummary(items: ItemRow[]) {
  const byRate = new Map<number, number>();
  for (const it of items) byRate.set(it.tax_rate, (byRate.get(it.tax_rate) ?? 0) + it.unit_price * it.qty);
  return [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rate, subtotal]) => ({ rate, subtotal, tax: Math.floor((subtotal * rate) / (100 + rate)) }));
}

async function verifyTurnstile(env: Env, token: unknown, ip: string): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 4096) return false;
  try {
    const res = await fetch(env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY!, response: token, remoteip: ip }).toString(),
    });
    return ((await res.json()) as { success?: boolean }).success === true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

// ---------- 公開 API ----------

// Stripe ダッシュボードの「決済手段」で有効になっているもの。取得できなければ null（画面側は既定の一覧を使う）
const KNOWN_METHODS = ['card', 'apple_pay', 'google_pay', 'link', 'paypay'] as const;
let methodsCache: { at: number; methods: string[] | null } | null = null;
async function enabledPaymentMethods(env: Env): Promise<string[] | null> {
  if (methodsCache && Date.now() - methodsCache.at < 10 * 60_000) return methodsCache.methods;
  let methods: string[] | null = null;
  try {
    type Config = { is_default?: boolean; parent?: string | null } & Record<string, { available?: boolean } | unknown>;
    const res = await stripe<{ data: Config[] }>(env, 'GET', '/payment_method_configurations?limit=20');
    const cfg = res.data.find((c) => c.is_default && !c.parent) ?? res.data.find((c) => c.is_default) ?? res.data[0];
    if (cfg) methods = KNOWN_METHODS.filter((k) => (cfg[k] as { available?: boolean } | undefined)?.available === true);
    if (methods && methods.length === 0) methods = null; // 想定外の応答なら既定の一覧に任せる
  } catch (e) {
    console.error(e);
  }
  methodsCache = { at: Date.now(), methods };
  return methods;
}

app.get('/api/config', async (c) =>
  c.json({
    publishableKey: c.env.STRIPE_PUBLISHABLE_KEY ?? '',
    turnstileSiteKey: c.env.TURNSTILE_SECRET_KEY ? (c.env.TURNSTILE_SITE_KEY ?? '') : '',
    paymentMethods: await enabledPaymentMethods(c.env),
  }),
);

app.get('/api/stores/:id', async (c) => {
  const row = await c.env.DB.prepare(`SELECT id, name, qr_rotate_minutes FROM stores WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<{ id: string; name: string; qr_rotate_minutes: number }>();
  if (!row) return c.json({ error: 'store_not_found' }, 404);
  const store = { id: row.id, name: row.name, qrRotation: row.qr_rotate_minutes > 0 };
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, price, tax_rate AS taxRate, age_restricted AS ageRestricted, barcode
     FROM products WHERE store_id = ? AND available = 1 ORDER BY sort, id`,
  )
    .bind(store.id)
    .all<{ ageRestricted: number }>();
  return c.json({ store, products: results.map((p) => ({ ...p, ageRestricted: p.ageRestricted === 1 })) });
});

// 有効な QR（合言葉）と引き換えに入店確認を発行する
app.post('/api/stores/:id/pass', async (c) => {
  if (!(await rateLimit(c.env, 'pass', clientIp(c), 120, 300))) return c.json({ error: 'too_many_requests' }, 429);
  const store = await getStoreQr(c.env, c.req.param('id'));
  if (!store) return c.json({ error: 'store_not_found' }, 404);
  if (store.qr_rotate_minutes === 0) return c.json({ required: false });
  const body = (await c.req.json().catch(() => null)) as { t?: unknown } | null;
  if (!(await validQrToken(store, body?.t))) return c.json({ error: 'qr_expired' }, 403);
  return c.json({ required: true, ...(await issuePass(store)) });
});

app.post('/api/orders', async (c) => {
  // 同じ接続元からの注文作成は 5 分間に 30 回まで（店内 Wi-Fi の共用を考慮した上限）
  if (!(await rateLimit(c.env, 'order', clientIp(c), 30, 300))) return c.json({ error: 'too_many_requests' }, 429);

  const body = (await c.req.json().catch(() => null)) as
    | { storeId?: unknown; items?: unknown; ageConfirmed?: unknown; turnstileToken?: unknown; email?: unknown; pass?: unknown; geo?: unknown }
    | null;
  if (!body || typeof body.storeId !== 'string' || !Array.isArray(body.items)) return c.json({ error: 'bad_request' }, 400);
  // 購入完了メールの送付先（任意）。入力があるのに形式が不正な場合は、届かないまま進まないよう受け付けない
  const hasEmail = typeof body.email === 'string' && body.email.trim() !== '';
  const receiptEmail = hasEmail ? parseEmail(body.email) : '';
  if (hasEmail && !receiptEmail) return c.json({ error: 'bad_email' }, 400);

  const qty = new Map<string, number>();
  for (const it of body.items as { productId?: unknown; qty?: unknown }[]) {
    if (!it || typeof it.productId !== 'string' || !Number.isInteger(it.qty) || (it.qty as number) < 1) {
      return c.json({ error: 'bad_request' }, 400);
    }
    qty.set(it.productId, (qty.get(it.productId) ?? 0) + (it.qty as number));
  }
  if (qty.size === 0 || qty.size > MAX_LINES || [...qty.values()].some((q) => q > MAX_QTY)) {
    return c.json({ error: 'bad_request' }, 400);
  }

  if (c.env.TURNSTILE_SECRET_KEY && !(await verifyTurnstile(c.env, body.turnstileToken, clientIp(c)))) {
    return c.json({ error: 'verification_failed' }, 403);
  }

  const store = await getStoreQr(c.env, body.storeId);
  if (!store) return c.json({ error: 'store_not_found' }, 404);
  // QR の定期更新が有効な店舗では、有効な QR を読み取った端末からしか注文できない
  if (store.qr_rotate_minutes > 0 && !(await validPass(store, body.pass))) return c.json({ error: 'qr_expired' }, 403);

  // 位置情報は必須。店舗の位置が設定されていれば、店舗の近く（設定した範囲＋測位の誤差）でのみ注文できる
  const geo = parseGeo(body.geo);
  if (!geo) return c.json({ error: 'location_required' }, 400);
  if (geo.accuracy > GEO_MAX_ACCURACY_M) return c.json({ error: 'location_inaccurate' }, 400);
  const sg = await storeGeo(c.env, store.id);
  const geoDist = geoDistance(sg, geo);
  if (geoDist != null && geoDist > sg!.geofence_m + geo.accuracy) return c.json({ error: 'out_of_store' }, 403);

  // 金額は必ずサーバー側の価格から計算する
  const ids = [...qty.keys()];
  const { results: products } = await c.env.DB.prepare(
    `SELECT id, name, price, tax_rate, age_restricted FROM products
     WHERE store_id = ? AND available = 1 AND id IN (${ids.map(() => '?').join(',')})`,
  )
    .bind(store.id, ...ids)
    .all<{ id: string; name: string; price: number; tax_rate: number; age_restricted: number }>();
  if (products.length !== ids.length) return c.json({ error: 'product_unavailable' }, 409);

  const ageCheck = products.some((p) => p.age_restricted === 1);
  if (ageCheck && body.ageConfirmed !== true) return c.json({ error: 'age_confirmation_required' }, 400);

  const total = products.reduce((s, p) => s + p.price * qty.get(p.id)!, 0);
  if (total < MIN_AMOUNT_JPY) return c.json({ error: 'amount_too_small' }, 400);

  const orderId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO orders (id, store_id, total, created_at, age_check_required, receipt_email, origin, geo_distance_m, geo_accuracy_m) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(orderId, store.id, total, nowIso(), ageCheck ? 1 : 0, receiptEmail || null, site(c), geoDist, Math.round(geo.accuracy)),
    ...products.map((p) =>
      c.env.DB.prepare(
        `INSERT INTO order_items (order_id, product_id, name, unit_price, tax_rate, qty, age_restricted) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(orderId, p.id, p.name, p.price, p.tax_rate, qty.get(p.id)!, p.age_restricted),
    ),
  ]);

  // 利用できる決済手段は Stripe ダッシュボードの設定に従う。カード情報は当システムを通過しない
  let pi: { id: string; client_secret: string };
  try {
    pi = await stripe<{ id: string; client_secret: string }>(
      c.env,
      'POST',
      '/payment_intents',
      {
        amount: String(total),
        currency: 'jpy',
        'automatic_payment_methods[enabled]': 'true',
        description: `${store.name} 注文 ${orderId}`,
        'metadata[order_id]': orderId,
        'metadata[store_id]': store.id,
      },
      `order-${orderId}`,
    );
  } catch (e) {
    // 支払いを開始できなかった理由を残す（注文は未払いのまま。請求は発生しない）
    const reason = e instanceof StripeError ? e.message : 'stripe unreachable';
    await c.env.DB.prepare(`UPDATE orders SET payment_error = ? WHERE id = ?`).bind(reason, orderId).run();
    console.error(e);
    return c.json({ error: 'payment_provider_error' }, 502);
  }
  await c.env.DB.prepare(`UPDATE orders SET payment_intent_id = ? WHERE id = ?`).bind(pi.id, orderId).run();

  return c.json({ orderId, total, clientSecret: pi.client_secret }, 201);
});

/** 返品・交換の受付メールを、購入完了メールと同じ宛先へ送る */
async function sendReturnAccepted(
  env: Env,
  order: OrderRow,
  r: { id: string; code: string; reason: string; wanted: string; detail: string; token: string; storeName: string; photoCount: number; items: { name: string; qty: number }[] },
  to: string,
): Promise<boolean> {
  const pickup = String(order.pickup_no ?? '').padStart(3, '0');
  const reasonLabel: Record<string, string> = { defect: '商品の不良・破損・汚れ', wrong_item: '注文と違う商品だった', expired: '期限切れ・傷み・異物', other: 'その他' };
  const m = `?m=${r.token}`;
  const statusUrl = order.origin ? `${order.origin}/return/${order.id}${m}` : null;
  const orderUrl = order.origin ? `${order.origin}/order/${order.id}${m}` : null;
  const lines = [
    `${r.storeName} です。返品・交換のお申し込みを受け付けました。`,
    '',
    `受付番号: ${r.code}`,
    `注文番号: ${pickup}`,
    `ご希望: ${r.wanted === 'refund' ? '返金' : '同じ商品との交換'}`,
    `理由: ${reasonLabel[r.reason] ?? r.reason}`,
    '対象の商品:',
    ...r.items.map((i) => `  ${i.name} × ${i.qty}`),
    `写真: ${r.photoCount} 枚`,
    '',
    '店舗で内容を確認し、結果をお申し込みの画面でお知らせします。商品は捨てずに保管してください。',
    ...(statusUrl ? ['', '申し込みの状況:', statusUrl] : []),
    ...(orderUrl ? ['', '購入の証明:', orderUrl] : []),
    '',
    'このメールをお送りしたため、先にお送りした購入完了メールのリンクは使えなくなりました。今後はこのメールのリンクをお使いください。',
    '',
    'このメールは、ご購入時に入力されたメールアドレスへ自動で送信しています。',
  ];
  const html = returnAcceptedHtml({
    storeName: r.storeName, code: r.code, orderNo: pickup, wanted: r.wanted === 'refund' ? '返金' : '同じ商品との交換',
    reason: reasonLabel[r.reason] ?? r.reason, detail: r.detail, items: r.items, photoCount: r.photoCount, statusUrl, orderUrl,
  });
  return sendMail(env, to, `【${r.storeName}】返品・交換のお申し込みを受け付けました（受付番号 ${r.code}）`, lines.join('\n'), html);
}

app.get('/api/orders/:id', async (c) => {
  let order = await getOrder(c.env, c.req.param('id'));
  if (!order) return c.json({ error: 'order_not_found' }, 404);
  if (staleMailLink(order, c.req.query('m'))) return c.json({ error: 'mail_revoked', returnId: await latestReturnId(c.env, order.id) }, 410);

  // Webhook が遅れている/届かない場合に備え、未払いの間は Stripe に直接確認する
  if (order.status === 'pending' && order.payment_intent_id) {
    try {
      const pi = await stripe<PaymentIntent>(c.env, 'GET', `/payment_intents/${order.payment_intent_id}`);
      await markPaid(c.env, order, pi);
      order = (await getOrder(c.env, order.id))!;
    } catch (e) {
      console.error(e);
    }
  }

  const store = await c.env.DB.prepare(`SELECT name, invoice_number FROM stores WHERE id = ?`)
    .bind(order.store_id)
    .first<{ name: string; invoice_number: string | null }>();
  const { results: items } = await c.env.DB.prepare(
    `SELECT order_id, name, unit_price, tax_rate, qty, age_restricted FROM order_items WHERE order_id = ?`,
  )
    .bind(order.id)
    .all<ItemRow>();

  c.header('Cache-Control', 'no-store');
  return c.json({
    id: order.id,
    status: order.status,
    total: order.total,
    refundedAmount: order.refunded_amount,
    pickupNo: order.pickup_no,
    ageCheckRequired: order.age_check_required === 1,
    ageChecked: order.age_checked_at !== null,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    handedOverAt: order.handed_over_at,
    refundedAt: order.refunded_at,
    store: { id: order.store_id, name: store!.name, invoiceNumber: store!.invoice_number },
    items: items.map((i) => ({ name: i.name, unitPrice: i.unit_price, taxRate: i.tax_rate, qty: i.qty })),
    tax: taxSummary(items),
  });
});

// 決済画面で起きたエラーの内容を、原因調査のため未払いの注文に記録する
app.post('/api/orders/:id/client-error', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === 'string' ? body.message.replace(/\s+/g, ' ').slice(0, 300) : '';
  if (message) {
    await c.env.DB.prepare(`UPDATE orders SET payment_error = ? WHERE id = ? AND status = 'pending'`)
      .bind(`client: ${message}`, c.req.param('id'))
      .run();
  }
  return c.json({ ok: true });
});

app.post('/api/stripe/webhook', async (c) => {
  const raw = await c.req.text();
  if (!(await verifyStripeSignature(raw, c.req.header('Stripe-Signature'), c.env.STRIPE_WEBHOOK_SECRET))) {
    return c.json({ error: 'invalid_signature' }, 400);
  }
  const event = JSON.parse(raw) as { type: string; data: { object: PaymentIntent } };
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const orderId = pi.metadata?.order_id;
    const order = orderId ? await getOrder(c.env, orderId) : null;
    if (order) await markPaid(c.env, order, pi);
  }
  return c.json({ received: true });
});

// ---------- お問い合わせチャット（お客様は画面、店舗は LINE） ----------

const CHAT_MAX_LENGTH = 500;
const CHAT_RETENTION_DAYS = 90;
const LINK_CODE_MINUTES = 15;

type ThreadRow = { id: string; store_id: string; code: string; token_hash: string; order_id: string | null; created_at: string; last_message_at: string };

const lineEnabled = (env: Env) => !!(env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_CHANNEL_SECRET);

async function lineApi(env: Env, path: string, body: unknown): Promise<{ ok: boolean; json: { sentMessages?: { id: string }[] } }> {
  try {
    const res = await fetch(`${env.LINE_API_BASE || 'https://api.line.me'}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { sentMessages?: { id: string }[] };
    if (!res.ok) console.error('line api failed', path, res.status, JSON.stringify(json).slice(0, 300));
    return { ok: res.ok, json };
  } catch (e) {
    console.error(e);
    return { ok: false, json: {} };
  }
}
const lineText = (text: string) => ({ type: 'text', text: text.slice(0, 4900) });
const lineReply = (env: Env, replyToken: string, text: string) => lineApi(env, '/v2/bot/message/reply', { replyToken, messages: [lineText(text)] });

/** 見分けやすい 4 文字の番号（紛らわしい 0 O 1 I は使わない） */
function chatCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(4))].map((b) => chars[b % chars.length]).join('');
}

async function threadForCustomer(c: C): Promise<ThreadRow | null> {
  const token = c.req.header('X-Chat-Token') ?? '';
  if (!token) return null;
  const thread = await c.env.DB.prepare(`SELECT * FROM chat_threads WHERE id = ?`).bind(c.req.param('threadId')).first<ThreadRow>();
  if (!thread || !timingSafeEqual(enc.encode(hex(await sha256(token))), enc.encode(thread.token_hash))) return null;
  return thread;
}

const messageJson = (m: { id: number; sender: string; body: string; created_at: string }) => ({
  id: m.id,
  sender: m.sender,
  body: m.body,
  createdAt: m.created_at,
});

/** お客様のメッセージを保存し、店舗の LINE に知らせる（届かなくても保存し、管理画面から確認・返信できる） */
async function addCustomerMessage(
  env: Env,
  store: { id: string; name: string; line_target: string | null },
  thread: ThreadRow,
  first: boolean,
  text: string,
) {
  const now = nowIso();
  let lineMessageId: string | null = null;
  if (lineEnabled(env) && store.line_target) {
    const order = thread.order_id
      ? await env.DB.prepare(`SELECT pickup_no, total FROM orders WHERE id = ?`).bind(thread.order_id).first<{ pickup_no: number | null; total: number }>()
      : null;
    const orderLabel = order ? `注文番号 ${String(order.pickup_no ?? '').padStart(3, '0')}` : '注文の指定なし';
    const header = first
      ? `【お問い合わせ #${thread.code}】${store.name}\n${orderLabel}${order ? `（${yen(order.total)}）` : ''}\nこのメッセージに「リプライ」で返信すると、お客様の画面に届きます。`
      : `#${thread.code}（${orderLabel}）お客様より`;
    const sent = await lineApi(env, '/v2/bot/message/push', { to: store.line_target, messages: [lineText(`${header}\n――――――――\n${text}`)] });
    lineMessageId = sent.json.sentMessages?.[0]?.id ?? null;
  }
  const row = await env.DB.prepare(
    `INSERT INTO chat_messages (thread_id, sender, body, line_message_id, created_at) VALUES (?, 'customer', ?, ?, ?) RETURNING id, sender, body, created_at`,
  )
    .bind(thread.id, text, lineMessageId, now)
    .first<{ id: number; sender: string; body: string; created_at: string }>();
  await env.DB.prepare(`UPDATE chat_threads SET last_message_at = ? WHERE id = ?`).bind(now, thread.id).run();
  return messageJson(row!);
}

async function newThread(env: Env, storeId: string, orderId: string | null): Promise<{ thread: ThreadRow; token: string }> {
  const now = nowIso();
  const token = randomHex(24);
  const thread: ThreadRow = { id: crypto.randomUUID(), store_id: storeId, code: chatCode(), token_hash: hex(await sha256(token)), order_id: orderId, created_at: now, last_message_at: now };
  await env.DB.prepare(`INSERT INTO chat_threads (id, store_id, code, token_hash, order_id, created_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(thread.id, thread.store_id, thread.code, thread.token_hash, thread.order_id, now, now)
    .run();
  return { thread, token };
}

const chatText = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : '');
const storeForChat = (env: Env, id: string) =>
  env.DB.prepare(`SELECT id, name, line_target FROM stores WHERE id = ?`).bind(id).first<{ id: string; name: string; line_target: string | null }>();

// お客様：注文に紐づかない問い合わせ（端末が持つ合言葉でやり取りを引き継ぐ）
app.post('/api/stores/:id/chat', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { threadId?: unknown; token?: unknown; body?: unknown } | null;
  const text = chatText(body?.body);
  if (!text || text.length > CHAT_MAX_LENGTH) return c.json({ error: 'bad_request' }, 400);
  if (!(await rateLimit(c.env, 'chat', clientIp(c), 12, 300))) return c.json({ error: 'too_many_requests' }, 429);
  const store = await storeForChat(c.env, c.req.param('id'));
  if (!store) return c.json({ error: 'store_not_found' }, 404);

  let thread: ThreadRow | null = null;
  let token = typeof body?.token === 'string' ? body.token : '';
  if (typeof body?.threadId === 'string' && token) {
    const row = await c.env.DB.prepare(`SELECT * FROM chat_threads WHERE id = ? AND store_id = ? AND order_id IS NULL`).bind(body.threadId, store.id).first<ThreadRow>();
    if (row && timingSafeEqual(enc.encode(hex(await sha256(token))), enc.encode(row.token_hash))) thread = row;
  }
  const first = !thread;
  if (!thread) ({ thread, token } = await newThread(c.env, store.id, null));
  const message = await addCustomerMessage(c.env, store, thread, first, text);
  return c.json({ threadId: thread.id, token, code: thread.code, message }, 201);
});

// お客様：注文に紐づく問い合わせ。1 つの注文に 1 つのやり取り。注文 ID（購入の証明のリンク）があれば、どの端末からでも続きを開ける
async function orderThread(env: Env, orderId: string) {
  const order = await getOrder(env, orderId);
  if (!order || order.status === 'pending') return { order: null, thread: null };
  const thread = await env.DB.prepare(`SELECT * FROM chat_threads WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`).bind(order.id).first<ThreadRow>();
  return { order, thread };
}

app.get('/api/orders/:id/chat', async (c) => {
  const { order, thread } = await orderThread(c.env, c.req.param('id'));
  if (!order) return c.json({ error: 'order_not_found' }, 404);
  c.header('Cache-Control', 'no-store');
  if (!thread) return c.json({ code: null, orderNo: order.pickup_no, messages: [] });
  const after = Number(c.req.query('after')) || 0;
  const { results } = await c.env.DB.prepare(`SELECT id, sender, body, created_at FROM chat_messages WHERE thread_id = ? AND id > ? ORDER BY id LIMIT 200`)
    .bind(thread.id, after)
    .all<{ id: number; sender: string; body: string; created_at: string }>();
  return c.json({ code: thread.code, orderNo: order.pickup_no, messages: results.map(messageJson) });
});

app.post('/api/orders/:id/chat', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { body?: unknown } | null;
  const text = chatText(body?.body);
  if (!text || text.length > CHAT_MAX_LENGTH) return c.json({ error: 'bad_request' }, 400);
  if (!(await rateLimit(c.env, 'chat', clientIp(c), 12, 300))) return c.json({ error: 'too_many_requests' }, 429);
  let { order, thread } = await orderThread(c.env, c.req.param('id'));
  if (!order) return c.json({ error: 'order_not_found' }, 404);
  const store = await storeForChat(c.env, order.store_id);
  if (!store) return c.json({ error: 'store_not_found' }, 404);
  const first = !thread;
  if (!thread) ({ thread } = await newThread(c.env, store.id, order.id));
  const message = await addCustomerMessage(c.env, store, thread!, first, text);
  return c.json({ code: thread!.code, orderNo: order.pickup_no, message }, 201);
});

// お客様：やり取りを読む（端末が持つ合言葉が必要）
app.get('/api/chat/:threadId', async (c) => {
  const thread = await threadForCustomer(c);
  if (!thread) return c.json({ error: 'not_found' }, 404);
  const after = Number(c.req.query('after')) || 0;
  const { results } = await c.env.DB.prepare(
    `SELECT id, sender, body, created_at FROM chat_messages WHERE thread_id = ? AND id > ? ORDER BY id LIMIT 200`,
  )
    .bind(thread.id, after)
    .all<{ id: number; sender: string; body: string; created_at: string }>();
  c.header('Cache-Control', 'no-store');
  const order = thread.order_id ? await c.env.DB.prepare(`SELECT pickup_no FROM orders WHERE id = ?`).bind(thread.order_id).first<{ pickup_no: number | null }>() : null;
  return c.json({ code: thread.code, orderNo: order?.pickup_no ?? null, messages: results.map(messageJson) });
});

/** 店舗からの返信を保存する */
async function storeReply(env: Env, threadId: string, text: string): Promise<void> {
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO chat_messages (thread_id, sender, body, created_at) VALUES (?, 'store', ?, ?)`).bind(threadId, text.slice(0, 2000), now),
    env.DB.prepare(`UPDATE chat_threads SET last_message_at = ? WHERE id = ?`).bind(now, threadId),
  ]);
}

async function verifyLineSignature(body: string, signature: string | undefined, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  const expected = btoa(String.fromCharCode(...mac));
  return timingSafeEqual(enc.encode(signature), enc.encode(expected));
}

type LineEvent = {
  type: string;
  replyToken?: string;
  source?: { type?: string; groupId?: string; roomId?: string; userId?: string };
  message?: { type?: string; text?: string; quotedMessageId?: string };
};

// LINE からの通知：店舗スタッフの返信を、お客様のチャットに届ける
app.post('/api/line/webhook', async (c) => {
  const raw = await c.req.text();
  if (!lineEnabled(c.env) || !(await verifyLineSignature(raw, c.req.header('X-Line-Signature'), c.env.LINE_CHANNEL_SECRET!))) {
    return c.json({ error: 'invalid_signature' }, 400);
  }
  const events = ((JSON.parse(raw) as { events?: LineEvent[] }).events ?? []).slice(0, 20);
  for (const ev of events) {
    try {
      if (ev.type !== 'message' || ev.message?.type !== 'text' || !ev.replyToken) continue;
      const source = ev.source?.groupId ?? ev.source?.roomId ?? ev.source?.userId ?? '';
      const text = (ev.message.text ?? '').trim();
      if (!source || !text) continue;

      // 「連携 123456」：管理画面で発行したコードを送ると、このトークが店舗の通知先になる
      const link = text.match(/^連携[\s　]*([0-9]{6})$/);
      if (link) {
        const store = await c.env.DB.prepare(
          `UPDATE stores SET line_target = ?, line_link_code = NULL, line_link_expires = NULL
           WHERE line_link_code = ? AND line_link_expires > ? RETURNING name`,
        )
          .bind(source, link[1], nowIso())
          .first<{ name: string }>();
        await lineReply(c.env, ev.replyToken, store ? `${store.name} のお問い合わせを、このトークで受け取ります。` : '連携コードが違うか、期限が切れています。管理画面でコードを発行し直してください。');
        continue;
      }

      const store = await c.env.DB.prepare(`SELECT id FROM stores WHERE line_target = ?`).bind(source).first<{ id: string }>();
      if (!store) continue; // 連携していないトークの発言には反応しない

      // どの問い合わせへの返信か：①リプライした元のメッセージ ②先頭の #番号 ③直近 30 分で 1 件だけ
      let thread: ThreadRow | null = null;
      let reply = text;
      if (ev.message.quotedMessageId) {
        thread = await c.env.DB.prepare(
          `SELECT t.* FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id WHERE m.line_message_id = ? AND t.store_id = ?`,
        )
          .bind(ev.message.quotedMessageId, store.id)
          .first<ThreadRow>();
      }
      if (!thread) {
        const m = text.match(/^[#＃]\s*([A-Za-z0-9]{4})[\s　:：]+([\s\S]+)$/);
        if (m) {
          thread = await c.env.DB.prepare(`SELECT * FROM chat_threads WHERE store_id = ? AND code = ? ORDER BY last_message_at DESC LIMIT 1`)
            .bind(store.id, m[1].toUpperCase())
            .first<ThreadRow>();
          if (thread) reply = m[2].trim();
        }
      }
      if (!thread) {
        const { results } = await c.env.DB.prepare(`SELECT * FROM chat_threads WHERE store_id = ? AND last_message_at > ? ORDER BY last_message_at DESC LIMIT 2`)
          .bind(store.id, new Date(Date.now() - 30 * 60_000).toISOString())
          .all<ThreadRow>();
        if (results.length === 1) thread = results[0];
      }
      if (!thread) {
        await lineReply(c.env, ev.replyToken, 'どのお問い合わせへの返信か分かりませんでした。お客様のメッセージを長押しして「リプライ」で返信するか、先頭に「#番号 」を付けて送ってください（例: #K7QD ありがとうございます）。');
        continue;
      }
      await storeReply(c.env, thread.id, reply);
      await lineReply(c.env, ev.replyToken, `#${thread.code} のお客様に送信しました。`);
    } catch (e) {
      console.error(e);
    }
  }
  return c.json({ ok: true });
});

// ---------- スタッフのログイン（パスキーのみ。初回はメールの確認コード） ----------

type StaffRow = { id: string; email: string; role: Session['role']; active: number; setup_allowed: number };

const CODE_MINUTES = 10;
const CODE_MAX_ATTEMPTS = 5;
const CHALLENGE_MINUTES = 5;

const parseEmail = (v: unknown): string => {
  const email = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};
const ownerEmail = (env: Env) => parseEmail(env.OWNER_EMAIL);
const rp = (c: C) => {
  const u = new URL(c.req.url);
  return { rpID: u.hostname, origin: u.origin };
};
const codeHash = async (email: string, code: string) => hex(await sha256(`${email}:${code}`));

async function readSession(c: C): Promise<Session | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT s.expires_at, st.id, st.email, st.role, st.active
     FROM sessions s JOIN staff st ON st.email = s.username WHERE s.token_hash = ?`,
  )
    .bind(hex(await sha256(token)))
    .first<{ expires_at: string; id: string; email: string; role: Session['role']; active: number }>();
  // 無効化・削除されたアカウントは即時に使えなくなる
  if (!row || row.expires_at < nowIso() || row.active !== 1) return null;
  return { id: row.id, username: row.email, role: row.role === 'admin' ? 'admin' : 'staff', authAt: new Date(row.expires_at).getTime() - SESSION_HOURS * 3600_000 };
}

async function startSession(c: C, staff: { email: string; role: string }) {
  const token = randomHex(32);
  await c.env.DB.prepare(`INSERT INTO sessions (token_hash, username, role, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(hex(await sha256(token)), staff.email, staff.role, new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString())
    .run();
  setCookie(c, SESSION_COOKIE, token, { path: '/', httpOnly: true, secure: true, sameSite: 'Strict', maxAge: SESSION_HOURS * 3600 });
}

async function saveChallenge(env: Env, challenge: string, kind: string, staffId: string | null): Promise<string> {
  const id = randomHex(16);
  await env.DB.prepare(`INSERT INTO webauthn_challenges (id, challenge, kind, staff_id, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, challenge, kind, staffId, new Date(Date.now() + CHALLENGE_MINUTES * 60_000).toISOString())
    .run();
  return id;
}

/** 一時データを取り出して消す（1 回限り） */
async function takeChallenge(env: Env, id: unknown, kind: string) {
  if (typeof id !== 'string') return null;
  const row = await env.DB.prepare(`DELETE FROM webauthn_challenges WHERE id = ? AND kind = ? RETURNING challenge, staff_id, expires_at`)
    .bind(id, kind)
    .first<{ challenge: string; staff_id: string | null; expires_at: string }>();
  return row && row.expires_at >= nowIso() ? row : null;
}

/** メールを送る。html を渡すと、対応するメールソフトではそちらが表示される（text は非対応のソフト用） */
async function sendMail(env: Env, to: string, subject: string, text: string, html?: string): Promise<boolean> {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    console.error('mail is not configured (RESEND_API_KEY / MAIL_FROM)');
    return false;
  }
  try {
    const res = await fetch(`${env.MAIL_API_BASE || 'https://api.resend.com'}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, ...(html ? { html } : {}) }),
    });
    if (!res.ok) console.error('mail failed', res.status, (await res.text()).slice(0, 300));
    return res.ok;
  } catch (e) {
    console.error(e);
    return false;
  }
}

function deviceLabel(c: C): string {
  const ua = c.req.header('User-Agent') ?? '';
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : '端末';
  return `${device}（${jstDate()} 登録）`;
}

async function registrationOptions(c: C, staff: { id: string; email: string }, kind: string) {
  const { results: existing } = await c.env.DB.prepare(`SELECT id FROM passkeys WHERE staff_id = ?`).bind(staff.id).all<{ id: string }>();
  const options = await generateRegistrationOptions({
    rpName: '店舗管理',
    rpID: rp(c).rpID,
    userName: staff.email,
    userID: new Uint8Array(enc.encode(staff.id)) as Uint8Array<ArrayBuffer>,
    attestationType: 'none',
    excludeCredentials: existing.map((p) => ({ id: p.id })),
    // 端末に保存され、生体認証や画面ロックでの本人確認を必須にする
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  return { options, challengeId: await saveChallenge(c.env, options.challenge, kind, staff.id) };
}

/** 登録結果を検証してパスキーを保存する */
async function storePasskey(c: C, staffId: string, expectedChallenge: string, response: unknown): Promise<boolean> {
  let result;
  try {
    result = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: rp(c).origin,
      expectedRPID: rp(c).rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    console.error(e);
    return false;
  }
  if (!result.verified) return false;
  const cred = result.registrationInfo.credential;
  await c.env.DB.prepare(
    `INSERT INTO passkeys (id, staff_id, public_key, counter, transports, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(cred.id, staffId, hex(cred.publicKey), cred.counter, JSON.stringify(cred.transports ?? []), deviceLabel(c), nowIso())
    .run();
  return true;
}

// 手順 1：メールアドレスに確認コードを送る
app.post('/api/staff/setup/request', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
  const email = parseEmail(body?.email);
  if (!email) return c.json({ error: 'bad_request' }, 400);
  const okIp = await rateLimit(c.env, 'setup-ip', clientIp(c), 10, 900);
  const okEmail = await rateLimit(c.env, 'setup-email', email, 3, 900);
  if (!okIp || !okEmail) return c.json({ error: 'too_many_requests' }, 429);

  let staff = await c.env.DB.prepare(`SELECT * FROM staff WHERE email = ?`).bind(email).first<StaffRow>();
  const isOwner = email === ownerEmail(c.env);
  if (!staff && isOwner) {
    // 最初の管理者（OWNER_EMAIL）は初回セットアップ時に自動で登録する
    staff = { id: crypto.randomUUID(), email, role: 'admin', active: 1, setup_allowed: 1 };
    await c.env.DB.prepare(`INSERT INTO staff (id, email, role, created_at) VALUES (?, ?, 'admin', ?)`).bind(staff.id, email, nowIso()).run();
  }
  const eligible = !!staff && staff.active === 1 && (staff.setup_allowed === 1 || (isOwner && c.env.OWNER_RECOVERY === '1'));
  if (eligible) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    await c.env.DB.prepare(
      `INSERT INTO email_codes (email, code_hash, attempts, expires_at) VALUES (?1, ?2, 0, ?3)
       ON CONFLICT(email) DO UPDATE SET code_hash = ?2, attempts = 0, expires_at = ?3`,
    )
      .bind(email, await codeHash(email, code), new Date(Date.now() + CODE_MINUTES * 60_000).toISOString())
      .run();
    const sent = await sendMail(
      c.env,
      email,
      '【店舗管理】確認コード',
      `店舗管理画面のセットアップ用の確認コードです。\n\n確認コード: ${code}\n\n有効期限は ${CODE_MINUTES} 分です。このコードは誰にも教えないでください。\n心当たりがない場合は、このメールを破棄してください。`,
    );
    if (!sent) return c.json({ error: 'mail_failed' }, 502);
  }
  // 登録の有無を外から判別できないよう、対象外のアドレスでも同じ応答を返す
  return c.json({ ok: true });
});

// 手順 2：確認コードを照合し、パスキー登録に進む
app.post('/api/staff/setup/verify', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown; code?: unknown } | null;
  const email = parseEmail(body?.email);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!email || !/^\d{6}$/.test(code)) return c.json({ error: 'invalid_code' }, 401);
  if (!(await rateLimit(c.env, 'setup-verify-ip', clientIp(c), 20, 900))) return c.json({ error: 'too_many_requests' }, 429);

  const row = await c.env.DB.prepare(`SELECT code_hash, attempts, expires_at FROM email_codes WHERE email = ?`)
    .bind(email)
    .first<{ code_hash: string; attempts: number; expires_at: string }>();
  if (!row || row.expires_at < nowIso() || row.attempts >= CODE_MAX_ATTEMPTS) {
    await c.env.DB.prepare(`DELETE FROM email_codes WHERE email = ?`).bind(email).run();
    return c.json({ error: 'invalid_code' }, 401);
  }
  if (!timingSafeEqual(enc.encode(await codeHash(email, code)), enc.encode(row.code_hash))) {
    await c.env.DB.prepare(`UPDATE email_codes SET attempts = attempts + 1 WHERE email = ?`).bind(email).run();
    return c.json({ error: 'invalid_code' }, 401);
  }
  await c.env.DB.prepare(`DELETE FROM email_codes WHERE email = ?`).bind(email).run(); // コードは 1 回限り
  const staff = await c.env.DB.prepare(`SELECT * FROM staff WHERE email = ? AND active = 1`).bind(email).first<StaffRow>();
  if (!staff) return c.json({ error: 'invalid_code' }, 401);
  return c.json(await registrationOptions(c, staff, 'setup'));
});

// 手順 3：パスキーを登録してログインする
app.post('/api/staff/setup/finish', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { challengeId?: unknown; response?: unknown } | null;
  const ch = await takeChallenge(c.env, body?.challengeId, 'setup');
  const staff = ch?.staff_id
    ? await c.env.DB.prepare(`SELECT * FROM staff WHERE id = ? AND active = 1`).bind(ch.staff_id).first<StaffRow>()
    : null;
  if (!ch || !staff || !(await storePasskey(c, staff.id, ch.challenge, body?.response))) {
    return c.json({ error: 'registration_failed' }, 400);
  }
  await c.env.DB.prepare(`UPDATE staff SET setup_allowed = 0 WHERE id = ?`).bind(staff.id).run(); // 以後はパスキーのみ
  await startSession(c, staff);
  return c.json({ ok: true });
});

// ログイン：パスキーのみ
app.post('/api/staff/login/options', async (c) => {
  if (!(await rateLimit(c.env, 'login-ip', clientIp(c), 30, 900))) return c.json({ error: 'too_many_requests' }, 429);
  const options = await generateAuthenticationOptions({ rpID: rp(c).rpID, userVerification: 'required' });
  return c.json({ options, challengeId: await saveChallenge(c.env, options.challenge, 'login', null) });
});

app.post('/api/staff/login/verify', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { challengeId?: unknown; response?: AuthenticationResponseJSON } | null;
  const ch = await takeChallenge(c.env, body?.challengeId, 'login');
  const credId = typeof body?.response?.id === 'string' ? body.response.id : '';
  const key = credId
    ? await c.env.DB.prepare(
        `SELECT p.id, p.public_key, p.counter, p.transports, st.email, st.role
         FROM passkeys p JOIN staff st ON st.id = p.staff_id WHERE p.id = ? AND st.active = 1`,
      )
        .bind(credId)
        .first<{ id: string; public_key: string; counter: number; transports: string | null; email: string; role: string }>()
    : null;
  if (!ch || !key || !body?.response) return c.json({ error: 'login_failed' }, 401);
  let result;
  try {
    result = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: ch.challenge,
      expectedOrigin: rp(c).origin,
      expectedRPID: rp(c).rpID,
      credential: { id: key.id, publicKey: fromHex(key.public_key) as Uint8Array<ArrayBuffer>, counter: key.counter },
      requireUserVerification: true,
    });
  } catch (e) {
    console.error(e);
    return c.json({ error: 'login_failed' }, 401);
  }
  if (!result.verified) return c.json({ error: 'login_failed' }, 401);
  await c.env.DB.prepare(`UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?`)
    .bind(result.authenticationInfo.newCounter, nowIso(), key.id)
    .run();
  await startSession(c, key);
  return c.json({ ok: true });
});

app.post('/api/staff/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(hex(await sha256(token))).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

app.get('/staff/setup', (c) => c.html(setupHtml, 200, { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }));
app.get('/staff/login', (c) => c.html(loginHtml, 200, { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }));

// スタッフ用の操作ガイド：管理画面にログインしている人だけに見せる（未ログインならログイン後にここへ戻す）
app.get('/guide/staff', async (c) => {
  if (!(await readSession(c))) return c.redirect('/staff/login?next=' + encodeURIComponent(bp(c) + '/guide/staff'));
  return c.html(guideStaffHtml, 200, { 'Cache-Control': 'private, no-store', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex' });
});
app.get('/guide/staff.html', (c) => c.redirect('/guide/staff', 301));

// ページ一覧：開くたびにパスキーでの本人確認を求める（ログイン済みでも、確認から 5 分を過ぎていれば確認し直す）
const WIKI_REAUTH_MS = 5 * 60_000;
app.get('/wiki', async (c) => {
  const session = await readSession(c);
  if (!session || Date.now() - session.authAt > WIKI_REAUTH_MS) return c.redirect('/staff/login?reauth=1&next=' + encodeURIComponent(bp(c) + '/wiki'));
  return c.html(wikiHtml, 200, { 'Cache-Control': 'private, no-store', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex' });
});
app.get('/wiki.html', (c) => c.redirect('/wiki', 301));

// 画面：未ログインならログイン画面へ
app.use('/staff', async (c, next) => {
  const session = await readSession(c);
  if (!session) return c.redirect('/staff/login');
  c.set('session', session);
  await next();
});
app.use('/staff/*', async (c, next) => {
  const session = await readSession(c);
  if (!session) return c.text('Unauthorized', 401);
  c.set('session', session);
  await next();
});
// API：ログイン必須。書き込みは同じサイトからの操作に限る（CSRF 対策）
app.use('/api/staff/*', async (c, next) => {
  const session = await readSession(c);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  if (c.req.method !== 'GET') {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: 'forbidden' }, 403);
  }
  c.set('session', session);
  await next();
});
const adminOnly = createMiddleware<{ Bindings: Env; Variables: { session: Session } }>(async (c, next) => {
  if (c.get('session').role !== 'admin') return c.json({ error: 'admin_only' }, 403);
  await next();
});

app.get('/staff', (c) => c.html(staffHtml, 200, { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }));
app.get('/api/staff/me', (c) => c.json(c.get('session')));

// ---------- スタッフ：注文 ----------

function qrSvg(c: C, url: string) {
  const qr = qrcode(0, 'M');
  qr.addData(url);
  qr.make();
  // 定期更新される QR が古いまま表示されないよう、保存させない
  return c.body(qr.createSvgTag({ cellSize: 8, margin: 32, scalable: true }), 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
}

// お客様画面（カート）の URL。QR の定期更新が有効なら、いま使える合言葉付きの URL を返す
app.get('/api/staff/stores/:id/customer-url', async (c) => {
  const store = await getStoreQr(c.env, c.req.param('id'));
  if (!store) return c.json({ error: 'store_not_found' }, 404);
  c.header('Cache-Control', 'no-store');
  return c.json({ url: await qrUrl(site(c), store), rotateMinutes: store.qr_rotate_minutes });
});

// ---------- 電子棚札（OpenEPaperLink） ----------
// 棚札の QR に入れる短いアドレス。QR を小さくでき、棚札の小さな画面でも読み取りやすい。
// 読み取ると、その商品をカートに入れるお客様画面へ移る
app.get('/p/:productId', async (c) => {
  const p = await c.env.DB.prepare(`SELECT id, store_id FROM products WHERE id = ?`).bind(c.req.param('productId')).first<{ id: string; store_id: string }>();
  if (!p) return c.redirect('/', 302);
  return c.redirect(`/s/${encodeURIComponent(p.store_id)}?add=${encodeURIComponent(p.id)}`, 302);
});

// 棚札に表示する画像（296×128 の JPEG）。基地局が「7 - Image URL」で定期的に取りに来る。
// 商品名・価格・販売状態が変わらなければ同じ画像（同じ ETag）を返し、作り直しも書き換えもしない
app.get('/esl/:file', async (c) => {
  const m = c.req.param('file').match(/^([A-Za-z0-9_-]{1,64})\.jpg$/);
  if (!m) return c.text('not found', 404);
  const p = await c.env.DB.prepare(`SELECT id, name, price, tax_rate, age_restricted, available FROM products WHERE id = ?`)
    .bind(m[1])
    .first<{ id: string; name: string; price: number; tax_rate: number; age_restricted: number; available: number }>();
  if (!p) return c.text('not found', 404);
  const input = {
    name: p.name, price: p.price, taxRate: p.tax_rate, ageRestricted: p.age_restricted === 1, available: p.available === 1,
    qrText: `${site(c)}/p/${p.id}`,
  };
  const etag = '"' + hex(await sha256('esl-v2|' + JSON.stringify(input))).slice(0, 32) + '"';
  const headers = { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304, headers);
  // 同じ内容の画像は、Cloudflare のキャッシュから返す（作り直しの処理を減らす）
  const cache = (caches as unknown as { default: Cache }).default;
  const key = new Request(`https://esl-cache.invalid/${p.id}/${etag.slice(1, -1)}`);
  const hit = await cache.match(key);
  if (hit) return c.body(await hit.arrayBuffer(), 200, headers);
  const jpg = renderEsl(input);
  c.executionCtx.waitUntil(cache.put(key, new Response(jpg, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=2592000' } })));
  return c.body(jpg, 200, headers);
});

app.get('/staff/qr.svg', async (c) => {
  const store = await getStoreQr(c.env, c.req.query('store') ?? '');
  if (!store) return c.text('store not found', 404);
  c.header('X-QR-Rotate-Minutes', String(store.qr_rotate_minutes));
  return qrSvg(c, await qrUrl(site(c), store));
});

// 商品QR：読み取ると注文画面が開き、その商品がカートに入る
app.get('/staff/product-qr.svg', async (c) => {
  const product = await c.env.DB.prepare(`SELECT id, store_id FROM products WHERE id = ?`)
    .bind(c.req.query('id') ?? '')
    .first<{ id: string; store_id: string }>();
  const store = product ? await getStoreQr(c.env, product.store_id) : null;
  if (!product || !store) return c.text('product not found', 404);
  return qrSvg(c, await qrUrl(site(c), store, product.id));
});

// 入口のタブレットなどに映しておく、店舗 QR の表示専用画面
app.get('/staff/display', (c) => c.html(displayHtml, 200, { 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' }));

app.get('/api/staff/stores', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, name, qr_rotate_minutes AS qrRotateMinutes, lat, lng, geofence_m AS geofence FROM stores ORDER BY id`).all();
  return c.json({ stores: results });
});

// 店舗の位置（購入時の GPS の確認に使う）。管理者が店舗の中で「この端末の現在地」を登録する
app.post('/api/staff/stores/:id/location', adminOnly, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { geo?: unknown; radius?: unknown; clear?: unknown } | null;
  const radius = body?.radius;
  if (typeof radius !== 'number' || ![50, 100, 200, 300, 500, 1000].includes(radius)) return c.json({ error: 'bad_request' }, 400);
  if (body?.clear === true) {
    await c.env.DB.prepare(`UPDATE stores SET lat = NULL, lng = NULL, geofence_m = ? WHERE id = ?`).bind(radius, c.req.param('id')).run();
    return c.json({ ok: true });
  }
  // 地図で選んだ位置（accuracy 0）、または店内で測った現在地（誤差 200m 以内）
  const geo = body?.geo === undefined ? null : parseGeo(body.geo);
  if (body?.geo !== undefined && (!geo || geo.accuracy > 200)) return c.json({ error: 'location_inaccurate' }, 400);
  const res = geo
    ? await c.env.DB.prepare(`UPDATE stores SET lat = ?, lng = ?, geofence_m = ? WHERE id = ?`).bind(geo.lat, geo.lng, radius, c.req.param('id')).run()
    : await c.env.DB.prepare(`UPDATE stores SET geofence_m = ? WHERE id = ?`).bind(radius, c.req.param('id')).run();
  if (res.meta.changes !== 1) return c.json({ error: 'store_not_found' }, 404);
  return c.json({ ok: true });
});

// 地図アプリの共有用の短いリンク（maps.app.goo.gl など）を展開して、緯度・経度を読み取る（管理者のみ）
const MAP_HOSTS = /^(maps\.app\.goo\.gl|goo\.gl|maps\.google\.[a-z.]+|www\.google\.[a-z.]+|google\.[a-z.]+|maps\.apple\.com)$/i;
function latLngFromMapUrl(u: string): { lat: number; lng: number } | null {
  let s = u;
  try { s = decodeURIComponent(u); } catch { /* そのまま */ }
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  for (const re of [new RegExp('!3d' + num + '!4d' + num), new RegExp('[?&](?:q|query|ll|center)=' + num + '\\s*,\\s*' + num), new RegExp('@' + num + ',' + num)]) {
    const m = s.match(re);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) return { lat, lng };
    }
  }
  return null;
}
app.get('/api/staff/geo/resolve', adminOnly, async (c) => {
  let url: URL;
  try { url = new URL(c.req.query('url') ?? ''); } catch { return c.json({ error: 'bad_url' }, 400); }
  for (let hop = 0; hop < 6; hop++) {
    if (url.protocol !== 'https:' || !MAP_HOSTS.test(url.hostname)) return c.json({ error: 'unsupported_host' }, 400);
    const found = latLngFromMapUrl(url.toString());
    if (found) return c.json(found);
    let res: Response;
    try { res = await fetch(url.toString(), { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; qr-order)' }, signal: AbortSignal.timeout(6000) }); }
    catch { return c.json({ error: 'fetch_failed' }, 502); }
    const loc = res.headers.get('Location');
    if (!loc) {
      // 転送されない場合は、ページの中に書かれた位置を探す
      const html = (await res.text()).slice(0, 400_000);
      const m = html.match(/center=(-?\d{1,3}\.\d+)%2C(-?\d{1,3}\.\d+)/) || html.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/);
      if (m) return c.json({ lat: Number(m[1]), lng: Number(m[2]) });
      return c.json({ error: 'not_found' }, 404);
    }
    url = new URL(loc, url);
  }
  return c.json({ error: 'not_found' }, 404);
});

// QR コードの更新間隔（分）。0 で更新しない
app.post('/api/staff/stores/:id/qr-rotation', adminOnly, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { minutes?: unknown } | null;
  if (typeof body?.minutes !== 'number' || !ROTATE_CHOICES.includes(body.minutes)) return c.json({ error: 'bad_request' }, 400);
  const res = await c.env.DB.prepare(`UPDATE stores SET qr_rotate_minutes = ? WHERE id = ?`).bind(body.minutes, c.req.param('id')).run();
  if (res.meta.changes !== 1) return c.json({ error: 'store_not_found' }, 404);
  return c.json({ ok: true });
});

app.get('/api/staff/orders', async (c) => {
  const storeId = c.req.query('store') ?? '';
  const { results: orders } = await c.env.DB.prepare(
    // 支払いが済んだ注文を新しい順に。年齢確認待ちは古くても必ず含める
    `SELECT * FROM (SELECT * FROM orders WHERE store_id = ?1 AND status != 'pending' ORDER BY paid_at DESC LIMIT 100)
     UNION
     SELECT * FROM orders WHERE store_id = ?1 AND status IN ('paid', 'handed_over') AND age_check_required = 1 AND age_checked_at IS NULL
     ORDER BY paid_at DESC`,
  )
    .bind(storeId)
    .all<OrderRow>();
  let items: ItemRow[] = [];
  if (orders.length) {
    const res = await c.env.DB.prepare(
      `SELECT order_id, name, unit_price, tax_rate, qty, age_restricted FROM order_items
       WHERE order_id IN (${orders.map(() => '?').join(',')})`,
    )
      .bind(...orders.map((o) => o.id))
      .all<ItemRow>();
    items = res.results;
  }
  c.header('Cache-Control', 'no-store');
  return c.json({
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      total: o.total,
      refundedAmount: o.refunded_amount,
      pickupNo: o.pickup_no,
      paidAt: o.paid_at,
      handedOverAt: o.handed_over_at,
      handedOverBy: o.handed_over_by,
      refundedAt: o.refunded_at,
      ageCheckRequired: o.age_check_required === 1,
      ageCheckedAt: o.age_checked_at,
      ageCheckedBy: o.age_checked_by,
      geoDistance: o.geo_distance_m,
      geoAccuracy: o.geo_accuracy_m,
      items: items
        .filter((i) => i.order_id === o.id)
        .map((i) => ({ name: i.name, qty: i.qty, ageRestricted: i.age_restricted === 1 })),
    })),
  });
});

// 年齢確認商品を含む注文に、スタッフが年齢を確認した記録を付ける
app.post('/api/staff/orders/:id/age-check', async (c) => {
  const res = await c.env.DB.prepare(
    `UPDATE orders SET age_checked_at = ?, age_checked_by = ?
     WHERE id = ? AND status IN ('paid', 'handed_over') AND age_check_required = 1 AND age_checked_at IS NULL`,
  )
    .bind(nowIso(), c.get('session').username, c.req.param('id'))
    .run();
  if (res.meta.changes !== 1) return c.json({ error: 'not_applicable' }, 409);
  return c.json({ ok: true });
});

type RefundResult = { ok: true; refunded: number; remaining: number } | { ok: false; status: 400 | 404 | 409 | 502; error: string; remaining?: number };

/** 返金（全額・一部）。注文額を超えないよう先に枠を確保してから決済会社に依頼し、失敗したら枠を戻す */
async function refundOrder(env: Env, orderId: string, amountIn: unknown, requestIdIn: unknown, staff: string): Promise<RefundResult> {
  const order = await getOrder(env, orderId);
  if (!order) return { ok: false, status: 404, error: 'order_not_found' };
  if ((order.status !== 'paid' && order.status !== 'handed_over') || !order.payment_intent_id) {
    return { ok: false, status: 409, error: 'not_refundable' };
  }
  const remaining = order.total - order.refunded_amount;
  const amount = amountIn === undefined || amountIn === null ? remaining : amountIn;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1 || amount > remaining) {
    return { ok: false, status: 400, error: 'bad_amount', remaining };
  }
  const requestId = typeof requestIdIn === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(requestIdIn) ? requestIdIn : crypto.randomUUID();

  // 同じ操作（同じ識別子）がすでに記録されていれば、その結果を返す（通信の再送などで二重に返金しない）
  const already = async () => {
    const prev = await env.DB.prepare(`SELECT amount FROM refunds WHERE order_id = ? AND request_id = ?`).bind(order.id, requestId).first<{ amount: number }>();
    if (!prev) return null;
    const cur = await getOrder(env, order.id);
    return { ok: true as const, refunded: prev.amount, remaining: cur ? cur.total - cur.refunded_amount : 0 };
  };
  const done = await already();
  if (done) return done;

  // 返金の記録（識別子は注文ごとに一意）と、返金額の確保を、まとめて行う
  const refundId = crypto.randomUUID();
  const now = nowIso();
  try {
    const [, reserve] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO refunds (id, order_id, amount, staff, created_at, request_id) VALUES (?, ?, ?, ?, ?, ?)`).bind(refundId, order.id, amount, staff, now, requestId),
      env.DB.prepare(
        `UPDATE orders SET refunded_amount = refunded_amount + ?1
         WHERE id = ?2 AND status IN ('paid', 'handed_over') AND refunded_amount + ?1 <= total`,
      ).bind(amount, order.id),
    ]);
    if (reserve.meta.changes !== 1) {
      await env.DB.prepare(`DELETE FROM refunds WHERE id = ?`).bind(refundId).run();
      return { ok: false, status: 409, error: 'not_refundable' };
    }
  } catch (e) {
    // 同じ識別子の操作が同時に届いた（先に届いた方が処理している）
    const prev = await already();
    if (prev) return prev;
    throw e;
  }

  try {
    await stripe(env, 'POST', '/refunds', { payment_intent: order.payment_intent_id, amount: String(amount) }, `refund-${order.id}-${requestId}`);
  } catch (e) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE orders SET refunded_amount = refunded_amount - ? WHERE id = ?`).bind(amount, order.id),
      env.DB.prepare(`DELETE FROM refunds WHERE id = ?`).bind(refundId),
    ]);
    console.error(e);
    return { ok: false, status: 502, error: 'payment_provider_error' };
  }

  await env.DB.batch([
    // 全額を返金し終えたら「返金済」にする
    env.DB.prepare(
      `UPDATE orders SET refunded_at = ?1, status = CASE WHEN refunded_amount >= total THEN 'refunded' ELSE status END WHERE id = ?2`,
    ).bind(now, order.id),
  ]);
  return { ok: true, refunded: amount, remaining: remaining - amount };
}

// 返金（全額・一部）。管理者のみ
app.post('/api/staff/orders/:id/refund', adminOnly, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { amount?: unknown; requestId?: unknown } | null;
  const r = await refundOrder(c.env, c.req.param('id'), body?.amount, body?.requestId, c.get('session').username);
  if (!r.ok) return c.json({ error: r.error, ...(r.remaining !== undefined ? { remaining: r.remaining } : {}) }, r.status);
  return c.json({ ok: true, refunded: r.refunded, remaining: r.remaining });
});

// ---------- 返品・交換の申請（商品の不良・誤りなど。メールのボタンや購入の証明の画面から） ----------

const RETURN_REASONS = ['defect', 'wrong_item', 'expired', 'other'] as const;
const RETURN_PHOTO_KINDS = ['whole', 'defect', 'label', 'other'] as const;
const RETURN_MAX_PHOTOS = 5;
const RETURN_MIN_PHOTOS = 2;
const RETURN_PHOTO_MAX_BYTES = 600_000;
const RETURN_RETENTION_DAYS = 90;
const returnWindowDays = (env: Env) => Math.min(Math.max(Number(env.RETURN_WINDOW_DAYS) || 7, 1), 90);

type ReturnRow = {
  id: string; order_id: string; store_id: string; code: string; reason: string; detail: string; wanted: string; status: string;
  resolution: string | null; refund_amount: number; staff_note: string | null; decided_by: string | null; decided_at: string | null; geo_distance_m: number | null; geo_accuracy_m: number | null;
  completed_at: string | null; created_at: string;
};

/** この注文で、まだ返品・交換の申請に使える数量（却下されたものは数えない） */
async function returnableItems(env: Env, orderId: string) {
  const { results } = await env.DB.prepare(
    `SELECT oi.product_id AS productId, oi.name, oi.unit_price AS unitPrice, oi.qty,
            oi.qty - COALESCE((SELECT SUM(ri.qty) FROM return_items ri JOIN returns r ON r.id = ri.return_id
                               WHERE r.order_id = oi.order_id AND ri.product_id = oi.product_id AND r.status != 'rejected'), 0) AS available
     FROM order_items oi WHERE oi.order_id = ?`,
  )
    .bind(orderId)
    .all<{ productId: string; name: string; unitPrice: number; qty: number; available: number }>();
  return results;
}

const returnJson = async (env: Env, r: ReturnRow) => {
  const { results: items } = await env.DB.prepare(`SELECT name, qty, unit_price AS unitPrice FROM return_items WHERE return_id = ?`).bind(r.id).all();
  return {
    id: r.id, code: r.code, reason: r.reason, detail: r.detail, wanted: r.wanted, status: r.status, resolution: r.resolution,
    refundAmount: r.refund_amount, staffNote: r.staff_note, createdAt: r.created_at, decidedAt: r.decided_at, completedAt: r.completed_at, items,
  };
};

// お客様：この注文の返品・交換の状況と、申請できる商品
app.get('/api/orders/:id/returns', async (c) => {
  const order = await getOrder(c.env, c.req.param('id'));
  if (!order || order.status === 'pending') return c.json({ error: 'order_not_found' }, 404);
  if (staleMailLink(order, c.req.query('m'))) return c.json({ error: 'mail_revoked' }, 410);
  const days = returnWindowDays(c.env);
  const deadline = new Date(new Date(order.paid_at ?? order.created_at).getTime() + days * 86400_000);
  const store = await c.env.DB.prepare(`SELECT name FROM stores WHERE id = ?`).bind(order.store_id).first<{ name: string }>();
  const { results: rows } = await c.env.DB.prepare(`SELECT * FROM returns WHERE order_id = ? ORDER BY created_at DESC LIMIT 20`).bind(order.id).all<ReturnRow>();
  const items = await returnableItems(c.env, order.id);
  c.header('Cache-Control', 'no-store');
  return c.json({
    store: { id: order.store_id, name: store?.name ?? '' },
    orderNo: order.pickup_no,
    total: order.total,
    paidAt: order.paid_at,
    refunded: order.status === 'refunded',
    windowDays: days,
    deadline: deadline.toISOString(),
    open: Date.now() <= deadline.getTime() && order.status !== 'refunded',
    items,
    returns: await Promise.all(rows.map((r) => returnJson(c.env, r))),
  });
});

const latestReturnId = async (env: Env, orderId: string) =>
  (await env.DB.prepare(`SELECT id FROM returns WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`).bind(orderId).first<{ id: string }>())?.id ?? null;

/** base64 の写真が JPEG か（先頭だけを見る。全体を展開すると処理時間の上限を超えることがある） */
const isJpegBase64 = (b64: string) => b64.startsWith('/9j/');
/** base64 の長さから元のバイト数を求める */
const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

/** base64 を元のバイト列に戻す（スタッフが写真を開くとき用） */
function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// お客様：返品・交換を申し込む
app.post('/api/orders/:id/returns', async (c) => {
  if (!(await rateLimit(c.env, 'return', clientIp(c), 6, 3600))) return c.json({ error: 'too_many_requests' }, 429);
  const order = await getOrder(c.env, c.req.param('id'));
  if (!order || order.status === 'pending') return c.json({ error: 'order_not_found' }, 404);
  if (order.status === 'refunded') return c.json({ error: 'already_refunded' }, 409);
  const deadline = new Date(order.paid_at ?? order.created_at).getTime() + returnWindowDays(c.env) * 86400_000;
  if (Date.now() > deadline) return c.json({ error: 'window_closed' }, 409);

  const body = (await c.req.json().catch(() => null)) as {
    reason?: unknown; detail?: unknown; wanted?: unknown; agree?: unknown; items?: unknown; photos?: unknown; geo?: unknown;
  } | null;
  const geo = parseGeo(body?.geo);
  if (!geo) return c.json({ error: 'location_required' }, 400);
  if (geo.accuracy > GEO_MAX_ACCURACY_M) return c.json({ error: 'location_inaccurate' }, 400);
  const reason = RETURN_REASONS.find((r) => r === body?.reason);
  const wanted = body?.wanted === 'refund' || body?.wanted === 'exchange' ? body.wanted : null;
  const detail = typeof body?.detail === 'string' ? body.detail.replace(/\r\n?/g, '\n').trim() : '';
  if (detail.length < 5) return c.json({ error: 'detail_too_short' }, 400);
  if (detail.length > 1000) return c.json({ error: 'detail_too_long' }, 400);
  if (!reason || !wanted || body?.agree !== true || !Array.isArray(body?.items) || !Array.isArray(body?.photos)) {
    return c.json({ error: 'bad_request' }, 400);
  }

  // 商品と数量：この注文にあり、まだ申請していない数量まで
  const available = new Map((await returnableItems(c.env, order.id)).map((i) => [i.productId, i]));
  const chosen = new Map<string, number>();
  for (const it of body.items as { productId?: unknown; qty?: unknown }[]) {
    if (!it || typeof it.productId !== 'string' || !Number.isInteger(it.qty) || (it.qty as number) < 1) return c.json({ error: 'bad_request' }, 400);
    chosen.set(it.productId, (chosen.get(it.productId) ?? 0) + (it.qty as number));
  }
  if (chosen.size === 0 || [...chosen].some(([id, q]) => !available.has(id) || q > available.get(id)!.available)) return c.json({ error: 'items_unavailable' }, 409);

  // 写真：端末で縮小した JPEG だけを受け付ける
  const photos = (body.photos as { kind?: unknown; data?: unknown }[]).slice(0, RETURN_MAX_PHOTOS + 1);
  if (photos.length > RETURN_MAX_PHOTOS || photos.length < RETURN_MIN_PHOTOS) return c.json({ error: 'photos_required', min: RETURN_MIN_PHOTOS }, 400);
  const decoded: { kind: string; data: string }[] = [];
  for (const ph of photos) {
    const kind = RETURN_PHOTO_KINDS.find((k) => k === ph?.kind);
    if (!kind || typeof ph.data !== 'string' || ph.data.length % 4 !== 0 || !isJpegBase64(ph.data) || !/^[A-Za-z0-9+/]+={0,2}$/.test(ph.data)) return c.json({ error: 'bad_photo' }, 400);
    if (base64Bytes(ph.data) > RETURN_PHOTO_MAX_BYTES) return c.json({ error: 'photo_too_large' }, 400);
    decoded.push({ kind, data: ph.data });
  }
  if (!decoded.some((p) => p.kind === 'whole')) return c.json({ error: 'photos_required', min: RETURN_MIN_PHOTOS }, 400);

  // 同じ注文で同時に進められるのは 3 件まで
  const open = await c.env.DB.prepare(`SELECT count(*) AS n FROM returns WHERE order_id = ? AND status IN ('submitted', 'approved')`).bind(order.id).first<{ n: number }>();
  if ((open?.n ?? 0) >= 3) return c.json({ error: 'too_many_open' }, 409);

  const id = crypto.randomUUID();
  const code = 'R' + chatCode().slice(0, 3);
  const now = nowIso();
  // 購入完了メールを送っていれば、そのメールのリンクを無効にし、新しい合言葉で受付メールを送る
  const mailTo = order.receipt_email && order.receipt_sent_at ? order.receipt_email : null;
  const token = mailTo ? mailToken() : null;
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO returns (id, order_id, store_id, code, reason, detail, wanted, created_at, geo_distance_m, geo_accuracy_m) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, order.id, order.store_id, code, reason, detail, wanted, now, geoDistance(await storeGeo(c.env, order.store_id), geo), Math.round(geo.accuracy)),
      ...[...chosen].map(([productId, qty]) =>
        c.env.DB.prepare(`INSERT INTO return_items (return_id, product_id, name, unit_price, qty) VALUES (?, ?, ?, ?, ?)`).bind(
          id, productId, available.get(productId)!.name, available.get(productId)!.unitPrice, qty,
        ),
      ),
      ...decoded.map((p) => c.env.DB.prepare(`INSERT INTO return_photos (return_id, kind, data, created_at) VALUES (?, ?, ?, ?)`).bind(id, p.kind, p.data, now)),
      ...(token ? [c.env.DB.prepare(`UPDATE orders SET mail_token = ? WHERE id = ?`).bind(token, order.id)] : []),
    ]);
  } catch (e) {
    console.error('return save failed', e);
    return c.json({ error: 'save_failed' }, 500);
  }

  // 店舗の LINE に知らせる（届かなくても申請は保存済み）
  const store = await c.env.DB.prepare(`SELECT name, line_target FROM stores WHERE id = ?`).bind(order.store_id).first<{ name: string; line_target: string | null }>();
  if (lineEnabled(c.env) && store?.line_target) {
    const labels: Record<string, string> = { defect: '商品の不良・破損', wrong_item: '違う商品', expired: '期限切れ・傷み', other: 'その他' };
    await lineApi(c.env, '/v2/bot/message/push', {
      to: store.line_target,
      messages: [lineText(`【返品・交換の申請 ${code}】${store.name}\n注文番号 ${String(order.pickup_no ?? '').padStart(3, '0')}\n理由: ${labels[reason]}\nご希望: ${wanted === 'refund' ? '返金' : '交換'}\n写真 ${decoded.length} 枚\n管理画面の「返品」で確認してください。`)],
    });
  }
  let mailed = false;
  if (mailTo && token) {
    try {
      mailed = await sendReturnAccepted(c.env, order, { id, code, reason, wanted, detail, token, storeName: store?.name ?? '', photoCount: decoded.length,
        items: [...chosen].map(([pid, qty]) => ({ name: available.get(pid)!.name, qty })) }, mailTo);
    } catch (e) {
      console.error(e);
    }
  }
  return c.json({ id, code, mailed }, 201);
});

// ---------- スタッフ：返品・交換 ----------

app.get('/api/staff/returns', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, o.pickup_no AS orderNo, o.total AS orderTotal, o.refunded_amount AS orderRefunded
     FROM returns r JOIN orders o ON o.id = r.order_id WHERE r.store_id = ? ORDER BY CASE r.status WHEN 'submitted' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 60`,
  )
    .bind(c.req.query('store') ?? '')
    .all<ReturnRow & { orderNo: number | null; orderTotal: number; orderRefunded: number }>();
  const out = [];
  for (const r of results) {
    const { results: photos } = await c.env.DB.prepare(`SELECT id, kind FROM return_photos WHERE return_id = ? ORDER BY id`).bind(r.id).all();
    out.push({ ...(await returnJson(c.env, r)), orderNo: r.orderNo, orderTotal: r.orderTotal, orderRefundable: r.orderTotal - r.orderRefunded, orderId: r.order_id, decidedBy: r.decided_by, geoDistance: r.geo_distance_m, geoAccuracy: r.geo_accuracy_m, photos });
  }
  c.header('Cache-Control', 'no-store');
  return c.json({ returns: out });
});

app.get('/api/staff/returns/:id/photos/:photoId', async (c) => {
  const row = await c.env.DB.prepare(`SELECT data FROM return_photos WHERE id = ? AND return_id = ?`).bind(c.req.param('photoId'), c.req.param('id')).first<{ data: string }>();
  if (!row) return c.text('not found', 404);
  return c.body(fromBase64(row.data), 200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
});

// 承認・却下（管理者のみ）。承認は「返金」か「交換」のどちらで対応するかを決める
app.post('/api/staff/returns/:id/decide', adminOnly, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { decision?: unknown; note?: unknown } | null;
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 500) : '';
  const decision = body?.decision;
  if (decision !== 'refund' && decision !== 'exchange' && decision !== 'reject') return c.json({ error: 'bad_request' }, 400);
  if (decision === 'reject' && !note) return c.json({ error: 'note_required' }, 400);
  const res = await c.env.DB.prepare(
    `UPDATE returns SET status = ?, resolution = ?, staff_note = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'submitted'`,
  )
    .bind(decision === 'reject' ? 'rejected' : 'approved', decision === 'reject' ? null : decision, note || null, c.get('session').username, nowIso(), c.req.param('id'))
    .run();
  if (res.meta.changes !== 1) return c.json({ error: 'not_pending' }, 409);
  return c.json({ ok: true });
});

// 商品を回収したら完了にする。返金のときは、ここで決済会社に返金を依頼する（管理者のみ）
app.post('/api/staff/returns/:id/complete', adminOnly, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { amount?: unknown; requestId?: unknown } | null;
  const ret = await c.env.DB.prepare(`SELECT * FROM returns WHERE id = ?`).bind(c.req.param('id')).first<ReturnRow>();
  if (!ret || ret.status !== 'approved') return c.json({ error: 'not_approved' }, 409);
  let refunded = 0;
  if (ret.resolution === 'refund') {
    const sum = (await c.env.DB.prepare(`SELECT COALESCE(SUM(unit_price * qty), 0) AS n FROM return_items WHERE return_id = ?`).bind(ret.id).first<{ n: number }>())?.n ?? 0;
    const r = await refundOrder(c.env, ret.order_id, body?.amount ?? sum, body?.requestId ?? `ret-${ret.id}`, c.get('session').username);
    if (!r.ok) return c.json({ error: r.error, ...(r.remaining !== undefined ? { remaining: r.remaining } : {}) }, r.status);
    refunded = r.refunded;
  }
  await c.env.DB.prepare(`UPDATE returns SET status = 'completed', completed_at = ?, refund_amount = ? WHERE id = ? AND status = 'approved'`).bind(nowIso(), refunded, ret.id).run();
  return c.json({ ok: true, refunded });
});

// ---------- スタッフ：商品 ----------

app.get('/api/staff/products', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, price, tax_rate AS taxRate, available, age_restricted AS ageRestricted, barcode
     FROM products WHERE store_id = ? ORDER BY sort, id`,
  )
    .bind(c.req.query('store') ?? '')
    .all<{ available: number; ageRestricted: number }>();
  c.header('Cache-Control', 'no-store');
  return c.json({
    products: results.map((p) => ({ ...p, available: p.available === 1, ageRestricted: p.ageRestricted === 1 })),
  });
});

/** バーコード（8・12・13 桁）のチェックデジットが正しいか */
function validBarcode(s: string): boolean {
  if (!/^(\d{8}|\d{12,13})$/.test(s)) return false;
  const d = [...s].map(Number);
  const check = d.pop()!;
  const sum = d.reverse().reduce((a, n, i) => a + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const isUniqueViolation = (e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

/** 商品の入力内容を検証する。不正なら null */
function parseProduct(
  body: { name?: unknown; price?: unknown; taxRate?: unknown; ageRestricted?: unknown; barcode?: unknown } | null,
) {
  const barcode = typeof body?.barcode === 'string' ? body.barcode.trim() : '';
  if (barcode && !validBarcode(barcode)) return null;
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const price = body?.price;
  const taxRate = body?.taxRate;
  if (
    !name ||
    name.length > 60 ||
    typeof price !== 'number' ||
    !Number.isInteger(price) ||
    price < MIN_AMOUNT_JPY || // 1点でも決済できる金額にする
    price > MAX_PRICE_JPY ||
    (taxRate !== 8 && taxRate !== 10)
  ) {
    return null;
  }
  return { name, price, taxRate, ageRestricted: body?.ageRestricted === true ? 1 : 0, barcode: barcode || null };
}

app.post('/api/staff/products', adminOnly, async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { storeId?: unknown; name?: unknown; price?: unknown; taxRate?: unknown; ageRestricted?: unknown; barcode?: unknown }
    | null;
  const product = parseProduct(body);
  if (!product || typeof body?.storeId !== 'string') return c.json({ error: 'bad_request' }, 400);
  const store = await c.env.DB.prepare(`SELECT id FROM stores WHERE id = ?`).bind(body.storeId).first();
  if (!store) return c.json({ error: 'store_not_found' }, 404);
  const id = 'p-' + randomHex(6);
  try {
    await c.env.DB.prepare(
      `INSERT INTO products (id, store_id, name, price, tax_rate, age_restricted, barcode, available, sort)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, (SELECT COALESCE(MAX(sort), 0) + 1 FROM products WHERE store_id = ?2))`,
    )
      .bind(id, body.storeId, product.name, product.price, product.taxRate, product.ageRestricted, product.barcode)
      .run();
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: 'barcode_taken' }, 409);
    throw e;
  }
  return c.json({ id }, 201);
});

// 編集。QR コード（商品ID）は変わらない。過去の注文は注文時点の名前・価格のまま残る
app.put('/api/staff/products/:id', adminOnly, async (c) => {
  const product = parseProduct(await c.req.json().catch(() => null));
  if (!product) return c.json({ error: 'bad_request' }, 400);
  let res;
  try {
    res = await c.env.DB.prepare(
      `UPDATE products SET name = ?, price = ?, tax_rate = ?, age_restricted = ?, barcode = ? WHERE id = ?`,
    )
      .bind(product.name, product.price, product.taxRate, product.ageRestricted, product.barcode, c.req.param('id'))
      .run();
  } catch (e) {
    if (isUniqueViolation(e)) return c.json({ error: 'barcode_taken' }, 409);
    throw e;
  }
  if (res.meta.changes !== 1) return c.json({ error: 'product_not_found' }, 404);
  return c.json({ ok: true });
});

// 削除。過去の注文の明細は商品名・価格を写しで持っているので影響しない
app.delete('/api/staff/products/:id', adminOnly, async (c) => {
  const res = await c.env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(c.req.param('id')).run();
  if (res.meta.changes !== 1) return c.json({ error: 'product_not_found' }, 404);
  return c.json({ ok: true });
});

// バーコードから商品情報を調べる（外部の商品データベースに問い合わせる。送るのはバーコードの数字だけ）
type ProductInfo = { name: string; referencePrice: number | null; source: string };

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`lookup ${new URL(url).hostname} ${res.status}`);
  return res.json();
}

const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 60) : '');

/** Open Food Facts：食品・飲料の公開データベース（登録不要） */
async function lookupOpenFoodFacts(env: Env, code: string): Promise<ProductInfo | null> {
  const base = env.OFF_API_BASE || 'https://world.openfoodfacts.org';
  const json = (await fetchJson(`${base}/api/v2/product/${code}.json?fields=product_name,product_name_ja,brands,quantity`, {
    'User-Agent': 'qr-order/1.0',
  })) as { status?: number; product?: { product_name?: string; product_name_ja?: string; brands?: string; quantity?: string } };
  if (json.status !== 1 || !json.product) return null;
  const base_name = cleanName(json.product.product_name_ja) || cleanName(json.product.product_name);
  if (!base_name) return null;
  const quantity = cleanName(json.product.quantity);
  const name = cleanName(quantity && !base_name.includes(quantity) ? `${base_name} ${quantity}` : base_name);
  return { name, referencePrice: null, source: 'Open Food Facts' };
}

/** Yahoo!ショッピング：出品されている商品の名称と価格（Client ID が必要） */
async function lookupYahoo(env: Env, code: string): Promise<ProductInfo | null> {
  if (!env.YAHOO_CLIENT_ID) return null;
  const base = env.YAHOO_API_BASE || 'https://shopping.yahooapis.jp';
  const url = `${base}/ShoppingWebService/V3/itemSearch?appid=${encodeURIComponent(env.YAHOO_CLIENT_ID)}&jan_code=${code}&results=5&sort=-score`;
  const json = (await fetchJson(url)) as { hits?: { name?: string; price?: number }[] };
  const hit = (json.hits ?? []).find((h) => cleanName(h.name));
  if (!hit) return null;
  const prices = (json.hits ?? []).map((h) => h.price).filter((n): n is number => typeof n === 'number' && n > 0);
  // 出品タイトルに付く宣伝文句（【送料無料】など）は商品名ではないので外す
  const name = cleanName((hit.name ?? '').replace(/【[^】]*】|\[[^\]]*\]|送料無料|ポイント\d+倍/g, ' ')) || cleanName(hit.name);
  return { name, referencePrice: prices.length ? Math.min(...prices) : null, source: 'Yahoo!ショッピング' };
}

app.get('/api/staff/barcode-lookup', adminOnly, async (c) => {
  const code = c.req.query('code') ?? '';
  if (!validBarcode(code)) return c.json({ error: 'bad_request' }, 400);
  if (!(await rateLimit(c.env, 'lookup', c.get('session').id, 120, 3600))) return c.json({ error: 'too_many_requests' }, 429);
  for (const lookup of [lookupOpenFoodFacts, lookupYahoo]) {
    try {
      const info = await lookup(c.env, code);
      if (info) return c.json({ found: true, ...info });
    } catch (e) {
      console.error(e); // 片方が落ちていても、もう片方で探す
    }
  }
  return c.json({ found: false });
});

// 有効・無効（品切れ対応）は一般スタッフも切り替えられる
app.post('/api/staff/products/:id/availability', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { available?: unknown } | null;
  if (typeof body?.available !== 'boolean') return c.json({ error: 'bad_request' }, 400);
  const res = await c.env.DB.prepare(`UPDATE products SET available = ? WHERE id = ?`)
    .bind(body.available ? 1 : 0, c.req.param('id'))
    .run();
  if (res.meta.changes !== 1) return c.json({ error: 'product_not_found' }, 404);
  return c.json({ ok: true });
});

// ---------- スタッフ：お問い合わせ ----------

app.get('/api/staff/chat', async (c) => {
  const storeId = c.req.query('store') ?? '';
  const store = await c.env.DB.prepare(`SELECT line_target, line_link_code, line_link_expires FROM stores WHERE id = ?`)
    .bind(storeId)
    .first<{ line_target: string | null; line_link_code: string | null; line_link_expires: string | null }>();
  if (!store) return c.json({ error: 'store_not_found' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.code, t.last_message_at AS lastMessageAt, o.pickup_no AS orderNo,
            (SELECT body FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS lastBody,
            (SELECT sender FROM chat_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS lastSender
     FROM chat_threads t LEFT JOIN orders o ON o.id = t.order_id
     WHERE t.store_id = ? ORDER BY t.last_message_at DESC LIMIT 50`,
  )
    .bind(storeId)
    .all();
  const codeValid = !!store.line_link_code && !!store.line_link_expires && store.line_link_expires > nowIso();
  c.header('Cache-Control', 'no-store');
  return c.json({
    line: { configured: lineEnabled(c.env), linked: !!store.line_target, linkCode: codeValid ? store.line_link_code : null },
    threads: results,
  });
});

app.get('/api/staff/chat/:threadId', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, sender, body, created_at FROM chat_messages WHERE thread_id = ? ORDER BY id LIMIT 500`)
    .bind(c.req.param('threadId'))
    .all<{ id: number; sender: string; body: string; created_at: string }>();
  c.header('Cache-Control', 'no-store');
  return c.json({ messages: results.map(messageJson) });
});

// 管理画面からも返信できる（LINE を使えないとき用）
app.post('/api/staff/chat/:threadId', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { body?: unknown } | null;
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text || text.length > 2000) return c.json({ error: 'bad_request' }, 400);
  const thread = await c.env.DB.prepare(`SELECT id FROM chat_threads WHERE id = ?`).bind(c.req.param('threadId')).first();
  if (!thread) return c.json({ error: 'not_found' }, 404);
  await storeReply(c.env, c.req.param('threadId'), text);
  return c.json({ ok: true });
});

// LINE との連携コードを発行する（LINE のトークで「連携 123456」と送ると通知先になる）
app.post('/api/staff/stores/:id/line-link', adminOnly, async (c) => {
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  const res = await c.env.DB.prepare(`UPDATE stores SET line_link_code = ?, line_link_expires = ? WHERE id = ?`)
    .bind(code, new Date(Date.now() + LINK_CODE_MINUTES * 60_000).toISOString(), c.req.param('id'))
    .run();
  if (res.meta.changes !== 1) return c.json({ error: 'store_not_found' }, 404);
  return c.json({ code, minutes: LINK_CODE_MINUTES });
});

app.delete('/api/staff/stores/:id/line-link', adminOnly, async (c) => {
  await c.env.DB.prepare(`UPDATE stores SET line_target = NULL, line_link_code = NULL, line_link_expires = NULL WHERE id = ?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------- スタッフ：自分のパスキー ----------

app.get('/api/staff/passkeys', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, label, created_at AS createdAt, last_used_at AS lastUsedAt FROM passkeys WHERE staff_id = ? ORDER BY created_at`,
  )
    .bind(c.get('session').id)
    .all();
  return c.json({ passkeys: results });
});

// 2 台目以降の端末を追加する（ログイン中の本人のみ）
app.post('/api/staff/passkeys/options', async (c) => {
  const s = c.get('session');
  return c.json(await registrationOptions(c, { id: s.id, email: s.username }, 'add'));
});

app.post('/api/staff/passkeys/verify', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { challengeId?: unknown; response?: unknown } | null;
  const ch = await takeChallenge(c.env, body?.challengeId, 'add');
  if (!ch || ch.staff_id !== c.get('session').id || !(await storePasskey(c, ch.staff_id, ch.challenge, body?.response))) {
    return c.json({ error: 'registration_failed' }, 400);
  }
  return c.json({ ok: true });
});

app.delete('/api/staff/passkeys/:id', async (c) => {
  // 最後の 1 つは消せない（ログインできなくなるため）
  const res = await c.env.DB.prepare(
    `DELETE FROM passkeys WHERE id = ?1 AND staff_id = ?2 AND (SELECT count(*) FROM passkeys WHERE staff_id = ?2) > 1`,
  )
    .bind(c.req.param('id'), c.get('session').id)
    .run();
  if (res.meta.changes !== 1) return c.json({ error: 'cannot_delete_last_passkey' }, 409);
  return c.json({ ok: true });
});

// ---------- スタッフ：アカウント管理（管理者のみ） ----------

/** 有効な管理者がほかにいるか（最後の管理者を止めたり消したりしないため） */
async function hasOtherAdmin(env: Env, exceptId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT count(*) AS n FROM staff WHERE role = 'admin' AND active = 1 AND id != ?`)
    .bind(exceptId)
    .first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

app.get('/api/staff/accounts', adminOnly, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT st.id, st.email, st.role, st.active, st.setup_allowed, st.created_at,
            (SELECT count(*) FROM passkeys p WHERE p.staff_id = st.id) AS passkeys
     FROM staff st ORDER BY st.created_at`,
  ).all<{ id: string; email: string; role: string; active: number; setup_allowed: number; created_at: string; passkeys: number }>();
  return c.json({
    accounts: results.map((a) => ({
      id: a.id,
      email: a.email,
      role: a.role,
      active: a.active === 1,
      setupAllowed: a.setup_allowed === 1,
      passkeys: a.passkeys,
      self: a.id === c.get('session').id,
    })),
  });
});

app.post('/api/staff/accounts', adminOnly, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { email?: unknown; role?: unknown } | null;
  const email = parseEmail(body?.email);
  if (!email || (body?.role !== 'admin' && body?.role !== 'staff')) return c.json({ error: 'bad_request' }, 400);
  const exists = await c.env.DB.prepare(`SELECT 1 FROM staff WHERE email = ?`).bind(email).first();
  if (exists) return c.json({ error: 'email_taken' }, 409);
  await c.env.DB.prepare(`INSERT INTO staff (id, email, role, created_at) VALUES (?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), email, body.role, nowIso())
    .run();
  // 案内メール。届かなくてもアカウントは作成済みなので、セットアップ画面の URL を口頭などで伝えればよい
  const url = `${site(c)}/staff/setup`;
  const invited = await sendMail(
    c.env,
    email,
    '【店舗管理】スタッフとして登録されました',
    `店舗管理画面のスタッフとして登録されました。\n\n次のページを開き、このメールアドレスを入力してセットアップしてください。\n${url}\n\n確認コードがメールで届いたあと、端末にパスキー（指紋・顔・画面ロック）を登録します。以後はパスキーだけでログインできます。`,
  );
  return c.json({ ok: true, invited }, 201);
});

app.post('/api/staff/accounts/:id/active', adminOnly, async (c) => {
  const body = (await c.req.json().catch(() => null)) as { active?: unknown } | null;
  if (typeof body?.active !== 'boolean') return c.json({ error: 'bad_request' }, 400);
  if (!body.active && !(await hasOtherAdmin(c.env, c.req.param('id')))) return c.json({ error: 'last_admin' }, 409);
  const row = await c.env.DB.prepare(`UPDATE staff SET active = ? WHERE id = ? RETURNING email`)
    .bind(body.active ? 1 : 0, c.req.param('id'))
    .first<{ email: string }>();
  if (!row) return c.json({ error: 'account_not_found' }, 404);
  if (!body.active) await c.env.DB.prepare(`DELETE FROM sessions WHERE username = ?`).bind(row.email).run();
  return c.json({ ok: true });
});

// 端末の紛失・機種変更時：登録済みのパスキーを無効にし、メールの確認コードでの再セットアップを許可する
app.post('/api/staff/accounts/:id/reset', adminOnly, async (c) => {
  const row = await c.env.DB.prepare(`UPDATE staff SET setup_allowed = 1 WHERE id = ? RETURNING email`)
    .bind(c.req.param('id'))
    .first<{ email: string }>();
  if (!row) return c.json({ error: 'account_not_found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM passkeys WHERE staff_id = ?`).bind(c.req.param('id')),
    c.env.DB.prepare(`DELETE FROM sessions WHERE username = ?`).bind(row.email),
  ]);
  return c.json({ ok: true });
});

app.delete('/api/staff/accounts/:id', adminOnly, async (c) => {
  if (!(await hasOtherAdmin(c.env, c.req.param('id')))) return c.json({ error: 'last_admin' }, 409);
  const row = await c.env.DB.prepare(`DELETE FROM staff WHERE id = ? RETURNING email`).bind(c.req.param('id')).first<{ email: string }>();
  if (!row) return c.json({ error: 'account_not_found' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM passkeys WHERE staff_id = ?`).bind(c.req.param('id')),
    c.env.DB.prepare(`DELETE FROM sessions WHERE username = ?`).bind(row.email),
  ]);
  return c.json({ ok: true });
});

// ---------- 画面 ----------

const page = (path: string) => (c: C) => c.env.ASSETS.fetch(new Request(new URL(path, c.req.url)));
// Android アプリとこのサイトが同じ持ち主であることの証明（Digital Asset Links）。
// 署名鍵のフィンガープリントが一致するアプリだけが、アドレスバーなしでこのサイトを開ける
app.get('/.well-known/assetlinks.json', (c) => {
  const fingerprints = (c.env.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  const packages = (c.env.ANDROID_PACKAGES || 'dev.workers.gmakihiro.qrorder.staff,dev.workers.gmakihiro.qrorder.customer')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(p));
  const statements = fingerprints.length
    ? packages.map((pkg) => ({
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints },
      }))
    : [];
  return c.json(statements, 200, { 'Cache-Control': 'public, max-age=300' });
});

// お客様用のアプリ情報（店舗ごと）。ホーム画面に追加すると、その店舗の注文画面が開く
app.get('/s/:storeId/manifest.webmanifest', async (c) => {
  const store = await c.env.DB.prepare(`SELECT id, name FROM stores WHERE id = ?`).bind(c.req.param('storeId')).first<{ id: string; name: string }>();
  if (!store) return c.json({ error: 'store_not_found' }, 404);
  const start = `${bp(c)}/s/${encodeURIComponent(store.id)}`;
  return c.body(
    JSON.stringify({
      id: start,
      name: `${store.name} ご注文`,
      short_name: store.name.slice(0, 12),
      description: '商品をスキャンして、その場でお支払い',
      lang: 'ja',
      start_url: start,
      scope: `${bp(c)}/`,
      display: 'standalone',
      background_color: '#f4f5f2',
      theme_color: '#0a6b50',
      icons: [
        { src: `${bp(c)}/icons/app-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `${bp(c)}/icons/app-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `${bp(c)}/icons/app-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    }),
    200,
    { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' },
  );
});
app.get('/s/:storeId', page('/store'));
app.get('/contact/:storeId', page('/contact'));
app.get('/return/:orderId', page('/return'));
app.get('/order/:orderId', page('/order'));

app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

// ---------- 定期処理（1時間ごと） ----------

async function cleanup(env: Env): Promise<void> {
  // 1) 未払いのまま 24 時間たった注文を削除する。支払いの状態を Stripe で確かめてから消す
  const cutoff = new Date(Date.now() - PENDING_TTL_HOURS * 3600_000).toISOString();
  const { results: stale } = await env.DB.prepare(
    `SELECT * FROM orders WHERE status = 'pending' AND created_at < ? ORDER BY created_at LIMIT 15`,
  )
    .bind(cutoff)
    .all<OrderRow>();
  for (const order of stale) {
    if (order.payment_intent_id) {
      try {
        const pi = await stripe<PaymentIntent>(env, 'GET', `/payment_intents/${order.payment_intent_id}`);
        if (pi.status === 'succeeded') {
          await markPaid(env, order, pi); // 通知が届いていなかった支払いを救済する
          continue;
        }
        if (pi.status === 'processing' || pi.status === 'requires_capture') continue; // 処理中は触らない
        // あとから支払われないよう、支払いの受付自体を取り消す
        if (pi.status !== 'canceled') await stripe(env, 'POST', `/payment_intents/${pi.id}/cancel`, {});
      } catch (e) {
        console.error('cleanup: keep order', order.id, e);
        continue; // 状態を確認できない注文は消さない
      }
    }
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM order_items WHERE order_id = (SELECT id FROM orders WHERE id = ? AND status = 'pending')`).bind(order.id),
      env.DB.prepare(`DELETE FROM orders WHERE id = ? AND status = 'pending'`).bind(order.id),
    ]);
  }

  // 購入完了メール：送れなかったものを再送し、24 時間たっても送れなければ送付先を消去する
  const { results: unsent } = await env.DB.prepare(
    `SELECT id FROM orders WHERE status = 'paid' AND receipt_email IS NOT NULL AND receipt_sent_at IS NULL AND paid_at >= ? LIMIT 10`,
  )
    .bind(cutoff)
    .all<{ id: string }>();
  for (const o of unsent) await sendReceipt(env, o.id);
  // 送れなかった宛先は 24 時間で、送れた宛先は返品・交換の申込期限の翌日に消去する
  await env.DB.prepare(
    `UPDATE orders SET receipt_email = NULL WHERE receipt_email IS NOT NULL AND ((receipt_sent_at IS NULL AND created_at < ?) OR COALESCE(paid_at, created_at) < ?)`,
  )
    .bind(cutoff, new Date(Date.now() - (returnWindowDays(env) + 1) * 86400_000).toISOString())
    .run();

  // 2) 保存期間を過ぎた注文データを削除する（帳簿の保存期間 7 年に余裕を持たせた日数が既定）
  const days = Math.max(Number(env.ORDER_RETENTION_DAYS) || 2922, 30);
  const old = new Date(Date.now() - days * 86400_000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE created_at < ?)`).bind(old),
    env.DB.prepare(`DELETE FROM refunds WHERE order_id IN (SELECT id FROM orders WHERE created_at < ?)`).bind(old),
    env.DB.prepare(`DELETE FROM orders WHERE created_at < ?`).bind(old),
    // 3) 期限切れのログインと回数制限の記録
    // 返品・交換の申請（写真を含む）：完了・却下から 90 日、未完了のまま 180 日で消去する
    env.DB.prepare(`DELETE FROM return_photos WHERE return_id IN (SELECT id FROM returns WHERE (status IN ('completed', 'rejected') AND COALESCE(completed_at, decided_at, created_at) < ?1) OR created_at < ?2)`).bind(new Date(Date.now() - RETURN_RETENTION_DAYS * 86400_000).toISOString(), new Date(Date.now() - 2 * RETURN_RETENTION_DAYS * 86400_000).toISOString()),
    env.DB.prepare(`DELETE FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE (status IN ('completed', 'rejected') AND COALESCE(completed_at, decided_at, created_at) < ?1) OR created_at < ?2)`).bind(new Date(Date.now() - RETURN_RETENTION_DAYS * 86400_000).toISOString(), new Date(Date.now() - 2 * RETURN_RETENTION_DAYS * 86400_000).toISOString()),
    env.DB.prepare(`DELETE FROM returns WHERE (status IN ('completed', 'rejected') AND COALESCE(completed_at, decided_at, created_at) < ?1) OR created_at < ?2`).bind(new Date(Date.now() - RETURN_RETENTION_DAYS * 86400_000).toISOString(), new Date(Date.now() - 2 * RETURN_RETENTION_DAYS * 86400_000).toISOString()),
    // お問い合わせのやり取りは 90 日で消去する
    env.DB.prepare(`DELETE FROM chat_messages WHERE thread_id IN (SELECT id FROM chat_threads WHERE last_message_at < ?)`).bind(new Date(Date.now() - CHAT_RETENTION_DAYS * 86400_000).toISOString()),
    env.DB.prepare(`DELETE FROM chat_threads WHERE last_message_at < ?`).bind(new Date(Date.now() - CHAT_RETENTION_DAYS * 86400_000).toISOString()),
    env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(nowIso()),
    env.DB.prepare(`DELETE FROM webauthn_challenges WHERE expires_at < ?`).bind(nowIso()),
    env.DB.prepare(`DELETE FROM email_codes WHERE expires_at < ?`).bind(nowIso()),
    env.DB.prepare(`DELETE FROM rate_limits WHERE expires_at < ?`).bind(Math.floor(Date.now() / 1000)),
  ]);
}

export default {
  fetch: app.fetch,
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(cleanup(env));
  },
};
