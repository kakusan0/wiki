// ひかり野線とつなぐ：荷物の記録置き場（同じ公開先の /api）を呼ぶ。
// つないでいない、または呼べないときは、この端末の中だけの仮の記録で遊べる。

export interface Box12 { id: number; num: string; contents: string; weight: number; dest: string; at?: string; }
export interface Counts { stationOut: number; stationIn: number; truck: number; }

const KEY = 'truck.link';
const MOUNTAIN = '山ノ口';
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

function load(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
function save(v: string | null) { try { if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY); } catch { /* 覚えられなくても遊べる */ } }

export class Link {
  code: string | null = load();
  online = false;            // いま記録置き場とつながっているか
  private localId = 9000;
  private local: Box12[] = [
    // つないでいないときの、駅に届いている仮のコンテナ
    { id: 1, num: '19D-30588', contents: '木材', weight: 4700, dest: 'ミドリ物流センター', at: 'station' },
    { id: 2, num: '20D-41207', contents: '米', weight: 4900, dest: 'ミドリ物流センター', at: 'station' },
    { id: 3, num: '19D-28843', contents: '野菜', weight: 3300, dest: '潮見精機 第二工場', at: 'station' },
  ];

  private async call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T | null> {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify({ code: this.code, ...body }) : undefined });
      if (!r.ok) { this.online = false; return null; }
      this.online = true;
      return (await r.json()) as T;
    } catch { this.online = false; return null; }
  }

  /** 新しい連携コードを作る */
  async create(): Promise<string | null> {
    const r = await this.call<{ code: string }>('POST', 'link');
    if (r?.code) { this.code = r.code; save(r.code); }
    return r?.code ?? null;
  }
  /** ほかの端末で作ったコードを使う */
  async use(code: string): Promise<boolean> {
    code = code.trim().toUpperCase();
    if (!CODE_RE.test(code)) return false;
    const prev = this.code;
    this.code = code;
    if (await this.counts()) { save(code); return true; }
    this.code = prev;
    return false;
  }
  forget() { this.code = null; save(null); this.online = false; }

  async counts(): Promise<Counts | null> {
    if (!this.code) return null;
    const r = await this.call<{ counts: Counts }>('GET', `link?code=${this.code}`);
    return r?.counts ?? null;
  }

  /** 駅に届いている、町あてのコンテナ */
  async stationIn(): Promise<Box12[]> {
    if (this.code) {
      const r = await this.call<{ boxes: Box12[] }>('GET', `boxes?code=${this.code}&at=station&dir=in`);
      if (r) return r.boxes;
    }
    return this.local.filter((b) => b.at === 'station');
  }
  /** 工場で積む（山ノ口あて） */
  async factoryLoad(n: number): Promise<Box12[]> {
    if (this.code) {
      const r = await this.call<{ boxes: Box12[] }>('POST', 'factory/load', { n });
      if (r) return r.boxes.slice(-n);
    }
    const out: Box12[] = [];
    for (let i = 0; i < n; i++) out.push({ id: this.localId++, num: `20D-${50000 + Math.floor(Math.random() * 40000)}`, contents: '精密部品', weight: 4300, dest: MOUNTAIN, at: 'truck' });
    return out;
  }
  /** コンテナを動かす。つないでいなければ、この端末の中だけで動かす */
  async move(ids: number[], from: 'station' | 'truck', to: 'station' | 'truck' | 'delivered'): Promise<boolean> {
    if (this.code) {
      const r = await this.call<{ moved: number }>('POST', 'boxes/move', { ids, from, to });
      if (r) return r.moved === ids.length;
    }
    for (const b of this.local) if (ids.includes(b.id) && b.at === from) b.at = to;
    return true;
  }
}
