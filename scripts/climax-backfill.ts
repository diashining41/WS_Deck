/**
 * Daily climax backfill (CI-safe). Auto-selects recently-captured PUBLISHED decks
 * whose climax is still 미상 and that have a usable photo, runs the same tiled
 * Opus-vision read as climax-vision.ts, and writes back ONLY high-confidence
 * verdicts (is_ws_deck && climaxes.length && confidence >= 0.6). Reversible: only
 * decks.climaxes changes.
 *
 * Why this exists: the daily accumulate pipeline fills climaxes from post TEXT
 * only (climaxesFromText), but result tweets rarely state the climax ("優勝は〇〇
 * の推しの子でした!"), so ~65% of captured decks land 미상. The climax lives only
 * in the photo, which needs vision. This is the automated bridge — wired into
 * accumulate.yml so new decks get read every day instead of by a manual batch.
 *
 * CI-SAFE by design — it must never break the pipeline:
 *   - No ANTHROPIC_API_KEY  → exit 0 (no-op). Lets it be wired in BEFORE credits
 *     exist; the day the key + credits are added it starts working, no code change.
 *   - Credit/billing error  → log and stop cleanly (exit 0), decks read so far kept.
 *   - Bounded by LIMIT (per-run deck cap) and MAX_COST (USD hard cap) so a run is
 *     always cheap and always finishes before the export step that follows it.
 *
 * ENV: LIMIT(60) · DAYS(14 — only recent decks, so unreadable ones age out of retry)
 *      · MAX_COST(4.00 USD) · TCOLS(3) TROWS(2) · DRY=1 (read+print, write nothing)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';

import { closeDb, db, rows } from '@/db';
import { type Climax, decks } from '@/db/schema';
import { loadEnv } from '@/lib/env';

loadEnv();

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('ANTHROPIC_API_KEY 미설정 — 클라이맥스 백필 스킵(파이프라인 정상 진행).');
  await closeDb();
  process.exit(0);
}

const LIMIT = Number(process.env.LIMIT ?? 60);
const DAYS = Number(process.env.DAYS ?? 14);
const MAX_COST = Number(process.env.MAX_COST ?? 4);
const TCOLS = Number(process.env.TCOLS ?? 3);
const TROWS = Number(process.env.TROWS ?? 2);
const DRY = process.env.DRY === '1';
const MODEL = 'claude-opus-4-8';
const IN = 5 / 1_000_000;
const OUT = 25 / 1_000_000;

const CACHE = resolve('.data/review/orig');
mkdirSync(CACHE, { recursive: true });

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
const overviewJpg = (raw: Buffer) => sharp(raw).resize({ width: 1200 }).jpeg({ quality: 80 }).toBuffer();
const tileJpg = (raw: Buffer, o: { left: number; top: number; width: number; height: number }) =>
  sharp(raw).extract(o).resize({ width: 1500, height: 1500, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
const b64 = (buf: Buffer): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } });

const anthropic = new Anthropic();

type Cand = { deckId: string; code: string | null; nameKo: string | null; originUrl: string | null };
const cands = rows<Cand>(
  await db.execute(sql`
    SELECT d.id::text AS "deckId", t.code, t.name_ko AS "nameKo", i.origin_url AS "originUrl"
    FROM decks d
    JOIN images i ON i.id = d.image_id
    LEFT JOIN titles t ON t.id = d.title_id
    WHERE d.status = 'published' AND d.climaxes = '{}' AND d.provenance = 'ai'
      AND i.status = 'ok'
      AND d.created_at >= now() - make_interval(days => ${DAYS})
    ORDER BY d.created_at DESC
    LIMIT ${LIMIT}
  `),
);

console.log(`후보 ${cands.length}건 (최근 ${DAYS}일 · published · 미상 · 사진있음 · LIMIT ${LIMIT})${DRY ? ' · DRY' : ''}`);

let costTotal = 0;
let applied = 0;
let read = 0;
let stopped = '';

for (const r of cands) {
  if (costTotal >= MAX_COST) { stopped = `비용상한 $${MAX_COST} 도달`; break; }
  const raw = await fetchOrig(maxRes(r.originUrl ?? ''));
  if (!raw) { console.log(`  ${r.deckId.slice(0, 8)} 원본 실패 — 스킵`); continue; }

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
      '사진이 덱이 아니거나(전시/전단/대진표) 다른 게임이면 is_ws_deck=false. 트리거 아이콘이 안 보이면 카드 아트/효과로 판단하고, 확신 없으면 climaxes를 비우고 confidence를 낮추십시오(추측 금지).',
    ].join('\n'),
  });

  let v: z.infer<typeof Verdict>;
  try {
    const resp = await anthropic.messages.parse({
      model: MODEL,
      max_tokens: 3000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high', format: zodOutputFormat(Verdict) },
      messages: [{ role: 'user', content }],
    });
    v = resp.parsed_output!;
    const u = resp.usage;
    costTotal += (u.input_tokens ?? 0) * IN + (u.output_tokens ?? 0) * OUT;
  } catch (e: any) {
    const msg = String(e?.error?.error?.message ?? e?.message ?? e);
    // Credit/billing exhaustion — stop cleanly so the pipeline keeps going.
    if (e?.status === 400 && /credit balance|billing|quota/i.test(msg)) {
      stopped = `크레딧/청구 오류로 중단: ${msg.slice(0, 80)}`;
      break;
    }
    console.log(`  ${r.deckId.slice(0, 8)} 판독 오류 — 스킵: ${msg.slice(0, 80)}`);
    continue;
  }

  read++;
  const got = v.climaxes.join(',');
  const write = v.is_ws_deck && v.climaxes.length > 0 && v.confidence >= 0.6;
  console.log(`  ${r.deckId.slice(0, 8)} ${(r.code ?? '-').padEnd(5)} AI=[${got}] conf=${v.confidence.toFixed(2)} cnt=${v.count_seen} ${write ? '→ 반영' : '(보류)'} · $${costTotal.toFixed(2)}`);
  if (write && !DRY) {
    // Guard the write on still-미상 so a concurrent human edit is never clobbered.
    await db.update(decks).set({ climaxes: v.climaxes as Climax[] }).where(sql`${decks.id} = ${r.deckId} AND ${decks.climaxes} = '{}'`);
    applied++;
  }
}

console.log(`\n판독 ${read}건 · 반영 ${applied}건 · 총비용 $${costTotal.toFixed(2)}${stopped ? ` · ${stopped}` : ''}`);
if (stopped) console.log('(중단 사유가 있어도 exit 0 — 파이프라인은 계속 진행합니다.)');
await closeDb();
