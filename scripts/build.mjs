// サイトをまとめて作る：dist/<作品>/ に各作品、dist/wiki/ に作品 wiki
// 作品の画面は、公開先のパス（/<作品>/）を base にしてビルドする
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { APPS } from './apps.mjs';

const root = new URL('..', import.meta.url).pathname;
const dist = `${root}dist`;
const only = process.argv[2];
if (!only) rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const a of APPS) {
  if (only && only !== a.id) continue;
  const out = `${dist}/${a.id}`;
  console.log(`\n=== ${a.id}`);
  if (a.kind === 'vite') {
    execSync(`npm run build -w apps/${a.id} -- --base /${a.id}/ --outDir ${out} --emptyOutDir`, { cwd: root, stdio: 'inherit' });
  } else {
    rmSync(out, { recursive: true, force: true });
    cpSync(`${root}apps/${a.id}/${a.dir}`, out, { recursive: true, filter: (src) => !src.endsWith('/_headers') });
  }
}

// 作品 wiki（一覧と作品ごとのページ。トップと 404 のページも）
if (!only || only === 'wiki') execSync('node site/build.mjs', { cwd: root, stdio: 'inherit' });

// 応答のヘッダー：QR オーダーの安全のための決まりを、/qr-order/ の下にだけ付ける
const qrHeaders = readFileSync(`${root}apps/qr-order/public/_headers`, 'utf8').replace(/^\/\*/m, '/qr-order/*');
writeFileSync(`${dist}/_headers`, qrHeaders);
console.log('\nサイトを dist/ に作りました');
