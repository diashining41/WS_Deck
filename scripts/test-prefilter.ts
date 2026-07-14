/**
 * Recall test for the prefilter.
 *
 * Every imported post is a tournament post — a human put it in the sheet. So the
 * prefilter must pass essentially all of them. Anything it rejects is a keyword
 * we're missing, and each one would have silently cost us a deck.
 */
import { eq, ne, sql } from 'drizzle-orm';

import { db } from '@/db';
import { images, posts } from '@/db/schema';
import { prefilter, PASS_THRESHOLD } from '@/lib/prefilter';

const rows = await db
  .select({
    id: posts.id,
    text: posts.rawText,
    url: posts.urlOriginal,
    imageCount: sql<number>`count(${images.id})::int`,
  })
  .from(posts)
  .leftJoin(images, eq(images.postId, posts.id))
  .where(ne(posts.rawText, ''))
  .groupBy(posts.id);

let pass = 0;
const missed: { url: string; score: number; text: string }[] = [];
const hist = new Map<number, number>();

for (const p of rows) {
  const r = prefilter({ text: p.text, hasImage: p.imageCount > 0 });
  hist.set(r.score, (hist.get(r.score) ?? 0) + 1);
  if (r.pass) pass++;
  else missed.push({ url: p.url, score: r.score, text: p.text.replace(/\n/g, ' ').slice(0, 76) });
}

const recall = (pass / rows.length) * 100;

console.log(`알려진 대회 게시물 ${rows.length}건 (임계값 ${PASS_THRESHOLD}점)\n`);
console.log(`  재현율  ${recall.toFixed(1)}%   (통과 ${pass} / 누락 ${missed.length})`);
console.log(`  ${recall >= 99 ? '✅ 목표 달성' : recall >= 95 ? '△ 키워드 보강 필요' : '❌ 키워드 버그 — 누락분을 보십시오'}\n`);

console.log('  점수 분포:');
for (const [s, n] of [...hist].sort((a, b) => a[0] - b[0])) {
  const bar = '█'.repeat(Math.ceil((n / rows.length) * 60));
  console.log(`   ${String(s).padStart(3)}점 ${String(n).padStart(3)}건 ${s < PASS_THRESHOLD ? '✗' : ' '} ${bar}`);
}

if (missed.length) {
  console.log(`\n  누락된 게시물 (이것들이 곧 잃어버릴 뻔한 덱입니다):\n`);
  for (const m of missed.slice(0, 15)) {
    console.log(`   ${m.score}점  ${m.text}`);
    console.log(`         ${m.url}`);
  }
}

process.exit(0);
