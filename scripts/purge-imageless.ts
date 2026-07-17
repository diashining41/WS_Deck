/**
 * Removes published decks that show no recipe at all: no deck image, and not an
 * external decklog/naver recipe link either. The site exists to show deck
 * composition, so a row with nothing to look at doesn't belong on a title page.
 *
 * Rejected (not deleted): status='rejected' keeps the row for audit/reversal;
 * then titles.deck_count is recomputed. Dry run by default; --commit to write.
 */
import { inArray, sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';
import { decks } from '@/db/schema';

const COMMIT = process.argv.includes('--commit');

const target = rows<{ id: string; code: string | null; nameko: string | null; url: string }>(
  await db.execute(sql`
    SELECT d.id::text AS id, t.code, t.name_ko AS nameko, p.url_original AS url
    FROM decks d
    JOIN posts p ON p.id = d.post_id
    LEFT JOIN titles t ON t.id = d.title_id
    WHERE d.status = 'published'
      AND d.image_id IS NULL
      AND p.url_original NOT ILIKE '%decklog%'
      AND p.url_original NOT ILIKE '%naver%'`),
);

console.log(`이미지도 decklog 링크도 없는 게시 덱(볼 레시피 없음): ${target.length}건\n`);
const byTitle: Record<string, number> = {};
for (const r of target) byTitle[r.nameko ?? '(제목없음)'] = (byTitle[r.nameko ?? '(제목없음)'] ?? 0) + 1;
console.log('타이틀별:', JSON.stringify(byTitle, null, 0));
console.log('\n샘플:');
for (const r of target.slice(0, 10)) console.log(`   [${r.code ?? '-'}] ${r.url}`);

if (!COMMIT) {
  console.log('\n(드라이런입니다. 반영하려면 --commit)');
  await closeDb();
  process.exit(0);
}

const ids = target.map((r) => r.id);
if (ids.length) await db.update(decks).set({ status: 'rejected' }).where(inArray(decks.id, ids));
await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )`);
const [{ n } = { n: 0 }] = rows<{ n: number }>(
  await db.execute(sql`SELECT count(*)::int n FROM decks WHERE status='published'`),
);
console.log(`\n✅ ${ids.length}건 rejected · deck_count 재계산 · 남은 게시 덱 ${n}건`);
await closeDb();
