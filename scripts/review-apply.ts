/**
 * Applies image-판독 verdicts from `npm run review:vision`.
 *
 *   PUBLISH="id,id" — confirmed WS 50-card recipe → status='published'
 *   REJECT="id,id"  — other game / not a full recipe → status='rejected'
 *
 * Both reversible (status only). Recomputes titles.deck_count. Dry run by
 * default; add --commit to write.
 *
 *   PUBLISH="a,b" REJECT="c" npm run review:apply -- --commit
 */
import { inArray, sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';
import { decks } from '@/db/schema';

const COMMIT = process.argv.includes('--commit');
const parse = (v: string | undefined) => (v ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
const publish = parse(process.env.PUBLISH);
const reject = parse(process.env.REJECT);

if (!publish.length && !reject.length) {
  console.log('PUBLISH / REJECT 둘 다 비어 있음. 예: PUBLISH="id1,id2" REJECT="id3" npm run review:apply -- --commit');
  await closeDb();
  process.exit(0);
}

// Show current state so a wrong id is caught before writing.
const all = [...publish, ...reject];
const found = rows<{ id: string; status: string }>(
  await db.execute(sql`SELECT id::text, status FROM decks WHERE id IN (${sql.join(all.map((i) => sql`${i}::uuid`), sql`, `)})`),
);
console.log(`게시 ${publish.length}건 · 제외 ${reject.length}건 · DB 발견 ${found.length}/${all.length}`);
const st = (id: string) => found.find((r) => r.id === id)?.status ?? '없음';
for (const id of publish) console.log(`  게시 ← [${st(id)}]  ${id}`);
for (const id of reject) console.log(`  제외 ← [${st(id)}]  ${id}`);

if (!COMMIT) {
  console.log('\n(드라이런. 반영하려면 --commit)');
  await closeDb();
  process.exit(0);
}

if (publish.length) await db.update(decks).set({ status: 'published' }).where(inArray(decks.id, publish));
if (reject.length) await db.update(decks).set({ status: 'rejected' }).where(inArray(decks.id, reject));
await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )
`);
const [{ n: pub } = { n: 0 }] = rows<{ n: number }>(
  await db.execute(sql`SELECT count(*)::int AS n FROM decks WHERE status='published'`),
);
console.log(`\n✅ 게시 ${publish.length} · 제외 ${reject.length} · deck_count 재계산 · 남은 게시 덱 ${pub}개`);

await closeDb();
