/**
 * Imports every half-year tab of the source spreadsheet (2024 H2 → now).
 *
 * Incremental, never destructive: rows are upserted with onConflictDoNothing, so
 * the already-imported 2026 H2 posts keep their backfilled deck images. The
 * older tabs (2024–2025) only ever recorded work / climax / date / URL, so their
 * decks are archived with region/scale/format left null — the site hides those
 * badges rather than inventing them. Rosé rows are dropped.
 *
 * Run with --refresh to re-download the tabs (otherwise data/tabs/{gid}.csv is used).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';

import { closeDb, db, rows as toRows } from '@/db';
import { decks, posts, titles } from '@/db/schema';
import { isRoseCode } from '@/lib/game';
import { csvUrl, identifyPost, parseTab, TABS, type SheetRow, type Tab } from '@/lib/sheet';

const refresh = process.argv.includes('--refresh');

async function loadTab(tab: Tab): Promise<string> {
  const path = `./data/tabs/${tab.gid}.csv`;
  if (existsSync(path) && !refresh) return readFileSync(path, 'utf8');
  process.stdout.write(`  ↓ ${tab.name} 내려받는 중… `);
  const res = await fetch(csvUrl(tab.gid));
  if (!res.ok) throw new Error(`시트 다운로드 실패(${tab.name}): HTTP ${res.status}`);
  const csv = await res.text();
  mkdirSync('./data/tabs', { recursive: true });
  writeFileSync(path, csv, 'utf8');
  console.log(`${(csv.length / 1024).toFixed(0)}KB`);
  return csv;
}

/** Batched insert; onConflictDoNothing keeps existing rows (and their images) intact. */
async function insertChunked<V extends Record<string, unknown>>(
  table: typeof posts | typeof decks | typeof titles,
  values: V[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conflict: { target: any },
  size = 500,
): Promise<number> {
  let n = 0;
  for (let i = 0; i < values.length; i += size) {
    const chunk = values.slice(i, i + size);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db.insert(table) as any).values(chunk).onConflictDoNothing(conflict);
    n += chunk.length;
  }
  return n;
}

/* ------------------------------------------------------------------ parse */

// TABS is newest-first, so the first master entry for a work (and the first tab
// a duplicate post appears in) wins.
const masterCode = new Map<string, string>(); // 작품명 → 코드
const allRows: SheetRow[] = [];
let quarantined = 0;

for (const tab of TABS) {
  const csv = await loadTab(tab);
  const parsed = parseTab(csv, tab);
  for (const t of parsed.titles) if (!masterCode.has(t.nameKo)) masterCode.set(t.nameKo, t.code);
  allRows.push(...parsed.rows);
  quarantined += parsed.quarantined.length;
  console.log(`  ${tab.name}: 덱행 ${parsed.rows.length} · 마스터 ${parsed.titles.length} · 격리 ${parsed.quarantined.length}`);
}

// Resolve each row's code (from its own column or the master) and drop Rosé.
const isRose = (row: SheetRow): boolean => {
  if (row.gameCol && row.gameCol.includes('로제')) return true;
  const code = row.code ?? masterCode.get(row.titleKo) ?? '';
  return isRoseCode(code);
};
const roseRows = allRows.filter(isRose).length;
const wsRows = allRows.filter((r) => !isRose(r));

console.log(`\n총 덱행 ${allRows.length} · 로제 제외 ${roseRows} · 대상 ${wsRows.length}`);

/* --------------------------------------------------------------- titles */

const titleValues = [...masterCode.entries()].map(([nameKo, code]) => ({
  nameKo,
  code,
  game: isRoseCode(code) ? ('ROSE' as const) : ('WS' as const),
}));
await insertChunked(titles, titleValues, { target: titles.nameKo });

const titleRows = await db.select({ id: titles.id, nameKo: titles.nameKo }).from(titles);
const titleId = new Map(titleRows.map((t) => [t.nameKo, t.id]));

/* --------------------------------------------------------------- posts */

// Group by canonical URL. Multiple decks under one canonical from the SAME tab
// are trio siblings (kept); the same canonical from an older tab is a duplicate
// (dropped) — allRows is newest-first, so the first tab seen fixes the group.
const groups = new Map<string, { canonical: string; url: string; tab: string; rows: SheetRow[] }>();
let unresolved = 0;
for (const row of wsRows) {
  const ref = identifyPost(row.url);
  if (!ref) {
    unresolved++;
    continue;
  }
  const g = groups.get(ref.canonical);
  if (!g) groups.set(ref.canonical, { canonical: ref.canonical, url: row.url, tab: row.tab, rows: [row] });
  else if (g.tab === row.tab) g.rows.push(row);
}

const postValues = [...groups.values()].map((g) => {
  const ref = identifyPost(g.url)!;
  const first = g.rows[0]!;
  return {
    source: ref.source,
    sourceId: ref.sourceId,
    urlCanonical: ref.canonical,
    urlOriginal: g.url,
    authorHandle: g.url.match(/(?:x|twitter)\.com\/([^/]+)\/status/i)?.[1] ?? null,
    postedAt: first.date,
  };
});
await insertChunked(posts, postValues, { target: posts.urlCanonical });

// Full canonical → id map (existing + newly inserted).
const postRows = await db.select({ id: posts.id, urlCanonical: posts.urlCanonical }).from(posts);
const postId = new Map(postRows.map((p) => [p.urlCanonical, p.id]));

/* --------------------------------------------------------------- decks */

let missingTitles = 0;
const deckValues: (typeof decks.$inferInsert)[] = [];
for (const g of groups.values()) {
  const pid = postId.get(g.canonical);
  if (!pid) continue;
  g.rows.forEach((row, i) => {
    const tid = titleId.get(row.titleKo);
    if (!tid) missingTitles++;
    deckValues.push({
      postId: pid,
      // The sheet never recorded which photo is which deck, so multi-deck posts
      // stay unverified until an image backfill can confirm the pairing.
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
  });
}
await insertChunked(decks, deckValues, { target: [decks.postId, decks.mediaIndex] });

await db.execute(sql`
  UPDATE titles SET deck_count = (
    SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
  )
`);

/* --------------------------------------------------------------- report */

const [tot] = toRows<{ p: number; d: number; withImg: number; wsTitles: number }>(
  await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM posts) AS p,
      (SELECT count(*)::int FROM decks) AS d,
      (SELECT count(*)::int FROM decks WHERE image_id IS NOT NULL) AS "withImg",
      (SELECT count(*)::int FROM titles WHERE deck_count > 0 AND game = 'WS') AS "wsTitles"
  `),
);

console.log('');
console.log(`✅ 게시물 ${tot?.p} · 덱 ${tot?.d} (이미지 연결 ${tot?.withImg})`);
console.log(`✅ 덱 보유 타이틀 ${tot?.wsTitles}종`);
if (unresolved) console.log(`⚠ URL 형식 인식 실패 ${unresolved}건`);
if (missingTitles) console.log(`⚠ 마스터 미등록 작품 참조 ${missingTitles}건 (titleId=null 로 보존)`);
if (quarantined) console.log(`⚠ 격리된 행(URL 아님) ${quarantined}건`);

await closeDb();
