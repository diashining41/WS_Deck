/**
 * Vision-sweep the shared-IP WS titles (hololive / love live / 五等分 / ゴジラ /
 * マクロス / ディズニー / チェンソー) for cross-game leaks (hololive OCG, Reバース
 * for you, Vanguard, Lorcana …) that TEXT gates can't see. Scoped to published
 * decks with NO WS text fingerprint — the text-unverifiable set where every
 * observed leak lives; text-confirmed WS decklogs are skipped as redundant.
 *
 *   MODE=count                       → per-title counts of the sweep queue
 *   MODE=montage ALL=1 [COLS=4]      → build every contact sheet
 *   MODE=montage OFFSET=0 LIMIT=24   → one sheet
 *
 * Deterministic order (title code, deck id) so audit-shared-apply.ts can reject
 * by cell index without copying UUIDs.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { closeDb, db } from '@/db';
import { decks, images, posts, titles } from '@/db/schema';
import { hasWsFingerprint } from '@/lib/game';

export const SHARED_CODES = ['LHS', 'HOL', '5HY', 'CSM', 'LNJ', 'MRD', 'MDE', 'LSS', 'LSP', 'LSF', 'LL', 'DDS', 'GZL'];

const MODE = process.env.MODE ?? 'count';
const OFFSET = Number(process.env.OFFSET ?? 0);
const LIMIT = Number(process.env.LIMIT ?? 24);
const COLS = Number(process.env.COLS ?? 4);
const ALL = process.env.ALL === '1';

const raw = await db
  .select({
    deckId: decks.id, text: posts.rawText, url: posts.urlOriginal,
    mediumKey: images.mediumKey, originUrl: images.originUrl, code: titles.code,
  })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .innerJoin(titles, eq(titles.id, decks.titleId))
  .leftJoin(images, eq(images.id, decks.imageId))
  .where(and(eq(decks.status, 'published'), inArray(titles.code, SHARED_CODES)))
  .orderBy(asc(titles.code), asc(decks.id));

// text-unverifiable = the sweep queue
export const queue = raw.filter((r) => !hasWsFingerprint(r.text ?? ''));

if (MODE === 'count') {
  const per: Record<string, { total: number; q: number; img: number }> = {};
  for (const r of raw) {
    per[r.code!] ??= { total: 0, q: 0, img: 0 };
    per[r.code!]!.total++;
  }
  for (const r of queue) { per[r.code!]!.q++; if (r.mediumKey || r.originUrl) per[r.code!]!.img++; }
  console.log(`공유-IP 게시덱 ${raw.length} · 판독큐(지문없음) ${queue.length}`);
  for (const c of SHARED_CODES) if (per[c]) console.log(`  ${c.padEnd(5)} 전체 ${String(per[c]!.total).padStart(4)} · 큐 ${String(per[c]!.q).padStart(4)} · 이미지 ${per[c]!.img}`);
  const noimg = queue.filter((r) => !r.mediumKey && !r.originUrl).length;
  console.log(`판독큐 중 이미지 없음(판독불가): ${noimg}`);
  await closeDb();
  process.exit(0);
}

const OUT = resolve('.data/review');
const CACHE = join(OUT, 'orig');
mkdirSync(CACHE, { recursive: true });
const CW = 520, CH = 400;

async function grab(r: (typeof queue)[number]): Promise<Buffer | null> {
  const local = r.mediumKey ? join('public', r.mediumKey.replace(/^\//, '')) : null;
  if (local && existsSync(local)) return readFileSync(local);
  if (!r.originUrl) return null;
  const f = join(CACHE, createHash('md5').update(r.originUrl).digest('hex') + '.img');
  if (existsSync(f)) return readFileSync(f);
  try {
    const res = await fetch(r.originUrl);
    if (!res.ok) return null;
    const b = Buffer.from(await res.arrayBuffer());
    writeFileSync(f, b);
    return b;
  } catch { return null; }
}

async function sheet(offset: number): Promise<void> {
  const batch = queue.slice(offset, offset + LIMIT);
  if (!batch.length) return;
  const cells: sharp.OverlayOptions[] = [];
  for (let i = 0; i < batch.length; i++) {
    const r = batch[i]!;
    const no = offset + i;
    const rawImg = await grab(r);
    const banner = Buffer.from(
      `<svg width="${CW}" height="30"><rect width="100%" height="100%" fill="#111"/><text x="6" y="22" font-size="18" fill="#0f0" font-family="monospace">#${no} ${r.code}</text></svg>`,
    );
    const body = rawImg
      ? await sharp(rawImg).resize({ width: CW, height: CH - 30, fit: 'contain', background: '#222' }).png().toBuffer()
      : await sharp({ create: { width: CW, height: CH - 30, channels: 3, background: '#500' } }).png().toBuffer();
    const cell = await sharp({ create: { width: CW, height: CH, channels: 3, background: '#000' } })
      .composite([{ input: banner, top: 0, left: 0 }, { input: body, top: 30, left: 0 }]).png().toBuffer();
    cells.push({ input: cell, top: Math.floor(i / COLS) * CH, left: (i % COLS) * CW });
  }
  const montage = await sharp({
    create: { width: COLS * CW, height: Math.ceil(batch.length / COLS) * CH, channels: 3, background: '#000' },
  }).composite(cells).png().toBuffer();
  writeFileSync(join(OUT, `shared_${String(offset).padStart(4, '0')}.png`), montage);
}

if (ALL) {
  for (let off = 0; off < queue.length; off += LIMIT) { await sheet(off); if (off % 120 === 0) console.log(`  … ${off}/${queue.length}`); }
  console.log(`전체 ${Math.ceil(queue.length / LIMIT)}시트 → ${OUT}/shared_<offset>.png`);
} else {
  await sheet(OFFSET);
  console.log(`시트 → ${OUT}/shared_${String(OFFSET).padStart(4, '0')}.png`);
  for (let i = 0; i < Math.min(LIMIT, queue.length - OFFSET); i++) {
    const r = queue[OFFSET + i]!;
    console.log(`  #${OFFSET + i}  ${r.code}  ${r.url}  [${r.deckId}]`);
  }
}
await closeDb();
