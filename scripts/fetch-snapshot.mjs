/**
 * Pulls the site's data snapshot from R2 before a build.
 *
 * data.json is a build artifact regenerated from Neon every day, and committing
 * it was quietly destroying the repo: ~3MB of new git objects per day, on a file
 * that grows with the archive (9.6MB today, ~33MB in three years). Git would
 * have passed 1GB within a year. So the snapshot lives in the bucket next to the
 * images, and the build fetches it.
 *
 * --if-missing keeps local work fast: if you already exported a snapshot from
 * your own DB, that one is used. On a fresh clone (and on Vercel, where the file
 * is gitignored and therefore absent) it downloads the current one.
 *
 * Plain .mjs on purpose — this runs before the build, so it must not depend on
 * tsx or on anything the build itself sets up.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'src/generated/data.json';
const KEY = 'snapshot/data.json';

if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  console.log(`스냅샷이 이미 있습니다 (${OUT}) — 내려받지 않음`);
  process.exit(0);
}

// The bucket's public base lives in .env.production (it is a public URL, not a
// secret). Node does not load env files on its own, so read it here.
function mediaBase() {
  if (process.env.NEXT_PUBLIC_MEDIA_BASE_URL) return process.env.NEXT_PUBLIC_MEDIA_BASE_URL;
  try {
    const line = readFileSync('.env.production', 'utf8')
      .split('\n')
      .find((l) => l.startsWith('NEXT_PUBLIC_MEDIA_BASE_URL='));
    if (line) return line.slice('NEXT_PUBLIC_MEDIA_BASE_URL='.length).trim();
  } catch {
    /* fall through */
  }
  return '';
}

const base = mediaBase().replace(/\/$/, '');
if (!base) {
  console.error('❌ NEXT_PUBLIC_MEDIA_BASE_URL 이 없습니다 (.env.production 확인)');
  process.exit(1);
}

const url = `${base}/${KEY}`;
console.log(`스냅샷 내려받는 중: ${url}`);

const res = await fetch(url, { cache: 'no-store' });
if (!res.ok) {
  console.error(`❌ 스냅샷 다운로드 실패: HTTP ${res.status}`);
  console.error('   버킷에 스냅샷이 없으면 먼저 `npm run export:static && npm run upload:r2` 를 실행하세요.');
  process.exit(1);
}

const body = Buffer.from(await res.arrayBuffer());

// Fail loudly rather than build a site on a truncated snapshot.
let parsed;
try {
  parsed = JSON.parse(body.toString('utf8'));
} catch {
  console.error('❌ 스냅샷이 올바른 JSON 이 아닙니다 (전송 중 잘렸을 수 있음)');
  process.exit(1);
}
if (!parsed?.titles?.length || !parsed?.byTitle) {
  console.error('❌ 스냅샷 내용이 비어 있습니다 — 배포를 중단합니다');
  process.exit(1);
}

mkdirSync('src/generated', { recursive: true });
writeFileSync(OUT, body);

const kb = (body.length / 1024).toFixed(0);
const decks = Object.values(parsed.byTitle).reduce((n, list) => n + list.length, 0);
console.log(`✅ 스냅샷 ${kb}KB · 타이틀 ${parsed.titles.length}종 · 덱 ${decks}개 (생성 ${parsed.generatedAt})`);
