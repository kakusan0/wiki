// 公開先の設定。SUBDOMAIN は Cloudflare の workers.dev のサブドメイン（https://<作品>.<ここ>.workers.dev/）。
// 空のときは「遊ぶ」のリンクを出さない。ビルドのときの環境変数 WORKERS_SUBDOMAIN でも決められる
export const SUBDOMAIN = process.env.WORKERS_SUBDOMAIN ?? '';
export const OWNER = 'kakusan0';
