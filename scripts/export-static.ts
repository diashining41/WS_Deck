/**
 * Freezes the current WS data into a static JSON snapshot the public site reads.
 *
 * The public site is a read-only snapshot of the ingestion store. Keeping those
 * two separate is what lets the site deploy as pure static files — no database,
 * no secrets, no serverless — while the DB (and the poller that fills it) lives
 * on a worker or a dev machine. Re-run this after ingesting to refresh the site.
 */
import { mkdirSync, writeFileSync } from 'node:fs';

import { closeDb } from '@/db';
import { getStats, listDecksForTitle, listTitlesWithDecks } from '@/lib/queries';
import { seasonOf } from '@/lib/seasons';

const OUT = 'src/generated';
mkdirSync(OUT, { recursive: true });

const titles = await listTitlesWithDecks();
const stats = await getStats();

const byTitle: Record<string, Awaited<ReturnType<typeof listDecksForTitle>>> = {};
let deckTotal = 0;
for (const t of titles) {
  const decks = await listDecksForTitle(t.id);
  byTitle[t.code] = decks;
  deckTotal += decks.length;
  // Per-season deck counts, so the home page can group titles by season cheaply.
  const seasons: Record<string, number> = {};
  for (const d of decks) {
    const key = seasonOf(d.sortAt)?.key;
    if (key) seasons[key] = (seasons[key] ?? 0) + 1;
  }
  t.seasons = seasons;
}

const generatedAt = new Date().toISOString();
const snapshot = { generatedAt, stats, titles, byTitle };
const json = JSON.stringify(snapshot);
writeFileSync(`${OUT}/data.json`, json);

/**
 * data.json itself is NOT committed — it goes to R2 (see fetch-snapshot.mjs).
 * But Vercel redeploys on a git push, so with nothing committed the site would
 * never pick the new snapshot up. This few-hundred-byte receipt is the commit:
 * it moves whenever the data moves, triggering the deploy, and it costs the repo
 * nothing.
 */
writeFileSync(
  `${OUT}/snapshot.meta.json`,
  JSON.stringify({ generatedAt, ...stats, bytes: Buffer.byteLength(json) }, null, 2) + '\n',
);

const kb = (Buffer.byteLength(json) / 1024).toFixed(0);
console.log(`정적 스냅샷 생성: ${OUT}/data.json  (${kb}KB)`);
console.log(`  타이틀 ${titles.length}종 · 덱 ${deckTotal}개 · 미리보기 ${stats.images}개`);
console.log(`  스냅샷은 R2 로 업로드됩니다 (npm run upload:r2) — git 에는 메타 파일만 커밋됩니다`);

await closeDb();
