/**
 * Revives held posts whose 작품 the alias tables can now identify.
 *
 * A held post is a `posts` row with rawText but no decks and no images — the
 * capture skipped it because the classifier (running against then-empty alias
 * tables) found no title in the text. Now that the aliases are seeded, ~121 of
 * them classify to a real 작품 from the text alone. This re-fetches those tweets,
 * downloads the photos, and creates published decks.
 *
 * It never touches the ~749 that still don't classify — those genuinely need the
 * image read (the paid AI pass), and re-fetching them would only burn rate limit.
 * A tweet that turns out deleted keeps its link and is marked settled.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';
import { decks, images, posts, titleAliases } from '@/db/schema';
import { classifyDecks } from '@/lib/classify';
import { guessFormat, guessRegion, guessScale } from '@/lib/heuristics';
import { AliasMatcher } from '@/lib/match';
import { download, storeImage } from '@/lib/media';
import { fetchTweet, RateLimited } from '@/lib/x';

const PACING_MS = Number(process.env.PACING_MS ?? 800);
const LIMIT = Number(process.env.LIMIT ?? Infinity);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const titleMatcher = new AliasMatcher(
  (await db.select({ titleId: titleAliases.titleId, alias: titleAliases.alias }).from(titleAliases)).map((r) => ({
    key: r.titleId,
    alias: r.alias,
  })),
);

// Held X posts: text present, no decks. Pre-filter to those whose text now names
// a 작품, BEFORE any network call — that is the whole efficiency of this script.
const held = rows<{ id: string; sourceId: string; url: string; text: string; postedAt: Date }>(
  await db.execute(sql`
    SELECT p.id, p.source_id AS "sourceId", p.url_original AS url, p.raw_text AS text, p.posted_at AS "postedAt"
    FROM posts p
    WHERE p.source = 'x'
      AND coalesce(p.raw_text, '') <> ''
      AND NOT EXISTS (SELECT 1 FROM decks d WHERE d.post_id = p.id)
  `),
);

const candidates = held.filter((p) => classifyDecks(p.text, [0], titleMatcher).some((c) => c.status === 'published'));
console.log(`보류 ${held.length}개 중 별칭으로 작품 매칭되는 후보 ${candidates.length}개\n`);

let revived = 0;
let gone = 0;
let failed = 0;
let done = 0;

for (const post of candidates.slice(0, LIMIT)) {
  done++;
  const label = `[${done}/${Math.min(candidates.length, LIMIT)}] x:${post.sourceId}`;
  try {
    const tweet = await fetchTweet(post.sourceId);
    if (!tweet) {
      gone++;
      await db.update(posts).set({ fetchedAt: new Date() }).where(eq(posts.id, post.id));
      console.log(`${label} ✗ 삭제됨 (링크 유지)`);
      await sleep(PACING_MS);
      continue;
    }

    // Now we know the real media count — re-classify against it.
    const mediaUrls = tweet.media.map((m) => m.url);
    if (mediaUrls.length === 0) {
      await db.update(posts).set({ rawText: tweet.text, fetchedAt: new Date() }).where(eq(posts.id, post.id));
      console.log(`${label} — 사진 없는 글 (보류 유지)`);
      await sleep(PACING_MS);
      continue;
    }

    const classified = classifyDecks(
      tweet.text,
      mediaUrls.map((_, i) => i),
      titleMatcher,
    );
    const toPublish = classified.filter((c) => c.status === 'published');
    if (toPublish.length === 0) {
      await db.update(posts).set({ rawText: tweet.text, fetchedAt: new Date() }).where(eq(posts.id, post.id));
      console.log(`${label} — 재분류 후 보류 (사진 수 불일치)`);
      await sleep(PACING_MS);
      continue;
    }

    const region = guessRegion(tweet.text);
    const scale = guessScale(tweet.text);
    const format = guessFormat(tweet.text);
    for (const c of toPublish) {
      const bytes = await download(mediaUrls[c.mediaIndex]!);
      const s = await storeImage(bytes, 'user_photo');
      const [img] = await db
        .insert(images)
        .values({
          postId: post.id,
          mediaIndex: c.mediaIndex,
          originUrl: mediaUrls[c.mediaIndex]!,
          origKey: s.origKey,
          thumbKey: s.thumbKey,
          mediumKey: s.mediumKey,
          width: s.width,
          height: s.height,
          sha256: s.sha256,
          blur: s.blur,
          kind: 'user_photo',
        })
        .onConflictDoNothing({ target: [images.postId, images.mediaIndex] })
        .returning({ id: images.id });
      const imageId =
        img?.id ??
        (
          await db
            .select({ id: images.id })
            .from(images)
            .where(and(eq(images.postId, post.id), eq(images.mediaIndex, c.mediaIndex)))
            .limit(1)
        )[0]?.id;

      await db
        .insert(decks)
        .values({
          postId: post.id,
          mediaIndex: c.mediaIndex,
          imageId: imageId ?? null,
          imageVerified: toPublish.length === 1,
          titleId: c.titleId,
          climaxes: c.climaxes,
          region,
          scale,
          format,
          status: 'published',
          provenance: 'ai',
          // postgres-js returns timestamps as strings, not Date — wrap it.
          sortAt: post.postedAt ? new Date(post.postedAt) : new Date(),
        })
        .onConflictDoNothing({ target: [decks.postId, decks.mediaIndex] });
    }
    await db
      .update(posts)
      .set({ rawText: tweet.text, rawJson: tweet.raw as object, authorHandle: tweet.authorHandle, fetchedAt: new Date() })
      .where(eq(posts.id, post.id));
    revived++;
    console.log(`${label} ✓ 부활 ${toPublish.length}덱`);
  } catch (err) {
    if (err instanceof RateLimited) {
      const wait = Math.max(5000, err.resetAt.getTime() - Date.now() + 2000);
      console.log(`⏳ 레이트리밋 — ${Math.ceil(wait / 1000)}초 대기`);
      await sleep(wait);
      done--;
      candidates.splice(candidates.indexOf(post), 0, post);
      continue;
    }
    failed++;
    console.log(`${label} ✗ ${err instanceof Error ? err.message : String(err)}`);
  }
  await sleep(PACING_MS);
}

await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )
`);

console.log(`\n✅ 부활 ${revived}개 · 삭제됨 ${gone}개${failed ? ` · 실패 ${failed}개` : ''}`);
await closeDb();
