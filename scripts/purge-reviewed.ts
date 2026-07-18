/**
 * Removes the non-WS decks found by the manual image (AI-vision) review of the
 * shared-IP, text-unconfirmable candidates. Each was inspected at full-res:
 *
 *   - Cardfight!! Vanguard decklogs mis-imported onto WS titles (the decklog's
 *     "国家：…" nation header + ヴァンガード logo are unmistakable), and
 *   - a Doraemon anime screenshot with no deck at all.
 *
 * Reversible: status='rejected' hides them but keeps the rows. Then deck_count
 * is recomputed. Dry run by default; --commit to write.
 */
import { inArray, sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';
import { decks } from '@/db/schema';

const COMMIT = process.argv.includes('--commit');

const TARGETS: { id: string; why: string }[] = [
  { id: '9f2470b6-1622-4f73-846b-93cfd772efd5', why: '#67 Vanguard (Monster Strike collab) on HOL' },
  { id: '97ae4ab2-c766-4d8b-8963-e4526f095e5a', why: '#245 Doraemon screenshot (no deck) on LHS' },
  { id: '6a001b9c-8e33-4950-acd5-ee6b9e316bb2', why: '#349 Vanguard (Keter Sanctuary) on MDE' },
];

const ids = TARGETS.map((t) => t.id);
const found = rows<{ id: string; status: string }>(
  await db.execute(sql`SELECT id::text, status FROM decks WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`),
);
console.log(`대상 ${ids.length}건 · DB에서 발견 ${found.length}건`);
for (const t of TARGETS) {
  const f = found.find((r) => r.id === t.id);
  console.log(`  ${f ? `[${f.status}]` : '[없음]'}  ${t.why}`);
}

if (!COMMIT) {
  console.log('\n(드라이런입니다. 실제 반영하려면 --commit)');
  await closeDb();
  process.exit(0);
}

await db.update(decks).set({ status: 'rejected' }).where(inArray(decks.id, ids));
await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )
`);
const [{ n: pub } = { n: 0 }] = rows<{ n: number }>(
  await db.execute(sql`SELECT count(*)::int AS n FROM decks WHERE status='published'`),
);
console.log(`\n✅ ${ids.length}건 rejected · deck_count 재계산 · 남은 게시 덱 ${pub}개`);

await closeDb();
