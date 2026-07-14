/**
 * Configures the GitHub Actions cloud automation, end to end.
 *
 * Uses the GitHub credential already stored on this machine (the one `git push`
 * uses) to push every secret the workflow needs — Neon plus the R2 bucket the
 * images now live in — and then trigger a run. Values are read from .env.local
 * and are never printed.
 *
 * Run:  npm run setup:cloud            (sync secrets)
 *       npm run setup:cloud -- --no-run (sync only, don't trigger a run)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import _sodium from 'libsodium-wrappers';

const OWNER = 'diashining41';
const REPO = 'WS_Deck';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

/** Every secret the workflow reads. Without R2 the runner would download images and lose them. */
const REQUIRED = [
  'DATABASE_URL',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const;

const env = new Map<string, string>();
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m?.[1] && m[2]) env.set(m[1], m[2].trim());
}

const missing = REQUIRED.filter((k) => !env.get(k));
if (missing.length) throw new Error(`.env.local 에 없는 값: ${missing.join(', ')}`);

// The GitHub token git already stored on this machine.
function githubToken(): string {
  const out = execFileSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const tok = out.split('\n').find((l) => l.startsWith('password='))?.slice('password='.length);
  if (!tok) throw new Error('저장된 GitHub 자격증명을 찾지 못했습니다 (git push 가 되는 상태여야 함)');
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

// Repo public key for sealing secrets (GitHub's required scheme).
const keyRes = await gh('/actions/secrets/public-key');
if (!keyRes.ok) throw new Error(`public-key 실패: HTTP ${keyRes.status} — 토큰에 secrets 권한이 없을 수 있습니다`);
const { key, key_id } = (await keyRes.json()) as { key: string; key_id: string };

await _sodium.ready;
const sodium = _sodium;

for (const name of REQUIRED) {
  const sealed = sodium.crypto_box_seal(
    sodium.from_string(env.get(name)!),
    sodium.from_base64(key, sodium.base64_variants.ORIGINAL),
  );
  const res = await gh(`/actions/secrets/${name}`, {
    method: 'PUT',
    body: JSON.stringify({
      encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL),
      key_id,
    }),
  });
  if (!res.ok) throw new Error(`시크릿 ${name} 설정 실패: HTTP ${res.status}`);
  console.log(`✅ 시크릿 ${name}`);
}

if (process.argv.includes('--no-run')) {
  console.log('\n시크릿만 동기화했습니다 (실행은 생략).');
  process.exit(0);
}

const runRes = await gh('/actions/workflows/accumulate.yml/dispatches', {
  method: 'POST',
  body: JSON.stringify({ ref: 'main' }),
});
if (runRes.status === 204) {
  console.log(`\n✅ accumulate 워크플로우 실행 시작 — https://github.com/${OWNER}/${REPO}/actions`);
} else {
  console.log(`\n⚠ 실행 요청 HTTP ${runRes.status} (시크릿은 설정됨 — Actions 탭에서 수동 실행 가능)`);
}
