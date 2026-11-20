// 依頼の一覧：港の 40ft と、潮見貨物駅をはさむ 12ft（ひかり野線とつながる）
import type { Box12 } from '../link';

export const RIGID_CAP = 2; // 単車に積める 12ft の数

export type JobKind = 'port' | 'toStation' | 'fromStation';
export interface Job {
  kind: JobKind;
  title: string;
  detail: string;
  from: string;     // 場所の id（roadnet の PLACES）か 'port'
  to: string;
  boxes: Box12[];   // 駅から運ぶときの、運ぶコンテナ
}

/** 届け先の名前 → 場所の id */
export const DEST_ID: Record<string, string> = { 'ミドリ物流センター': 'midori', '潮見精機 第二工場': 'seiki' };

/** 駅に届いたコンテナから、駅からの依頼を作る（届け先ごとに 2 個まで） */
export function stationJobs(boxes: Box12[]): Job[] {
  const byDest = new Map<string, Box12[]>();
  for (const b of boxes) { if (!DEST_ID[b.dest]) continue; const l = byDest.get(b.dest) ?? []; l.push(b); byDest.set(b.dest, l); }
  const out: Job[] = [];
  for (const [dest, list] of byDest) {
    for (let i = 0; i < list.length; i += RIGID_CAP) {
      const part = list.slice(i, i + RIGID_CAP);
      const kg = part.reduce((a, b) => a + b.weight, 0);
      out.push({
        kind: 'fromStation', from: 'station', to: DEST_ID[dest], boxes: part,
        title: `駅から：潮見貨物駅 → ${dest}`,
        detail: `12ft × ${part.length}（${part.map((b) => b.contents).join('・')}）・${(kg / 1000).toFixed(1)} t`,
      });
    }
  }
  return out;
}

export function allJobs(stationBoxes: Box12[]): Job[] {
  return [
    { kind: 'port', from: 'port', to: 'midori', boxes: [], title: '港：潮見港 第 2 ターミナル → ミドリ物流センター', detail: '40ft × 1・18 t。クレーンで自分で積む' },
    { kind: 'toStation', from: 'seiki', to: 'station', boxes: [], title: '駅へ：潮見精機 → 潮見貨物駅', detail: `12ft × ${RIGID_CAP}・山ノ口あて。ひかり野線の貨物列車が運ぶ` },
    ...stationJobs(stationBoxes),
  ];
}
