import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';

import { db, rows as toRows } from '@/db';
import { decks, posts, titles } from '@/db/schema';
import { isRoseCode } from '@/lib/game';
import { identifyPost, parseSheet, SHEET_CSV_URL, type SheetRow } from '@/lib/sheet';

const CACHE = './data/sheet.csv';

async function loadCsv(): Promise<string> {
  if (existsSync(CACHE) && !process.argv.includes('--refresh')) {
    return readFileSync(CACHE, 'utf8');
  }
  console.log('스프레드시트 내려받는 중…');
  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) throw new Error(`시트 다운로드 실패: HTTP ${res.status}`);
  const csv = await res.text();
  mkdirSync('./data', { recursive: true });
  writeFileSync(CACHE, csv, 'utf8');
  return csv;
}

const csv = await loadCsv();
const sheet = parseSheet(csv);

console.log(`타이틀 마스터 : ${sheet.titles.length}종`);
console.log(`덱 행         : ${sheet.rows.length}`);
console.log(`격리된 행     : ${sheet.quarantined.length} → ${sheet.quarantined.map((q) => q.cell).join(', ')}`);
for (const w of sheet.warnings) console.log(`  ⚠ ${w}`);

// Wipe and reload: the sheet is the source of truth for this import.
await db.delete(decks);
await db.delete(posts);
await db.delete(titles);

const insertedTitles = await db
  .insert(titles)
  .values(
    sheet.titles.map((t) => ({
      nameKo: t.nameKo,
      code: t.code,
      // Rosé is a different game with a different card pool. Its works are
      // exactly the OS## codes, so they are flagged here and never served.
      game: isRoseCode(t.code) ? ('ROSE' as const) : ('WS' as const),
    })),
  )
  .returning({ id: titles.id, nameKo: titles.nameKo });

const roseCount = sheet.titles.filter((t) => isRoseCode(t.code)).length;

const titleId = new Map(insertedTitles.map((t) => [t.nameKo, t.id]));

// One post can carry up to 4 decks (a trio team posts all its lists in one
// tweet), so decks are grouped under their URL rather than created 1:1.
const byUrl = new Map<string, SheetRow[]>();
for (const row of sheet.rows) {
  const list = byUrl.get(row.url);
  if (list) list.push(row);
  else byUrl.set(row.url, [row]);
}

let deckCount = 0;
let unresolvedUrls = 0;
let missingTitles = 0;

for (const [url, group] of byUrl) {
  const ref = identifyPost(url);
  if (!ref) {
    unresolvedUrls++;
    console.log(`  ⚠ URL 형식 인식 실패: ${url}`);
    continue;
  }

  const first = group[0]!;
  const [post] = await db
    .insert(posts)
    .values({
      source: ref.source,
      sourceId: ref.sourceId,
      urlCanonical: ref.canonical,
      urlOriginal: url,
      authorHandle: url.match(/(?:x|twitter)\.com\/([^/]+)\/status/i)?.[1] ?? null,
      postedAt: first.date,
    })
    .returning({ id: posts.id });

  if (!post) continue;

  for (const [i, row] of group.entries()) {
    const tid = titleId.get(row.titleKo);
    if (!tid) {
      missingTitles++;
      console.log(`  ⚠ 마스터에 없는 작품: ${row.titleKo}`);
    }

    await db.insert(decks).values({
      postId: post.id,
      // Provisional: the sheet never recorded which photo belongs to which deck.
      // Row order is the only signal we have, so multi-deck posts stay unverified
      // until the image backfill can confirm the pairing.
      mediaIndex: i,
      imageVerified: false,
      titleId: tid ?? null,
      titleRaw: row.titleKo,
      climaxes: row.climaxes,
      region: row.region,
      scale: row.scale,
      format: row.format,
      top4: row.top4,
      status: 'published',
      provenance: 'sheet_import',
      sortAt: row.date,
    });
    deckCount++;
  }
}

await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )
`);

const withDecks = toRows<{ n: number }>(
  await db.execute(sql`SELECT count(*)::int AS n FROM titles WHERE deck_count > 0 AND game = 'WS'`),
);
const roseDecks = toRows<{ n: number }>(
  await db.execute(sql`
    SELECT count(*)::int AS n FROM decks d JOIN titles t ON t.id = d.title_id WHERE t.game = 'ROSE'
  `),
);

console.log('');
console.log(`✅ 타이틀 ${insertedTitles.length}종 (덱 보유 ${withDecks[0]?.n ?? '?'}종)`);
console.log(`✅ 게시물 ${byUrl.size - unresolvedUrls}개`);
console.log(`✅ 덱 ${deckCount}개`);
console.log(`🚫 로제 제외: 타이틀 ${roseCount}종 · 덱 ${roseDecks[0]?.n ?? 0}개 (OS 코드 = 바이스슈발츠 로제)`);
if (missingTitles) console.log(`⚠ 마스터 미등록 작품 참조 ${missingTitles}건`);

process.exit(0);
