/** Vercel deployment result for a commit, via the GitHub commit status API. */
import { execFileSync } from 'node:child_process';

const OWNER = 'diashining41';
const REPO = 'WS_Deck';

const sha =
  process.argv[2] ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();

const out = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
});
const token = out.split('\n').find((l) => l.startsWith('password='))!.slice('password='.length);

const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/commits/${sha}/status`, {
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
});
const j = (await res.json()) as {
  state: string;
  statuses: { context: string; state: string; description: string; target_url: string }[];
};

console.log(`커밋 ${sha.slice(0, 7)} — 전체 상태: ${j.state}`);
if (!j.statuses?.length) {
  console.log('  (아직 배포 상태 보고 없음 — Vercel 이 빌드를 시작하지 않았거나 진행 중)');
}
for (const s of j.statuses ?? []) {
  const mark = s.state === 'success' ? '✅' : s.state === 'failure' || s.state === 'error' ? '❌' : '⏳';
  console.log(`  ${mark} ${s.context}: ${s.state} — ${s.description}`);
  if (s.target_url) console.log(`     ${s.target_url}`);
}
