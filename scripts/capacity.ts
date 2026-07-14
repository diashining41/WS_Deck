/** Capacity report: where the archive is growing and what runs out first. */
import { readFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';

const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
const gb = (b: number) => (b / 1024 / 1024 / 1024).toFixed(2);

/* ---------------------------------------------------------------- R2 size */
let r2Bytes = 0;
let r2Files = 0;
try {
  const m = JSON.parse(readFileSync('.data/r2-uploaded.json', 'utf8')) as Record<string, number>;
  for (const v of Object.values(m)) r2Bytes += v;
  r2Files = Object.keys(m).length;
} catch {
  /* no manifest */
}

/* ----------------------------------------------------------- Neon DB size */
const dbSize = rows<{ total: string }>(
  await db.execute(sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS total`),
)[0];

const tables = rows<{ table: string; size: string; bytes: number }>(
  await db.execute(sql`
    SELECT relname AS table,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
           pg_total_relation_size(c.oid)::bigint AS bytes
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 6
  `),
);

/* ------------------------------------------------------------ growth rate */
const growth = rows<{ decks: number; images: number; days: number }>(
  await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM decks WHERE sort_at > now() - interval '90 days') AS decks,
      (SELECT count(*)::int FROM images i JOIN posts p ON p.id = i.post_id
         WHERE p.posted_at > now() - interval '90 days') AS images,
      90 AS days
  `),
)[0]!;

const [counts] = rows<{ decks: number; images: number; posts: number }>(
  await db.execute(sql`
    SELECT (SELECT count(*)::int FROM decks) decks,
           (SELECT count(*)::int FROM images) images,
           (SELECT count(*)::int FROM posts) posts
  `),
);

const avgImg = r2Files > 0 ? r2Bytes / (r2Files / 2) : 0; // thumb+medium per image
const imgPerDay = growth.images / growth.days;
const bytesPerDay = imgPerDay * avgImg;
const bytesPerYear = bytesPerDay * 365;

const R2_FREE = 10 * 1024 ** 3;
const yearsLeft = (R2_FREE - r2Bytes) / bytesPerYear;

console.log('■ R2 (무료 10GB)');
console.log(`   현재      ${gb(r2Bytes)} GB · 파일 ${r2Files}개 (이미지 ${Math.round(r2Files / 2)}장)`);
console.log(`   장당 평균 ${(avgImg / 1024).toFixed(0)} KB (thumb+medium)`);
console.log(`   남은 여유 ${gb(R2_FREE - r2Bytes)} GB`);

console.log('\n■ 최근 90일 증가 속도');
console.log(`   덱 ${growth.decks}개 · 이미지 ${growth.images}장 → 하루 이미지 ${imgPerDay.toFixed(1)}장 · ${mb(bytesPerDay)} MB/일`);
console.log(`   연간 약 ${gb(bytesPerYear)} GB/년`);
console.log(`   → R2 무료 한도까지 약 ${yearsLeft.toFixed(1)}년`);

console.log(`\n■ Neon DB (무료 0.5GB): ${dbSize?.total}`);
for (const t of tables) console.log(`   ${t.table.padEnd(16)} ${t.size}`);

console.log(`\n■ 현재 총량: 덱 ${counts?.decks} · 게시물 ${counts?.posts} · 이미지 ${counts?.images}`);

await closeDb();
