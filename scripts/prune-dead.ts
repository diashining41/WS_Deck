/**
 * Removes rows whose source post is actually gone.
 *
 * "No image" is not evidence of deletion — naver and wstcg posts have no image
 * because their adapters were never written, and a live trio tweet can carry
 * more decks than photos. So this only touches X posts that we already fetched
 * and got nothing back from, and it RE-CHECKS every one of them against X before
 * deleting: a transient failure during the backfill must not cost us a row.
 *
 * A tweet that turns out to be alive is repaired instead of deleted — if it has
 * photos we store them, which is the opposite of throwing it away.
 *
 *   npx tsx scripts/prune-dead.ts            # verify + report only
 *   npx tsx scripts/prune-dead.ts --delete   # verify, then delete the dead ones
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import { closeDb, db, rows as toRows } from '@/db';
import { decks, images, posts } from '@/db/schema';
import { download, storeImage } from '@/lib/media';
import { fetchTweet, RateLimited } from '@/lib/x';

const DELETE = process.argv.includes('--delete');
const PACING_MS = Number(process.env.PACING_MS ?? 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Suspected-dead: an X post we fetched, that stored no text and has no image.
const suspects = toRows<{ id: string; source_id: string; url: string; decks: number }>(
  await db.execute(sql`
    SELECT p.id, p.source_id, p.url_original AS url,
           (SELECT count(*)::int FROM decks d WHERE d.post_id = p.id) AS decks
    FROM posts p
    WHERE p.source = 'x'
      AND p.fetched_at IS NOT NULL
      AND coalesce(p.raw_text, '') = ''
      AND NOT EXISTS (SELECT 1 FROM images i WHERE i.post_id = p.id)
    ORDER BY p.posted_at DESC
  `),
);

console.log(`삭제 의심 게시물 ${suspects.length}개 — X 에 실제로 남아있는지 재확인합니다\n`);

const dead: typeof suspects = [];
const revived: string[] = [];
let recovered = 0;
let n = 0;

for (const s of suspects) {
  n++;
  try {
    const tweet = await fetchTweet(s.source_id);

    if (!tweet) {
      dead.push(s);
      if (dead.length % 25 === 0) console.log(`  [${n}/${suspects.length}] 삭제 확인 ${dead.length}건`);
      await sleep(PACING_MS);
      continue;
    }

    // Alive after all — our earlier fetch failed transiently. Repair, don't delete.
    revived.push(s.id);
    await db
      .update(posts)
      .set({ rawText: tweet.text, authorHandle: tweet.authorHandle || null, fetchedAt: new Date() })
      .where(eq(posts.id, s.id));

    if (tweet.media.length > 0) {
      const postDecks = await db
        .select({ id: decks.id, mediaIndex: decks.mediaIndex })
        .from(decks)
        .where(and(eq(decks.postId, s.id), isNull(decks.imageId)));

      for (const [i, m] of tweet.media.entries()) {
        const bytes = await download(m.url);
        const st = await storeImage(bytes, 'user_photo');
        const [img] = await db
          .insert(images)
          .values({
            postId: s.id,
            mediaIndex: i,
            originUrl: m.url,
            origKey: st.origKey,
            thumbKey: st.thumbKey,
            mediumKey: st.mediumKey,
            width: st.width,
            height: st.height,
            sha256: st.sha256,
            blur: st.blur,
            kind: 'user_photo',
          })
          .onConflictDoNothing({ target: [images.postId, images.mediaIndex] })
          .returning({ id: images.id });
        const deck = postDecks.find((d) => d.mediaIndex === i);
        if (img && deck) {
          await db.update(decks).set({ imageId: img.id }).where(eq(decks.id, deck.id));
          recovered++;
        }
      }
      console.log(`  [${n}] ✚ 살아있음 — 이미지 ${tweet.media.length}장 복구 (${s.url})`);
    }
  } catch (err) {
    if (err instanceof RateLimited) {
      const wait = Math.max(5000, err.resetAt.getTime() - Date.now() + 2000);
      console.log(`⏳ 레이트리밋 — ${Math.ceil(wait / 1000)}초 대기`);
      await sleep(wait);
      continue;
    }
    // An error is not proof of death — leave the row alone.
    console.log(`  [${n}] ? 확인 실패, 보존: ${err instanceof Error ? err.message : String(err)}`);
  }
  await sleep(PACING_MS);
}

const deadDecks = dead.reduce((sum, d) => sum + d.decks, 0);

console.log('');
console.log(`■ 삭제 확인(원본 없음) : 게시물 ${dead.length} · 덱 ${deadDecks}`);
console.log(`■ 살아있어 보존       : 게시물 ${revived.length} (이미지 ${recovered}장 복구)`);
console.log(`■ 확인 불가로 보존     : ${suspects.length - dead.length - revived.length}`);

if (!DELETE) {
  console.log('\n(확인만 했습니다. 실제로 지우려면 --delete)');
  await closeDb();
  process.exit(0);
}

if (dead.length === 0) {
  console.log('\n지울 것이 없습니다.');
  await closeDb();
  process.exit(0);
}

// Deleting the post cascades to its decks and images (FK ON DELETE CASCADE).
const ids = dead.map((d) => d.id);
for (let i = 0; i < ids.length; i += 200) {
  const chunk = ids.slice(i, i + 200);
  await db.execute(sql`DELETE FROM posts WHERE id IN (${sql.join(chunk.map((x) => sql`${x}`), sql`, `)})`);
}

await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )
`);

const [after] = toRows<{ posts: number; decks: number }>(
  await db.execute(sql`SELECT (SELECT count(*)::int FROM posts) posts, (SELECT count(*)::int FROM decks) decks`),
);
console.log(`\n✅ 삭제 완료 — 남은 게시물 ${after?.posts} · 덱 ${after?.decks}`);

await closeDb();
