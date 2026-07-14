/**
 * Polls the seeded X accounts for new tournament posts.
 *
 * Pacing is the whole job. The measured limit is 30 requests per 15 minutes per
 * IP, and a 429 seems to consume quota on its own — so the poller runs at one
 * request per 35 seconds and stops dead when it's told to, rather than retrying
 * into a deeper hole. A full sweep of 214 accounts therefore takes ~2 hours; the
 * tiers exist so the shops that actually post get checked hourly anyway.
 *
 * New posts land as `needs_review` with no decks attached. The AI pass turns
 * them into decks; until then they simply queue up, which is a safe place to be.
 */
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { closeDb, db } from '@/db';
import { posts, sourceAccounts } from '@/db/schema';
import { gameFromText } from '@/lib/game';
import { prefilter } from '@/lib/prefilter';
import { fetchTimeline } from '@/lib/x';

// nitter RSS, not the old rate-limited syndication endpoint. Polite pacing so we
// don't get an instance to block us — images are fetched later by backfill.
const PACING_MS = 4_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TIER_INTERVAL_MS: Record<string, number> = {
  hot: 60 * 60_000, // 1h
  active: 3 * 60 * 60_000, // 3h
  longtail: 12 * 60 * 60_000, // 12h
};

const MAX = Number(process.env.MAX_ACCOUNTS ?? Infinity);

/**
 * Ignore the cursor and re-walk every tweet the timeline still holds.
 *
 * The cursor advances past tweets we *decided* to skip, not just ones we saved —
 * otherwise it never moves for a shop that mostly posts restock notices. The
 * cost of that is real: improve the prefilter, and the tweets it used to reject
 * are already behind the cursor. A full scan is how you get them back, and the
 * unique constraint makes re-reading free. Run it after any prefilter change,
 * and once a day regardless.
 */
const FULL_SCAN = process.env.FULL_SCAN === 'true';

const all = await db
  .select()
  .from(sourceAccounts)
  .where(and(eq(sourceAccounts.source, 'x'), eq(sourceAccounts.enabled, true)));

const now = Date.now();
const due = all
  .filter((a) => {
    const interval = TIER_INTERVAL_MS[a.tier] ?? TIER_INTERVAL_MS.longtail!;
    return !a.lastPolledAt || now - a.lastPolledAt.getTime() >= interval;
  })
  // Busiest accounts first, so a run that gets cut short still got the good ones.
  .sort((a, b) => b.deckCount - a.deckCount)
  .slice(0, MAX);

console.log(`폴링 대상 ${due.length} / 등록 ${all.length}개 계정\n`);

let found = 0;
let saved = 0;
let parked = 0;
let variant = 0;

for (const [i, acct] of due.entries()) {
  try {
    const refs = await fetchTimeline(acct.handle);

    // RSS is chronological, but the cursor is still a snowflake-id compare so it
    // survives out-of-order feeds and duplicate instances. lastSeenId is the
    // newest tweet we've already handled.
    const cursor = FULL_SCAN ? 0n : acct.lastSeenId ? BigInt(acct.lastSeenId) : 0n;
    const fresh = refs.filter((t) => BigInt(t.id) > cursor);

    let maxSeen = cursor;
    let newHere = 0;

    // Store the post shell from the RSS text (which is the full tweet text).
    // Images and the authoritative text come later, when backfill-images.ts
    // calls fetchTweet — the two rate-limited services stay in separate passes.
    for (const t of fresh) {
      if (BigInt(t.id) > maxSeen) maxSeen = BigInt(t.id);

      // Rosé and Blau are different games. Their titles won't be in our master,
      // so without this gate they'd arrive as "unknown 작품" and a reviewer would
      // be invited to add them — quietly turning this into a three-game site.
      if (gameFromText(t.text) !== 'WS') {
        variant++;
        continue;
      }

      // RSS descriptions embed the tweet's images, so a deck photo means the
      // description carries media — good enough for the prefilter's image bonus.
      const pf = prefilter({ text: t.text, hasImage: /pic\.|photo|media|<img/i.test(t.text) });
      if (!pf.pass) {
        parked++;
        continue;
      }

      const res = await db
        .insert(posts)
        .values({
          source: 'x',
          sourceId: t.id,
          urlCanonical: `https://x.com/i/status/${t.id}`,
          urlOriginal: t.url,
          authorHandle: t.authorHandle,
          postedAt: t.createdAt,
          rawText: t.text,
          fetchedAt: null, // no images yet — backfill will complete this
        })
        .onConflictDoNothing()
        .returning({ id: posts.id });

      if (res.length) {
        saved++;
        newHere++;
      }
    }

    found += fresh.length;

    // Advance the cursor only after the inserts above committed. A cursor that
    // is too low just re-reads posts the unique constraint already dedupes; a
    // cursor that is too high loses them for good.
    await db
      .update(sourceAccounts)
      .set({
        lastSeenId: maxSeen > 0n ? maxSeen.toString() : acct.lastSeenId,
        lastPolledAt: new Date(),
        consecutiveFailures: 0,
      })
      .where(eq(sourceAccounts.id, acct.id));

    console.log(
      `[${i + 1}/${due.length}] @${acct.handle.padEnd(20)} 신규 ${String(fresh.length).padStart(2)}건 → 저장 ${newHere}`,
    );
  } catch (err) {
    await db
      .update(sourceAccounts)
      .set({
        consecutiveFailures: sql`${sourceAccounts.consecutiveFailures} + 1`,
        lastPolledAt: new Date(),
      })
      .where(eq(sourceAccounts.id, acct.id));
    console.log(`[${i + 1}/${due.length}] @${acct.handle} ✗ ${err instanceof Error ? err.message : err}`);
  }

  if (i < due.length - 1) await sleep(PACING_MS);
}

console.log(
  `\n✅ 신규 ${found}건 · 저장 ${saved}건 · 프리필터 탈락 ${parked}건 · 로제/블라우 제외 ${variant}건${FULL_SCAN ? '  (전체 재스캔)' : ''}`,
);
if (saved > 0) console.log(`   → AI 추출로 덱을 뽑아내면 됩니다`);

await closeDb();
