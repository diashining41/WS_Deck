/**
 * Auto-publishes already-captured decks that are still needs_review.
 *
 * Re-runs the text classification over every held deck: if the post text names a
 * title, the deck is placed and published; otherwise it stays held. Use it after
 * turning on auto-publish, to flush the backlog the review-mode capture created.
 */
import { and, eq, isNotNull } from 'drizzle-orm';

import { closeDb, db } from '@/db';
import { decks, images, posts, titleAliases } from '@/db/schema';
import { classifyDecks } from '@/lib/classify';
import { AliasMatcher } from '@/lib/match';

const titleMatcher = new AliasMatcher(
  (await db.select({ titleId: titleAliases.titleId, alias: titleAliases.alias }).from(titleAliases)).map((r) => ({
    key: r.titleId,
    alias: r.alias,
  })),
);

// Held decks that have an image, grouped by post (so a trio is classified as a set).
const held = await db
  .select({
    deckId: decks.id,
    postId: decks.postId,
    mediaIndex: decks.mediaIndex,
    text: posts.rawText,
  })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .where(and(eq(decks.status, 'needs_review'), isNotNull(decks.imageId)));

const byPost = new Map<string, typeof held>();
for (const d of held) byPost.set(d.postId, [...(byPost.get(d.postId) ?? []), d]);

console.log(`보류 중인 덱 ${held.length}개 (게시물 ${byPost.size}개) 재분류\n`);

let published = 0;
for (const group of byPost.values()) {
  const text = group[0]!.text;
  const classified = classifyDecks(
    text,
    group.map((d) => d.mediaIndex),
    titleMatcher,
  );
  for (const c of classified) {
    if (c.status !== 'published') continue;
    const deck = group.find((d) => d.mediaIndex === c.mediaIndex);
    if (!deck) continue;
    await db
      .update(decks)
      .set({ titleId: c.titleId, climaxes: c.climaxes, status: 'published' })
      .where(eq(decks.id, deck.deckId));
    published++;
  }
}

// Keep the title index counts honest.
const { sql } = await import('drizzle-orm');
await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )
`);

console.log(`✅ 자동 게시 ${published}개 · 남은 보류 ${held.length - published}개 (본문에 작품 없음 → 사진 판독 필요)`);

await closeDb();
