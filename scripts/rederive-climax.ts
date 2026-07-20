/**
 * Re-derive decks.climaxes from post text with the fixed climaxesFromText, which
 * no longer scrapes opponents' climaxes out of round-by-round match logs.
 *
 * The old extractor merged the whole tweet, so a Granblue "8宝" deck stored as
 * 문/게이트/초이스/금괴. This recomputes every published deck; where the text names
 * no deck climax (most shop announcements), it clears to 미상 for the image 판독
 * to fill from the photo later.
 *
 * Dry run by default (prints before/after distribution + samples). --commit writes.
 * SCOPE=GBF limits to one title code; omit for all published decks.
 */
import { inArray, sql } from 'drizzle-orm';
import { closeDb, db, rows } from '@/db';
import { type Climax, decks, titles } from '@/db/schema';
import { climaxesFromText } from '@/lib/heuristics';

const COMMIT = process.argv.includes('--commit');
const SCOPE = process.env.SCOPE?.trim();

// sanity: the known cases the user flagged
const CHECK: [string, string][] = [
  ['3ae4bd1a', '금괴'],           // グラブル 8宝 → single 금괴 (was 문,게이트,초이스,금괴)
  ['2c2ed9c4', '게이트,문'],       // 使用:門扉 → 게이트+문 split
];
for (const [id, want] of CHECK) {
  const r = rows<{ t: string }>(await db.execute(sql`SELECT p.raw_text AS t FROM decks d JOIN posts p ON p.id=d.post_id WHERE d.id::text LIKE ${id + '%'} LIMIT 1`));
  const got = climaxesFromText(r[0]?.t ?? '').join(',');
  console.log(`  check ${id}: [${got}] ${got === want ? '✓' : '✗ expected ' + want}`);
}

const all = rows<{ id: string; climaxes: string; text: string | null; code: string }>(
  await db.execute(
    SCOPE
      ? sql`SELECT d.id::text, d.climaxes::text, p.raw_text AS text, t.code FROM decks d JOIN titles t ON t.id=d.title_id JOIN posts p ON p.id=d.post_id WHERE d.status='published' AND t.code=${SCOPE}`
      : sql`SELECT d.id::text, d.climaxes::text, p.raw_text AS text, t.code FROM decks d JOIN titles t ON t.id=d.title_id JOIN posts p ON p.id=d.post_id WHERE d.status='published'`,
  ),
);

const beforeHist: Record<number, number> = {};
const afterHist: Record<number, number> = {};
let changed = 0, toEmpty = 0, multiToSingle = 0, preserved = 0;
const updates: { id: string; after: Climax[] }[] = [];
for (const r of all) {
  const before = r.climaxes.replace(/[{}]/g, '');
  const beforeArr = before ? before.split(',') : [];
  const after = climaxesFromText(r.text ?? '');
  beforeHist[beforeArr.length] = (beforeHist[beforeArr.length] ?? 0) + 1;
  afterHist[after.length] = (afterHist[after.length] ?? 0) + 1;
  const afterStr = after.join(',');
  if (before === afterStr) { preserved++; continue; }
  changed++;
  if (before && !afterStr) toEmpty++;
  if (beforeArr.length > 1 && after.length === 1) multiToSingle++;
  updates.push({ id: r.id, after });
}

const hist = (h: Record<number, number>) => [0, 1, 2, 3, 4].map((n) => `${n}종:${h[n] ?? 0}`).join(' · ');
console.log(`\n대상 ${all.length}건${SCOPE ? ` (SCOPE=${SCOPE})` : ''}`);
console.log(`before ${hist(beforeHist)}`);
console.log(`after  ${hist(afterHist)}`);
console.log(`변경 ${changed} · →미상 ${toEmpty} · 다종→단일 ${multiToSingle} · 유지 ${preserved}`);

if (!COMMIT) {
  console.log('\n(드라이런. --commit 로 반영)');
  await closeDb();
  process.exit(0);
}

// batch by identical target value (≈15 distinct arrays), chunk ids to stay under
// query limits — a handful of UPDATEs instead of 11k round-trips
const groups = new Map<string, { after: Climax[]; ids: string[] }>();
for (const u of updates) {
  const k = JSON.stringify(u.after);
  if (!groups.has(k)) groups.set(k, { after: u.after, ids: [] });
  groups.get(k)!.ids.push(u.id);
}
for (const g of groups.values()) {
  for (let i = 0; i < g.ids.length; i += 1000) {
    await db.update(decks).set({ climaxes: g.after }).where(inArray(decks.id, g.ids.slice(i, i + 1000)));
  }
  console.log(`  [${g.after.join(',') || '미상'}] ${g.ids.length}건`);
}
console.log(`\n✅ ${updates.length}건 climaxes 재도출 반영`);
await closeDb();
