/**
 * AI-vision climax reader (Opus 4.8). Fetches a deck's full-res original, cuts it
 * into native-resolution tiles (the whole-deck downscale is what hid the climax
 * cards), and asks the model to identify the climax cards and classify each type.
 * The model matches the CX card ART against the known WS climax kinds — it never
 * has to read the 10px trigger icon.
 *
 * Default = VALIDATION: runs on the given decks and prints AI verdict vs the
 * deck's current DB climaxes (text-derived = ground truth for text-confirmed
 * decks), so accuracy is measurable before any mass run. Cost is printed.
 *
 * ENV: IDS="id,id" · TCOLS(3) TROWS(2) · APPLY=1 to write AI result to 미상 decks
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import sharp from 'sharp';

import { closeDb, db } from '@/db';
import { type Climax, decks, images, posts, titles } from '@/db/schema';
import { loadEnv } from '@/lib/env';

const CACHE = resolve('.data/review/orig');
mkdirSync(CACHE, { recursive: true });
const IDS = (process.env.IDS ?? '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
const TCOLS = Number(process.env.TCOLS ?? 3);
const TROWS = Number(process.env.TROWS ?? 2);
const APPLY = process.env.APPLY === '1';
const MODEL = 'claude-opus-4-8';
const IN = 5 / 1_000_000;
const OUT = 25 / 1_000_000;

const CX_TYPES = ['문', '게이트', '스탠', '초이스', '금괴', '책', '포커스', '2소울', '찬스', '샷', '회오리', '망원경', '보따리'] as const;
const Verdict = z.object({
  is_ws_deck: z.boolean().describe('바이스슈발츠 덱이면 true'),
  climaxes: z.array(z.enum(CX_TYPES)).describe('덱이 쓰는 클라이맥스 종류(보통 1~2종). 대각선 홀로그램 줄무늬 CX 카드로 판단'),
  count_seen: z.number().describe('사진에서 확인한 클라이맥스 카드 장수(정상 덱=8)'),
  confidence: z.number().describe('0~1'),
  notes: z.string().describe('근거를 짧게(예: 어떤 CX 카드가 보였는지)'),
});

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
// JPEG, capped at 1500px long edge — the model resizes >1568px anyway, and PNG
// native tiles blow past the 32MB request cap. 1500px keeps cards ~350px legible.
const overviewJpg = (raw: Buffer) => sharp(raw).resize({ width: 1200 }).jpeg({ quality: 80 }).toBuffer();
const tileJpg = (raw: Buffer, o: { left: number; top: number; width: number; height: number }) =>
  sharp(raw).extract(o).resize({ width: 1500, height: 1500, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
const b64 = (buf: Buffer): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } });

loadEnv();
const anthropic = new Anthropic();

const rows = await db
  .select({ deckId: decks.id, climaxes: decks.climaxes, code: titles.code, nameKo: titles.nameKo, url: posts.urlOriginal, originUrl: images.originUrl })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .innerJoin(images, eq(images.id, decks.imageId))
  .leftJoin(titles, eq(titles.id, decks.titleId))
  .where(inArray(decks.id, IDS));
const byId = new Map(rows.map((r) => [r.deckId, r]));

let costTotal = 0;
let correct = 0;
let judged = 0;
for (const id of IDS) {
  const r = byId.get(id);
  if (!r) {
    console.log(`  [없음] ${id}`);
    continue;
  }
  const raw = await fetchOrig(maxRes(r.originUrl ?? ''));
  if (!raw) {
    console.log(`  ${id.slice(0, 8)} 원본 실패`);
    continue;
  }
  const m = await sharp(raw).metadata();
  const W = m.width ?? 0;
  const H = m.height ?? 0;
  const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: 'OVERVIEW:' }, b64(await overviewJpg(raw))];
  for (let rr = 0; rr < TROWS; rr++)
    for (let cc = 0; cc < TCOLS; cc++) {
      const tile = await tileJpg(raw, { left: Math.floor((cc * W) / TCOLS), top: Math.floor((rr * H) / TROWS), width: Math.floor(W / TCOLS), height: Math.floor(H / TROWS) });
      content.push({ type: 'text', text: `TILE r${rr}c${cc}:` });
      content.push(b64(tile));
    }
  content.push({
    type: 'text',
    text: [
      `바이스슈발츠 대회 덱 사진입니다(작품: ${r.nameKo ?? r.code ?? '?'}).`,
      'OVERVIEW로 클라이맥스 카드 위치를 파악하고, 해당 TILE(네이티브 해상도)에서 그 카드를 확대해 종류를 판정하십시오.',
      '클라이맥스 카드 = 대각선 홀로그램 줄무늬 카드(보통 8장, 1~2종). 각 종류는:',
      '문(扉/return)·게이트(門/gate)·스탠(電源/standby)·초이스(枝택/choice)·금괴(宝/treasure)·책(本/draw)·포커스·2소울(魂)·찬스·샷·회오리·망원경·보따리.',
      '트리거 아이콘이 안 보이면 카드 아트/효과로 판단하고, 확신 없으면 climaxes를 비우고 confidence를 낮추십시오(추측 금지).',
    ].join('\n'),
  });

  const resp = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 3000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: zodOutputFormat(Verdict) },
    messages: [{ role: 'user', content }],
  });
  const v = resp.parsed_output!;
  const u = resp.usage;
  const cost = (u.input_tokens ?? 0) * IN + (u.output_tokens ?? 0) * OUT;
  costTotal += cost;

  const expected = (r.climaxes ?? []).join(',');
  const got = v.climaxes.join(',');
  const isValidation = expected.length > 0;
  const ok = isValidation && new Set(v.climaxes).size === new Set(r.climaxes).size && v.climaxes.every((c) => (r.climaxes ?? []).includes(c));
  if (isValidation) {
    judged++;
    if (ok) correct++;
  }
  console.log(`  ${id.slice(0, 8)} ${(r.code ?? '-').padEnd(5)} ${W}x${H} · AI=[${got}] conf=${v.confidence.toFixed(2)} cnt=${v.count_seen}${isValidation ? ` · 정답=[${expected}] ${ok ? '✓' : '✗'}` : ' (미상)'}  $${cost.toFixed(3)}`);
  if (v.notes) console.log(`         ${v.notes.slice(0, 100)}`);

  if (APPLY && !isValidation && v.is_ws_deck && v.climaxes.length && v.confidence >= 0.6) {
    await db.update(decks).set({ climaxes: v.climaxes as Climax[] }).where(eq(decks.id, id));
    console.log(`         → 반영`);
  }
}
console.log(`\n검증 정확도: ${judged ? `${correct}/${judged} (${((100 * correct) / judged).toFixed(0)}%)` : 'n/a'} · 총비용 $${costTotal.toFixed(2)} · 덱당 평균 $${(costTotal / Math.max(1, IDS.length)).toFixed(3)}`);
await closeDb();
