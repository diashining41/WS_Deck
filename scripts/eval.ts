/**
 * Scores the AI extractor against the spreadsheet.
 *
 * Every one of the 485 imported decks was read and labelled by a human, and
 * every one of them is a tournament deck. That makes the sheet a free, honest
 * eval set — the only reason we can set a confidence threshold from evidence
 * instead of from vibes.
 *
 * What it measures:
 *   is_tournament  — must be ~100%. Every post here IS a tournament post, so a
 *                    false negative is a bug in the model or the prompt.
 *   작품            — the field that must not be wrong. Target 95%+.
 *   클라이맥스       — exact set match. Split by whether the post text stated it,
 *                    because those two populations are entirely different
 *                    problems: one is a lookup, the other is reading a trigger
 *                    icon off a glare-y table photo.
 *   규모/형식        — cheap, mostly from keywords.
 *
 * Run:  ANTHROPIC_API_KEY=… npx tsx scripts/eval.ts [N]
 */
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';

import { closeDb, db } from '@/db';
import { climaxAliases, decks, images, posts, titleAliases, titles, type Climax } from '@/db/schema';
import { CREDENTIALS_HELP, extractPost, isAuthError } from '@/lib/ai/extract';
import type { TitleRow } from '@/lib/ai/prompt';
import { AliasMatcher } from '@/lib/match';

const LIMIT = Number(process.argv[2] ?? 20);

const titleRows = await db.select({ id: titles.id, code: titles.code, nameKo: titles.nameKo }).from(titles);
const aliasRows = await db.select({ titleId: titleAliases.titleId, alias: titleAliases.alias }).from(titleAliases);
const cxRows = await db.select({ climax: climaxAliases.climax, alias: climaxAliases.alias }).from(climaxAliases);

const aliasesByTitle = new Map<number, string[]>();
for (const a of aliasRows) aliasesByTitle.set(a.titleId, [...(aliasesByTitle.get(a.titleId) ?? []), a.alias]);

const titleMaster: TitleRow[] = titleRows.map((t) => ({
  code: t.code,
  nameKo: t.nameKo,
  aliases: (aliasesByTitle.get(t.id) ?? []).filter((a) => a !== t.nameKo).slice(0, 6),
}));
const codeById = new Map(titleRows.map((t) => [t.id, t.code]));
const climaxMatcher = new AliasMatcher(cxRows.map((r) => ({ key: r.climax, alias: r.alias })));

/** Only posts we actually have images for, and only single-deck posts: the sheet
 *  never recorded which photo held which deck, so a trio post has no ground
 *  truth for the binding and would score the model on our guess, not on itself. */
const singles = db.$with('singles').as(
  db.select({ postId: decks.postId }).from(decks).groupBy(decks.postId).having(sql`count(*) = 1`),
);

const sample = await db
  .with(singles)
  .select({
    postId: posts.id,
    text: posts.rawText,
    source: posts.source,
    author: posts.authorHandle,
    postedAt: posts.postedAt,
    titleId: decks.titleId,
    climaxes: decks.climaxes,
    scale: decks.scale,
    format: decks.format,
    top4: decks.top4,
    imageKey: images.mediumKey,
  })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .innerJoin(singles, eq(singles.postId, decks.postId))
  .innerJoin(images, eq(images.id, decks.imageId))
  .where(and(ne(posts.rawText, ''), isNotNull(images.mediumKey)))
  .limit(LIMIT);

console.log(`정답셋 ${sample.length}건으로 평가 (모델: claude-opus-4-8)\n`);

const SCALE = { SHOP: '소', CS: '중', BUSHIROAD: '대' } as const;
const FORMAT = { SINGLES: '개인', TRIO: '트리오' } as const;

const eq_ = (a: Climax[], b: Climax[]) =>
  a.length === b.length && [...a].sort().join('/') === [...b].sort().join('/');

let n = 0;
let tourn = 0;
let titleOk = 0;
let cxOk = 0;
let scaleOk = 0;
let formatOk = 0;
let cost = 0;
let cacheReadTotal = 0;

// The two climax populations are different problems — never average them.
let cxTextTotal = 0;
let cxTextOk = 0;
let cxImgTotal = 0;
let cxImgOk = 0;

const failures: string[] = [];

for (const row of sample) {
  if (!row.imageKey) continue;
  const truthCode = row.titleId ? codeById.get(row.titleId) : null;
  const truthCx = (row.climaxes ?? []) as Climax[];
  const climaxInText = truthCx.length > 0 && truthCx.every((c) => climaxMatcher.has(row.text, c));

  try {
    const { result, usage } = await extractPost(
      {
        text: row.text,
        source: row.source,
        authorHandle: row.author,
        postedAt: row.postedAt,
        imageKeys: [row.imageKey],
      },
      titleMaster,
    );

    n++;
    cost += usage.costUsd;
    cacheReadTotal += usage.cacheRead;

    const deck = result.decks[0];
    const gotTitle = deck?.title_code ?? null;
    const gotCx = (deck?.climaxes ?? []) as Climax[];

    if (result.is_tournament) tourn++;
    const tOk = gotTitle === truthCode;
    const cOk = eq_(gotCx, truthCx);
    if (tOk) titleOk++;
    if (cOk) cxOk++;
    if (result.scale === SCALE[row.scale]) scaleOk++;
    if (result.format === FORMAT[row.format]) formatOk++;

    if (climaxInText) {
      cxTextTotal++;
      if (cOk) cxTextOk++;
    } else {
      cxImgTotal++;
      if (cOk) cxImgOk++;
    }

    const mark = (ok: boolean) => (ok ? '✅' : '❌');
    console.log(
      `${String(n).padStart(3)} ${mark(result.is_tournament)}대회 ${mark(tOk)}작품 ${mark(cOk)}CX  ` +
        `[${truthCode} ${truthCx.join('/')}] → [${gotTitle ?? '?'} ${gotCx.join('/') || '?'}]  ` +
        `${climaxInText ? '본문' : '사진'} · conf ${deck?.self_confidence.climax.toFixed(2) ?? '-'}`,
    );

    if (!tOk || !cOk) {
      failures.push(
        `  정답 [${truthCode} ${truthCx.join('/')}] · 추출 [${gotTitle ?? '?'} ${gotCx.join('/') || '?'}]\n` +
          `    근거: ${deck?.title_evidence ?? '-'} / ${deck?.climax_evidence ?? '-'}\n` +
          `    본문: ${row.text.replace(/\n/g, ' ').slice(0, 70)}`,
      );
    }
  } catch (err) {
    // Bail on the real problem instead of repeating it N times.
    if (isAuthError(err)) {
      console.log(`\n${CREDENTIALS_HELP}`);
      await closeDb();
      process.exit(1);
    }
    console.log(`  ✗ ${err instanceof Error ? err.message : String(err)}`);
  }
}

const pct = (a: number, b: number) => (b === 0 ? ' n/a' : `${((a / b) * 100).toFixed(0).padStart(3)}%`);

console.log(`\n${'='.repeat(58)}`);
console.log(`평가 ${n}건 · 비용 $${cost.toFixed(3)} (건당 $${(cost / Math.max(n, 1)).toFixed(4)})\n`);
console.log(`  대회 판정      ${pct(tourn, n)}  ← 전부 대회 글이므로 100%가 나와야 정상`);
console.log(`  작품           ${pct(titleOk, n)}  (목표 95%+)`);
console.log(`  클라이맥스     ${pct(cxOk, n)}`);
console.log(`    ├ 본문 명시  ${pct(cxTextOk, cxTextTotal)}  (${cxTextTotal}건) ← 별칭표 문제`);
console.log(`    └ 사진 판독  ${pct(cxImgOk, cxImgTotal)}  (${cxImgTotal}건) ← 검수 대상 결정`);
console.log(`  대회 규모      ${pct(scaleOk, n)}`);
console.log(`  대회 형식      ${pct(formatOk, n)}`);

// Caching fails silently under 4096 tokens on Opus — a zero here means we are
// paying full price on every call and nothing would otherwise tell us.
console.log(
  `\n  프롬프트 캐시  ${cacheReadTotal > 0 ? `✅ 동작 (누적 ${cacheReadTotal.toLocaleString()} 토큰 읽음)` : '❌ 미동작 — 시스템 프리픽스가 4096 토큰 미만인지 확인'}`,
);

if (failures.length) {
  console.log(`\n오답 ${failures.length}건:\n`);
  console.log(failures.slice(0, 10).join('\n\n'));
}

process.exit(0);
