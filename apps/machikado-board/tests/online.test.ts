import { describe, expect, it } from 'vitest';
import {
  ALONE_MS, AUTO_START_MS, RateLimiter, TURN_MS, act, canRequestStart, cleanName, isAction, isCode, join, leaveLobby, newRoom,
  planWake, randomCode, sanitize, shouldAutoStart, start, viewFor, wake,
} from '../src/worker/logic';

let n = 0;
const tok = () => `tok${++n}`;
const room = (isPrivate = false) => newRoom('ABCDEF', 'corner', 'normal', isPrivate, 0);

describe('名前', () => {
  it('ふつうの名前はそのまま', () => {
    expect(cleanName('たろう')).toBe('たろう');
    expect(cleanName('  ＡＢＣ ')).toBe('ABC'); // 全角は半角にそろえる
    expect(cleanName('かすみ')).toBe('かすみ');
  });
  it('長すぎる・空・URL・NG ワード・制御文字は使えない', () => {
    expect(cleanName('123456789')).toBeNull();
    expect(cleanName('')).toBeNull();
    expect(cleanName('a.com')).toBeNull();
    expect(cleanName('http://x')).toBeNull();
    expect(cleanName('しね')).toBeNull();
    expect(cleanName('F.u.c.k')).toBeNull();
    expect(cleanName('管理者')).toBeNull();
    expect(cleanName('‮abc')).toBe('abc');
    expect(cleanName(42)).toBeNull();
  });
});

describe('合言葉・操作の形', () => {
  it('合言葉は 6 文字で、まぎらわしい文字を使わない', () => {
    for (let i = 0; i < 50; i++) expect(isCode(randomCode())).toBe(true);
    expect(isCode('ABCDE0')).toBe(false); // 0 は使わない
    expect(isCode('abcdef')).toBe(false);
  });
  it('おかしな操作は弾く', () => {
    expect(isAction({ type: 'roll' })).toBe(true);
    expect(isAction({ type: 'move', to: 3 })).toBe(true);
    expect(isAction({ type: 'move', to: -1 })).toBe(false);
    expect(isAction({ type: 'invest', sq: 1, amount: Infinity })).toBe(false);
    expect(isAction({ type: 'buyStock', street: 0, lots: 0 })).toBe(false);
    expect(isAction({ type: 'hack' })).toBe(false);
    expect(isAction(null)).toBe(false);
  });
});

describe('送りすぎの制限', () => {
  it('1 秒に 5 回まで', () => {
    const r = new RateLimiter(5, 1000);
    for (let i = 0; i < 5; i++) expect(r.allow(100 + i)).toBe(true);
    expect(r.allow(200)).toBe(false);
    expect(r.allow(1200)).toBe(true);
  });
});

describe('入室と開始', () => {
  it('4 人まで。名前が使えなければ「プレイヤーN」', () => {
    const r = room();
    expect(join(r, null, 'あ', 0, tok)).toMatchObject({ ok: true, seat: 0 });
    expect(join(r, null, 'しね', 0, tok)).toMatchObject({ ok: true, seat: 1 });
    expect(r.seats[1].name).toBe('プレイヤー2');
    join(r, null, 'c', 0, tok);
    join(r, null, 'd', 0, tok);
    expect(join(r, null, 'e', 0, tok)).toMatchObject({ ok: false });
  });
  it('同じトークンなら同じ席に戻れる（再接続）', () => {
    const r = room();
    const a = join(r, null, 'あ', 0, tok);
    if (!a.ok) throw new Error();
    r.seats[0].connected = false;
    expect(join(r, a.token, 'x', 5, tok)).toMatchObject({ ok: true, seat: 0, token: a.token });
    expect(r.seats[0].connected).toBe(true);
  });
  it('始まったあとは新しい人は入れない', () => {
    const r = room();
    join(r, null, 'a', 0, tok);
    start(r, 1, 0);
    expect(join(r, null, 'b', 0, tok)).toMatchObject({ ok: false });
  });
  it('相手探し：4 人そろうか、2 人目から 30 秒で自動で始まり、空き席は CPU', () => {
    const r = room();
    join(r, null, 'a', 0, tok);
    expect(shouldAutoStart(r, 999_999)).toBe(false); // 1 人では自動で始めない
    join(r, null, 'b', 1000, tok);
    expect(shouldAutoStart(r, 1000 + AUTO_START_MS - 1)).toBe(false);
    expect(planWake(r, 2000)).toBe(1000 + AUTO_START_MS);
    expect(wake(r, 1000 + AUTO_START_MS, false, undefined, 7)).toBe(true);
    expect(r.game).not.toBeNull();
    expect(r.seats.map((s) => s.cpu)).toEqual([false, false, true, true]);
  });
  it('1 人で 60 秒待つと「CPU と始める」を押せる。合言葉の部屋は作った人がいつでも押せる', () => {
    const r = room();
    const a = join(r, null, 'a', 0, tok);
    if (!a.ok) throw new Error();
    expect(canRequestStart(r, a.token, ALONE_MS - 1)).toBe(false);
    expect(canRequestStart(r, a.token, ALONE_MS)).toBe(true);
    const p = room(true);
    const h = join(p, null, 'h', 0, tok);
    const g = join(p, null, 'g', 0, tok);
    if (!h.ok || !g.ok) throw new Error();
    expect(canRequestStart(p, h.token, 0)).toBe(true);
    expect(canRequestStart(p, g.token, 0)).toBe(false);
  });
  it('始まる前に作った人が抜けたら、次の人が作った人になる', () => {
    const p = room(true);
    join(p, null, 'h', 0, tok);
    const g = join(p, null, 'g', 0, tok);
    if (!g.ok) throw new Error();
    leaveLobby(p, 0);
    expect(p.hostToken).toBe(g.token);
    expect(p.seats).toHaveLength(1);
  });
});

describe('ゲームの進行', () => {
  const started = () => {
    const r = room();
    join(r, null, 'a', 0, tok);
    join(r, null, 'b', 0, tok);
    start(r, 3, 0);
    return r;
  };
  it('手番でない人の操作・できない操作は弾く', () => {
    const r = started();
    expect(act(r, 1, { type: 'roll' }, 10)).toMatchObject({ ok: false });
    expect(act(r, 0, { type: 'endTurn' }, 10)).toMatchObject({ ok: false });
    expect(act(r, 0, { type: 'roll' }, 10)).toMatchObject({ ok: true });
    expect(r.version).toBeGreaterThan(1);
  });
  it('時間切れなら代わりに動く', () => {
    const r = started();
    planWake(r, 0);
    expect(r.wakeAt).toBe(TURN_MS);
    expect(wake(r, TURN_MS - 1000)).toBe(false);
    expect(wake(r, TURN_MS)).toBe(true);
    expect(r.last).toMatchObject({ type: 'roll', seat: 0 });
  });
  it('切断中の人・CPU の番は、演出を待ってすぐ動く', () => {
    const r = started();
    r.seats[0].connected = false;
    const at = planWake(r, 100)!;
    expect(at).toBeLessThan(100 + TURN_MS);
  });
  it('人がいなくても、最後まで遊べる（全員切断・CPU だけで終わる）', () => {
    const r = started();
    r.seats.forEach((s) => { s.connected = false; });
    r.game!.maxRounds = 20;
    let now = 0;
    for (let i = 0; i < 20000 && r.game!.phase !== 'over'; i++) {
      now = planWake(r, now)!;
      wake(r, now);
    }
    expect(r.game!.phase).toBe('over');
    expect(r.endedAt).not.toBeNull();
  });
  it('送る形には乱数と山札の順番が入らない', () => {
    const r = started();
    r.game!.deck = [3, 1, 2];
    const v = viewFor(r, 0, 0);
    expect(v.game!.rng).toBe(0);
    expect(v.game!.deck).toEqual([]);
    expect(sanitize(r.game!).players).toEqual(r.game!.players);
    expect(v.you).toBe(0);
    expect(JSON.stringify(v)).not.toContain(r.seats[1].token); // 他人のトークンは送らない
  });
});

describe('競売（オンライン）', () => {
  it('競売中は入札する人だけが操作でき、時間切れなら代わりに決まる', () => {
    const r = room();
    join(r, null, 'a', 0, tok);
    join(r, null, 'b', 0, tok);
    start(r, 3, 0);
    const g = r.game!;
    const sq = g.props.findIndex((p, i) => p && i > 0);
    g.props[sq]!.owner = 0;
    expect(act(r, 0, { type: 'auction', sq }, 10)).toMatchObject({ ok: true });
    expect(r.game!.phase).toBe('auction');
    const bidder = r.game!.auction!.bidder; // 売り手の次の席（1 番）
    expect(bidder).toBe(1);
    expect(act(r, 0, { type: 'pass' }, 20)).toMatchObject({ ok: false }); // 売り手は入札できない
    expect(act(r, 1, { type: 'bid', raise: 10 }, 30)).toMatchObject({ ok: true });
    // 次は CPU の席。時間になれば代わりに決まり、最後は競売が終わる
    let now = 40;
    for (let i = 0; i < 50 && r.game!.phase === 'auction'; i++) {
      const who = r.game!.auction!.bidder;
      if (r.seats[who].cpu) { now = planWake(r, now)!; wake(r, now); } else act(r, who, { type: 'pass' }, ++now);
    }
    expect(r.game!.phase).not.toBe('auction');
  });
  it('競売の操作の形', () => {
    expect(isAction({ type: 'auction', sq: 3 })).toBe(true);
    expect(isAction({ type: 'bid', raise: 50 })).toBe(true);
    expect(isAction({ type: 'bid', raise: 7 })).toBe(false);
    expect(isAction({ type: 'pass' })).toBe(true);
  });
});
