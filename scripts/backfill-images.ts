/**
 * Pulls the deck photo for every imported post and stores it locally.
 *
 * This is the one perishable asset in the project: the spreadsheet's links point
 * at tweets that get deleted, and once a tweet is gone its deck recipe is gone
 * with it. Everything else here can be rebuilt at any time; these bytes cannot.
 */
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { db, rows as toRows } from '@/db';
import { decks, images, posts, titleAliases } from '@/db/schema';
import { classifyDecks } from '@/lib/classify';
import { guessFormat, guessRegion, guessScale } from '@/lib/heuristics';
import { AliasMatcher } from '@/lib/match';
import { download, storeImage, type ImageKind } from '@/lib/media';
import { decklogImageUrl, fetchTweet, RateLimited } from '@/lib/x';

/**
 * Single-instance lock.
 *
 * Two backfills running at once walk the same pending list and race on
 * UNIQUE(post_id, media_index) — that already happened once and turned ~40% of
 * the run into duplicate-key errors and wasted downloads. The lock holds a PID;
 * a lock left behind by a killed run is reclaimed.
 */
/**
 * Sharding: the work is embarrassingly parallel, but two workers must never
 * touch the same post (that races on UNIQUE(post_id, media_index)). So each
 * worker takes a disjoint slice — post #i belongs to shard i % SHARD_TOTAL —
 * and holds its own lock. 4 shards turns a ~17h sequential run into ~4h.
 */
const SHARD_ID = Number(process.env.SHARD_ID ?? 0);
const SHARD_TOTAL = Number(process.env.SHARD_TOTAL ?? 1);

const LOCK = `.data/backfill-${SHARD_ID}of${SHARD_TOTAL}.lock`;
mkdirSync('.data', { recursive: true });
function acquireLock(): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK, 'wx');
      closeSync(fd);
      writeFileSync(LOCK, String(process.pid));
      return;
    } catch {
      const pid = Number(readFileSync(LOCK, 'utf8').trim());
      let alive = false;
      try {
        process.kill(pid, 0); // signal 0 = existence check
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) {
        console.log(`❌ 백필이 이미 실행 중입니다 (PID ${pid}). 중복 실행은 서로 충돌합니다.`);
        process.exit(1);
      }
      unlinkSync(LOCK); // stale lock from a killed run
    }
  }
}
acquireLock();
const releaseLock = () => {
  try {
    unlinkSync(LOCK);
  } catch {
    /* already gone */
  }
};
process.on('exit', releaseLock);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

// Title matcher, built once from the DB aliases, to auto-place captured decks.
const titleMatcher = new AliasMatcher(
  (await db.select({ titleId: titleAliases.titleId, alias: titleAliases.alias }).from(titleAliases)).map((r) => ({
    key: r.titleId,
    alias: r.alias,
  })),
);

// Measured: two backfills ran concurrently (~600ms effective spacing) against the
// per-tweet endpoint with zero rate-limit responses, so 800ms sequential is safe.
// RateLimited is still honoured below if the endpoint ever pushes back.
const PACING_MS = Number(process.env.PACING_MS ?? 800);
const LIMIT = Number(process.env.LIMIT ?? Infinity);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * What still needs fetching.
 *
 * "Has no image" is the wrong question — most posts without an image will never
 * have one: the tweet was deleted, or it was a text-only post, or it's a naver /
 * wstcg link whose adapter was never written. Asking that question daily meant
 * the cloud job burned its whole budget re-fetching ~700 hopeless posts and
 * never reached the new ones.
 *
 * fetched_at answers it properly: it is set once a post has actually been
 * resolved (image stored, no media, or tweet gone) and left NULL when the fetch
 * threw — so errors are still retried, and settled posts are never touched again.
 */
const allPending = await db
  .select({
    id: posts.id,
    source: posts.source,
    sourceId: posts.sourceId,
    url: posts.urlOriginal,
    postedAt: posts.postedAt,
  })
  .from(posts)
  .leftJoin(images, eq(images.postId, posts.id))
  .where(
    and(
      isNull(images.id),
      isNull(posts.fetchedAt),
      // Sources we can actually fetch images from today.
      inArray(posts.source, ['x', 'decklog']),
    ),
  )
  .groupBy(posts.id)
  // Stable order, so the shard split is deterministic across workers.
  .orderBy(posts.id);

const pending = allPending.filter((_, i) => i % SHARD_TOTAL === SHARD_ID);

console.log(
  `가져올 게시물 ${allPending.length}개` +
    (SHARD_TOTAL > 1 ? ` · 이 샤드(${SHARD_ID}/${SHARD_TOTAL}) 담당 ${pending.length}개` : '') +
    '\n',
);

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

    // Idempotent: an interrupted run may already have stored this image, and the
    // pending list is computed once up front. Never let a duplicate abort a post.
    const findExisting = async (mediaIndex: number) => {
      const [row] = await db
        .select({ id: images.id, mediaIndex: images.mediaIndex })
        .from(images)
        .where(and(eq(images.postId, post.id), eq(images.mediaIndex, mediaIndex)))
        .limit(1);
      return row;
    };

    const storeOne = async (mediaIndex: number) => {
      const already = await findExisting(mediaIndex);
      if (already) return already;

      const bytes = await download(mediaUrls[mediaIndex]!);
      const s = await storeImage(bytes, kind);
      const [row] = await db
        .insert(images)
        .values({
          postId: post.id,
          mediaIndex,
          originUrl: mediaUrls[mediaIndex]!,
          origKey: s.origKey,
          thumbKey: s.thumbKey,
          mediumKey: s.mediumKey,
          width: s.width,
          height: s.height,
          sha256: s.sha256,
          blur: s.blur,
          kind,
        })
        .onConflictDoNothing({ target: [images.postId, images.mediaIndex] })
        .returning({ id: images.id, mediaIndex: images.mediaIndex });
      if (row) {
        stored++;
        return row;
      }
      return (await findExisting(mediaIndex))!;
    };

    // Sheet posts already have decks; freshly captured posts don't.
    const postDecks = await db
      .select({ id: decks.id, mediaIndex: decks.mediaIndex })
      .from(decks)
      .where(eq(decks.postId, post.id));

    if (postDecks.length === 0) {
      // Captured post: classify from the TEXT first, and only download images for
      // decks that will actually publish. A held post (no title in the text) would
      // never show anyway, so we keep its link + text but skip the images — that's
      // what stops a cold-start capture from committing hundreds of unused photos.
      const classified = classifyDecks(
        text,
        mediaUrls.map((_, i) => i),
        titleMatcher,
      );
      const toPublish = classified.filter((c) => c.status === 'published');
      if (toPublish.length === 0) {
        await db
          .update(posts)
          .set({ rawText: text, authorHandle: author, fetchedAt: new Date() })
          .where(eq(posts.id, post.id));
        console.log(`${label} — 보류 (본문에 작품 없음, 링크만 보존)`);
        await sleep(PACING_MS);
        continue;
      }
      const region = guessRegion(text);
      const scale = guessScale(text);
      const format = guessFormat(text);
      for (const c of toPublish) {
        const img = await storeOne(c.mediaIndex);
        await db.insert(decks).values({
          postId: post.id,
          mediaIndex: c.mediaIndex,
          imageId: img.id,
          imageVerified: toPublish.length === 1,
          titleId: c.titleId,
          climaxes: c.climaxes,
          region,
          scale,
          format,
          status: 'published',
          provenance: 'ai',
          sortAt: post.postedAt ?? new Date(),
        });
      }
      await db
        .update(posts)
        .set({ rawText: text, rawJson: raw as object, authorHandle: author, fetchedAt: new Date() })
        .where(eq(posts.id, post.id));
      console.log(`${label} ✓ 자동게시 ${toPublish.length}개 (이미지 ${toPublish.length}장)`);
      await sleep(PACING_MS);
      continue;
    }

    // Sheet post: download every image and link to the pre-existing decks.
    if (mediaUrls.length === 0) {
      await db.update(posts).set({ rawText: text, fetchedAt: new Date() }).where(eq(posts.id, post.id));
      await sleep(PACING_MS);
      continue;
    }
    const rows = [];
    for (let i = 0; i < mediaUrls.length; i++) rows.push(await storeOne(i));
    await db
      .update(posts)
      .set({ rawText: text, rawJson: raw as object, authorHandle: author, fetchedAt: new Date() })
      .where(eq(posts.id, post.id));

    // Row order is our only guess for which photo is which deck — certain only
    // for a single-deck, single-image post.
    const certain = postDecks.length === 1 && rows.length === 1;
    for (const d of postDecks) {
      const match = rows.find((r) => r.mediaIndex === d.mediaIndex);
      if (!match) continue;
      await db.update(decks).set({ imageId: match.id, imageVerified: certain }).where(eq(decks.id, d.id));
    }
    console.log(`${label} ✓ 이미지 ${rows.length}장 · 덱 ${postDecks.length}개${certain ? '' : ' (매칭 미확정)'}`);
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
// ASCII completion marker: the supervisor distinguishes "ran to the end" from
// "was killed" by this line, and restarts shards that never printed it.
console.log('BACKFILL_DONE');
console.log(`✅ 이미지 ${stored}장 저장`);
console.log(`   덱 ${withImage}개에 이미지 연결 (그중 ${verified}개는 매칭 확정)`);
if (gone) console.log(`   삭제된 트윗 ${gone}건`);
if (failed) console.log(`   실패 ${failed}건`);

process.exit(0);
