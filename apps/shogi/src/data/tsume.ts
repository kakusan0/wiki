// 詰将棋（本作のオリジナル問題）。scripts/gen-tsume.ts で作り、tests/tsume.test.ts で「ちょうど N 手詰め・正解の初手が 1 つ」を毎回確かめる
// 攻め方は先手（盤の下側）。受け方は、盤上と攻め方の持ち駒以外の駒をすべて持つ（詰将棋の決まり）
export interface Tsume { id: string; plies: number; title: string; sfen: string }
export const TSUME: Tsume[] = [
  { id: 't1-1', plies: 1, title: '1手詰め 第1問', sfen: '6+sk1/9/4L2n1/7N1/9/9/9/9/9 b G2r2b3g3s2n3l18p 1' },
  { id: 't1-2', plies: 1, title: '1手詰め 第2問', sfen: '6lSk/9/7p1/9/9/9/9/9/9 b GS2r2b3g2s4n3l17p 1' },
  { id: 't1-3', plies: 1, title: '1手詰め 第3問', sfen: '8k/6S1B/5G3/9/9/9/9/9/9 b 2rb3g3s4n4l18p 1' },
  { id: 't1-4', plies: 1, title: '1手詰め 第4問', sfen: '6k2/4B4/6+P2/9/5N3/9/9/9/9 b RNrb4g4s2n4l17p 1' },
  { id: 't1-5', plies: 1, title: '1手詰め 第5問', sfen: '7k1/8p/9/4G1N2/9/9/9/9/9 b BG2rb2g4s3n4l17p 1' },
  { id: 't1-6', plies: 1, title: '1手詰め 第6問', sfen: '7k1/9/8G/5n2P/9/9/9/9/9 b G2r2b2g4s3n4l17p 1' },
  { id: 't1-7', plies: 1, title: '1手詰め 第7問', sfen: '7k1/8n/8G/9/5R2B/9/9/9/9 b Grb2g4s3n4l18p 1' },
  { id: 't1-8', plies: 1, title: '1手詰め 第8問', sfen: '7nk/9/6PsS/8G/9/9/9/9/9 b B2rb3g2s3n4l17p 1' },
  { id: 't3-1', plies: 3, title: '3手詰め 第1問', sfen: '9/6S1k/7gs/7G1/9/7N1/9/9/9 b 2r2b2g2s3n4l18p 1' },
  { id: 't3-2', plies: 3, title: '3手詰め 第2問', sfen: '4s1k2/7s1/3P5/6B2/5R3/9/9/9/9 b RB4g2s4n4l17p 1' },
  { id: 't3-3', plies: 3, title: '3手詰め 第3問', sfen: '8k/9/5P1R1/9/7P1/9/9/9/9 b Brb4g4s4n4l16p 1' },
  { id: 't3-4', plies: 3, title: '3手詰め 第4問', sfen: '6k2/4+S4/6l+P1/4l4/4N4/9/9/9/9 b BP2rb4g3s3n2l16p 1' },
  { id: 't3-5', plies: 3, title: '3手詰め 第5問', sfen: '8k/9/8g/8+R/5S3/9/9/9/9 b Brb3g3s4n4l18p 1' },
  { id: 't3-6', plies: 3, title: '3手詰め 第6問', sfen: '9/8k/5NG2/7S1/9/9/9/9/9 b P2r2b3g3s3n4l17p 1' },
  { id: 't3-7', plies: 3, title: '3手詰め 第7問', sfen: '6k2/4R4/9/7R1/9/9/9/9/9 b N2b4g4s3n4l18p 1' },
  { id: 't3-8', plies: 3, title: '3手詰め 第8問', sfen: '9/7kP/8R/6L2/9/9/9/9/9 b BPrb4g4s4n3l16p 1' },
  { id: 't5-1', plies: 5, title: '5手詰め 第1問', sfen: '9/8k/6R2/9/9/9/9/9/9 b BSrb4g3s4n4l18p 1' },
  { id: 't5-2', plies: 5, title: '5手詰め 第2問', sfen: '9/8k/6Bs1/9/6+L2/9/9/9/9 b BG2r3g3s4n3l18p 1' },
  { id: 't5-3', plies: 5, title: '5手詰め 第3問', sfen: '6R+pk/9/5P3/7S1/9/9/9/9/9 b RP2b4g3s4n4l15p 1' },
  { id: 't5-4', plies: 5, title: '5手詰め 第4問', sfen: '6k2/9/9/7+RB/5+S3/9/9/9/9 b SPrb4g2s4n4l17p 1' },
  { id: 't5-5', plies: 5, title: '5手詰め 第5問', sfen: '9/8k/9/8G/6LS1/9/9/9/9 b RLr2b3g3s4n2l18p 1' },
  { id: 't5-6', plies: 5, title: '5手詰め 第6問', sfen: '7k1/5g3/5L3/5Bn2/9/9/9/9/9 b RPrb3g4s3n3l17p 1' },
];
