/**
 * Seeds the X accounts to poll, from the accounts that actually produced decks.
 *
 * Tiers exist because of a hard measured ceiling: 30 requests per 15 minutes per
 * IP, i.e. 2,880/day. Polling 214 accounts hourly would need 5,136 — over
 * budget. But the distribution is heavily skewed (the top 30 accounts produced
 * 45% of all decks), so tiering by output fits comfortably inside the limit
 * while still checking the busy shops every hour.
 */
import { eq, sql } from 'drizzle-orm';

import { db, rows as toRows } from '@/db';
import { sourceAccounts } from '@/db/schema';

interface Row {
  handle: string;
  decks: number;
  lastPost: string;
}

const counts = toRows<Row>(
  await db.execute(sql`
    SELECT p.author_handle AS handle,
           count(d.id)::int AS decks,
           max(p.posted_at)::text AS "lastPost"
    FROM posts p
    JOIN decks d ON d.post_id = p.id
    WHERE p.source = 'x' AND p.author_handle IS NOT NULL
    GROUP BY p.author_handle
    ORDER BY count(d.id) DESC
  `),
);

// hot = the top 30 by output; active = everyone else who posted decks; the long
// tail is for accounts we discover later and have no track record for.
const HOT = 30;

let seeded = 0;
for (const [i, r] of counts.entries()) {
  const tier = i < HOT ? 'hot' : 'active';
  await db
    .insert(sourceAccounts)
    .values({
      source: 'x',
      handle: r.handle,
      tier,
      deckCount: r.decks,
      lastPostAt: r.lastPost ? new Date(r.lastPost) : null,
    })
    .onConflictDoUpdate({
      target: [sourceAccounts.source, sourceAccounts.handle],
      set: { tier, deckCount: r.decks },
    });
  seeded++;
}

const hot = counts.slice(0, HOT);
const hotDecks = hot.reduce((a, b) => a + b.decks, 0);
const allDecks = counts.reduce((a, b) => a + b.decks, 0);

console.log(`X 계정 ${seeded}개 등록\n`);
console.log(`  hot    ${hot.length}개  (1시간마다 폴링 · 일 ${hot.length * 24}회)`);
console.log(`  active ${counts.length - hot.length}개  (3시간마다 · 일 ${(counts.length - hot.length) * 8}회)`);
console.log(`\n  일일 요청 예산: ${hot.length * 24 + (counts.length - hot.length) * 8} / 2,880 (실측 한도)`);
console.log(`  상위 ${HOT}개 계정이 전체 덱의 ${((hotDecks / allDecks) * 100).toFixed(0)}%를 생산합니다`);
console.log(`\n  상위 10개: ${counts.slice(0, 10).map((c) => `@${c.handle}(${c.decks})`).join(' ')}`);

process.exit(0);
