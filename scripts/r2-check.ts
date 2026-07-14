/** Verifies R2 credentials + public access with one throwaway object. */
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { loadEnv } from '@/lib/env';

loadEnv();

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.log('❌ R2 자격증명 누락');
  process.exit(1);
}

const PUBLIC_BASE = process.argv[2];
if (!PUBLIC_BASE) {
  console.log('사용법: tsx scripts/r2-check.ts https://pub-xxxx.r2.dev');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const key = 'media/_healthcheck.txt';
const body = `ws-deckcheck r2 ok`;

console.log(`버킷: ${R2_BUCKET}`);
try {
  await s3.send(
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: 'text/plain' }),
  );
  console.log('✅ 업로드 성공 (자격증명 유효)');
} catch (e) {
  console.log(`❌ 업로드 실패: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

const url = `${PUBLIC_BASE.replace(/\/$/, '')}/${key}`;
const res = await fetch(url);
const text = res.ok ? (await res.text()).trim() : '';
if (res.ok && text === body) {
  console.log(`✅ 공개 접근 성공 (${url} → HTTP ${res.status})`);
} else {
  console.log(`❌ 공개 접근 실패: HTTP ${res.status} — Public Development URL 이 꺼져 있을 수 있습니다`);
}

await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
console.log('🧹 테스트 객체 삭제 완료');
process.exit(0);
