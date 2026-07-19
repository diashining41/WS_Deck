/**
 * Removes the non-WS / non-recipe decks found by the 2026-07 full vision sweep of
 * the shared-IP titles (hololive / love live / 五等分 / マクロス / ディズニー / …),
 * scoped to the 325 text-unconfirmable (no WS fingerprint) published decks — the
 * only place cross-game look-alikes can hide. All 325 were eyeballed at montage
 * scale and every suspect zoomed to full-res. Only three did not survive:
 *
 *   - Reバース for you (hololive) mis-placed on HOL — the PSA slab reads
 *     "REBIRTH FOR YOU … HP/001B" and the cards show a "LIFE 5" stat, neither of
 *     which exists in Weiß Schwarz. (A SIBLING deck on the same TSUTAYA post is a
 *     genuine 五等分 WS deck and is deliberately NOT removed.)
 *   - An upcoming-event flyer ("WS CXチャレンジ 開催日時 7/19 … 優勝者[prize]"), a
 *     future announcement, not a placing result. The classify gate now catches
 *     this shape (isEventPromo PROMO_HARD), but this one predates the fix.
 *   - A bowl of ramen — a tournament-day meal photo mis-ingested as a deck.
 *
 * Reversible: status='rejected' hides the rows without deleting them; deck_count
 * is then recomputed. Dry run by default; --commit to write.
 */
import { inArray, sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';
import { decks } from '@/db/schema';

const COMMIT = process.argv.includes('--commit');

const TARGETS: { id: string; why: string }[] = [
  { id: '1c474ea8-b072-43c7-9275-af932aa3e02f', why: 'HOL #70 — Reバース for you (Rushia, PSA "REBIRTH FOR YOU HP/001B", LIFE 5)' },
  { id: '1112e6dc-7523-4707-b165-16046ff258ec', why: 'GBF — 開催予定 event-promo flyer (torekore_kudama), not a result' },
  { id: 'e3fdeb9b-d84f-4647-a331-463d664bbffc', why: 'LNJ #294 — ramen photo (nisekoiweiss), no cards at all' },
  // Round 2 — hololive OFFICIAL CARD GAME (hOCG) on HOL, caught only on a
  // full-res individual zoom (montage scale wrongly read them as WS). The tell:
  // holomem cards carry an HP value + Bloom level in a TOP name-bar and have NO
  // WS diagonal-stripe climax cards; hOCG decks run white support/cheer cards.
  { id: '41bf5e98-36fb-4dbf-b96b-0b4769662664', why: 'HOL — hOCG AZKi deck (HP 120/150/220, Bloom, "hololive OFFICIAL CARD GAME" mat) — LASTCG_77' },
  { id: '4a4c0756-c7e9-4220-b1aa-3fcc5493528b', why: 'HOL — hOCG FUWAMOCO (フワワ/モココ・アビスガード holomem) — tcg_mobara (user-reported)' },
  { id: '6fc31993-478d-48c9-9fef-b39cbda99530', why: 'HOL — hOCG Mori Calliope/Shiranui Flare (HP 210/200, 推しスキル/エール) — LASTCG_77' },
  // Round 3 — game-gate under-detection (user-reported). OTHER_TCG required the
  // full "シャドウバース エボルヴ" so a bare "#エボルヴ" Shadowverse result leaked
  // onto ウマ娘; "ポケカ\b" never fired on "#ポケカ ジムバトル". Both fixed in
  // src/lib/game.ts; these two predate the fix and are pure non-WS (no ヴァイス,
  // no climax). A whole-DB re-scan with the new gate flips exactly these two.
  { id: 'd7580408-8c5b-4f90-9bd6-9391befe258e', why: 'UMA — Shadowverse EVOLVE ("#エボルヴ ショップ大会 デッキ名 ループウマ") — batoloco_tym (user-reported)' },
  { id: 'c4f508e2-c1d2-475c-a155-c01f2dcc37a7', why: 'PD — Pokémon TCG ("#ポケカ ジムバトル 優勝者 クミクミ様 #リザＸ") — BO_MUSAKO' },
];

const ids = TARGETS.map((t) => t.id);
const found = rows<{ id: string; status: string }>(
  await db.execute(sql`SELECT id::text, status FROM decks WHERE id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`),
);
console.log(`대상 ${ids.length}건 · DB에서 발견 ${found.length}건`);
for (const t of TARGETS) {
  const f = found.find((r) => r.id === t.id);
  console.log(`  ${f ? `[${f.status}]` : '[없음]'}  ${t.why}`);
}

if (!COMMIT) {
  console.log('\n(드라이런입니다. 실제 반영하려면 --commit)');
  await closeDb();
  process.exit(0);
}

await db.update(decks).set({ status: 'rejected' }).where(inArray(decks.id, ids));
await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )
`);
const [{ n: pub } = { n: 0 }] = rows<{ n: number }>(
  await db.execute(sql`SELECT count(*)::int AS n FROM decks WHERE status='published'`),
);
console.log(`\n✅ ${ids.length}건 rejected · deck_count 재계산 · 남은 게시 덱 ${pub}개`);

await closeDb();
