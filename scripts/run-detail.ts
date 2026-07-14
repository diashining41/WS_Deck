/** Step-by-step status of a workflow run: npx tsx scripts/run-detail.ts [runId] */
import { execFileSync } from 'node:child_process';

const OWNER = 'diashining41';
const REPO = 'WS_Deck';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

const out = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
});
const token = out.split('\n').find((l) => l.startsWith('password='))!.slice('password='.length);

const gh = (p: string) =>
  fetch(`${API}${p}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  }).then((r) => r.json());

let runId = process.argv[2];
if (!runId) {
  const runs = (await gh('/actions/workflows/accumulate.yml/runs?per_page=1')) as {
    workflow_runs: { id: number }[];
  };
  runId = String(runs.workflow_runs?.[0]?.id ?? '');
}

const run = (await gh(`/actions/runs/${runId}`)) as { status: string; conclusion: string | null; html_url: string };
console.log(`실행 ${runId}: ${run.status} / ${run.conclusion ?? '-'}`);
console.log(run.html_url);

const jobs = (await gh(`/actions/runs/${runId}/jobs`)) as {
  jobs: { steps: { name: string; status: string; conclusion: string | null }[] }[];
};
console.log('');
for (const s of jobs.jobs?.[0]?.steps ?? []) {
  const mark =
    s.conclusion === 'success' ? '✓' : s.conclusion === 'failure' ? '✗' : s.status === 'in_progress' ? '▶' : '·';
  console.log(`  ${mark} ${s.name}${s.status === 'in_progress' ? '   ← 실행 중' : ''}`);
}
