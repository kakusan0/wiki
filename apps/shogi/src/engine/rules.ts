// 駒と盤のルール。本将棋（9×9）・5五将棋（5×5）・ミニ将棋（3×4）を同じ仕組みで扱う

// 駒の種類（正の数）。盤には先手は正、後手は負で入れる
export const P = 1, L = 2, N = 3, S = 4, G = 5, B = 6, R = 7, K = 8;
export const TP = 9, NL = 10, NN = 11, NS = 12, UM = 13, RY = 14; // と・成香・成桂・成銀・馬・竜
export type PieceType = number;

export const HAND_TYPES = [R, B, G, S, N, L, P]; // 持ち駒の並び（強い順）

export const isPromoted = (t: PieceType) => t >= TP;
export const canPromoteType = (t: PieceType) => t === P || t === L || t === N || t === S || t === B || t === R;
export const promote = (t: PieceType) => (t <= S ? t + 8 : t === B ? UM : t === R ? RY : t);
export const unpromote = (t: PieceType) => (t >= TP && t <= NS ? t - 8 : t === UM ? B : t === RY ? R : t);

// 表示の文字
export const KANJI: Record<number, string> = {
  [P]: '歩', [L]: '香', [N]: '桂', [S]: '銀', [G]: '金', [B]: '角', [R]: '飛', [K]: '玉',
  [TP]: 'と', [NL]: '杏', [NN]: '圭', [NS]: '全', [UM]: '馬', [RY]: '竜',
};
export const NAME: Record<number, string> = {
  [P]: '歩', [L]: '香', [N]: '桂', [S]: '銀', [G]: '金', [B]: '角', [R]: '飛', [K]: '玉',
  [TP]: 'と', [NL]: '成香', [NN]: '成桂', [NS]: '成銀', [UM]: '馬', [RY]: '竜',
};
export const SFEN_CHAR: Record<number, string> = { [P]: 'P', [L]: 'L', [N]: 'N', [S]: 'S', [G]: 'G', [B]: 'B', [R]: 'R', [K]: 'K' };

// 動き（先手から見た向き。dy = -1 が前）。step は 1 マス、slide は走る
const GOLD: [number, number][] = [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]];
const KING: [number, number][] = [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1]];
const DIAG: [number, number][] = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const ORTHO: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
export const MOVES: Record<number, { step: [number, number][]; slide: [number, number][] }> = {
  [P]: { step: [[0, -1]], slide: [] },
  [L]: { step: [], slide: [[0, -1]] },
  [N]: { step: [[-1, -2], [1, -2]], slide: [] },
  [S]: { step: [[0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]], slide: [] },
  [G]: { step: GOLD, slide: [] },
  [B]: { step: [], slide: DIAG },
  [R]: { step: [], slide: ORTHO },
  [K]: { step: KING, slide: [] },
  [TP]: { step: GOLD, slide: [] },
  [NL]: { step: GOLD, slide: [] },
  [NN]: { step: GOLD, slide: [] },
  [NS]: { step: GOLD, slide: [] },
  [UM]: { step: ORTHO, slide: DIAG },
  [RY]: { step: DIAG, slide: ORTHO },
};

// 駒の価値（評価・入玉の点数）
export const VALUE: Record<number, number> = {
  [P]: 100, [L]: 300, [N]: 350, [S]: 500, [G]: 550, [B]: 800, [R]: 1000, [K]: 0,
  [TP]: 520, [NL]: 520, [NN]: 520, [NS]: 540, [UM]: 1050, [RY]: 1250,
};

export interface Ruleset {
  id: 'standard' | 'mini55' | 'mini34';
  name: string;
  w: number;
  h: number;
  zone: number; // 敵陣の段数（成れる範囲）
  start: string; // 平手の初期局面（SFEN）
  nyugyoku: boolean; // 入玉宣言があるか
}

export const RULESETS: Record<Ruleset['id'], Ruleset> = {
  standard: {
    id: 'standard', name: '本将棋', w: 9, h: 9, zone: 3, nyugyoku: true,
    start: 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1',
  },
  // 5五将棋：昔からある 5×5 の変則将棋。敵陣は 1 段目
  mini55: {
    id: 'mini55', name: '5五将棋', w: 5, h: 5, zone: 1, nyugyoku: false,
    start: 'rbsgk/4p/5/P4/KGSBR b - 1',
  },
  // ミニ将棋（本作独自）：3×4・玉金銀歩。敵陣は 1 段目
  mini34: {
    id: 'mini34', name: 'ミニ将棋', w: 3, h: 4, zone: 1, nyugyoku: false,
    start: 'gks/3/3/SKG b Pp 1', // 歩は盤に置かず、持ち駒で 1 枚ずつ持って始める
  },
};

// 駒落ち（本将棋）：上手（後手）から取り除く駒。SFEN の初期局面で表す（上手が先に指す）
export const HANDICAPS: { id: string; name: string; sfen: string }[] = [
  { id: 'even', name: '平手', sfen: RULESETS.standard.start },
  { id: 'lance', name: '香落ち', sfen: 'lnsgkgsn1/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1' },
  { id: 'bishop', name: '角落ち', sfen: 'lnsgkgsnl/1r7/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1' },
  { id: 'rook', name: '飛車落ち', sfen: 'lnsgkgsnl/7b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1' },
  { id: 'two', name: '二枚落ち', sfen: 'lnsgkgsnl/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1' },
  { id: 'four', name: '四枚落ち', sfen: '1nsgkgsn1/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1' },
  { id: 'six', name: '六枚落ち', sfen: '2sgkgs2/9/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1' },
];
