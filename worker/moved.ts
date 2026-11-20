// 前のパスから、いまのパスへの転送（作品をまとめたとき用）
// 1 つにまとめた作品の、前のパス → いまのパス（クエリは残し、乗り物を選んだ形で開く）
export const MOVED: Record<string, { to: string; mode?: string }> = {
  truck: { to: 'shiomi', mode: 'truck' },
  'train-sim': { to: 'shiomi', mode: 'train' },
};
const MOVED_WIKI: Record<string, string> = { truck: 'shiomi', 'train-sim': 'shiomi' };

/** 前のパスなら、転送先の URL */
export function movedTo(url: URL): string | null {
  const [, seg, sub] = url.pathname.split('/');
  const m = MOVED[seg];
  if (m) {
    const u = new URL(`/${m.to}/`, url);
    u.search = url.search;
    if (m.mode && !u.searchParams.has('mode')) u.searchParams.set('mode', m.mode);
    return u.toString();
  }
  if (seg === 'wiki' && sub && MOVED_WIKI[sub]) return new URL(`/wiki/${MOVED_WIKI[sub]}/`, url).toString();
  return null;
}
