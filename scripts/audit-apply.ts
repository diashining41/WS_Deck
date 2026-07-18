/**
 * Rejects the non-WS decks found by the no-fingerprint audit, addressed by their
 * cell index in a bucket (re-derives the same deterministic order as
 * audit-nofp.ts, so no UUID copy errors). Reversible (status='rejected').
 *
 *   BUCKET=decklog CELLS="1,3,5" npm run tsx scripts/audit-apply.ts -- --commit
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { closeDb, db, rows as toRows } from '@/db';
import { decks, images, posts, titles } from '@/db/schema';
import { hasWsFingerprint } from '@/lib/game';

const COMMIT = process.argv.includes('--commit');
const BUCKET = process.env.BUCKET ?? 'decklog';
const CELLS = (process.env.CELLS ?? '').split(/[\s,]+/).map(Number).filter((n) => !Number.isNaN(n));

const rows = await db
  .select({ deckId: decks.id, text: posts.rawText, url: posts.urlOriginal, imgId: images.id, code: titles.code, nameKo: titles.nameKo })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .innerJoin(titles, eq(titles.id, decks.titleId))
  .leftJoin(images, eq(images.id, decks.imageId))
  .where(and(eq(decks.status, 'published'), eq(titles.game, 'WS')))
  .orderBy(asc(titles.code), asc(decks.id));
const nofp = rows.filter((r) => !hasWsFingerprint(r.text ?? ''));
const bucket = BUCKET === 'photo' ? nofp.filter((r) => r.imgId && !/decklog/i.test(r.url)) : nofp.filter((r) => /decklog/i.test(r.url));

const targets = CELLS.map((c) => bucket[c]).filter(Boolean) as (typeof bucket)[number][];
console.log(`[${BUCKET}] 제거 대상 ${targets.length}건:`);
for (let i = 0; i < CELLS.length; i++) {
  const t = bucket[CELLS[i]!];
  console.log(`  #${CELLS[i]}  ${t ? `${t.code}/${t.nameKo}  ${t.url}  [${t.deckId}]` : '(없음!)'}`);
}

if (!COMMIT) {
  console.log('\n(드라이런. 반영하려면 --commit)');
  await closeDb();
  process.exit(0);
}

const ids = targets.map((t) => t.deckId);
await db.update(decks).set({ status: 'rejected' }).where(inArray(decks.id, ids));
await db.execute(sql`UPDATE titles SET deck_count = (SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status='published')`);
const [{ n: pub } = { n: 0 }] = toRows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM decks WHERE status='published'`));
console.log(`\n✅ ${ids.length}건 rejected · deck_count 재계산 · 남은 게시 덱 ${pub}개`);
await closeDb();
