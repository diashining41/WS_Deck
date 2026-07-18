/**
 * Periodic image 판독 (AI-vision review) of held posts — the human/Claude step
 * that releases real WS 50-card recipes and rejects the rest.
 *
 * classifyDecks now HOLDS (needs_review) any post whose text can't confirm a WS
 * 50-card recipe (no WS fingerprint), keeping its resolved title. This builds a
 * labelled contact-sheet of those holds so Claude can eyeball each image and
 * decide. Feed the verdicts to `npm run review:apply`.
 *
 * ONLY full 50-card WS deck spreads / WS decklog screenshots should be published
 * — that is the site's whole purpose. Single cards, certificates, promos, and
 * other-game (Reバース / Vanguard / …) frames get rejected.
 *
 * ENV: OFFSET (default 0), LIMIT (default 12), COLS (default 2).
 * Reads decks.status='needs_review' with an image on a WS title (title kept by
 * the hold), newest first. Writes .data/review/montage_<OFFSET>.png and prints a
 * cell → deckId / code / url table.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import sharp from 'sharp';

import { closeDb, db } from '@/db';
import { decks, images, posts, titles } from '@/db/schema';

const OUT = resolve('.data/review');
const CACHE = join(OUT, 'orig');
mkdirSync(CACHE, { recursive: true });

const OFFSET = Number(process.env.OFFSET ?? 0);
const LIMIT = Number(process.env.LIMIT ?? 12);
const COLS = Number(process.env.COLS ?? 2);

const rows = await db
  .select({
    deckId: decks.id,
    code: titles.code,
    nameKo: titles.nameKo,
    url: posts.urlOriginal,
    originUrl: images.originUrl,
    fetchedAt: posts.fetchedAt,
  })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .innerJoin(titles, eq(titles.id, decks.titleId))
  .innerJoin(images, eq(images.id, decks.imageId))
  .where(and(eq(decks.status, 'needs_review'), eq(titles.game, 'WS'), isNotNull(images.mediumKey)))
  .orderBy(desc(posts.fetchedAt), desc(decks.id));

console.log(`판독 대기(needs_review·이미지·WS타이틀): ${rows.length}건 · 이번 배치 [${OFFSET}, ${OFFSET + LIMIT})`);
const batch = rows.slice(OFFSET, OFFSET + LIMIT);

async function fetchOrig(url: string): Promise<Buffer | null> {
  const f = join(CACHE, createHash('md5').update(url).digest('hex') + '.img');
  if (existsSync(f)) return readFileSync(f);
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    writeFileSync(f, b);
    return b;
  } catch {
    return null;
  }
}

const CELL_W = 760;
const CELL_H = 500;
const cells: sharp.OverlayOptions[] = [];
const table: string[] = [];

for (let i = 0; i < batch.length; i++) {
  const r = batch[i]!;
  const cellNo = OFFSET + i;
  table.push(`  #${String(cellNo).padStart(3)}  ${(r.code ?? '-').padEnd(5)} ${(r.nameKo ?? '').slice(0, 16).padEnd(18)} ${r.url}   [${r.deckId}]`);
  const raw = await fetchOrig(r.originUrl ?? '');
  const banner = Buffer.from(
    `<svg width="${CELL_W}" height="42"><rect width="100%" height="100%" fill="#111"/><text x="10" y="30" font-size="28" fill="#0f0" font-family="monospace">#${cellNo}  ${r.code}</text></svg>`,
  );
  const body = raw
    ? await sharp(raw).resize({ width: CELL_W, height: CELL_H - 42, fit: 'contain', background: '#222' }).png().toBuffer()
    : await sharp({ create: { width: CELL_W, height: CELL_H - 42, channels: 3, background: '#400' } }).png().toBuffer();
  const cell = await sharp({ create: { width: CELL_W, height: CELL_H, channels: 3, background: '#000' } })
    .composite([{ input: banner, top: 0, left: 0 }, { input: body, top: 42, left: 0 }])
    .png()
    .toBuffer();
  cells.push({ input: cell, top: Math.floor(i / COLS) * CELL_H, left: (i % COLS) * CELL_W });
}

if (batch.length) {
  const montage = await sharp({
    create: { width: COLS * CELL_W, height: Math.ceil(batch.length / COLS) * CELL_H, channels: 3, background: '#000' },
  })
    .composite(cells)
    .png()
    .toBuffer();
  const mpath = join(OUT, `montage_${OFFSET}.png`);
  writeFileSync(mpath, montage);
  console.log('\n' + table.join('\n'));
  console.log(`\n몽타주: ${mpath}`);
} else {
  console.log('\n판독 대기 건 없음 (이 오프셋 범위).');
}

await closeDb();
