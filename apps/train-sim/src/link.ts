// トラックのゲームとつなぐ：潮見貨物駅で待つコンテナを読み、貨物列車が着いたら知らせる。
// 呼び先はトラックのゲームの公開先（/api）。連携コードはこの端末に覚える。
import type { Box12 } from './freight';

const KEY = 'trainsim.link';
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
/** トラックのゲームの公開先。?api= で差し替えられる（開発で確かめる用） */
export const LINK_API = (new URLSearchParams(location.search).get('api') ?? import.meta.env.VITE_LINK_API ?? '').replace(/\/$/, '');

function load(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
function save(v: string | null) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* 覚えられなくても遊べる */ } }

export interface RunResult { carried: Box12[]; arrived: (Box12 & { dest: string })[]; }

export class Link {
  code: string | null = load();
  get ready() { return !!(LINK_API && this.code); }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T | null> {
    if (!LINK_API) return null;
    try {
      const r = await fetch(`${LINK_API}/api/${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify({ code: this.code, ...body }) : undefined });
      if (!r.ok) return null;
      return (await r.json()) as T;
    } catch { return null; }
  }

  /** コードを確かめて覚える。駅で待つ数を返す（違えば null） */
  async use(code: string): Promise<{ stationOut: number; stationIn: number } | null> {
    code = code.trim().toUpperCase();
    if (!CODE_RE.test(code)) return null;
    const prev = this.code;
    this.code = code;
    const r = await this.call<{ counts: { stationOut: number; stationIn: number } }>('GET', `link?code=${code}`);
    if (r) { save(code); return r.counts; }
    this.code = prev;
    return null;
  }
  forget() { this.code = null; save(null); }
  async counts() { return this.ready ? (await this.call<{ counts: { stationOut: number; stationIn: number } }>('GET', `link?code=${this.code}`))?.counts ?? null : null; }

  /** 潮見貨物駅で待つ、山ノ口あてのコンテナ。つないでいなければ仮のもの */
  async waiting(): Promise<{ boxes: Box12[]; linked: boolean }> {
    if (this.ready) {
      const r = await this.call<{ boxes: Box12[] }>('GET', `boxes?code=${this.code}&at=station&dir=out`);
      if (r) return { boxes: r.boxes.slice(0, 5), linked: true };
    }
    return { boxes: [{ id: 0, num: '20D-41207', contents: '精密部品' }, { id: 0, num: '19D-30588', contents: '機械部品' }, { id: 0, num: '20D-53184', contents: '日用品' }], linked: false };
  }

  /** 山ノ口に着いた：運んだ分が届き、帰りの列車が町あてのコンテナを駅へ持ち帰る */
  async arrive(): Promise<RunResult | null> {
    return this.ready ? this.call<RunResult>('POST', 'train/run') : null;
  }
}
