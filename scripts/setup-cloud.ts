/**
 * Configures the GitHub Actions cloud automation, end to end.
 *
 * Uses the GitHub credential already stored on this machine (the one `git push`
 * uses) to: set the DATABASE_URL repository secret so the workflow can reach
 * Neon, then trigger the first run. The token is never printed.
 *
 * Run once:  npm run setup:cloud
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import _sodium from 'libsodium-wrappers';

const OWNER = 'diashining41';
const REPO = 'WS_Deck';
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;

// DATABASE_URL from .env.local (never committed).
const envLine = readFileSync('.env.local', 'utf8')
  .split('\n')
  .find((l) => l.startsWith('DATABASE_URL='));
const DATABASE_URL = envLine?.slice('DATABASE_URL='.length).trim();
if (!DATABASE_URL) throw new Error('.env.local 에 DATABASE_URL 이 없습니다');

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

// 1. Repo public key for sealing the secret.
const keyRes = await gh('/actions/secrets/public-key');
if (!keyRes.ok) throw new Error(`public-key 실패: HTTP ${keyRes.status} — 토큰에 secrets 권한이 없을 수 있습니다`);
const { key, key_id } = (await keyRes.json()) as { key: string; key_id: string };

// 2. Seal DATABASE_URL with libsodium (GitHub's required scheme).
await _sodium.ready;
const sodium = _sodium;
const sealed = sodium.crypto_box_seal(
  sodium.from_string(DATABASE_URL),
  sodium.from_base64(key, sodium.base64_variants.ORIGINAL),
);
const encrypted_value = sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);

// 3. Write the secret.
const putRes = await gh('/actions/secrets/DATABASE_URL', {
  method: 'PUT',
  body: JSON.stringify({ encrypted_value, key_id }),
});
if (!putRes.ok) throw new Error(`시크릿 설정 실패: HTTP ${putRes.status}`);
console.log('✅ GitHub 시크릿 DATABASE_URL 설정됨');

// 4. Trigger the first run.
const runRes = await gh('/actions/workflows/accumulate.yml/dispatches', {
  method: 'POST',
  body: JSON.stringify({ ref: 'main' }),
});
if (runRes.status === 204) {
  console.log('✅ accumulate 워크플로우 실행 시작됨');
  console.log(`\n실행 상태: https://github.com/${OWNER}/${REPO}/actions`);
} else {
  console.log(`⚠ 워크플로우 실행 요청 HTTP ${runRes.status} (시크릿은 설정됨 — Actions 탭에서 수동 실행 가능)`);
}

console.log('\n이제 매일 06:00 KST 에 클라우드에서 자동으로 대회 트윗이 쌓입니다.');
console.log('게시는 로컬 검수: npm run dev → /admin/review');
