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
 * other-game (Reバース / Vanguard / Shadowverse / hOCG / …) frames get rejected.
 *
 * The decisive WS tell — count it, don't vibe it: a real WS 50-card spread shows
 * ~8 blue/pink DIAGONAL-STRIPE climax cards; hOCG / Shadowverse / Pokémon / Reバ
 * ース have NONE. `scripts/climax-reference.ts` builds a side-by-side reference.
 * That stripe is invisible at contact-sheet scale, so the montage is only for
 * TRIAGE — zoom every suspect to full-res (IDS mode) before calling it.
 *
 * TWO MODES
 *   (montage, default)  OFFSET LIMIT COLS CW CH
 *       Labelled contact-sheet of the needs_review queue (WS title, has image),
 *       newest first. For deciding which cells to zoom, not for final calls.
 *   (zoom)  IDS="id,id,…"   [ZW]
 *       One hi-res PNG per deck (ANY status), long edge capped at ZW so the CX
 *       stripe is legible and nothing is wasted past the vision viewer's limit.
 *       Use this on the suspects the montage surfaced — this is the real call.
 *
 * ENV: OFFSET(0) LIMIT(12) COLS(2) CW(900) CH(620) | IDS ZW(1600)
 * Writes .data/review/montage_<OFFSET>.png (triage) or .data/review/zoom_*.png.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import sharp from 'sharp';

import { closeDb, db } from '@/db';
import { decks, images, posts, titles } from '@/db/schema';

const OUT = resolve('.data/review');
const CACHE = join(OUT, 'orig');
mkdirSync(CACHE, { recursive: true });

/** Force pbs.twimg.com URLs to the full original (name=orig ≈ 2048–4096px). Our
 *  rows already store name=orig, but normalise any that don't so a zoom is never
 *  silently served a downscaled variant. Non-twimg hosts (decklog) are full-res. */
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

/* -------------------------------------------------------------- zoom mode */
// IDS="uuid,uuid,…" → one legible full-res PNG per deck, whatever its status.
const IDS = (process.env.IDS ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
if (IDS.length) {
  const ZW = Number(process.env.ZW ?? 1600);
  const zrows = await db
    .select({
      deckId: decks.id,
      status: decks.status,
      code: titles.code,
      nameKo: titles.nameKo,
      url: posts.urlOriginal,
      originUrl: images.originUrl,
    })
    .from(decks)
    .innerJoin(posts, eq(posts.id, decks.postId))
    .innerJoin(images, eq(images.id, decks.imageId))
    .leftJoin(titles, eq(titles.id, decks.titleId))
    .where(inArray(decks.id, IDS));
  const byId = new Map(zrows.map((r) => [r.deckId, r]));

  console.log(`줌 판독: 요청 ${IDS.length}건 · 이미지 있는 덱 ${zrows.length}건 · 장변 ${ZW}px`);
  let i = 0;
  for (const id of IDS) {
    const r = byId.get(id);
    if (!r) {
      console.log(`  [없음/이미지無] ${id}`);
      continue;
    }
    const raw = await fetchOrig(maxRes(r.originUrl ?? ''));
    const out = join(OUT, `zoom_${String(i).padStart(2, '0')}_${r.code ?? 'na'}_${id.slice(0, 8)}.png`);
    if (raw) {
      const fitted = await sharp(raw)
        .resize({ width: ZW, height: ZW, fit: 'inside', withoutEnlargement: true })
        .toBuffer();
      const meta = await sharp(fitted).metadata();
      const w = meta.width ?? ZW;
      const h = meta.height ?? ZW;
      const banner = Buffer.from(
        `<svg width="${w}" height="40"><rect width="100%" height="100%" fill="#111"/><text x="10" y="29" font-size="26" fill="#0f0" font-family="monospace">${r.code ?? '-'} · ${r.status} · ${id.slice(0, 8)}</text></svg>`,
      );
      const composed = await sharp({ create: { width: w, height: h + 40, channels: 3, background: '#000' } })
        .composite([{ input: banner, top: 0, left: 0 }, { input: await sharp(fitted).png().toBuffer(), top: 40, left: 0 }])
        .png()
        .toBuffer();
      writeFileSync(out, composed);
    }
    console.log(`  #${String(i).padStart(2)} ${(r.code ?? '-').padEnd(5)} [${r.status}] ${r.url}${raw ? '' : '  (원본 다운로드 실패)'}\n        -> ${out}`);
    i++;
  }
  await closeDb();
  process.exit(0);
}

/* ---------------------------------------------------------- montage (triage) */
const OFFSET = Number(process.env.OFFSET ?? 0);
const LIMIT = Number(process.env.LIMIT ?? 12);
const COLS = Number(process.env.COLS ?? 2);
const CELL_W = Number(process.env.CW ?? 900);
const CELL_H = Number(process.env.CH ?? 620);

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
console.log('※ 몽타주는 TRIAGE 전용. 의심 셀은 IDS="…"로 개별 확대해 대각선 CX를 세어 확정할 것.');
const batch = rows.slice(OFFSET, OFFSET + LIMIT);

const cells: sharp.OverlayOptions[] = [];
const table: string[] = [];

for (let i = 0; i < batch.length; i++) {
  const r = batch[i]!;
  const cellNo = OFFSET + i;
  table.push(`  #${String(cellNo).padStart(3)}  ${(r.code ?? '-').padEnd(5)} ${(r.nameKo ?? '').slice(0, 16).padEnd(18)} ${r.url}   [${r.deckId}]`);
  const raw = await fetchOrig(maxRes(r.originUrl ?? ''));
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
