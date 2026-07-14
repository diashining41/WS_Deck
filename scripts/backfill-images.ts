/**
 * Pulls the deck photo for every imported post and stores it locally.
 *
 * This is the one perishable asset in the project: the spreadsheet's links point
 * at tweets that get deleted, and once a tweet is gone its deck recipe is gone
 * with it. Everything else here can be rebuilt at any time; these bytes cannot.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';

import { db, rows as toRows } from '@/db';
import { decks, images, posts } from '@/db/schema';
import { download, storeImage, type ImageKind } from '@/lib/media';
import { decklogImageUrl, fetchTweet, RateLimited } from '@/lib/x';

const PACING_MS = 1200;
const LIMIT = Number(process.env.LIMIT ?? Infinity);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pending = await db
  .select({ id: posts.id, source: posts.source, sourceId: posts.sourceId, url: posts.urlOriginal })
  .from(posts)
  .leftJoin(images, eq(images.postId, posts.id))
  .where(isNull(images.id))
  .groupBy(posts.id);

console.log(`이미지가 없는 게시물 ${pending.length}개\n`);

let done = 0;
let stored = 0;
let gone = 0;
let failed = 0;

for (const post of pending.slice(0, LIMIT)) {
  done++;
  const label = `[${done}/${Math.min(pending.length, LIMIT)}] ${post.source}:${post.sourceId}`;

  try {
    let mediaUrls: string[] = [];
    let kind: ImageKind = 'user_photo';
    let text = '';
    let author: string | null = null;
    let raw: unknown = null;

    if (post.source === 'x') {
      const tweet = await fetchTweet(post.sourceId);
      if (!tweet) {
        gone++;
        console.log(`${label} ✗ 삭제됨`);
        await db.update(posts).set({ fetchedAt: new Date() }).where(eq(posts.id, post.id));
        await sleep(PACING_MS);
        continue;
      }
      text = tweet.text;
      author = tweet.authorHandle || null;
      raw = tweet.raw;

      // A linked decklog render is strictly better than a photo of the table —
      // but in this corpus that link is essentially never present, so the photo
      // is what we almost always end up with.
      if (tweet.decklogCodes.length > 0) {
        mediaUrls = tweet.decklogCodes.map(decklogImageUrl);
        kind = 'decklog_render';
      } else {
        mediaUrls = tweet.media.map((m) => m.url);
        kind = 'user_photo';
      }
    } else if (post.source === 'decklog') {
      mediaUrls = [decklogImageUrl(post.sourceId)];
      kind = 'decklog_render';
    } else {
      console.log(`${label} — ${post.source} 어댑터 미구현, 건너뜀`);
      continue;
    }

    if (mediaUrls.length === 0) {
      console.log(`${label} — 이미지 없음`);
      await db.update(posts).set({ rawText: text, fetchedAt: new Date() }).where(eq(posts.id, post.id));
      await sleep(PACING_MS);
      continue;
    }

    const rows: { id: string; mediaIndex: number }[] = [];
    for (const [i, url] of mediaUrls.entries()) {
      const bytes = await download(url);
      const s = await storeImage(bytes, kind);
      const [row] = await db
        .insert(images)
        .values({
          postId: post.id,
          mediaIndex: i,
          originUrl: url,
          origKey: s.origKey,
          thumbKey: s.thumbKey,
          mediumKey: s.mediumKey,
          width: s.width,
          height: s.height,
          sha256: s.sha256,
          blur: s.blur,
          kind,
        })
        .returning({ id: images.id, mediaIndex: images.mediaIndex });
      if (row) rows.push({ id: row.id, mediaIndex: row.mediaIndex });
      stored++;
    }

    await db
      .update(posts)
      .set({ rawText: text, rawJson: raw as object, authorHandle: author, fetchedAt: new Date() })
      .where(eq(posts.id, post.id));

    // Bind each deck to its own image. The spreadsheet never recorded which
    // photo went with which deck, so row order is our only guess — safe when a
    // post holds a single deck, a guess when it holds a trio's three.
    const postDecks = await db
      .select({ id: decks.id, mediaIndex: decks.mediaIndex })
      .from(decks)
      .where(eq(decks.postId, post.id));

    const certain = postDecks.length === 1 && rows.length === 1;

    for (const d of postDecks) {
      const match = rows.find((r) => r.mediaIndex === d.mediaIndex);
      if (!match) continue;
      await db
        .update(decks)
        .set({ imageId: match.id, imageVerified: certain })
        .where(eq(decks.id, d.id));
    }

    console.log(`${label} ✓ 이미지 ${rows.length}장 · 덱 ${postDecks.length}개${certain ? '' : ' (이미지-덱 매칭 미확정)'}`);
  } catch (err) {
    if (err instanceof RateLimited) {
      const waitMs = Math.max(5_000, err.resetAt.getTime() - Date.now() + 2_000);
      console.log(`⏳ 레이트리밋 — ${Math.ceil(waitMs / 1000)}초 대기 (리셋 ${err.resetAt.toISOString()})`);
      await sleep(waitMs);
      done--; // retry this post after the window resets
      pending.splice(pending.indexOf(post), 0, post);
      continue;
    }
    failed++;
    console.log(`${label} ✗ ${err instanceof Error ? err.message : String(err)}`);
  }

  await sleep(PACING_MS);
}

const [{ n: withImage } = { n: 0 }] = toRows<{ n: number }>(
  await db.execute(sql`SELECT count(*)::int AS n FROM decks WHERE image_id IS NOT NULL`),
);
const [{ n: verified } = { n: 0 }] = toRows<{ n: number }>(
  await db.execute(sql`SELECT count(*)::int AS n FROM decks WHERE image_verified`),
);

console.log('');
console.log(`✅ 이미지 ${stored}장 저장`);
console.log(`   덱 ${withImage}개에 이미지 연결 (그중 ${verified}개는 매칭 확정)`);
if (gone) console.log(`   삭제된 트윗 ${gone}건`);
if (failed) console.log(`   실패 ${failed}건`);

process.exit(0);
