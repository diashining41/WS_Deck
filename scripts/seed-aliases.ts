/**
 * Seeds the alias tables, then measures how far they actually get us.
 *
 * The coverage number this prints is the ceiling on text-only extraction: the
 * share of decks whose 작품 and 클라이맥스 can be read straight out of the post,
 * with no vision call and no guessing. Everything it misses has to be read off a
 * photo of cards on a table, which is where the errors live — so this number,
 * not the choice of model, is what decides how much human review the pipeline
 * will cost.
 */
import { eq, ne } from 'drizzle-orm';

import { db } from '@/db';
import { climaxAliases, decks, posts, titleAliases, titles, type Climax } from '@/db/schema';
import { CLIMAX_ALIASES, TITLE_ALIASES, TITLE_ALIASES_KO } from '@/lib/aliases';
import { AliasMatcher, codeIsUsableAsAlias } from '@/lib/match';

const isKo = (s: string) => /[가-힣]/.test(s);

await db.delete(climaxAliases);
await db.delete(titleAliases);

for (const [climax, aliases] of Object.entries(CLIMAX_ALIASES)) {
  for (const alias of aliases) {
    await db
      .insert(climaxAliases)
      .values({ climax: climax as Climax, alias, lang: isKo(alias) ? 'ko' : 'ja' })
      .onConflictDoNothing();
  }
}

const allTitles = await db.select({ id: titles.id, code: titles.code, nameKo: titles.nameKo }).from(titles);
const byCode = new Map(allTitles.map((t) => [t.code, t]));

let aliasCount = 0;
const add = async (titleId: number, alias: string) => {
  const res = await db
    .insert(titleAliases)
    .values({ titleId, alias, lang: isKo(alias) ? 'ko' : 'ja' })
    .onConflictDoNothing()
    .returning({ id: titleAliases.id });
  if (res.length) aliasCount++;
};

for (const t of allTitles) {
  await add(t.id, t.nameKo);
  // Korean posts list results by master code ("全勝 - GBF, BRD, GIM").
  if (codeIsUsableAsAlias(t.code)) await add(t.id, t.code);
}
for (const [code, aliases] of Object.entries({ ...TITLE_ALIASES })) {
  const t = byCode.get(code);
  if (!t) {
    console.log(`  ⚠ 마스터에 없는 코드: ${code}`);
    continue;
  }
  for (const alias of aliases) await add(t.id, alias);
}
for (const [code, aliases] of Object.entries(TITLE_ALIASES_KO)) {
  const t = byCode.get(code);
  if (!t) continue;
  for (const alias of aliases) await add(t.id, alias);
}

console.log(`\n클라이맥스 별칭 ${Object.values(CLIMAX_ALIASES).flat().length}개`);
console.log(`작품 별칭 ${aliasCount}개\n`);

/* ---------------------------------------------------------------- coverage */

const titleMatcher = new AliasMatcher(
  (await db.select({ titleId: titleAliases.titleId, alias: titleAliases.alias }).from(titleAliases)).map((r) => ({
    key: r.titleId,
    alias: r.alias,
  })),
);
const climaxMatcher = new AliasMatcher(
  (await db.select({ climax: climaxAliases.climax, alias: climaxAliases.alias }).from(climaxAliases)).map((r) => ({
    key: r.climax,
    alias: r.alias,
  })),
);

const sample = await db
  .select({ titleId: decks.titleId, climaxes: decks.climaxes, text: posts.rawText })
  .from(decks)
  .innerJoin(posts, eq(posts.id, decks.postId))
  .where(ne(posts.rawText, ''));

let titleHit = 0;
let climaxHit = 0;
let bothHit = 0;
const missed = new Map<number, number>();

for (const d of sample) {
  const titleFound = d.titleId !== null && titleMatcher.has(d.text, d.titleId);

  // Count the climax as readable only when EVERY climax on the deck is written
  // in the post — a partial read still needs a human.
  const wanted = d.climaxes ?? [];
  const climaxFound = wanted.length > 0 && wanted.every((c) => climaxMatcher.has(d.text, c));

  if (titleFound) titleHit++;
  else if (d.titleId) missed.set(d.titleId, (missed.get(d.titleId) ?? 0) + 1);
  if (climaxFound) climaxHit++;
  if (titleFound && climaxFound) bothHit++;
}

const pct = (n: number) => `${((n / sample.length) * 100).toFixed(0)}%`;

console.log(`본문만으로 판독 가능한 비율 (덱 ${sample.length}개)\n`);
console.log(`  작품             ${String(titleHit).padStart(3)} / ${sample.length}  ${pct(titleHit)}`);
console.log(`  클라이맥스 (전체) ${String(climaxHit).padStart(3)} / ${sample.length}  ${pct(climaxHit)}`);
console.log(`  둘 다            ${String(bothHit).padStart(3)} / ${sample.length}  ${pct(bothHit)}  ← vision 없이 처리 가능`);
console.log(`  사진 판독 필요    ${String(sample.length - bothHit).padStart(3)} / ${sample.length}  ${pct(sample.length - bothHit)}`);

const nameById = new Map(allTitles.map((t) => [t.id, t.nameKo]));
const worst = [...missed].sort((a, b) => b[1] - a[1]).slice(0, 10);
if (worst.length) {
  console.log(`\n본문에 작품명이 없는 덱 상위 (대부분 "우승 사진만" 게시물):`);
  for (const [id, n] of worst) console.log(`  ${String(n).padStart(3)}건  ${nameById.get(id) ?? id}`);
}

process.exit(0);
