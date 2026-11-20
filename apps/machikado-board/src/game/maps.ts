import type { GameMap, Square, Street } from './state';

// 盤の並びを短い記号で書く。B=銀行 P=広場 C=チャンス L=空き地 a〜d=スタンプ 0〜9=通り番号の店
const SHOP_NAMES = [
  ['パン工房', '八百屋', '喫茶こもれび', '豆腐店'],
  ['魚市場', '船具店', '潮風食堂', '干物屋'],
  ['木工房', '花屋', '茶葉店', '森のパン屋'],
  ['天文書房', '時計店', '夜カフェ', '雑貨ほしや'],
  ['和菓子処', '呉服店', '金物屋', '甘味茶屋'],
  ['自転車店', '写真館', '靴工房', '風見亭'],
];
const STREETS: Street[] = [
  { name: 'あさひ通り', color: '#E8833A' },
  { name: 'みなと通り', color: '#2F7FD3' },
  { name: 'もりの通り', color: '#3E9B5A' },
  { name: 'ほしぞら通り', color: '#7A55C8' },
  { name: 'さくら通り', color: '#D9547E' },
  { name: 'かぜの通り', color: '#1E9E9A' },
];

export const MIN_SIZE = 3;
export const MAX_SIZE = 14;
export const MIN_SQUARES = 12;
export const MIN_SHOPS_PER_STREET = 2;
export const MAX_SHOPS_PER_STREET = 4;
const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// 盤を格子の絵で書く。1 文字が 1 マスで、上下左右にとなり合うマスどうしがつながる。
// B=銀行 P=広場 C=チャンス L=空き地 a〜d=スタンプ 0〜9=通り番号の店 「.」と空白=何もない
export function parseMap(id: string, name: string, target: number, startCash: number,
  rows: string[], streetBase: number[]): { map: GameMap; errors: string[] } {
  const errors: string[] = [];
  const width = Math.max(0, ...rows.map((r) => r.length));
  const height = rows.length;
  if (rows.some((r) => r.length !== width)) errors.push('行の長さがそろっていません');
  const used = streetBase.map(() => 0);
  let chance = 0;
  const squares: Square[] = [];
  const at = new Map<string, number>();
  rows.forEach((row, y) => [...row].forEach((t, x) => {
    if (t === '.' || t === ' ') return;
    const id0 = squares.length;
    const base = { id: id0, x, y };
    let sq: Square;
    if (t === 'B') sq = { ...base, kind: 'bank', name: '銀行' };
    else if (t === 'P') sq = { ...base, kind: 'plaza', name: '広場' };
    else if (t === 'C') sq = { ...base, kind: 'chance', name: `チャンス${++chance}` };
    else if (t === 'L') sq = { ...base, kind: 'lot', name: '空き地', base: 200 };
    else if ('abcd'.includes(t)) {
      const s = 'abcd'.indexOf(t);
      sq = { ...base, kind: 'stamp', name: `${['パン', '花', '本', '鍵'][s]}のスタンプ`, stamp: s };
    } else if (/^[0-9]$/.test(t) && Number(t) < streetBase.length) {
      const street = Number(t);
      const k = used[street]++;
      sq = { ...base, kind: 'shop', name: SHOP_NAMES[street]?.[k] ?? `${street}-${k + 1}号店`, street, base: streetBase[street] + k * 20 };
    } else {
      errors.push(`${y + 1} 行 ${x + 1} 列の記号「${t}」は使えません`);
      return;
    }
    squares.push(sq);
    at.set(`${x},${y}`, id0);
  }));
  const links = squares.map((sq) => DIRS.map(([dx, dy]) => at.get(`${sq.x + dx},${sq.y + dy}`)).filter((v): v is number => v != null));
  const map: GameMap = { id, name, width, height, target, startCash, streets: STREETS.slice(0, streetBase.length), squares, links };
  if (streetBase.length > STREETS.length) errors.push(`通りは ${STREETS.length} 本までです（${streetBase.length} 本）`);
  return { map, errors };
}

// 盤の上での最短の歩数（向きは気にしない）
export function distances(m: GameMap, from: number): number[] {
  const d = m.squares.map(() => Infinity);
  d[from] = 0;
  const q = [from];
  while (q.length) {
    const v = q.shift()!;
    for (const w of m.links[v]) if (d[w] === Infinity) { d[w] = d[v] + 1; q.push(w); }
  }
  return d;
}

// 盤の形とバランスの確認。問題の一覧を返す（空なら正しい）
export function validateMap(m: GameMap): string[] {
  const e: string[] = [];
  const sq = m.squares;
  const shops = sq.filter((q) => q.kind === 'shop');
  const name = (q: Square) => `${q.y + 1} 行 ${q.x + 1} 列（${q.name}）`;

  // 形
  if (!/^[a-z][a-z0-9-]*$/.test(m.id)) e.push(`id「${m.id}」は英小文字・数字・ハイフンにしてください`);
  if (!m.name.trim()) e.push('マップ名が空です');
  if (m.width < MIN_SIZE || m.height < MIN_SIZE || m.width > MAX_SIZE || m.height > MAX_SIZE) {
    e.push(`盤の大きさは ${MIN_SIZE}〜${MAX_SIZE} マス四方です（${m.width}×${m.height}）`);
  }
  if (sq.length < MIN_SQUARES) e.push(`マスが少なすぎます（${sq.length}。${MIN_SQUARES} 以上）`);
  sq.forEach((q, i) => { if (q.id !== i) e.push(`${i} 番のマスの番号がずれています（${q.id}）`); });
  if (sq.length && distances(m, 0).some((d) => d === Infinity)) e.push('つながっていないマスがあります');
  // 行き止まりがあると「後ろに戻らない」で進めなくなる
  sq.forEach((q) => { if (m.links[q.id].length < 2) e.push(`${name(q)}が行き止まりです`); });
  // 2×2 で詰まったマスは、道がどこへつながるか分かりにくいので禁止
  const filled = new Set(sq.map((q) => `${q.x},${q.y}`));
  for (const q of sq) {
    if (filled.has(`${q.x + 1},${q.y}`) && filled.has(`${q.x},${q.y + 1}`) && filled.has(`${q.x + 1},${q.y + 1}`)) {
      e.push(`${name(q)}の右下が 2×2 のかたまりになっています`);
    }
  }
  const forks = sq.filter((q) => m.links[q.id].length >= 3).length;
  if (forks === 0) e.push('分かれ道が 1 つもありません');

  // 銀行
  const banks = sq.filter((q) => q.kind === 'bank');
  if (banks.length !== 1) e.push(`銀行はちょうど 1 つ必要です（${banks.length}）`);

  // スタンプ：4 種が 1 つずつ
  for (let s = 0; s < 4; s++) {
    const n = sq.filter((q) => q.kind === 'stamp' && q.stamp === s).length;
    if (n !== 1) e.push(`${['パン', '花', '本', '鍵'][s]}のスタンプは 1 つ必要です（${n}）`);
  }

  // 通り
  if (m.streets.length < 2) e.push('通りは 2 本以上必要です');
  m.streets.forEach((st, i) => {
    const own = shops.filter((q) => q.street === i);
    if (own.length < MIN_SHOPS_PER_STREET || own.length > MAX_SHOPS_PER_STREET) {
      e.push(`${st.name}のお店は ${MIN_SHOPS_PER_STREET}〜${MAX_SHOPS_PER_STREET} 軒にしてください（${own.length}）`);
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(st.color)) e.push(`${st.name}の色「${st.color}」が正しくありません`);
    // 通りのお店は、3 歩以内でつながるひとかたまりにする
    if (own.length > 1) {
      const dist = own.map((q) => distances(m, q.id));
      const seen = new Set([0]);
      const stack = [0];
      while (stack.length) {
        const a = stack.pop()!;
        own.forEach((q, b) => { if (!seen.has(b) && dist[a][q.id] <= 3) { seen.add(b); stack.push(b); } });
      }
      if (seen.size !== own.length) e.push(`${st.name}のお店が離れすぎています`);
    }
  });
  if (new Set(m.streets.map((s) => s.name)).size !== m.streets.length) e.push('通りの名前が重なっています');
  shops.forEach((q) => {
    if (q.street == null || q.street < 0 || q.street >= m.streets.length) e.push(`${q.name}の通りがありません`);
    if (!(q.base! > 0)) e.push(`${q.name}の価格が正しくありません`);
  });
  sq.filter((q) => q.kind === 'lot').forEach((q) => { if (!(q.base! > 0)) e.push(`${name(q)}の空き地の価格が正しくありません`); });

  // 名前
  const names = shops.map((q) => q.name);
  const dup = names.filter((x, i) => names.indexOf(x) !== i);
  if (dup.length) e.push(`お店の名前が重なっています：${[...new Set(dup)].join('、')}`);

  // 並び
  if (sq.filter((q) => q.kind === 'chance').length < 1) e.push('チャンスマスが 1 つ以上必要です');
  for (const q of sq) for (const w of m.links[q.id]) {
    const b = sq[w];
    if (w > q.id && q.kind !== 'shop' && q.kind !== 'stamp' && q.kind === b.kind) e.push(`${name(q)}と${name(b)}に同じ特殊マス（${q.kind}）が並んでいます`);
  }
  if (shops.length < sq.length * 0.4) e.push(`お店が少なすぎます（${shops.length}/${sq.length} マス。4 割以上）`);

  // お金
  const cheapest = Math.min(...shops.map((q) => q.base!));
  if (!(m.startCash > 0)) e.push('初期資金が正しくありません');
  if (m.startCash < cheapest * 3) e.push(`初期資金（${m.startCash}G）では一番安いお店を 3 軒買えません（${cheapest}G）`);
  if (m.target <= m.startCash * 2) e.push(`目標（${m.target}G）は初期資金の 2 倍より大きくしてください`);
  return e;
}

function build(...args: Parameters<typeof parseMap>): GameMap {
  const { map, errors } = parseMap(...args);
  const all = [...errors, ...validateMap(map)];
  if (all.length) throw new Error(`マップ「${map.id}」に問題があります：\n- ${all.join('\n- ')}`);
  return map;
}

export const MAPS: GameMap[] = [
  // 四角い道の真ん中を 1 本の近道が通る。上と下に分かれ道
  build('corner', 'ちいさな四つ角', 4000, 1200, [
    'B00a011',
    'C..2..1',
    '4..2..b',
    '4..P..1',
    'c..2..3',
    'P..C..3',
    '44dLC33',
  ], [100, 120, 140, 180, 220]),
  // 「日」の字の形。まん中の縦の道で、左と右の輪のどちらを回るか選ぶ
  build('harbor', 'みなとの商店街', 5000, 1500, [
    'B00a0C111',
    '2...L...1',
    'P...3...b',
    '2...3...C',
    '22c3P4d44',
  ], [120, 140, 170, 210, 250]),
  // 右上がへこんだ形に、縦の近道が 1 本。遠回りの道には高いお店が並ぶ
  build('grand', 'ひろがる大通り', 5500, 2000, [
    'B00a11C...',
    'C..5..1...',
    '0..5..1b22',
    '0..L.....2',
    'd..5.....L',
    '4..5.....2',
    'L44C33c33P',
  ], [120, 150, 190, 230, 270, 320]),
  // 外周を十字の道が横切る。分かれ道が 5 つあり、方向を選ぶ場面が多い
  build('cross', '十字路の街', 4200, 1500, [
    'B00a11C',
    '2..0..1',
    '2..L..1',
    'd33C44b',
    '2..P..5',
    'C..4..5',
    'L2Cc55P',
  ], [100, 130, 150, 180, 210, 240]),
  // 左右 2 つの輪を短い橋でつないだ形。どちらの輪を回るかで止まるお店が変わる
  build('twin', 'ふたつの広場', 3500, 1600, [
    'B00a0...C11b1',
    '2...0...1...3',
    'P...L5C54...3',
    '2...5...4...3',
    '22cC5...4d4P3',
  ], [110, 140, 170, 200, 230, 260]),
  // 横長の大きな外周に、縦の近道が 2 本。いちばん長いマップ
  build('hills', '港と丘の大回り', 4200, 2000, [
    'B00a0C11L11C',
    'C...0...3..b',
    '5...P...3..4',
    'd...2...C..4',
    '5...2...3..P',
    'L552c2P3L44C',
  ], [120, 150, 190, 230, 270, 320]),
];

// マップどうしの確認（id の重なり）
export function validateMaps(maps: GameMap[]): string[] {
  const ids = maps.map((m) => m.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  return dup.length ? [`マップの id が重なっています：${[...new Set(dup)].join('、')}`] : [];
}
{
  const errs = validateMaps(MAPS);
  if (errs.length) throw new Error(errs.join('\n'));
}

export function getMap(id: string): GameMap {
  const m = MAPS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown map ${id}`);
  return m;
}

export const bankOf = (m: GameMap) => m.squares.find((q) => q.kind === 'bank')!.id;

// 進める先：つながっているマスのうち、来た方向（後ろ）以外
export function forwardOptions(m: GameMap, pos: number, prev: number | null): number[] {
  const opts = m.links[pos].filter((w) => w !== prev);
  return opts.length ? opts : m.links[pos];
}

// ちょうど n 歩進んで止まる可能性のあるマス（分かれ道はすべての方向を数える。後ろへは戻らない）
export function landingAfter(m: GameMap, pos: number, prev: number | null, n: number): Set<number> {
  let now: [number, number | null][] = [[pos, prev]];
  for (let i = 0; i < n; i++) {
    const next = new Map<string, [number, number | null]>();
    for (const [p, q] of now) for (const w of forwardOptions(m, p, q)) next.set(`${w}:${p}`, [w, p]);
    now = [...next.values()];
  }
  return new Set(now.map(([p]) => p));
}

// 分かれ道でその方向を選んだときに止まるマス（その先にも分かれ道があれば候補が複数）
export function stopsVia(m: GameMap, from: number, option: number, left: number): number[] {
  return [...landingAfter(m, option, from, Math.max(0, left - 1))];
}

// サイコロの目（1〜6）ごとに止まる可能性のあるマス：マス → 目の一覧
export function landingByDice(m: GameMap, pos: number, prev: number | null): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let d = 1; d <= 6; d++) for (const sq of landingAfter(m, pos, prev, d)) out.set(sq, [...(out.get(sq) ?? []), d]);
  return out;
}

// 2 マスの位置関係から矢印
export function arrow(m: GameMap, from: number, to: number): string {
  const a = m.squares[from], b = m.squares[to];
  return b.x > a.x ? '→' : b.x < a.x ? '←' : b.y > a.y ? '↓' : '↑';
}
