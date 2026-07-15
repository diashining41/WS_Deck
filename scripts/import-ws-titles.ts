/**
 * Merges the official Weiss Schwarz title master into our titles table.
 *
 * Source: ws-tcg.com's CakePHP filter endpoint (needs the XHR header, else it
 * returns 0 bytes). `sides` is the title master — 165 grouped works, each with a
 * `##`-joined list of card-number title codes (GBS, HOL, …). Our community codes
 * ARE those same codes, so the merge keys on code, case-insensitively.
 *
 * For a work already in our master: fill name_ja if empty (leave the Korean
 * name_ko alone). For a new work: insert it. Names are Japanese-only at the
 * source and there is no official Korean edition, so a new row is seeded with
 * the Japanese name in both name_ko and name_ja — a placeholder an editor can
 * localize later — EXCEPT the handful in KO_NAMES, which we know the Korean for.
 *
 * Empty titles are safe: listTitlesWithDecks filters deck_count>0, so these
 * surface only as match targets, never on the home page.
 *
 * Dry run by default; --commit to write.
 */
import { sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';
import { titles } from '@/db/schema';
import { isRoseCode } from '@/lib/game';

const COMMIT = process.argv.includes('--commit');

/** Works whose Korean name we actually know — everything else gets the JP placeholder. */
const KO_NAMES: Record<string, string> = {
  CSM: '체인소맨',
  TSK: '전생했더니슬라임',
  AGS: '앨리스기어아이기스',
  TL: 'To러브루',
  VS: '비비드스트라이크',
};

interface Work {
  name: string;
  name_kana: string;
  title_number: string;
  side: number;
}

const res = await fetch('https://ws-tcg.com/manage/CardListUser/filter-options', {
  headers: {
    'User-Agent': 'Mozilla/5.0',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: 'https://ws-tcg.com/cardlist/',
  },
});
if (!res.ok) throw new Error(`filter-options: HTTP ${res.status}`);
const official = ((await res.json()) as { sides: Work[] }).sides;
console.log(`공식 작품 ${official.length}종 수신\n`);

// Our existing titles, indexed by uppercased code.
const existing = rows<{ id: number; code: string; nameKo: string; nameJa: string | null }>(
  await db.execute(sql`SELECT id, code, name_ko AS "nameKo", name_ja AS "nameJa" FROM titles`),
);
const byCode = new Map<string, (typeof existing)[number]>();
for (const t of existing) byCode.set(t.code.toUpperCase(), t);

let matched = 0;
let jaFilled = 0;
let newTitles = 0;
let roseSkipped = 0;
const toInsert: { code: string; nameKo: string; nameJa: string }[] = [];
const jaUpdates: { id: number; nameJa: string }[] = [];

for (const w of official) {
  const codes = (w.title_number ?? '').split('##').filter(Boolean);
  if (codes.length === 0) continue;
  if (codes.every((c) => isRoseCode(c))) {
    roseSkipped++;
    continue;
  }

  // Does any of this work's codes already exist in our master?
  const hit = codes.map((c) => byCode.get(c.toUpperCase())).find(Boolean);
  if (hit) {
    matched++;
    if (!hit.nameJa) {
      jaUpdates.push({ id: hit.id, nameJa: w.name });
      jaFilled++;
    }
  } else {
    // New work. Representative code = first token. Skip if a later work already
    // claimed this exact code as new (dedupe on code).
    const rep = codes.find((c) => !isRoseCode(c)) ?? codes[0]!;
    if (byCode.has(rep.toUpperCase()) || toInsert.some((x) => x.code.toUpperCase() === rep.toUpperCase())) continue;
    toInsert.push({ code: rep, nameKo: KO_NAMES[rep.toUpperCase()] ?? w.name, nameJa: w.name });
    newTitles++;
  }
}

console.log('════════ 병합 계획 ════════');
console.log(`  기존과 코드 매칭 : ${matched}`);
console.log(`  그중 name_ja 채움 : ${jaFilled}`);
console.log(`  신규 타이틀      : ${newTitles}`);
console.log(`  로제 스킵        : ${roseSkipped}`);

console.log('\n■ 신규 타이틀 (앞 20종)');
for (const t of toInsert.slice(0, 20)) {
  const ko = KO_NAMES[t.code.toUpperCase()];
  console.log(`   ${t.code.padEnd(6)} ${t.nameJa}${ko ? `  → 한글: ${ko}` : ''}`);
}
if (toInsert.length > 20) console.log(`   … 외 ${toInsert.length - 20}종`);

if (!COMMIT) {
  console.log('\n(드라이런입니다. 실제 삽입하려면 --commit)');
  await closeDb();
  process.exit(0);
}

// ---- write ----
for (const u of jaUpdates) {
  await db.execute(sql`UPDATE titles SET name_ja = ${u.nameJa} WHERE id = ${u.id} AND name_ja IS NULL`);
}
if (toInsert.length) {
  await db
    .insert(titles)
    .values(toInsert.map((t) => ({ code: t.code, nameKo: t.nameKo, nameJa: t.nameJa, game: 'WS' as const })))
    .onConflictDoNothing({ target: titles.nameKo });
}

const [after] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int n FROM titles WHERE game='WS'`));
console.log(`\n✅ name_ja 채움 ${jaUpdates.length}종 · 신규 ${toInsert.length}종 · WS 타이틀 총 ${after?.n}종`);

await closeDb();
