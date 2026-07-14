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
}

const snapshot = { generatedAt: new Date().toISOString(), stats, titles, byTitle };
writeFileSync(`${OUT}/data.json`, JSON.stringify(snapshot));

const kb = (Buffer.byteLength(JSON.stringify(snapshot)) / 1024).toFixed(0);
console.log(`정적 스냅샷 생성: ${OUT}/data.json  (${kb}KB)`);
console.log(`  타이틀 ${titles.length}종 · 덱 ${deckTotal}개 · 미리보기 ${stats.images}개`);
console.log(`  이 스냅샷 + public/media/{thumb,medium} 만으로 공개 사이트가 배포됩니다`);

await closeDb();
