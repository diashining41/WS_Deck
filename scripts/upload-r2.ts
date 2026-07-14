/**
 * Uploads the deployable images (thumb + medium) to Cloudflare R2.
 *
 * R2 keeps the archive's ~3GB of photos out of git and out of the Vercel
 * deployment; the site loads them from the bucket via NEXT_PUBLIC_MEDIA_BASE_URL.
 * R2 is S3-compatible, so this speaks S3.
 *
 * Two things make this fast enough for ~28,000 files:
 *   - uploads run CONCURRENTLY (a sequential HeadObject+Put per file took hours)
 *   - a local manifest records what has already been uploaded, so re-runs after
 *     each backfill batch only push the new files. --force ignores the manifest.
 *
 * Needs in the environment (or .env.local):
 *   R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY  R2_BUCKET
 *
 * Run:  npm run upload:r2            (only what's new)
 *       npm run upload:r2 -- --force (re-upload everything)
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { loadEnv } from '@/lib/env';

loadEnv();

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.log('❌ R2 자격증명이 없습니다. .env.local 에 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET 를 넣으세요.');
  process.exit(1);
}

const force = process.argv.includes('--force');
const CONCURRENCY = Number(process.env.R2_CONCURRENCY ?? 24);
const MANIFEST = '.data/r2-uploaded.json';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  maxAttempts: 5,
});

// Only the derivatives the site serves — never the originals (cold archive).
const ROOTS = ['public/media/thumb', 'public/media/medium'];

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return; // root not created yet
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** key -> byte size of what we already put in the bucket. */
type Manifest = Record<string, number>;
mkdirSync('.data', { recursive: true });
let done: Manifest = {};
if (!force) {
  try {
    done = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
  } catch {
    done = {};
  }
}

const all: { path: string; key: string; size: number }[] = [];
for (const root of ROOTS) {
  for (const path of walk(root)) {
    // Key mirrors the on-disk path under public/, so "/media/thumb/ab/x.webp"
    // resolves identically whether served locally or from R2.
    const key = relative('public', path).replace(/\\/g, '/');
    all.push({ path, key, size: statSync(path).size });
  }
}

const todo = all.filter((f) => done[f.key] !== f.size);

console.log(`디스크 ${all.length}개 · 이미 업로드 ${all.length - todo.length}개 · 이번에 올릴 것 ${todo.length}개`);
console.log(`→ r2://${R2_BUCKET} (동시 ${CONCURRENCY})\n`);

if (todo.length === 0) {
  // No new images — but the snapshot still has to go up, or the site would keep
  // building against yesterday's data.
  console.log('새로 올릴 이미지 없음');
  await uploadSnapshot();
  process.exit(0);
}

let uploaded = 0;
let failed = 0;
let bytes = 0;
let cursor = 0;
const started = Date.now();

async function worker(): Promise<void> {
  for (;;) {
    const i = cursor++;
    if (i >= todo.length) return;
    const f = todo[i]!;
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: f.key,
          Body: readFileSync(f.path),
          ContentType: f.key.endsWith('.png') ? 'image/png' : 'image/webp',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      done[f.key] = f.size;
      uploaded++;
      bytes += f.size;
    } catch (err) {
      failed++;
      if (failed <= 5) console.log(`✗ ${f.key}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (uploaded % 200 === 0 && uploaded > 0) {
      const mb = (bytes / 1024 / 1024).toFixed(0);
      const secs = (Date.now() - started) / 1000;
      console.log(`  ${uploaded}/${todo.length}  (${mb}MB, ${(uploaded / secs).toFixed(1)}개/초)`);
      writeFileSync(MANIFEST, JSON.stringify(done)); // checkpoint: survive a kill
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

writeFileSync(MANIFEST, JSON.stringify(done));

const mb = (bytes / 1024 / 1024).toFixed(0);
console.log(`\n✅ 이미지 업로드 ${uploaded}개 (${mb}MB)${failed ? ` · 실패 ${failed}개` : ''}`);
console.log(`   버킷 총 ${Object.keys(done).length}개 파일`);

await uploadSnapshot();

process.exit(failed > 0 ? 1 : 0);

/**
 * The site's data snapshot rides along to the bucket.
 *
 * Never manifest-skipped: it changes every run by design, and it must land
 * AFTER the images above — a snapshot that references a photo not yet in the
 * bucket renders as a broken thumbnail on the live site.
 */
async function uploadSnapshot(): Promise<void> {
  const path = 'src/generated/data.json';
  let body: Buffer;
  try {
    body = readFileSync(path);
  } catch {
    console.log('   (스냅샷 없음 — export:static 먼저 실행하세요)');
    return;
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: 'snapshot/data.json',
      Body: body,
      ContentType: 'application/json',
      // The build fetches this every deploy; a cached stale copy would ship
      // yesterday's archive.
      CacheControl: 'no-store, max-age=0',
    }),
  );
  console.log(`✅ 스냅샷 업로드 (${(body.length / 1024).toFixed(0)}KB → snapshot/data.json)`);
}
