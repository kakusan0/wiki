(async () => {
  const $ = (id) => document.getElementById(id);
  const yen = (n) => '¥' + n.toLocaleString('ja-JP');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const showError = (msg) => { $('error').textContent = msg; $('error').hidden = false; };
  const MAX_QTY = 20;

  const storeId = decodeURIComponent(location.pathname.split('/')[3] || '');
  const cartKey = 'cart:' + storeId;
  const lastOrder = localStorage.getItem('lastOrder:' + storeId);
  if (lastOrder) {
    $('last-order').hidden = false;
    $('last-order').querySelector('a').href = '/qr-order/order/' + lastOrder;
  }

  let data, config;
  try {
    const [s, c] = await Promise.all([fetch('/qr-order/api/stores/' + encodeURIComponent(storeId), { cache: 'no-store' }), fetch('/qr-order/api/config')]);
    if (s.status === 404) return showError('店舗が見つかりません。QRコードをもう一度読み取ってください。');
    if (!s.ok || !c.ok) throw new Error();
    data = await s.json();
    config = await c.json();
  } catch {
    return showError('読み込みに失敗しました。通信状況を確認して再読み込みしてください。');
  }

  $('store-name').textContent = data.store.name;
  // ホーム画面に追加したとき、この店舗の注文画面が開くようにする
  const manifest = document.createElement('link');
  manifest.rel = 'manifest';
  manifest.href = '/qr-order/s/' + encodeURIComponent(storeId) + '/manifest.webmanifest';
  document.head.append(manifest);
  document.title = data.store.name + ' | ご注文';
  const products = new Map(data.products.map((p) => [p.id, p])); // 販売中（有効）の商品のみ

  // --- カート（QR を読み取るたびにページが開き直るため端末に保存する） ---
  const cart = new Map(); // productId -> qty
  try {
    for (const [id, q] of JSON.parse(localStorage.getItem(cartKey) || '[]')) {
      if (products.has(id) && Number.isInteger(q) && q > 0) cart.set(id, Math.min(q, MAX_QTY));
    }
  } catch { /* 壊れた保存データは無視 */ }
  const saveCart = () => { try { localStorage.setItem(cartKey, JSON.stringify([...cart])); } catch { /* 保存できなくても続行 */ } };
  const total = () => [...cart].reduce((s, [id, q]) => s + products.get(id).price * q, 0);

  let paying = false;
  // 画面上部に大きく出す通知。スキャン中でもカートまでスクロールせずに結果が分かる
  let noticeTimer, flashTimer, justAdded = null;
  function notice(msg, warn) {
    $('toast-text').textContent = msg;
    $('toast-icon').textContent = warn ? '!' : '✓';
    $('toast').className = 'toast' + (warn ? ' warn' : '');
    $('toast').hidden = false;
    void $('toast').offsetWidth; // 連続で出したときもアニメーションをやり直す
    $('toast').classList.add('show');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { $('toast').hidden = true; }, warn ? 4500 : 3000);

    // スキャン中はカメラ映像の上にも ✓ / ! を重ねる
    $('scan-flash').textContent = warn ? '!' : '✓';
    $('scan-flash').className = 'scan-flash ' + (warn ? 'ng' : 'ok');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { $('scan-flash').className = 'scan-flash'; }, 900);
  }

  function setQty(id, q) {
    if (paying) return;
    q = Math.max(0, Math.min(MAX_QTY, q));
    if (q) cart.set(id, q); else cart.delete(id);
    saveCart();
    render();
  }

  // --- 音とバイブレーションでの通知 ---
  // 音はブラウザの制約で、画面を一度操作（スキャン開始ボタンなど）したあとでないと鳴らない
  let audio = null;
  function unlockAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!audio && AC) audio = new AC();
      if (audio && audio.state === 'suspended') audio.resume();
    } catch { /* 音が使えない端末では通知文とバイブレーションのみ */ }
  }
  function beep(freq, startAt, duration) {
    if (!audio || audio.state !== 'running') return;
    const osc = audio.createOscillator(), gain = audio.createGain();
    const t = audio.currentTime + startAt;
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }
  function signal(kind) {
    try {
      if (kind === 'added') {
        beep(1320, 0, 0.12); // 高い音を1回
        if (navigator.vibrate) navigator.vibrate(60);
      } else {
        beep(330, 0, 0.16); beep(330, 0.24, 0.16); // 低い音を2回
        if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
      }
    } catch { /* 通知に失敗しても処理は続ける */ }
  }

  /** スキャンした商品をカートに入れる。すでに入っている商品は追加せず、音とバイブレーションで知らせる */
  function addProduct(productId) {
    const p = products.get(productId);
    if (!p) { notice('この商品は現在販売していません。', true); signal('rejected'); return false; }
    if (cart.has(productId)) {
      notice(p.name + ' はすでにカートに入っています。数量はカートの「＋」で変更してください。', true);
      signal('rejected');
      return false;
    }
    justAdded = productId;
    setTimeout(() => { if (justAdded === productId) justAdded = null; }, 2000);
    setQty(productId, 1);
    notice(p.name + '（' + yen(p.price) + '）をカートに入れました');
    $('scan-last-name').textContent = p.name + ' を追加しました';
    $('scan-last-price').textContent = yen(p.price);
    $('scan-last').hidden = false;
    signal('added');
    return true;
  }

  // --- 入店確認（QR コードの定期更新が有効な店舗） ---
  // 有効な QR を読み取ると数時間有効な入店確認が発行され、それがある端末だけが注文できる
  const rotation = !!data.store.qrRotation;
  const passKey = 'pass:' + storeId;
  let pass = '';
  try {
    const saved = localStorage.getItem(passKey) || '';
    if (Number(saved.split('.')[0]) > Date.now()) pass = saved;
  } catch { /* 保存データが読めなければ未確認として扱う */ }
  const hasPass = () => !rotation || (pass !== '' && Number(pass.split('.')[0]) > Date.now());
  const showGate = () => { $('gate').hidden = hasPass(); };

  /** QR の合言葉をサーバーで確かめ、入店確認を受け取る。期限切れなら false */
  async function redeem(token) {
    if (!rotation) return true;
    if (!token) return false;
    try {
      const res = await fetch('/qr-order/api/stores/' + encodeURIComponent(storeId) + '/pass', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token }),
      });
      if (!res.ok) return false;
      const body = await res.json();
      if (body.pass) { pass = body.pass; try { localStorage.setItem(passKey, pass); } catch { /* 保存できなくても続行 */ } }
      showGate();
      return true;
    } catch {
      return false;
    }
  }
  const expired = () => { notice('この QR コードは期限が切れています。店頭に表示されている新しい QR コードを読み取ってください。', true); signal('rejected'); return false; };

  // 自サイトに加え、店舗管理アプリ（qr-order.infoapp.org）で生成された QR も受け付ける
  const QR_ORIGINS = new Set([location.origin, 'https://qr-order.infoapp.org']);
  /** 読み取った QR の URL を解釈する。店舗・商品の QR でなければ null */
  function parseQrUrl(text) {
    let url;
    try { url = new URL(text); } catch { return null; }
    if (!QR_ORIGINS.has(url.origin)) return null;
    const path = url.pathname.replace(/^\/qr-order(?=\/)/, '');
    const m = path.match(/^\/(s|p)\/([^/]+)$/);
    if (!m) return null;
    let id;
    try { id = decodeURIComponent(m[2]); } catch { return null; }
    if (!id) return null;
    const token = url.searchParams.get('t') || '';
    if (m[1] === 'p') return { kind: 'product', productId: id, token };
    return { kind: 'store', storeId: id, add: url.searchParams.get('add') || '', token };
  }

  /** 読み取った QR・バーコードの文字列を解釈してカートに追加する */
  async function handleCode(text) {
    // 商品バーコード（JAN）：登録されている商品を探す
    if (/^\d{8,13}$/.test(text)) {
      if (!hasPass()) { notice('先に、店頭に表示されている QR コードを読み取ってください。', true); signal('rejected'); return false; }
      const p = data.products.find((x) => x.barcode === text);
      if (!p) { notice('このバーコードの商品は販売していません。', true); signal('rejected'); return false; }
      return addProduct(p.id);
    }
    const parsed = parseQrUrl(text);
    if (!parsed) { notice('商品の QR コードではありません。', true); signal('rejected'); return false; }
    if (parsed.kind === 'product') {
      // 電子棚札・店舗管理アプリの商品 QR（/p/<商品ID>）
      if (rotation) {
        if (parsed.token) {
          if (!(await redeem(parsed.token))) return expired();
        } else if (!hasPass()) {
          notice('先に、店頭に表示されている QR コードを読み取ってください。', true);
          signal('rejected');
          return false;
        }
      }
      return addProduct(parsed.productId);
    }
    if (parsed.storeId !== storeId) { notice('別の店舗の QR コードです。', true); signal('rejected'); return false; }
    // 定期更新が有効な店舗では、QR に入っている合言葉が有効かを確かめる
    if (rotation && !(await redeem(parsed.token))) return expired();
    if (!parsed.add) {
      // 店舗の QR（入口用）
      notice(rotation ? '店頭の QR コードを確認しました。商品をスキャンしてください。' : '店舗の QR コードです。商品の QR コードかバーコードを読み取ってください。', !rotation);
      signal(rotation ? 'added' : 'rejected');
      return rotation;
    }
    return addProduct(parsed.add);
  }

  // --- Stripe（カード / Apple Pay / Google Pay / Link / PayPay。表示される手段は Stripe の設定に従う） ---
  let stripe = null, elements = null;

  function payNote(msg) {
    $('pay-note').textContent = msg;
    $('pay-note').hidden = !msg;
  }

  function setupPayment(amount) {
    if (!window.Stripe || !config.publishableKey) {
      return payNote('現在お支払いを受け付けられません。店舗スタッフにお声がけください。');
    }
    stripe = Stripe(config.publishableKey, { locale: 'ja' });
    // 決済フォームの色も、表示の明るさ（ライト / ダーク）に合わせる
    const appearance = () => ({ theme: window.effectiveTheme && window.effectiveTheme() === 'dark' ? 'night' : 'stripe' });
    elements = stripe.elements({ mode: 'payment', amount, currency: 'jpy', appearance: appearance() });
    document.addEventListener('themechange', () => { try { elements.update({ appearance: appearance() }); } catch { /* 見た目の更新に失敗しても決済は続けられる */ } });
    const payment = elements.create('payment', { layout: { type: 'accordion', defaultCollapsed: false, radios: true, spacedAccordionItems: false } });
    payment.on('ready', () => { $('pay-button').hidden = false; $('agree').hidden = false; });
    payment.on('loaderror', () => payNote('決済方法を読み込めませんでした。再読み込みしてください。'));
    payment.mount('#pay');
    showAvailableMethods(amount);
  }

  // このブラウザ・端末で実際に使える決済方法だけを「支払方法」に表示する
  async function showAvailableMethods(amount) {
    const labels = { card: 'クレジットカード（JCB ほか）', apple_pay: 'Apple Pay', google_pay: 'Google Pay', link: 'Link', paypay: 'PayPay' };
    const hints = {
      apple_pay: 'Apple Pay は Safari（iPhone / Mac）でウォレットにカードを登録していると使えます',
      google_pay: 'Google Pay は Chrome で Google アカウントにカードを登録していると使えます',
    };
    // 店舗側で有効にしている決済方法（取得できなければ既定の一覧）
    const enabled = Array.isArray(config.paymentMethods) && config.paymentMethods.length
      ? config.paymentMethods
      : ['card', 'apple_pay', 'google_pay', 'link', 'paypay'];
    let wallets;
    try {
      // ブラウザと端末がウォレット決済に対応しているかを Stripe 経由で確認する
      const request = stripe.paymentRequest({ country: 'JP', currency: 'jpy', total: { label: '合計', amount } });
      wallets = (await request.canMakePayment()) || {};
    } catch {
      return; // 確認できないときは一覧を変えない
    }
    const usable = (m) => (m === 'apple_pay' ? !!wallets.applePay : m === 'google_pay' ? !!wallets.googlePay : true);
    const shown = enabled.filter(usable);
    const missing = enabled.filter((m) => !usable(m) && hints[m]);
    if (!shown.length) return;
    $('methods').textContent = shown.map((m) => labels[m] || m).join(' / ');
    $('methods-note').textContent = missing.length ? '（' + missing.map((m) => hints[m]).join('。') + '）' : '';
    $('methods-note').hidden = !missing.length;
  }

  const hasRestricted = () => [...cart.keys()].some((id) => products.get(id).ageRestricted);

  // Turnstile（設定されている場合のみ）。自動操作による注文の大量作成を防ぐ
  let turnstileToken = '', turnstileWidget = null;
  function setupTurnstile() {
    if (!config.turnstileSiteKey || turnstileWidget !== null || document.getElementById('turnstile-script')) return;
    const sc = document.createElement('script');
    sc.id = 'turnstile-script';
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    sc.onload = () => window.turnstile.ready(() => {
      turnstileWidget = window.turnstile.render('#turnstile', {
        sitekey: config.turnstileSiteKey,
        language: 'ja',
        callback: (t) => { turnstileToken = t; },
        'expired-callback': () => { turnstileToken = ''; },
        'error-callback': () => { turnstileToken = ''; },
      });
    });
    document.head.append(sc);
  }
  function resetTurnstile() {
    turnstileToken = '';
    if (turnstileWidget !== null && window.turnstile) window.turnstile.reset(turnstileWidget);
  }

  // --- 位置情報（GPS）：お支払いの前に確認する ---
  let geo = null;
  async function checkGeo(quiet) {
    $('geo-state').textContent = '現在地を確認しています…';
    $('geo-state').className = 'geo-state';
    try {
      geo = await window.getGeo(300000);
      $('geo-state').textContent = '確認しました（誤差 約 ' + geo.accuracy + 'm）。';
      $('geo-state').className = 'geo-state ok';
      $('geo-box').classList.remove('need');
      return true;
    } catch (e) {
      geo = null;
      $('geo-state').textContent = e.message;
      $('geo-state').className = 'geo-state ng';
      if (!quiet) $('geo-box').classList.add('need');
      return false;
    }
  }
  $('geo-check').onclick = () => checkGeo(false);

  async function pay() {
    if (paying || !elements || cart.size === 0) return;
    // 位置の確認が済んでいない（または古い）ときは、先に確認してもらう。決済の画面はボタンを押した直後に開く必要があるため、ここでは待たない
    if (!geo || Date.now() - geo.at > 300000) {
      showError('お支払いの前に「現在地を確認する」を押して、位置情報を確認してください。');
      $('geo-box').classList.add('need');
      $('geo-box').scrollIntoView({ block: 'center' });
      checkGeo(false);
      return;
    }
    if (!hasPass()) {
      showGate();
      showError('ご注文には、店頭に表示されている QR コードの読み取りが必要です。');
      $('gate').scrollIntoView({ block: 'center' });
      return;
    }
    if (hasRestricted() && !$('age-ok').checked) {
      showError('年齢確認が必要な商品が含まれています。20 歳以上であることを確認のうえ、チェックを入れてください。');
      $('age-box').scrollIntoView({ block: 'center' });
      return;
    }
    if (!$('receipt-email').checkValidity()) {
      showError('メールアドレスの形式を確認してください。不要な場合は空欄にしてください。');
      $('receipt-email').focus();
      return;
    }
    if (config.turnstileSiteKey && !turnstileToken) {
      showError('安全確認が終わっていません。数秒待ってからもう一度押してください。');
      return;
    }
    paying = true;
    $('pay-button').disabled = true;
    $('error').hidden = true;
    payNote('');
    try {
      // 入力内容の確認（カード番号の不備などはここで止まり、注文は作られない）
      const { error: submitError } = await elements.submit();
      if (submitError) throw new Error(submitError.message);

      const res = await fetch('/qr-order/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId,
          items: [...cart].map(([productId, qty]) => ({ productId, qty })),
          ageConfirmed: hasRestricted() ? $('age-ok').checked : undefined,
          turnstileToken: turnstileToken || undefined,
          pass: pass || undefined,
          geo: window.geoPayload(geo),
          email: $('receipt-email').value.trim() || undefined,
        }),
      });
      resetTurnstile(); // 確認結果は 1 回しか使えない
      if (!res.ok) {
        if (res.status === 400 && (await res.clone().json().catch(() => ({}))).error === 'bad_email') throw new Error('メールアドレスの形式を確認してください。お支払いは発生していません。');
        const errCode = res.status === 400 || res.status === 403 ? (await res.clone().json().catch(() => ({}))).error : '';
        if (errCode === 'out_of_store') throw new Error('店舗の近くでのみお支払いいただけます。店内で「現在地を確認する」を押してから、もう一度お試しください。お支払いは発生していません。');
        if (errCode === 'location_required' || errCode === 'location_inaccurate') { geo = null; throw new Error('現在地を正確に確認できませんでした。端末の位置情報（GPS）をオンにし、「現在地を確認する」を押してから、もう一度お試しください。お支払いは発生していません。'); }
        if (res.status === 429) throw new Error('注文が集中しています。少し待ってからもう一度お試しください。お支払いは発生していません。');
        if (res.status === 403) {
          if ((await res.clone().json().catch(() => ({}))).error === 'qr_expired') {
            pass = ''; try { localStorage.removeItem(passKey); } catch { /* 無視 */ }
            showGate();
            throw new Error('店頭の QR コードの確認が切れました。店頭に表示されている QR コードを読み取ってから、もう一度お支払いください。お支払いは発生していません。');
          }
          throw new Error('安全確認に失敗しました。ページを再読み込みしてもう一度お試しください。お支払いは発生していません。');
        }
        throw new Error(res.status === 409
          ? '販売を終了した商品が含まれています。再読み込みしてカートを確認してください。'
          : res.status === 502
            ? '決済サービスに接続できませんでした。お支払いは発生していません。店舗スタッフにお声がけください。'
            : '注文を作成できませんでした。お支払いは発生していません。');
      }
      const { orderId, clientSecret } = await res.json();
      localStorage.setItem('lastOrder:' + storeId, orderId);
        if (window.rememberOrder) window.rememberOrder(storeId, orderId);

      // PayPay などは外部の画面へ移動し、完了後に注文状況の画面へ戻る
      const { error } = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: { return_url: location.origin + '/qr-order/order/' + orderId },
        redirect: 'if_required',
      });
      if (error) {
        fetch('/qr-order/api/orders/' + orderId + '/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: [error.type, error.code, error.decline_code, error.message].filter(Boolean).join(' | ') }),
        }).catch(() => {});
        throw new Error(error.message || 'お支払いを完了できませんでした。');
      }
      location.href = '/qr-order/order/' + orderId;
    } catch (e) {
      showError(e.message);
      $('error').scrollIntoView({ block: 'center' });
      paying = false;
      $('pay-button').disabled = false;
    }
  }
  $('pay-button').onclick = pay;

  // --- 画面 ---
  function render() {
    const sum = total();
    const cards = [], rows = [];
    for (const [id, q] of cart) {
      const p = products.get(id);
      const mark = p.taxRate === 8 ? ' ※' : '';

      const card = el('div', 'card product' + (id === justAdded ? ' added' : ''));
      const name = el('div', 'name');
      name.append(el('div', null, p.name + mark), el('div', 'price', yen(p.price) + '（税込）' + (p.ageRestricted ? '・年齢確認商品' : '')));
      const stepper = el('div', 'stepper');
      const minus = el('button', null, q === 1 ? '×' : '−'), out = el('output', null, String(q)), plus = el('button', null, '＋');
      minus.setAttribute('aria-label', q === 1 ? p.name + 'を削除' : p.name + 'を減らす');
      plus.setAttribute('aria-label', p.name + 'を増やす');
      plus.disabled = q >= MAX_QTY;
      minus.onclick = () => setQty(id, q - 1);
      plus.onclick = () => setQty(id, q + 1);
      stepper.append(minus, out, plus);
      card.append(name, stepper);
      cards.push(card);

      const tr = el('tr');
      tr.append(el('td', null, p.name + mark + ' × ' + q), el('td', 'num', yen(p.price * q)));
      rows.push(tr);
    }
    $('cart').replaceChildren(...(cards.length ? cards : [el('p', 'note', 'カートは空です。商品の QR コードまたはバーコードをスキャンしてください。')]));

    const tr = el('tr', 'sum');
    tr.append(el('td', null, '合計（税込）'), el('td', 'num', yen(sum)));
    $('lines').replaceChildren(...rows, tr);

    // 商品が1点でも入っていれば決済方法を表示する
    const hasItems = cart.size > 0;
    $('confirm').hidden = !hasItems;
    if (hasItems) {
      if (!elements) setupPayment(sum);
      else elements.update({ amount: sum });
    }
    $('pay-button').textContent = yen(sum) + ' を支払う';
    $('age-box').hidden = !hasRestricted();
    if (hasItems) setupTurnstile();

    // 画面下に常に出すカートの点数と合計
    const count = [...cart.values()].reduce((a, b) => a + b, 0);
    $('tab-count').textContent = count;
    $('tab-count').hidden = !hasItems;
    $('cart-bar').hidden = !hasItems;
    document.body.classList.toggle('has-cart-bar', hasItems);
    $('cart-bar-total').textContent = yen(sum);
    if ($('cart-bar-count').textContent !== String(count)) {
      $('cart-bar-count').textContent = count;
      $('cart-bar-count').classList.remove('bump');
      void $('cart-bar-count').offsetWidth;
      $('cart-bar-count').classList.add('bump');
    }
  }

  // --- カメラで商品 QR を読み取る（映像は端末内だけで処理し、送信しない） ---
  const video = $('scan-video');
  const canvas = document.createElement('canvas');
  let stream = null, raf = 0, lastText = '', lastSeen = 0, lastHit = 0, scanSession = 0;

  // 読み取り中の表示
  function live(msg, ok, ng) {
    $('scan-live').textContent = msg;
    $('scan-live').className = 'scan-live' + (ok ? ' ok' : ng ? ' ng' : '');
  }
  function describeQr(text) {
    const parsed = parseQrUrl(text);
    if (parsed) {
      const p = products.get(parsed.kind === 'product' ? parsed.productId : parsed.add);
      return p ? 'QR コード: ' + p.name : 'QR コード: 店舗・商品の QR';
    }
    return 'QR コード: ' + text.slice(0, 40);
  }

  function stopScan() {
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    $('scanner').classList.remove('on');
    $('scan-close').hidden = true;
    $('scan-switch').hidden = true;
    $('scan-open').hidden = false;
    live('カメラを起動すると、読み取りを始めます。');
  }

  function tick() {
    if (!stream) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const ctx = window.drawScanRegion(video, $('scan-guide'), canvas); // 枠の中だけを読み取る
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const qr = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      // QR が写っていなければ、商品バーコードとして読む
      const text = (qr && qr.data) || (window.readBarcode ? window.readBarcode(canvas) : null);
      if (text) {
        // 読み取れた内容をそのまま見せる（QR は URL なので、商品名か「店舗の QR」に置き換える）
        live(/^\d+$/.test(text) ? 'バーコード: ' + text : describeQr(text), true);
        if (text !== lastText) window.flashGuide($('scan-guide'));
        const now = Date.now();
        // 同じコードを写し続けても通知は1回だけ。いったん外して2秒たつと再度反応する
        if (text !== lastText || now - lastSeen > 2000) {
          handleCode(text).then(() => { $('scan-status').textContent = $('toast-text').textContent; });
        }
        lastText = text;
        lastSeen = now;
        lastHit = now;
      } else if (window.readDigits && !window.ocrBusy() && Date.now() - lastHit > 1500) {
        // 線が読めないときは、バーコードの下の数字を文字認識で読む。登録済みの商品の番号と一致したときだけ使う
        const session = scanSession;
        window.readDigits(canvas, (info) => {
          if (session !== scanSession || !stream) return;
          if (info.stage === 'loading') live('数字の読み取りを準備しています…（初回のみ数秒かかります）');
          else live(info.text ? '読めている数字: ' + info.text : 'コードを探しています…（線が読めないときは、下の数字を大きく写してください）');
        }).then((digits) => {
          if (!digits || session !== scanSession || !stream) return;
          if (!data.products.some((x) => x.barcode === digits)) { live('番号 ' + digits + ' は、この店舗で販売している商品ではありません', false, true); return; }
          live('番号: ' + digits, true);
          const now = Date.now();
          if (digits !== lastText || now - lastSeen > 2000) {
            handleCode(digits).then(() => { $('scan-status').textContent = $('toast-text').textContent; });
          }
          lastText = digits;
          lastSeen = now;
          lastHit = now;
        });
      }
    }
    raf = requestAnimationFrame(tick);
  }

  // 使うカメラ（背面 / 前面）。選んだ向きは次回も使う
  let facing = 'environment';
  try { if (localStorage.getItem('scanFacing') === 'user') facing = 'user'; } catch { /* 既定の背面カメラ */ }
  const openCamera = () => navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });

  // カメラが 2 つ以上ある端末でだけ切り替えボタンを出す
  async function showSwitchIfUseful() {
    try {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      $('scan-switch').hidden = cams.length < 2;
    } catch { $('scan-switch').hidden = true; }
  }

  async function switchCamera() {
    if (!stream) return;
    $('scan-switch').disabled = true;
    cancelAnimationFrame(raf);
    stream.getTracks().forEach((t) => t.stop()); // 2 つ同時に開けない端末があるので先に止める
    stream = null;
    facing = facing === 'environment' ? 'user' : 'environment';
    try {
      stream = await openCamera();
    } catch {
      facing = facing === 'environment' ? 'user' : 'environment'; // 切り替えられなければ元のカメラに戻す
      try { stream = await openCamera(); } catch { $('scan-switch').disabled = false; stopScan(); return notice('カメラを切り替えられませんでした。', true); }
    }
    try { localStorage.setItem('scanFacing', facing); } catch { /* 保存できなくても続行 */ }
    lastText = '';
    video.srcObject = stream;
    await video.play().catch(() => {});
    $('scan-switch').disabled = false;
    tick();
  }

  async function startScan() {
    unlockAudio(); // ボタン操作の中で音を有効にする
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.jsQR) {
      return notice('このブラウザではカメラを使えません。スマートフォン標準のカメラアプリで商品の QR コードを読み取ってください。', true);
    }
    try {
      stream = await openCamera();
    } catch {
      return notice('カメラを起動できませんでした。ブラウザの設定でカメラの使用を許可してください。', true);
    }
    showSwitchIfUseful();
    lastText = '';
    lastHit = Date.now();
    scanSession++;
    live('コードを探しています…');
    $('scanner').classList.add('on');
    $('scan-close').hidden = false;
    $('scan-open').hidden = true;
    try { localStorage.setItem('scanAuto', '1'); } catch { /* 次回の自動起動ができないだけ */ }
    $('scan-status').textContent = '明るい枠の中だけを読み取ります。QR コードまたはバーコード全体が枠に入るように写してください。';
    video.srcObject = stream;
    await video.play().catch(() => {});
    tick();
  }

  document.addEventListener('pointerdown', unlockAudio, { once: true });
  // --- スキャンとカートの切り替え（タブ、または左右のフリック） ---
  let view = 'scan';
  function setView(next, direction) {
    if (next === view) return;
    view = next;
    const scan = view === 'scan';
    $('seg').dataset.view = view;
    $('dots').dataset.view = view;
    $('tab-scan').setAttribute('aria-pressed', String(scan));
    $('tab-cart').setAttribute('aria-pressed', String(!scan));
    for (const [id, show] of [['panel-scan', scan], ['panel-cart', !scan]]) {
      const panel = $(id);
      panel.hidden = !show;
      panel.classList.remove('from-left', 'from-right');
      if (show && direction) panel.classList.add(direction > 0 ? 'from-right' : 'from-left'); // 動かした向きから入ってくる
    }
    if (scan) {
      // 一度カメラを使った端末では、スキャンに戻ると自動で再開する
      let auto = false;
      try { auto = localStorage.getItem('scanAuto') === '1'; } catch { /* 手動で起動してもらう */ }
      if (auto && !stream) startScan();
    } else if (stream) {
      stopScan(); // カートを見ているあいだはカメラを止める
    }
  }
  // 切り替えのタブが上に貼り付いているあいだだけ、下に区切り線を出す
  const segWrap = document.querySelector('.seg-wrap');
  const onScroll = () => segWrap.classList.toggle('stuck', segWrap.getBoundingClientRect().top <= 0);
  window.addEventListener('scroll', onScroll, { passive: true });
  $('tab-scan').onclick = () => setView('scan', -1);
  $('tab-cart').onclick = () => { setView('cart', 1); if (!geo && cart.size) checkGeo(true); };

  (() => {
    const area = $('shop');
    let x0 = 0, y0 = 0, t0 = 0, tracking = false;
    area.addEventListener('touchstart', (e) => {
      tracking = false;
      if (e.touches.length !== 1 || paying) return;
      // 文字の入力欄の上から始めた操作は、切り替えに使わない
      if (e.target.closest('input, select, textarea, [data-noswipe]')) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); tracking = true;
    }, { passive: true });
    area.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0, dy = t.clientY - y0;
      // 横に 60px 以上、縦の動きの 2 倍以上、0.6 秒以内だけをフリックとみなす
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2 || Date.now() - t0 > 600) return;
      if (dx < 0) setView('cart', 1); else setView('scan', -1);
    }, { passive: true });
    area.addEventListener('touchcancel', () => { tracking = false; }, { passive: true });
  })();

  $('cart-bar-go').onclick = () => { setView('cart', 1); $('confirm').scrollIntoView({ behavior: 'smooth' }); if (!geo) checkGeo(true); };
  $('scan-open').onclick = startScan;
  $('scan-close').onclick = stopScan;
  $('scan-switch').onclick = switchCamera;
  document.addEventListener('visibilitychange', () => { if (document.hidden && stream) stopScan(); });
  $('scan-open').hidden = false;

  // 標準カメラアプリで商品 QR を読み取って開いた場合（/s/<店舗>?add=<商品ID>）
  const params = new URLSearchParams(location.search);
  const add = params.get('add'), token = params.get('t');
  if (add || token) history.replaceState(null, '', location.pathname); // 再読み込みで二重に追加しない・古い合言葉を残さない
  render();
  const entered = rotation && token ? await redeem(token) : true;
  if (rotation && token && !entered && !hasPass()) expired();
  else if (add) {
    if (hasPass()) addProduct(add); else expired();
  }
  showGate();
})();
