// 作品の一覧（ビルドとテストで使う）。vite：画面を Vite で作る作品。files：ファイルをそのまま出す作品
export const APPS = [
  { id: 'shiomi', kind: 'vite' },
  { id: 'shogi', kind: 'vite' },
  { id: 'hanafuda', kind: 'vite' },
  { id: 'medal-pusher', kind: 'vite' },
  { id: 'machikado-board', kind: 'vite' },
  { id: 'netspeed', kind: 'vite' },
  { id: 'qr-order', kind: 'files', dir: 'public' },
];
