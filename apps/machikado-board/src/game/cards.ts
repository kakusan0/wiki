// チャンスカード 20 種（本作オリジナル）
export interface Card {
  id: number;
  title: string;
  text: string;
}

export const CARDS: Card[] = [
  { id: 0, title: '商店街まつり', text: 'ほかの全員から 20G ずつもらう' },
  { id: 1, title: '落とし物を届けた', text: 'お礼に 100G もらう' },
  { id: 2, title: '町内会費', text: '50G 払う' },
  { id: 3, title: '近道を見つけた', text: '銀行へひとっとび' },
  { id: 4, title: '追い風', text: '3 マス進む' },
  { id: 5, title: 'スタンプラリー', text: '足りないスタンプを 1 つもらう' },
  { id: 6, title: '雑誌に載った', text: 'どこかの通りの人気が上がる（株価 +8%）' },
  { id: 7, title: '長雨', text: 'どこかの通りの客足が減る（株価 −8%）' },
  { id: 8, title: '売上好調', text: '自分のお店 1 軒につき 30G もらう' },
  { id: 9, title: '修繕の季節', text: '自分のお店 1 軒につき 20G 払う' },
  { id: 10, title: '配当の上乗せ', text: '持ち株 10 株につき 3G もらう' },
  { id: 11, title: 'おすそわけ', text: '一番お金の多い人から 80G もらう' },
  { id: 12, title: 'くじびき', text: 'サイコロの目 × 30G もらう' },
  { id: 13, title: '臨時休業', text: '次の自分の番まで、自分のお店の利用料が入らない' },
  { id: 14, title: '開店さがし', text: 'いちばん近い空き店舗へ移動（なければ何もない）' },
  { id: 15, title: '夕立', text: '全員 30G 払う' },
  { id: 16, title: '地域振興券', text: '150G もらう' },
  { id: 17, title: '広告を出した', text: '自分のお店の価値の合計の 5% を払う' },
  { id: 18, title: '常連さん', text: '自分の一番高いお店の価値の 20% をもらう' },
  { id: 19, title: '寄付', text: '一番お金の少ない人に 60G 渡す' },
];
