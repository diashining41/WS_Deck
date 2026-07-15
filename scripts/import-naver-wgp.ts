/**
 * Imports the WGP / BCF deck-list boards from the Naver cafe.
 *
 * These two boards are unique in the whole corpus: the subject carries the deck
 * in brackets — "[4금괴 4초이스 소아온]" — so 작품 AND climax come from the public
 * list API with no cookie. The body (also public on most of these) often carries
 * a DECK LOG code, which yields a crisp machine-rendered image — the clean source
 * that X posts never had. And they are Bushiroad-run official events (WGP/BCF),
 * a scale that is entirely absent from the archive today.
 *
 * Dry run by default (counts only, writes nothing). Pass --commit to insert.
 */
import { and, eq, sql } from 'drizzle-orm';

import { closeDb, db } from '@/db';
import { climaxAliases, decks, images, posts, titleAliases, type Climax } from '@/db/schema';
import { gameFromText } from '@/lib/game';
import { AliasMatcher } from '@/lib/match';
import { download, storeImage } from '@/lib/media';
import { fetchArticle, NaverAuthRequired } from '@/lib/naver';
import { decklogImageUrl } from '@/lib/x';

const COMMIT = process.argv.includes('--commit');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';
const CAFE = '18579885';
const BOARDS = [
  { id: 250, name: 'WGP' },
  { id: 256, name: 'BCF' },
];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const titleMatcher = new AliasMatcher(
  (await db.select({ titleId: titleAliases.titleId, alias: titleAliases.alias }).from(titleAliases)).map((r) => ({
    key: r.titleId,
    alias: r.alias,
  })),
);
const climaxMatcher = new AliasMatcher(
  (await db.select({ climax: climaxAliases.climax, alias: climaxAliases.alias }).from(climaxAliases)).map((r) => ({
    key: r.climax as Climax,
    alias: r.alias,
  })),
);

interface Listed {
  articleId: string;
  subject: string;
  nick: string;
  date: Date;
}

async function listAll(menuId: number): Promise<Listed[]> {
  const out: Listed[] = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `https://apis.naver.com/cafe-web/cafe2/ArticleListV2dot1.json?search.clubid=${CAFE}&search.menuid=${menuId}&search.queryType=lastArticle&search.page=${page}&search.perPage=50`,
      { headers: { 'User-Agent': UA, Referer: 'https://cafe.naver.com/wstcg' } },
    );
    const j = (await res.json()) as {
      message?: { result?: { articleList?: { articleId: number; subject: string; writerNickname?: string; writeDateTimestamp: number }[] } };
    };
    const list = j.message?.result?.articleList ?? [];
    if (!list.length) break;
    for (const a of list) {
      out.push({ articleId: String(a.articleId), subject: a.subject, nick: a.writerNickname ?? '', date: new Date(a.writeDateTimestamp) });
    }
    if (list.length < 50) break;
    await sleep(300);
  }
  return out;
}

let matched = 0;
let skipped = 0;
let withImage = 0;
let withDecklog = 0;
let gated = 0;
let inserted = 0;
const unmatched: string[] = [];

for (const board of BOARDS) {
  const arts = await listAll(board.id);
  console.log(`\n■ ${board.name} 덱 레시피 — 글 ${arts.length}개`);

  for (const a of arts) {
    // Bushiroad also runs Love Live OCG events; keep any non-WS game off WS pages.
    if (gameFromText(a.subject) !== 'WS') {
      skipped++;
      continue;
    }
    const m = a.subject.match(/\[([^\]]+)\]/);
    if (!m?.[1]) {
      skipped++;
      continue;
    }
    const bracket = m[1].trim();
    // Cafe titles space out the work ("소드 아트 온라인") but the master stores it
    // solid ("소드아트온라인"), so a CJK substring match misses. Try both.
    const solid = bracket.replace(/\s/g, '');
    const titleHit = titleMatcher.findAll(bracket)[0] ?? titleMatcher.findAll(solid)[0];
    if (!titleHit) {
      skipped++;
      unmatched.push(bracket);
      continue; // 작품 미상 — 별칭 보강 대상 (별도 처리)
    }
    matched++;
    const climaxes = [
      ...new Set([...climaxMatcher.findAll(bracket), ...climaxMatcher.findAll(solid)].map((x) => x.key as Climax)),
    ];

    // Placement from the subject: 1~4등 / 우승·준우승 → top4. "16강/8강 진출" is not.
    const top4 = /우승|준우승|[1-4]\s*등/.test(a.subject) || null;
    const format = /팀전|트리오|team/i.test(a.subject) ? ('TRIO' as const) : ('SINGLES' as const);

    // Body: decklog code (crisp render) beats the cafe photo. Login-gated bodies
    // still give us a full deck from the subject — just no image.
    let mediaUrl: string | null = null;
    let kind: 'decklog_render' | 'user_photo' = 'user_photo';
    let nick = a.nick;
    try {
      const art = await fetchArticle(a.articleId);
      if (art) {
        nick = art.authorHandle || nick;
        if (art.decklogCodes[0]) {
          mediaUrl = decklogImageUrl(art.decklogCodes[0]);
          kind = 'decklog_render';
          withDecklog++;
        } else if (art.media[0]) {
          mediaUrl = art.media[0].url;
          kind = 'user_photo';
        }
        if (mediaUrl) withImage++;
      }
      await sleep(350);
    } catch (err) {
      if (err instanceof NaverAuthRequired) gated++;
      else throw err;
    }

    if (!COMMIT) continue;

    // ---- insert ----
    const canonical = `https://cafe.naver.com/wstcg/${a.articleId}`;
    const [post] = await db
      .insert(posts)
      .values({
        source: 'naver',
        sourceId: `wstcg/${a.articleId}`,
        urlCanonical: canonical,
        urlOriginal: canonical,
        authorHandle: nick || null,
        postedAt: a.date,
        rawText: a.subject,
        fetchedAt: new Date(),
      })
      .onConflictDoNothing({ target: posts.urlCanonical })
      .returning({ id: posts.id });

    const postId =
      post?.id ??
      (await db.select({ id: posts.id }).from(posts).where(eq(posts.urlCanonical, canonical)).limit(1))[0]?.id;
    if (!postId) continue;

    let imageId: string | null = null;
    if (mediaUrl) {
      try {
        const bytes = await download(mediaUrl);
        const s = await storeImage(bytes, kind);
        const [img] = await db
          .insert(images)
          .values({
            postId,
            mediaIndex: 0,
            originUrl: mediaUrl,
            origKey: s.origKey,
            thumbKey: s.thumbKey,
            mediumKey: s.mediumKey,
            width: s.width,
            height: s.height,
            sha256: s.sha256,
            blur: s.blur,
            kind,
          })
          .onConflictDoNothing({ target: [images.postId, images.mediaIndex] })
          .returning({ id: images.id });
        imageId =
          img?.id ??
          (await db.select({ id: images.id }).from(images).where(and(eq(images.postId, postId), eq(images.mediaIndex, 0))).limit(1))[0]?.id ??
          null;
      } catch (e) {
        console.log(`   이미지 실패 ${a.articleId}: ${e instanceof Error ? e.message : e}`);
      }
    }

    await db
      .insert(decks)
      .values({
        postId,
        mediaIndex: 0,
        imageId,
        imageVerified: !!imageId,
        titleId: titleHit.key,
        titleRaw: bracket,
        climaxes,
        region: 'KR',
        scale: 'BUSHIROAD', // WGP/BCF are Bushiroad-run — the 대 scale, absent until now
        format,
        top4,
        status: 'published',
        provenance: 'ai',
        sortAt: a.date,
      })
      .onConflictDoNothing({ target: [decks.postId, decks.mediaIndex] });
    inserted++;
  }
}

if (COMMIT) {
  await db.execute(sql`
    UPDATE titles SET deck_count = (
      SELECT count(*) FROM decks WHERE decks.title_id = titles.id AND decks.status = 'published'
    )
  `);
}

console.log('\n════════ 결과 ════════');
console.log(`  작품 매칭     : ${matched}`);
console.log(`  작품 미상(스킵): ${skipped}  ← 별칭 보강 대상`);
console.log(`  이미지 확보   : ${withImage} (그중 decklog 렌더 ${withDecklog})`);
console.log(`  본문 로그인벽  : ${gated}  ← 제목으로 덱은 확보, 이미지만 없음`);
if (COMMIT) console.log(`  ✅ 삽입한 덱   : ${inserted}`);
else console.log(`\n(드라이런입니다. 실제 삽입하려면 --commit)`);
if (unmatched.length) console.log(`\n■ 여전히 작품 미상:\n  ${[...new Set(unmatched)].join('  ·  ')}`);

await closeDb();
