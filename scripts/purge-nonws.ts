/**
 * Evicts non-Weiss-Schwarz decks that leaked onto WS title pages.
 *
 * The trigger was the Love Live Official Card Game (ラブカ): a separate Bushiroad
 * TCG sharing the Love Live IP, so its posts named μ's / Aqours / … and got
 * auto-placed onto our WS pages. gameFromText now recognises it; this sweeps out
 * what landed before the gate existed.
 *
 * SAFETY — why this is not just "reject everything gameFromText flags":
 * many sheet-imported posts are COMBINED multi-game tweets ("#WS優勝 NIKKE扉電源
 * … #ヴァイスシュヴァルツブラウ 3名"), or a genuine WS post where a player merely
 * mentions ロゼ/ラブカ in a comment. The actual archived deck there is REAL WS.
 * A whole-post text gate would delete ~72 such WS decks. So we reject only when
 * it CANNOT be a mislabelled WS deck:
 *
 *   1. game === 'OTHER' — gameFromText already required an other-TCG name AND
 *      the absence of any base-WS signal, so a combined post never reaches here.
 *   2. the deck sits on a non-WS title (title.game != 'WS') — a WS deck's work
 *      resolves to a WS title, so a deck on a Rosé title is a Rosé deck.
 *
 * A Rosé/Blau *mention* on a deck that maps to a WS title is deliberately LEFT
 * ALONE — that is the combined-post case, and the WS deck is the real one.
 *
 * It also sweeps shop-advert posts (isShopAd): a WS-marked sales / restock /
 * buylist listing carrying a 작품 but no tournament result (labelled PROMO).
 *
 * Rejected (not deleted): status='rejected' hides it from the site but keeps the
 * row for audit and reversal. Then titles.deck_count is recomputed.
 *
 * Dry run by default; --commit to write.
 */
import { eq, inArray, sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';
import { decks, posts, titles } from '@/db/schema';
import { isShopAd } from '@/lib/classify';
import { gameFromText } from '@/lib/game';

const COMMIT = process.argv.includes('--commit');

const all = await db
  .select({
    deckId: decks.id,
    status: decks.status,
    provenance: decks.provenance,
    titleGame: titles.game,
    code: titles.code,
    nameKo: titles.nameKo,
    rawText: posts.rawText,
    url: posts.urlOriginal,
    source: posts.source,
  })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .leftJoin(titles, eq(titles.id, decks.titleId))
  .where(inArray(decks.status, ['published', 'needs_review']));

interface Row {
  deckId: string;
  game: string;
  titleGame: string | null;
  code: string | null;
  nameKo: string | null;
  status: string;
  source: string;
  url: string;
  text: string;
}

const reject: Row[] = [];
const protect: Row[] = []; // non-WS text BUT maps to a WS title → combined post, real WS deck

for (const d of all) {
  const text = d.rawText ?? '';
  const game = gameFromText(text);
  const r: Row = {
    deckId: d.deckId,
    game,
    titleGame: d.titleGame,
    code: d.code,
    nameKo: d.nameKo,
    status: d.status,
    source: d.source,
    url: d.url,
    text: text.replace(/\s+/g, ' ').trim().slice(0, 150),
  };
  if (game !== 'WS') {
    // 'OTHER' already required an other-game name AND no base-WS signal, so it
    // cannot be a mislabelled WS deck. Rosé/Blau on a WS title is the combined-
    // post case (the real deck is WS) → protect; on a non-WS title → reject.
    const safe = game === 'OTHER' || d.titleGame !== 'WS';
    (safe ? reject : protect).push(r);
  } else if (isShopAd(text)) {
    // WS-marked, but a shop advert / sales listing — not a tournament result.
    r.game = 'PROMO';
    reject.push(r);
  }
}

const rejByGame: Record<string, number> = {};
for (const r of reject) rejByGame[`${r.game}→${r.titleGame ?? 'NULL'}`] = (rejByGame[`${r.game}→${r.titleGame ?? 'NULL'}`] ?? 0) + 1;
const rejVisible = reject.filter((r) => r.status === 'published' && r.titleGame === 'WS');

console.log(`스캔 ${all.length}개 · 비-WS 텍스트 ${reject.length + protect.length}개\n`);
console.log(`■ 제거(rejected) 대상: ${reject.length}개  ${JSON.stringify(rejByGame)}`);
console.log(`   그중 실제 WS 페이지에 노출 중이던 것: ${rejVisible.length}개 (러브라이브 OCG 등)\n`);
for (const r of reject) {
  const vis = r.status === 'published' && r.titleGame === 'WS' ? ' ◀노출중' : '';
  console.log(`   [${r.game}→${r.code ?? '-'}(${r.nameKo ?? '-'})/${r.titleGame ?? '-'}]${vis}  ${r.url}`);
}

console.log(`\n■ 보호(그대로 둠): ${protect.length}개 — 복합 게시물의 진짜 WS 덱`);
console.log('   (한 트윗에 WS + 로제/블라우가 함께 언급됐지만 아카이브된 덱은 WS 본가)');
for (const r of protect.slice(0, 8)) console.log(`   [${r.game}→WS:${r.code}(${r.nameKo})]  ${r.url}\n      ${r.text}`);
if (protect.length > 8) console.log(`   … 외 ${protect.length - 8}개`);

if (!COMMIT) {
  console.log('\n(드라이런입니다. 실제 반영하려면 --commit)');
  await closeDb();
  process.exit(0);
}

// ---- write ----
const ids = reject.map((r) => r.deckId);
if (ids.length) await db.update(decks).set({ status: 'rejected' }).where(inArray(decks.id, ids));
await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )
`);
const [{ n: pub } = { n: 0 }] = rows<{ n: number }>(
  await db.execute(sql`SELECT count(*)::int AS n FROM decks WHERE status='published'`),
);
console.log(`\n✅ ${ids.length}개 rejected · deck_count 재계산 · 남은 게시 덱 ${pub}개`);

await closeDb();
