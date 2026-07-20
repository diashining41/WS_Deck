/**
 * Pure-CV climax matcher (perceptual hash). Given a cropped climax-card image,
 * find which catalog card it is by nearest dHash — the type comes from the
 * matched catalog entry, no icon reading, no AI.
 *
 * This file is the matcher CORE + a self-consistency check: it downloads a
 * title's catalog climax images (build-climax-catalog output), dHashes each, and
 * verifies the hashes separate the cards (a card matches itself at distance 0 and
 * distinct card arts sit far apart). Localising the ~8 CX cards inside a full
 * deck photo is the next step; this proves the identify-by-art core first.
 *
 * ENV: SET(GBF) catalog set · INPUT=<image path> to match one crop · TOP(5)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import sharp from 'sharp';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const SET = process.env.SET ?? 'GBF';
const TOP = Number(process.env.TOP ?? 5);
const INPUT = process.env.INPUT;
const CATALOG = resolve('.data/climax-catalog.json');
const IMGCACHE = resolve('.data/catalog-img');
mkdirSync(IMGCACHE, { recursive: true });

type CxCard = { cardcode: string; set: string; type: string | null; name: string; imagepath: string };

/** dHash: 9×8 grayscale, compare horizontally-adjacent pixels → 64-bit. Robust to
 *  scale/compression; captures the card's coarse art layout. */
async function dhash(buf: Buffer): Promise<bigint> {
  const { data } = await sharp(buf).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  let h = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const l = data[y * 9 + x]!;
      const r = data[y * 9 + x + 1]!;
      if (l < r) h |= 1n << BigInt(y * 8 + x);
    }
  return h;
}
function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let c = 0;
  while (x) {
    c += Number(x & 1n);
    x >>= 1n;
  }
  return c;
}

async function catalogImg(imagepath: string): Promise<Buffer | null> {
  const f = join(IMGCACHE, createHash('md5').update(imagepath).digest('hex') + '.img');
  if (existsSync(f)) return readFileSync(f);
  try {
    const r = await fetch('https://www.encoredecks.com/images/' + imagepath, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    writeFileSync(f, b);
    return b;
  } catch {
    return null;
  }
}

const catalog: Record<string, CxCard[]> = existsSync(CATALOG) ? JSON.parse(readFileSync(CATALOG, 'utf8')) : {};
const cards = (catalog[SET] ?? []).filter((c) => c.type);
if (!cards.length) {
  console.log(`카탈로그에 ${SET} 클라이맥스 없음. 먼저 catalog:build (NAME=…)`);
  process.exit(0);
}

// hash all catalog cards
const hashes: { card: CxCard; h: bigint }[] = [];
for (const c of cards) {
  const img = await catalogImg(c.imagepath);
  if (!img) {
    console.log(`  [img실패] ${c.cardcode}`);
    continue;
  }
  hashes.push({ card: c, h: await dhash(img) });
}
console.log(`${SET} 카탈로그 클라이맥스 ${hashes.length}장 dHash 완료`);

if (INPUT) {
  const inbuf = readFileSync(resolve(INPUT));
  const ih = await dhash(inbuf);
  const ranked = hashes.map((x) => ({ ...x, d: hamming(ih, x.h) })).sort((a, b) => a.d - b.d);
  console.log(`\nINPUT «${INPUT}» 최근접 ${TOP}:`);
  for (const r of ranked.slice(0, TOP)) console.log(`  d=${String(r.d).padStart(2)}  ${r.card.type!.padEnd(5)} ${r.card.cardcode}  «${r.card.name.slice(0, 22)}»`);
  console.log(`\n→ 추정 type: ${ranked[0]!.card.type} (거리 ${ranked[0]!.d})`);
  process.exit(0);
}

// self-consistency: each card's nearest OTHER card, and whether type clusters
console.log('\n자기일관성(각 카드의 최근접 타 카드):');
let sameType = 0;
for (const a of hashes) {
  const others = hashes.filter((b) => b.card.cardcode !== a.card.cardcode).map((b) => ({ b, d: hamming(a.h, b.h) })).sort((x, y) => x.d - y.d);
  const nn = others[0]!;
  const ok = nn.b.card.type === a.card.type;
  if (ok) sameType++;
  console.log(`  ${a.card.cardcode} [${a.card.type}] → ${nn.b.card.cardcode} [${nn.b.card.type}] d=${nn.d} ${ok ? '✓동일type' : '✗'}`);
}
console.log(`\n최근접이 같은 type: ${sameType}/${hashes.length} (아트가 type별로 다르므로 반드시 같을 필요는 없음 — 핵심은 self-match d=0 & 서로 구분)`);
