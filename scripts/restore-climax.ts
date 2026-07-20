/**
 * Restore the curated climaxes my 2026-07 re-derive wrongly wiped. That re-derive
 * recomputed climaxes from tweet text and set 미상 where the text named none — but
 * 12.5k decks are `sheet_import`, whose climax was human-entered in the source
 * spreadsheet (data/tabs/*.csv), NOT in the tweet. So recomputing from text
 * destroyed real data.
 *
 * This reconstructs the exact pre-rederive value for sheet_import decks by
 * replaying import-sheet.ts's own grouping: parse the CSV tabs, group rows by
 * canonical URL (newest tab wins, same-tab rows are trio siblings in order), and
 * map (canonical, mediaIndex) → row.climaxes — the identical key import-sheet used
 * to assign them. Non-sheet decks (provenance != sheet_import) are left untouched.
 *
 * Dry run by default (prints before/after distribution vs the recorded pre-rederive
 * 0:137·1:6934·2:5518·3:168·4:6). --commit writes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { inArray, sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';
import { type Climax, decks } from '@/db/schema';
import { isRoseCode } from '@/lib/game';
import { identifyPost, parseTab, type SheetRow, TABS } from '@/lib/sheet';

const COMMIT = process.argv.includes('--commit');

// --- replay import-sheet.ts grouping exactly ---
const masterCode = new Map<string, string>();
const allRows: SheetRow[] = [];
for (const tab of TABS) {
  const csv = readFileSync(resolve(`./data/tabs/${tab.gid}.csv`), 'utf8');
  const parsed = parseTab(csv, tab);
  for (const t of parsed.titles) if (!masterCode.has(t.nameKo)) masterCode.set(t.nameKo, t.code);
  allRows.push(...parsed.rows);
}
const isRose = (row: SheetRow): boolean => {
  if (row.gameCol && row.gameCol.includes('로제')) return true;
  return isRoseCode(row.code ?? masterCode.get(row.titleKo) ?? '');
};
const wsRows = allRows.filter((r) => !isRose(r));

const groups = new Map<string, { tab: string; rows: SheetRow[] }>();
for (const row of wsRows) {
  const ref = identifyPost(row.url);
  if (!ref) continue;
  const g = groups.get(ref.canonical);
  if (!g) groups.set(ref.canonical, { tab: row.tab, rows: [row] });
  else if (g.tab === row.tab) g.rows.push(row);
}
// (canonical#mediaIndex) → climaxes, the key import-sheet used
const cxMap = new Map<string, Climax[]>();
for (const [canonical, g] of groups) g.rows.forEach((row, i) => cxMap.set(`${canonical}#${i}`, row.climaxes));
console.log(`CSV 재현: 그룹 ${groups.size} · (canonical#idx) 매핑 ${cxMap.size}`);

// --- sheet_import published decks ---
const dks = rows<{ id: string; mi: number; canon: string; cur: string }>(
  await db.execute(sql`
    SELECT d.id::text, d.media_index AS mi, p.url_canonical AS canon, d.climaxes::text AS cur
    FROM decks d JOIN posts p ON p.id = d.post_id
    WHERE d.status='published' AND d.provenance='sheet_import'`),
);

const beforeHist: Record<number, number> = {};
const afterHist: Record<number, number> = {};
const updates = new Map<string, string[]>(); // target climaxes json → ids
let changed = 0;
let unmatched = 0;
for (const d of dks) {
  const cur = d.cur.replace(/[{}]/g, '');
  const curArr = cur ? cur.split(',') : [];
  const target = cxMap.get(`${d.canon}#${d.mi}`);
  beforeHist[curArr.length] = (beforeHist[curArr.length] ?? 0) + 1;
  if (!target) {
    unmatched++;
    afterHist[curArr.length] = (afterHist[curArr.length] ?? 0) + 1; // leave as-is
    continue;
  }
  afterHist[target.length] = (afterHist[target.length] ?? 0) + 1;
  const tgtStr = target.join(',');
  if (tgtStr !== cur) {
    changed++;
    const key = JSON.stringify(target);
    if (!updates.has(key)) updates.set(key, []);
    updates.get(key)!.push(d.id);
  }
}
const hist = (h: Record<number, number>) => [0, 1, 2, 3, 4].map((n) => `${n}:${h[n] ?? 0}`).join('·');
console.log(`sheet_import 게시덱 ${dks.length} · CSV매칭실패 ${unmatched}`);
console.log(`현재(재도출후) ${hist(beforeHist)}`);
console.log(`복원후         ${hist(afterHist)}`);
console.log(`재도출직전(기록) 0:137·1:6934·2:5518·3:168·4:6  (전체; ai 199 제외분 감안)`);
console.log(`변경 ${changed}건`);

if (!COMMIT) {
  console.log('\n(드라이런. --commit 로 복원)');
  await closeDb();
  process.exit(0);
}
let done = 0;
for (const [key, ids] of updates) {
  const val = JSON.parse(key) as Climax[];
  for (let i = 0; i < ids.length; i += 1000) {
    await db.update(decks).set({ climaxes: val }).where(inArray(decks.id, ids.slice(i, i + 1000)));
  }
  done += ids.length;
}
console.log(`\n✅ ${done}건 큐레이션 climax 복원`);
await closeDb();
