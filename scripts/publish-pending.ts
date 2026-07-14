/**
 * Re-classifies every auto-captured deck against the current text rules.
 *
 * Runs over all provenance=ai decks (held AND already auto-published), so
 * tightening the classifier both flushes new publishable decks and CORRECTS ones
 * a looser pass placed wrong. Human-approved decks (provenance=human) and the
 * sheet import (sheet_import) are never touched.
 */
import { and, eq, isNotNull } from 'drizzle-orm';

import { closeDb, db } from '@/db';
import { decks, posts, titleAliases } from '@/db/schema';
import { classifyDecks } from '@/lib/classify';
import { AliasMatcher } from '@/lib/match';

const titleMatcher = new AliasMatcher(
  (await db.select({ titleId: titleAliases.titleId, alias: titleAliases.alias }).from(titleAliases)).map((r) => ({
    key: r.titleId,
    alias: r.alias,
  })),
);

const auto = await db
  .select({
    deckId: decks.id,
    postId: decks.postId,
    mediaIndex: decks.mediaIndex,
    text: posts.rawText,
  })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .where(and(eq(decks.provenance, 'ai'), isNotNull(decks.imageId)));

const byPost = new Map<string, typeof auto>();
for (const d of auto) byPost.set(d.postId, [...(byPost.get(d.postId) ?? []), d]);

console.log(`자동 캡처 덱 ${auto.length}개 (게시물 ${byPost.size}개) 재분류\n`);

let published = 0;
let held = 0;
for (const group of byPost.values()) {
  const text = group[0]!.text;
  const classified = classifyDecks(
    text,
    group.map((d) => d.mediaIndex),
    titleMatcher,
  );
  for (const c of classified) {
    const deck = group.find((d) => d.mediaIndex === c.mediaIndex);
    if (!deck) continue;
    await db
      .update(decks)
      // A now-ambiguous deck reverts to needs_review and drops off the site.
      .set({ titleId: c.titleId, climaxes: c.climaxes, status: c.status })
      .where(eq(decks.id, deck.deckId));
    if (c.status === 'published') published++;
    else held++;
  }
}

// Keep the title index counts honest.
const { sql } = await import('drizzle-orm');
await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )
`);

console.log(`✅ 자동 게시 ${published}개 · 보류 ${held}개 (본문에 작품 없음/애매 → 사진 판독 필요)`);

await closeDb();
