/**
 * Cloud automation status: which secrets exist, and how the last runs went.
 *
 * Secret VALUES are never retrievable from GitHub — only names — which is
 * exactly what we want to confirm here. Pass --run to also dispatch a run and
 * watch it to completion.
 */
import { execFileSync } from 'node:child_process';

const OWNER = 'diashining41';
const REPO = 'WS_Deck';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

function githubToken(): string {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const tok = out.split('\n').find((l) => l.startsWith('password='))?.slice('password='.length);
  if (!tok) throw new Error('저장된 GitHub 자격증명을 찾지 못했습니다');
  return tok;
}

const token = githubToken();
const gh = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- secrets */

const REQUIRED = ['DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

const secRes = await gh('/actions/secrets');
if (!secRes.ok) throw new Error(`시크릿 조회 실패: HTTP ${secRes.status}`);
const { secrets } = (await secRes.json()) as { secrets: { name: string; updated_at: string }[] };
const names = new Set(secrets.map((s) => s.name));

console.log('등록된 시크릿:');
for (const n of REQUIRED) console.log(`  ${names.has(n) ? '✅' : '❌'} ${n}`);
const extra = secrets.filter((s) => !REQUIRED.includes(s.name));
if (extra.length) console.log(`  (기타: ${extra.map((s) => s.name).join(', ')})`);

const missing = REQUIRED.filter((n) => !names.has(n));
if (missing.length) {
  console.log(`\n❌ 누락: ${missing.join(', ')} — npm run setup:cloud 를 실행하세요`);
  process.exit(1);
}

if (!process.argv.includes('--run')) {
  const runs = await (await gh('/actions/workflows/accumulate.yml/runs?per_page=3')).json();
  console.log('\n최근 실행:');
  for (const r of (runs as { workflow_runs: { status: string; conclusion: string; created_at: string; html_url: string }[] }).workflow_runs ?? []) {
    console.log(`  ${r.created_at}  ${r.status}/${r.conclusion ?? '-'}`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------ dispatch+watch */

const before = (await (await gh('/actions/workflows/accumulate.yml/runs?per_page=1')).json()) as {
  workflow_runs: { id: number }[];
};
const beforeId = before.workflow_runs?.[0]?.id ?? 0;

const disp = await gh('/actions/workflows/accumulate.yml/dispatches', {
  method: 'POST',
  body: JSON.stringify({ ref: 'main' }),
});
if (disp.status !== 204) throw new Error(`실행 요청 실패: HTTP ${disp.status}`);
console.log('\n▶ 워크플로 실행 요청됨 — 새 실행을 기다리는 중…');

let runId = 0;
for (let i = 0; i < 20 && !runId; i++) {
  await sleep(3000);
  const res = (await (await gh('/actions/workflows/accumulate.yml/runs?per_page=1')).json()) as {
    workflow_runs: { id: number }[];
  };
  const id = res.workflow_runs?.[0]?.id ?? 0;
  if (id && id !== beforeId) runId = id;
}
if (!runId) {
  console.log('⚠ 새 실행을 찾지 못했습니다 — Actions 탭에서 확인하세요');
  process.exit(1);
}

console.log(`실행 https://github.com/${OWNER}/${REPO}/actions/runs/${runId}\n`);

for (let i = 0; i < 120; i++) {
  const r = (await (await gh(`/actions/runs/${runId}`)).json()) as { status: string; conclusion: string | null };
  if (r.status === 'completed') {
    const ok = r.conclusion === 'success';
    console.log(`\n${ok ? '✅' : '❌'} 실행 종료: ${r.conclusion}`);
    // Which step failed, if any.
    const jobs = (await (await gh(`/actions/runs/${runId}/jobs`)).json()) as {
      jobs: { steps: { name: string; conclusion: string | null }[] }[];
    };
    for (const step of jobs.jobs?.[0]?.steps ?? []) {
      const mark = step.conclusion === 'success' ? '✓' : step.conclusion === 'skipped' ? '-' : '✗';
      console.log(`  ${mark} ${step.name}`);
    }
    process.exit(ok ? 0 : 1);
  }
  process.stdout.write(`\r  ${r.status}… ${(i + 1) * 10}초`);
  await sleep(10_000);
}

console.log('\n⏱ 시간 초과 — Actions 탭에서 확인하세요');
