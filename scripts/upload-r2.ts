/**
 * Uploads the deployable images (thumb + medium) to Cloudflare R2.
 *
 * R2 keeps the 112MB of images out of git and out of the Vercel deployment; the
 * site loads them from the bucket's public URL via NEXT_PUBLIC_MEDIA_BASE_URL.
 * R2 is S3-compatible, so this speaks S3.
 *
 * Needs these in the environment (or .env.local):
 *   R2_ACCOUNT_ID          Cloudflare account id
 *   R2_ACCESS_KEY_ID       R2 API token — Access Key ID
 *   R2_SECRET_ACCESS_KEY   R2 API token — Secret Access Key
 *   R2_BUCKET              bucket name
 *
 * Run:  npm run upload:r2         (uploads only what's missing/changed)
 *       npm run upload:r2 --force (re-uploads everything)
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { loadEnv } from '@/lib/env';

loadEnv();

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.log('❌ R2 자격증명이 없습니다. .env.local 에 아래를 넣으세요:\n');
  console.log('   R2_ACCOUNT_ID=...');
  console.log('   R2_ACCESS_KEY_ID=...        (R2 → Manage API Tokens 에서 발급)');
  console.log('   R2_SECRET_ACCESS_KEY=...');
  console.log('   R2_BUCKET=ws-deckcheck-media\n');
  process.exit(1);
}

const force = process.argv.includes('--force');

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

// Only the derivatives the site serves — never the 349MB of originals.
const ROOTS = ['public/media/thumb', 'public/media/medium'];

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files: string[] = [];
for (const root of ROOTS) for (const f of walk(root)) files.push(f);

console.log(`업로드 대상 ${files.length}개 파일 → r2://${R2_BUCKET}\n`);

async function existsSameSize(key: string, size: number): Promise<boolean> {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return head.ContentLength === size;
  } catch {
    return false;
  }
}

let uploaded = 0;
let skipped = 0;

for (const [i, path] of files.entries()) {
  // Key mirrors the on-disk path under public/, so "/media/thumb/ab/x.webp"
  // resolves the same whether served locally or from R2.
  const key = relative('public', path).replace(/\\/g, '/');
  const body = readFileSync(path);

  if (!force && (await existsSameSize(key, body.length))) {
    skipped++;
  } else {
    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: body,
        ContentType: key.endsWith('.png') ? 'image/png' : 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
    uploaded++;
  }

  if ((i + 1) % 100 === 0 || i === files.length - 1) {
    process.stdout.write(`\r  ${i + 1}/${files.length}  (업로드 ${uploaded} · 스킵 ${skipped})`);
  }
}

console.log(`\n\n✅ 업로드 ${uploaded}개 · 이미 최신 ${skipped}개`);
console.log(`\n다음 단계:`);
console.log(`  1. R2 버킷에 Public access 를 켜고 (r2.dev URL 또는 커스텀 도메인)`);
console.log(`  2. Vercel 환경변수에 설정:`);
console.log(`     NEXT_PUBLIC_MEDIA_BASE_URL = https://pub-xxxx.r2.dev`);
console.log(`  3. 재배포하면 이미지가 R2에서 로드됩니다`);

process.exit(0);
