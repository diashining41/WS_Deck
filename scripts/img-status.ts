/** Image coverage status. */
import { sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';

const r = rows<Record<string, number>>(
  await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM images) AS images,
      (SELECT count(*)::int FROM decks) AS decks,
      (SELECT count(*)::int FROM decks WHERE image_id IS NOT NULL) AS decks_with_img,
      (SELECT count(*)::int FROM decks WHERE image_id IS NULL) AS decks_no_img,
      (SELECT count(*)::int FROM posts) AS posts,
      (SELECT count(*)::int FROM posts p WHERE NOT EXISTS (SELECT 1 FROM images i WHERE i.post_id = p.id)) AS posts_no_img,
      (SELECT count(DISTINCT d.post_id)::int FROM decks d WHERE d.image_id IS NULL) AS posts_with_unlinked_decks,
      (SELECT count(*)::int FROM posts p WHERE p.fetched_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM images i WHERE i.post_id = p.id)) AS posts_fetched_but_no_img
  `),
)[0]!;

console.log(JSON.stringify(r, null, 1));
await closeDb();
