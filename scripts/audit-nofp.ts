/**
 * Full audit of no-WS-fingerprint published decks against the new gate.
 *
 * MODE=buckets                         → counts per bucket
 * MODE=montage BUCKET=decklog|photo    → labelled contact-sheet (OFFSET/LIMIT/COLS)
 *
 * Buckets: `decklog` (decklog-import decks; the decklog image shows the game),
 * `photo` (physical-photo decks needing eyeball review). Imageless decks all
 * carry a naver/decklog recipe link, so they need no image judgment.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { and, asc, eq } from 'drizzle-orm';
import sharp from 'sharp';

import { closeDb, db } from '@/db';
import { decks, images, posts, titles } from '@/db/schema';
import { hasWsFingerprint } from '@/lib/game';

const MODE = process.env.MODE ?? 'buckets';
const BUCKET = process.env.BUCKET ?? 'decklog';
const OFFSET = Number(process.env.OFFSET ?? 0);
const LIMIT = Number(process.env.LIMIT ?? 12);
const COLS = Number(process.env.COLS ?? 2);

const rows = await db
  .select({
    deckId: decks.id,
    text: posts.rawText,
    url: posts.urlOriginal,
    imgId: images.id,
    originUrl: images.originUrl,
    code: titles.code,
    nameKo: titles.nameKo,
  })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .innerJoin(titles, eq(titles.id, decks.titleId))
  .leftJoin(images, eq(images.id, decks.imageId))
  .where(and(eq(decks.status, 'published'), eq(titles.game, 'WS')))
  .orderBy(asc(titles.code), asc(decks.id));

const nofp = rows.filter((r) => !hasWsFingerprint(r.text ?? ''));
const isDecklog = (u: string) => /decklog/i.test(u);
const decklog = nofp.filter((r) => isDecklog(r.url));
const photo = nofp.filter((r) => r.imgId && !isDecklog(r.url));

if (MODE === 'buckets') {
  console.log(`지문없음 ${nofp.length} · decklog ${decklog.length} · 이미지없음 ${nofp.filter((r) => !r.imgId).length} · 사진 ${photo.length}`);
  await closeDb();
  process.exit(0);
}

const bucket = BUCKET === 'photo' ? photo : decklog;
const batch = bucket.slice(OFFSET, OFFSET + LIMIT);
console.log(`[${BUCKET}] 총 ${bucket.length} · 배치 [${OFFSET}, ${OFFSET + LIMIT})`);

const OUT = resolve('.data/review');
const CACHE = join(OUT, 'orig');
mkdirSync(CACHE, { recursive: true });

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
  table.push(`  #${String(cellNo).padStart(3)}  ${(r.code ?? '-').padEnd(5)} ${(r.nameKo ?? '').slice(0, 14).padEnd(16)} ${r.url}   [${r.deckId}]`);
  const raw = r.originUrl ? await fetchOrig(r.originUrl) : null;
  const banner = Buffer.from(
    `<svg width="${CELL_W}" height="42"><rect width="100%" height="100%" fill="#111"/><text x="10" y="30" font-size="26" fill="#0f0" font-family="monospace">#${cellNo}  ${r.code}</text></svg>`,
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

const montage = await sharp({
  create: { width: COLS * CELL_W, height: Math.ceil(batch.length / COLS) * CELL_H, channels: 3, background: '#000' },
})
  .composite(cells)
  .png()
  .toBuffer();
const mpath = join(OUT, `audit_${BUCKET}_${OFFSET}.png`);
writeFileSync(mpath, montage);
console.log('\n' + table.join('\n'));
console.log(`\n몽타주: ${mpath}`);
await closeDb();
