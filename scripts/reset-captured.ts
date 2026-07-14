/**
 * Resets the automation-captured data back to the clean spreadsheet baseline.
 *
 * The cancelled first cloud run left Neon with ~950 captured posts and decks
 * whose images only ever existed on the (now-destroyed) CI runner. This drops
 * everything the poller added and rewinds the cursors, so a fresh run captures
 * cleanly. The sheet import (provenance=sheet_import) and its images are kept.
 */
import { sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';

const before = rows<Record<string, number>>(
  await db.execute(sql`SELECT (SELECT count(*)::int FROM posts) p, (SELECT count(*)::int FROM decks) d`),
)[0]!;

// Captured decks (everything not from the sheet).
await db.execute(sql`DELETE FROM decks WHERE provenance <> 'sheet_import'`);
// Images and posts that no longer belong to any deck (the captured ones).
await db.execute(sql`DELETE FROM images WHERE post_id NOT IN (SELECT DISTINCT post_id FROM decks)`);
await db.execute(sql`DELETE FROM posts WHERE id NOT IN (SELECT DISTINCT post_id FROM decks)`);
// Rewind every account so the next poll re-captures the recent window.
await db.execute(sql`UPDATE source_accounts SET last_seen_id = NULL, last_polled_at = NULL`);
await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )
`);

const after = rows<Record<string, number>>(
  await db.execute(sql`SELECT (SELECT count(*)::int FROM posts) p, (SELECT count(*)::int FROM decks) d`),
)[0]!;

console.log(`게시물 ${before.p} → ${after.p} · 덱 ${before.d} → ${after.d}`);
console.log('✅ 시트 기준선으로 리셋 + 커서 초기화 완료');

await closeDb();
