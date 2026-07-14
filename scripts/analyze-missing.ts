/**
 * Why is a deck missing its image? Read-only breakdown before any pruning.
 *
 * "No image" is not the same as "source is gone", and only the second is safe to
 * delete. A naver post has no image because its adapter was never written; a
 * trio tweet can be alive with 4 decks and 3 photos. Deleting on "no image"
 * alone would throw away live archive rows.
 */
import { sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';

const bySource = rows<{ source: string; posts: number; decks: number }>(
  await db.execute(sql`
    SELECT p.source,
           count(DISTINCT p.id)::int AS posts,
           count(d.id)::int          AS decks
    FROM posts p
    LEFT JOIN decks d ON d.post_id = p.id
    WHERE NOT EXISTS (SELECT 1 FROM images i WHERE i.post_id = p.id)
    GROUP BY p.source
    ORDER BY posts DESC
  `),
);

console.log('■ 이미지 없는 게시물 — 소스별');
for (const r of bySource) console.log(`   ${r.source.padEnd(8)} 게시물 ${String(r.posts).padStart(5)} · 덱 ${r.decks}`);

// For X posts: did we actually try to fetch, and did the tweet answer?
// A deleted tweet leaves fetched_at set but raw_text empty (the fetch returned
// nothing to store). A live-but-photoless tweet leaves raw_text populated.
const xBreak = rows<{ bucket: string; posts: number; decks: number }>(
  await db.execute(sql`
    SELECT
      CASE
        WHEN p.fetched_at IS NULL                      THEN '1. 아직 시도 안 함'
        WHEN coalesce(p.raw_text, '') = ''             THEN '2. 조회했으나 본문 없음 (삭제 의심)'
        ELSE                                                '3. 살아있음 (본문 있음, 사진 없음)'
      END AS bucket,
      count(DISTINCT p.id)::int AS posts,
      count(d.id)::int          AS decks
    FROM posts p
    LEFT JOIN decks d ON d.post_id = p.id
    WHERE p.source = 'x'
      AND NOT EXISTS (SELECT 1 FROM images i WHERE i.post_id = p.id)
    GROUP BY 1 ORDER BY 1
  `),
);

console.log('\n■ X 게시물 세부');
for (const r of xBreak) console.log(`   ${r.bucket.padEnd(34)} 게시물 ${String(r.posts).padStart(5)} · 덱 ${r.decks}`);

// Decks with no image whose post DOES have images = trio mismatch (source alive).
const [mismatch] = rows<{ decks: number; posts: number }>(
  await db.execute(sql`
    SELECT count(*)::int AS decks, count(DISTINCT d.post_id)::int AS posts
    FROM decks d
    WHERE d.image_id IS NULL
      AND EXISTS (SELECT 1 FROM images i WHERE i.post_id = d.post_id)
  `),
);
console.log(`\n■ 원본은 멀쩡한데 덱만 이미지 없음 (트리오 덱 수 > 사진 수)`);
console.log(`   덱 ${mismatch?.decks} · 게시물 ${mismatch?.posts}  → 지우면 안 됨`);

// Held posts (captured, no decks at all) — link-only rows.
const [held] = rows<{ n: number }>(
  await db.execute(sql`
    SELECT count(*)::int AS n FROM posts p
    WHERE NOT EXISTS (SELECT 1 FROM decks d WHERE d.post_id = p.id)
  `),
);
console.log(`\n■ 덱이 하나도 없는 게시물 (보류·링크만 보존): ${held?.n}`);

await closeDb();
