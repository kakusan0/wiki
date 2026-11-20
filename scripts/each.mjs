// 全作品で、同じ npm スクリプト（test・typecheck）を順に回す。1 つでも失敗したら止める
import { execSync } from 'node:child_process';
import { APPS } from './apps.mjs';
const script = process.argv[2];
const root = new URL('..', import.meta.url).pathname;
const skip = new Set((process.env.SKIP_APPS ?? '').split(',').filter(Boolean));
for (const a of APPS) {
  if (skip.has(a.id)) { console.log(`\n=== ${a.id}：${script} は飛ばします（SKIP_APPS）`); continue; }
  console.log(`\n=== ${a.id}：${script}`);
  execSync(`npm run ${script} -w apps/${a.id}`, { cwd: root, stdio: 'inherit' });
}
