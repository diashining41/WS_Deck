/**
 * Native-resolution tiling for climax 판독. The whole-deck zoom fits ~50 cards
 * into ≤1600px, so each card's trigger/number is sub-pixel. But 78% of our deck
 * photos are ≥2000px originals — so instead of downscaling the whole spread, we
 * fetch the full-res original and cut it into native-resolution tiles. In a tile
 * (~1/6 of a 4096px photo) each card is ~350px and the card NUMBER, CLIMAX card,
 * and even the ability text become legible — enough to identify the climax card
 * (its type then comes from the card, not from reading a 10px trigger icon).
 *
 * This is the shared front-end for climax restoration: read the tiles in-convo,
 * or feed them to an AI-vision step. Card identity (number/art) survives low res;
 * only the tiny trigger icon does not, and we no longer rely on it.
 *
 * IDS="id,id" ANY status. Writes .data/review/tiles_<i>_<code>_<id8>_overview.png
 * (whole, 1600px, to locate the climax cards) + _rRcC.png native tiles.
 * ENV: IDS · TCOLS(3) TROWS(2) OVW(1600)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';

import { closeDb, db } from '@/db';
import { decks, images, posts, titles } from '@/db/schema';

const OUT = resolve('.data/review');
const CACHE = join(OUT, 'orig');
mkdirSync(CACHE, { recursive: true });

const IDS = (process.env.IDS ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
const TCOLS = Number(process.env.TCOLS ?? 3);
const TROWS = Number(process.env.TROWS ?? 2);
const OVW = Number(process.env.OVW ?? 1600);

if (!IDS.length) {
  console.log('IDS="id,id,…" 를 지정하세요.');
  await closeDb();
  process.exit(0);
}

function maxRes(url: string): string {
  if (/pbs\.twimg\.com/.test(url) && /[?&]name=/.test(url)) return url.replace(/([?&]name=)[^&]+/, '$1orig');
  return url;
}
async function fetchOrig(url: string): Promise<Buffer | null> {
  if (!url) return null;
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

const rows = await db
  .select({ deckId: decks.id, status: decks.status, code: titles.code, url: posts.urlOriginal, originUrl: images.originUrl })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .innerJoin(images, eq(images.id, decks.imageId))
  .leftJoin(titles, eq(titles.id, decks.titleId))
  .where(inArray(decks.id, IDS));
const byId = new Map(rows.map((r) => [r.deckId, r]));

let i = 0;
for (const id of IDS) {
  const r = byId.get(id);
  if (!r) {
    console.log(`  [없음/이미지無] ${id}`);
    continue;
  }
  const raw = await fetchOrig(maxRes(r.originUrl ?? ''));
  const tag = `tiles_${String(i).padStart(2, '0')}_${r.code ?? 'na'}_${id.slice(0, 8)}`;
  if (!raw) {
    console.log(`  #${i} ${r.code} [${r.status}] 원본 다운로드 실패`);
    i++;
    continue;
  }
  const m = await sharp(raw).metadata();
  const W = m.width ?? 0;
  const H = m.height ?? 0;
  writeFileSync(join(OUT, `${tag}_overview.png`), await sharp(raw).resize({ width: OVW }).png().toBuffer());
  for (let rr = 0; rr < TROWS; rr++)
    for (let cc = 0; cc < TCOLS; cc++) {
      const left = Math.floor((cc * W) / TCOLS);
      const top = Math.floor((rr * H) / TROWS);
      const w = Math.floor(W / TCOLS);
      const h = Math.floor(H / TROWS);
      writeFileSync(join(OUT, `${tag}_r${rr}c${cc}.png`), await sharp(raw).extract({ left, top, width: w, height: h }).png().toBuffer());
    }
  console.log(`  #${i} ${(r.code ?? '-').padEnd(5)} [${r.status}] ${W}x${H} → ${tag}_overview.png + ${TCOLS * TROWS} native tiles (~${Math.floor(W / TCOLS)}x${Math.floor(H / TROWS)})`);
  console.log(`        ${r.url}`);
  i++;
}

await closeDb();
