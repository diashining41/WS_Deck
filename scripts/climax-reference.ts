/**
 * Builds a climax-card reference from OUR OWN confirmed rows — the calibration
 * anchor for the one decisive WS tell: the diagonal-stripe climax card.
 *
 *   WS side  = published WS decks with a STRONG text fingerprint (climax token
 *              like 8門/6宝2門) AND a physical table photo → every one shows the
 *              ~8 blue/pink DIAGONAL-STRIPE climax cards.
 *   非WS side = the confirmed cross-game rejects (hOCG / Shadowverse / Pokémon)
 *              from scripts/purge-sweep-2026-07.ts → none has that card.
 *
 * Nothing is fabricated; both sides are real DB rows. Doubles as few-shot
 * material if the vision path is ever automated.
 *
 * Writes .data/review/ref/{ws,nonws}_*.png (individual hi-res, labelled) and
 * .data/review/climax_reference.png (compact index). Banners are ASCII/romaji
 * only (librsvg on this box has no CJK/emoji font).
 *
 * ENV: WSN(3) WS examples · ZW(1600) long edge · WSIDS="id,id" to pin WS picks.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import sharp from 'sharp';

import { closeDb, db } from '@/db';
import { decks, images, posts, titles } from '@/db/schema';

const OUT = resolve('.data/review');
const REF = join(OUT, 'ref');
const CACHE = join(OUT, 'orig');
mkdirSync(REF, { recursive: true });
mkdirSync(CACHE, { recursive: true });

const WSN = Number(process.env.WSN ?? 3);
const ZW = Number(process.env.ZW ?? 1600);
const WSIDS = (process.env.WSIDS ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

// climax-count shorthand (mirrors WS_DECKLIST in src/lib/game.ts) — a strong,
// text-confirmed WS fingerprint, so these photos are guaranteed real WS.
const CLIMAX = /\d\s*(?:門|扉|電源|宝|チョイス|フォーカス|ゲート|魂)/;

// Confirmed non-WS rejects (scripts/purge-sweep-2026-07.ts). Real DB rows.
const NONWS: { id: string; label: string }[] = [
  { id: '41bf5e98-36fb-4dbf-b96b-0b4769662664', label: 'hOCG AZKi' },
  { id: '4a4c0756-c7e9-4220-b1aa-3fcc5493528b', label: 'hOCG FUWAMOCO' },
  { id: '6fc31993-478d-48c9-9fef-b39cbda99530', label: 'hOCG Calliope-Flare' },
  { id: 'd7580408-8c5b-4f90-9bd6-9391befe258e', label: 'Shadowverse EVOLVE' },
  { id: 'c4f508e2-c1d2-475c-a155-c01f2dcc37a7', label: 'Pokemon TCG' },
];

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

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Full-res labelled PNG: coloured banner + fitted image. */
async function labeled(raw: Buffer, text: string, bg: string): Promise<Buffer> {
  const fitted = await sharp(raw).resize({ width: ZW, height: ZW, fit: 'inside', withoutEnlargement: true }).toBuffer();
  const m = await sharp(fitted).metadata();
  const w = m.width ?? ZW;
  const h = m.height ?? ZW;
  const banner = Buffer.from(
    `<svg width="${w}" height="46"><rect width="100%" height="100%" fill="${bg}"/><text x="12" y="32" font-size="28" fill="#fff" font-family="monospace">${esc(text)}</text></svg>`,
  );
  return sharp({ create: { width: w, height: h + 46, channels: 3, background: '#000' } })
    .composite([{ input: banner, top: 0, left: 0 }, { input: await sharp(fitted).png().toBuffer(), top: 46, left: 0 }])
    .png()
    .toBuffer();
}

type Item = { tag: string; text: string; bg: string; buf: Buffer };
const items: Item[] = [];

/* ------------------------------------------------------------------ WS side */
let wsRows: { deckId: string; code: string | null; url: string | null; originUrl: string | null }[];
if (WSIDS.length) {
  wsRows = await db
    .select({ deckId: decks.id, code: titles.code, url: posts.urlOriginal, originUrl: images.originUrl })
    .from(decks)
    .innerJoin(posts, eq(posts.id, decks.postId))
    .innerJoin(images, eq(images.id, decks.imageId))
    .leftJoin(titles, eq(titles.id, decks.titleId))
    .where(inArray(decks.id, WSIDS));
} else {
  const cand = await db
    .select({ deckId: decks.id, code: titles.code, url: posts.urlOriginal, originUrl: images.originUrl, text: posts.rawText })
    .from(decks)
    .innerJoin(posts, eq(posts.id, decks.postId))
    .innerJoin(titles, eq(titles.id, decks.titleId))
    .innerJoin(images, eq(images.id, decks.imageId))
    .where(and(eq(decks.status, 'published'), eq(titles.game, 'WS'), eq(images.kind, 'user_photo'), isNotNull(images.originUrl)))
    .orderBy(desc(posts.fetchedAt))
    .limit(600);
  wsRows = cand.filter((r) => CLIMAX.test(r.text ?? ''));
}

console.log(`WS 후보 ${wsRows.length}건 중 다운로드 성공분으로 ${WSN}개 채택`);
let picked = 0;
for (const r of wsRows) {
  if (picked >= WSN) break;
  const raw = await fetchOrig(maxRes(r.originUrl ?? ''));
  if (!raw) continue;
  const text = `WS (has diagonal CX stripe) - ${r.code ?? '?'} - ${r.deckId.slice(0, 8)}`;
  const buf = await labeled(raw, text, '#0a5a20');
  const file = join(REF, `ws_${picked}_${r.code ?? 'na'}_${r.deckId.slice(0, 8)}.png`);
  writeFileSync(file, buf);
  items.push({ tag: `WS ${r.code}`, text, bg: '#0a5a20', buf });
  console.log(`  [WS] ${file}  ${r.url}`);
  picked++;
}
if (picked < WSN) console.log(`  ⚠ WS 예시 ${picked}/${WSN}만 확보 (원본 다운로드 실패분 존재).`);

/* --------------------------------------------------------------- 非WS side */
const nonRows = await db
  .select({ deckId: decks.id, status: decks.status, url: posts.urlOriginal, originUrl: images.originUrl })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .innerJoin(images, eq(images.id, decks.imageId))
  .where(inArray(decks.id, NONWS.map((n) => n.id)));
const nonById = new Map(nonRows.map((r) => [r.deckId, r]));

for (const n of NONWS) {
  const r = nonById.get(n.id);
  if (!r) {
    console.log(`  [非WS 없음] ${n.label} ${n.id}`);
    continue;
  }
  const raw = await fetchOrig(maxRes(r.originUrl ?? ''));
  if (!raw) {
    console.log(`  [非WS 원본실패] ${n.label} ${r.url}`);
    continue;
  }
  const text = `NON-WS (no CX): ${n.label} - ${n.id.slice(0, 8)}`;
  const buf = await labeled(raw, text, '#7a0d0d');
  const file = join(REF, `nonws_${n.label.replace(/[^A-Za-z0-9]+/g, '')}_${n.id.slice(0, 8)}.png`);
  writeFileSync(file, buf);
  items.push({ tag: `非WS ${n.label}`, text, bg: '#7a0d0d', buf });
  console.log(`  [非WS] ${file}  ${r.url}`);
}

/* ---------------------------------------------------------- compact index */
if (items.length) {
  const COLS = 2;
  const CW = 640;
  const CH = 460;
  const cells: sharp.OverlayOptions[] = [];
  for (let i = 0; i < items.length; i++) {
    const body = await sharp(items[i]!.buf).resize({ width: CW, height: CH, fit: 'contain', background: '#111' }).png().toBuffer();
    cells.push({ input: body, top: Math.floor(i / COLS) * CH, left: (i % COLS) * CW });
  }
  const index = await sharp({
    create: { width: COLS * CW, height: Math.ceil(items.length / COLS) * CH, channels: 3, background: '#000' },
  })
    .composite(cells)
    .png()
    .toBuffer();
  const ipath = join(OUT, 'climax_reference.png');
  writeFileSync(ipath, index);
  console.log(`\n인덱스: ${ipath} (${items.length}컷) · 개별 고해상도: ${REF}/`);
} else {
  console.log('\n생성된 컷 없음.');
}

await closeDb();
