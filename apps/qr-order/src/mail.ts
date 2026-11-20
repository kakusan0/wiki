// メール本文（HTML）の組み立て。
// メールソフトは対応している書き方が限られるので、表（table）と要素ごとの style 指定だけで作る。
// 外部の画像や書体は読み込まない（表示の崩れと、開封の追跡を避けるため）。

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;

const FONT = `-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', Meiryo, sans-serif`;
const INK = '#151815';
const MUTED = '#5a6058';
const LINE = '#e4e6de';
const GROUND = '#f3f4f0';
const GREEN = '#0a6b50';
const BROWN = '#8f3a16';

export type ReceiptMail = {
  storeName: string;
  invoiceNumber: string | null;
  orderNo: string;
  orderId: string;
  paidAt: string;
  total: number;
  items: { name: string; qty: number; amount: number; reduced: boolean }[];
  tax: { rate: number; subtotal: number; tax: number }[];
  ageCheck: boolean;
  orderUrl: string | null;
  returnUrl: string | null;
  returnDays: number;
  legalUrl: string | null;
};

const row = (label: string, value: string, opts: { bold?: boolean; small?: boolean } = {}) => `
<tr>
  <td style="padding:6px 0;font-size:${opts.small ? 13 : 15}px;line-height:1.6;color:${opts.small ? MUTED : INK};${opts.bold ? 'font-weight:700;' : ''}">${label}</td>
  <td align="right" style="padding:6px 0 6px 12px;font-size:${opts.small ? 13 : 15}px;line-height:1.6;color:${opts.small ? MUTED : INK};white-space:nowrap;${opts.bold ? 'font-weight:700;' : ''}">${value}</td>
</tr>`;

const button = (href: string, label: string, dark: boolean) => `
<td align="center" style="border-radius:16px;background:${dark ? INK : '#ffffff'};border:1px solid ${dark ? INK : '#dcdfd6'};">
  <a href="${esc(href)}" style="display:block;padding:14px 10px;font-size:14px;font-weight:700;color:${dark ? '#ffffff' : INK};text-decoration:none;">${label}</a>
</td>`;

/** 購入完了メール（HTML 版） */
export function receiptHtml(m: ReceiptMail): string {
  const accent = m.ageCheck ? BROWN : GREEN;
  const hasReduced = m.items.some((i) => i.reduced);
  const buttons = [m.orderUrl ? button(m.orderUrl, '購入の証明を開く', true) : ''].filter(Boolean);

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(m.storeName)} ご購入ありがとうございます</title>
</head>
<body style="margin:0;padding:0;background:${GROUND};font-family:${FONT};color:${INK};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">注文番号 ${esc(m.orderNo)}・合計 ${yen(m.total)}。お支払いが完了しました。</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${GROUND};">
<tr><td align="center" style="padding:24px 12px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

<tr><td style="padding:0 8px 16px;">
  <div style="font-size:12px;line-height:1.6;color:${MUTED};letter-spacing:0.04em;">ご購入ありがとうございます</div>
  <div style="font-size:22px;line-height:1.4;font-weight:900;color:${INK};">${esc(m.storeName)}</div>
</td></tr>

<tr><td align="center" style="padding:28px 20px 26px;border-radius:28px;background:${accent};color:#ffffff;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
    <td align="center" width="48" height="48" style="width:48px;height:48px;border-radius:24px;background:#ffffff;color:${accent};font-size:26px;line-height:48px;font-weight:900;">&#10003;</td>
  </tr></table>
  <div style="margin-top:12px;font-size:17px;line-height:1.5;font-weight:900;color:#ffffff;">${m.ageCheck ? 'お支払い完了・年齢確認待ち' : 'お支払い完了'}</div>
  <div style="margin-top:2px;font-size:12px;line-height:1.6;letter-spacing:0.08em;color:#ffffff;">注文番号</div>
  <div style="font-size:72px;line-height:1.1;font-weight:900;letter-spacing:0.04em;color:#ffffff;">${esc(m.orderNo)}</div>
  <div style="margin-top:10px;font-size:13px;line-height:1.7;color:#ffffff;">${
    m.ageCheck
      ? '年齢確認が必要な商品が含まれています。<br>店舗スタッフに年齢の確認を受けてください。'
      : 'お支払いが完了しました。<br>下のボタンから、購入の証明を表示できます。'
  }</div>
</td></tr>

${
  buttons.length
    ? `<tr><td style="padding:14px 0 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    ${buttons.join('<td width="10" style="width:10px;font-size:0;line-height:0;">&nbsp;</td>')}
  </tr></table>
</td></tr>`
    : ''
}

${
  m.returnUrl
    ? `<tr><td style="padding:14px 0 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${LINE};border-radius:20px;"><tr>
    <td style="padding:16px 20px;">
      <div style="font-size:14px;line-height:1.6;font-weight:700;color:${INK};">商品に不良・誤りがあったとき</div>
      <div style="margin-top:4px;font-size:13px;line-height:1.8;color:${MUTED};">お支払いから ${m.returnDays} 日以内に、商品の写真を添えて返品・交換を申し込めます。お客様のご都合による返品はお受けできません。</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;"><tr>
        <td align="center" style="border-radius:16px;background:${GREEN};">
          <a href="${esc(m.returnUrl)}" style="display:block;padding:14px 10px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">返品・交換を申し込む</a>
        </td>
      </tr></table>
    </td>
  </tr></table>
</td></tr>`
    : ''
}

<tr><td style="padding:14px 0 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${LINE};border-radius:20px;">
  <tr><td style="padding:18px 20px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="font-size:15px;line-height:1.6;font-weight:700;color:${INK};">ご利用明細</td>
        <td align="right" style="font-size:12px;line-height:1.6;color:${MUTED};white-space:nowrap;">${esc(m.paidAt)}</td>
      </tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
      ${m.items.map((i) => row(`${esc(i.name)}${i.reduced ? ' ※' : ''} × ${i.qty}`, yen(i.amount))).join('')}
      <tr><td colspan="2" style="padding:6px 0;"><div style="height:1px;line-height:1px;font-size:0;background:${LINE};">&nbsp;</div></td></tr>
      <tr>
        <td style="padding:6px 0;font-size:14px;line-height:1.6;font-weight:700;color:${INK};">合計（税込）</td>
        <td align="right" style="padding:6px 0 6px 12px;font-size:26px;line-height:1.3;font-weight:900;color:${INK};white-space:nowrap;">${yen(m.total)}</td>
      </tr>
      ${m.tax.map((t) => row(`${t.rate}% 対象 ${yen(t.subtotal)}（内消費税）`, yen(t.tax), { small: true })).join('')}
    </table>
    <div style="margin-top:10px;font-size:12px;line-height:1.8;color:${MUTED};">
      ${m.invoiceNumber ? `登録番号 ${esc(m.invoiceNumber)}<br>` : ''}注文 ID ${esc(m.orderId)}${hasReduced ? '<br>※は軽減税率（8%）対象商品です。' : ''}
    </div>
  </td></tr>
  </table>
</td></tr>

${
  m.ageCheck
    ? `<tr><td style="padding:14px 0 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fbf1ec;border:1px solid #e6c3b3;border-radius:20px;"><tr>
    <td style="padding:14px 18px;font-size:13px;line-height:1.8;color:#6b2a10;font-weight:700;">20 歳未満の者の飲酒・喫煙は法律で禁止されています。</td>
  </tr></table>
</td></tr>`
    : ''
}

<tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.9;color:${MUTED};">
  ${m.legalUrl ? `商品の不良・誤りなどのお問い合わせ先と返品の条件は、<a href="${esc(m.legalUrl)}" style="color:${GREEN};">特定商取引法に基づく表記</a>をご覧ください。<br>` : ''}
  このメールは、ご購入時に入力されたメールアドレスへ自動で送信しています。お心当たりがない場合は、このメールを破棄してください。メールアドレスは、返品・交換の受付をお知らせするため、申込期限まで保存し、その後消去します。
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

export type ReturnAcceptedMail = {
  storeName: string;
  code: string;
  orderNo: string;
  wanted: string;
  reason: string;
  detail: string;
  items: { name: string; qty: number }[];
  photoCount: number;
  statusUrl: string | null;
  orderUrl: string | null;
};

/** 返品・交換の受付メール（HTML 版） */
export function returnAcceptedHtml(m: ReturnAcceptedMail): string {
  const buttons = [
    m.statusUrl ? button(m.statusUrl, '申し込みの状況を見る', true) : '',
    m.orderUrl ? button(m.orderUrl, '購入の証明を開く', false) : '',
  ].filter(Boolean);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(m.storeName)} 返品・交換のお申し込みを受け付けました</title>
</head>
<body style="margin:0;padding:0;background:${GROUND};font-family:${FONT};color:${INK};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">受付番号 ${esc(m.code)}・注文番号 ${esc(m.orderNo)}。店舗で内容を確認します。</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${GROUND};">
<tr><td align="center" style="padding:24px 12px 32px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">

<tr><td style="padding:0 8px 16px;">
  <div style="font-size:12px;line-height:1.6;color:${MUTED};letter-spacing:0.04em;">返品・交換のお申し込み</div>
  <div style="font-size:22px;line-height:1.4;font-weight:900;color:${INK};">${esc(m.storeName)}</div>
</td></tr>

<tr><td align="center" style="padding:26px 20px 24px;border-radius:28px;background:${GREEN};color:#ffffff;">
  <div style="font-size:17px;line-height:1.5;font-weight:900;color:#ffffff;">お申し込みを受け付けました</div>
  <div style="margin-top:6px;font-size:12px;line-height:1.6;letter-spacing:0.08em;color:#ffffff;">受付番号</div>
  <div style="font-size:48px;line-height:1.1;font-weight:900;letter-spacing:0.06em;color:#ffffff;">${esc(m.code)}</div>
  <div style="margin-top:10px;font-size:13px;line-height:1.7;color:#ffffff;">店舗で内容を確認し、結果をお申し込みの画面でお知らせします。<br>商品は捨てずに保管してください。</div>
</td></tr>

${
  buttons.length
    ? `<tr><td style="padding:14px 0 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    ${buttons.join('<td width="10" style="width:10px;font-size:0;line-height:0;">&nbsp;</td>')}
  </tr></table>
</td></tr>`
    : ''
}

<tr><td style="padding:14px 0 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${LINE};border-radius:20px;">
  <tr><td style="padding:18px 20px 16px;">
    <div style="font-size:15px;line-height:1.6;font-weight:700;color:${INK};">お申し込みの内容</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
      ${row('注文番号', esc(m.orderNo))}
      ${row('ご希望', esc(m.wanted))}
      ${row('理由', esc(m.reason))}
      ${m.items.map((i) => row(esc(i.name), `× ${i.qty}`)).join('')}
      ${row('写真', `${m.photoCount} 枚`, { small: true })}
    </table>
    <div style="margin-top:10px;padding:12px 14px;border-radius:14px;background:${GROUND};font-size:13px;line-height:1.8;color:${INK};white-space:pre-wrap;">${esc(m.detail)}</div>
  </td></tr>
  </table>
</td></tr>

<tr><td style="padding:14px 0 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fbf1ec;border:1px solid #e6c3b3;border-radius:20px;"><tr>
    <td style="padding:14px 18px;font-size:13px;line-height:1.8;color:#6b2a10;font-weight:700;">先にお送りした購入完了メールのリンクは使えなくなりました。今後はこのメールのリンクをお使いください。</td>
  </tr></table>
</td></tr>

<tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.9;color:${MUTED};">
  このメールは、ご購入時に入力されたメールアドレスへ自動で送信しています。お心当たりがない場合は、このメールを破棄してください。
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}
