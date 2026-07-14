import { and, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import { db, rows } from '@/db';
import { decks, images, posts, titles } from '@/db/schema';
import type { Climax } from '@/db/schema';

export interface TitleSummary {
  id: number;
  code: string;
  nameKo: string;
  deckCount: number;
}

/**
 * 74 of the 148 titles have no decks; showing them all would be half dead links.
 * Rosé works (OS## codes) are a different game entirely and never appear here.
 */
export async function listTitlesWithDecks(): Promise<TitleSummary[]> {
  return db
    .select({ id: titles.id, code: titles.code, nameKo: titles.nameKo, deckCount: titles.deckCount })
    .from(titles)
    .where(and(gt(titles.deckCount, 0), eq(titles.game, 'WS')))
    .orderBy(desc(titles.deckCount), titles.nameKo);
}

export async function getTitleByCode(code: string): Promise<TitleSummary | null> {
  const [row] = await db
    .select({ id: titles.id, code: titles.code, nameKo: titles.nameKo, deckCount: titles.deckCount })
    .from(titles)
    .where(and(eq(titles.code, code), eq(titles.game, 'WS')))
    .limit(1);
  return row ?? null;
}

export interface DeckCard {
  id: string;
  climaxes: Climax[];
  region: 'JP' | 'KR' | 'OVERSEAS';
  scale: 'SHOP' | 'CS' | 'BUSHIROAD';
  format: 'SINGLES' | 'TRIO';
  top4: boolean | null;
  sortAt: string;
  imageVerified: boolean;
  /** How many decks came from the same post — a trio tweet carries up to 4. */
  siblingCount: number;
  postId: string;
  url: string;
  source: string;
  authorHandle: string | null;
  thumbKey: string | null;
  mediumKey: string | null;
  blur: string | null;
  width: number | null;
  height: number | null;
}

/**
 * The whole deck list for one title, newest first.
 *
 * No server-side faceting: the largest title has 51 decks and the median has 2,
 * so the entire list is a few KB. Shipping it whole lets the client filter and
 * count facets instantly, with no round-trip and no spinner.
 */
export async function listDecksForTitle(titleId: number): Promise<DeckCard[]> {
  const siblings = db.$with('siblings').as(
    db
      .select({ postId: decks.postId, n: sql<number>`count(*)::int`.as('n') })
      .from(decks)
      .groupBy(decks.postId),
  );

  const rows = await db
    .with(siblings)
    .select({
      id: decks.id,
      climaxes: decks.climaxes,
      region: decks.region,
      scale: decks.scale,
      format: decks.format,
      top4: decks.top4,
      sortAt: decks.sortAt,
      imageVerified: decks.imageVerified,
      siblingCount: siblings.n,
      postId: posts.id,
      url: posts.urlOriginal,
      source: posts.source,
      authorHandle: posts.authorHandle,
      thumbKey: images.thumbKey,
      mediumKey: images.mediumKey,
      blur: images.blur,
      width: images.width,
      height: images.height,
    })
    .from(decks)
    .innerJoin(posts, eq(posts.id, decks.postId))
    .leftJoin(images, eq(images.id, decks.imageId))
    .innerJoin(siblings, eq(siblings.postId, decks.postId))
    .where(and(eq(decks.titleId, titleId), eq(decks.status, 'published')))
    .orderBy(desc(decks.sortAt), desc(decks.id));

  return rows.map((r) => ({
    ...r,
    sortAt: (r.sortAt instanceof Date ? r.sortAt : new Date(r.sortAt)).toISOString(),
  })) as DeckCard[];
}

export interface ReviewItem {
  id: string;
  postId: string;
  climaxes: Climax[];
  titleId: number | null;
  titleName: string | null;
  imageId: string | null;
  confidence: number | null;
  status: string;
  sortAt: string;
  url: string;
  rawText: string;
  authorHandle: string | null;
  /** Every image on the post — the reviewer picks which one is this deck. */
  candidates: { id: string; mediaIndex: number; thumbKey: string | null; mediumKey: string | null }[];
  /** Other decks from the same post, so a trio is reviewed as a set. */
  siblingCount: number;
  reasons: string[];
}

/**
 * What needs a human.
 *
 * Two populations end up here, and they need the same UI:
 *   - decks the AI wasn't confident about (low confidence, unknown 작품)
 *   - decks whose image binding is a guess — the spreadsheet never recorded which
 *     photo went with which deck, so every multi-deck post is unverified until
 *     someone looks. That's 158 of the 485 imported decks.
 */
export async function listReviewQueue(limit = 50): Promise<ReviewItem[]> {
  const siblings = db.$with('siblings').as(
    db
      .select({ postId: decks.postId, n: sql<number>`count(*)::int`.as('n') })
      .from(decks)
      .groupBy(decks.postId),
  );

  const rows = await db
    .with(siblings)
    .select({
      id: decks.id,
      postId: decks.postId,
      climaxes: decks.climaxes,
      titleId: decks.titleId,
      titleName: titles.nameKo,
      imageId: decks.imageId,
      imageVerified: decks.imageVerified,
      confidence: decks.confidence,
      status: decks.status,
      sortAt: decks.sortAt,
      url: posts.urlOriginal,
      rawText: posts.rawText,
      authorHandle: posts.authorHandle,
      siblingCount: siblings.n,
    })
    .from(decks)
    .innerJoin(posts, eq(posts.id, decks.postId))
    .innerJoin(siblings, eq(siblings.postId, decks.postId))
    .leftJoin(titles, eq(titles.id, decks.titleId))
    .where(
      and(
        // Never ask a human to review a deck from a game we don't serve.
        // A null title is fine — that's an unknown work, which is the whole
        // reason it's in the queue.
        or(isNull(decks.titleId), eq(titles.game, 'WS')),
        or(
          eq(decks.status, 'needs_review'),
          // A guessed binding is only actually a guess when there was a choice.
          and(eq(decks.imageVerified, false), gt(siblings.n, 1)),
        ),
      ),
    )
    .orderBy(decks.confidence, desc(decks.sortAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const postIds = [...new Set(rows.map((r) => r.postId))];
  const media = await db
    .select({
      id: images.id,
      postId: images.postId,
      mediaIndex: images.mediaIndex,
      thumbKey: images.thumbKey,
      mediumKey: images.mediumKey,
    })
    .from(images)
    .where(inArray(images.postId, postIds))
    .orderBy(images.mediaIndex);

  const byPost = new Map<string, ReviewItem['candidates']>();
  for (const m of media) byPost.set(m.postId, [...(byPost.get(m.postId) ?? []), m]);

  return rows.map((r) => {
    const reasons: string[] = [];
    if (r.status === 'needs_review') reasons.push('AI 확신도 낮음');
    if (!r.imageVerified && r.siblingCount > 1) reasons.push(`이미지-덱 매칭 미확정 (덱 ${r.siblingCount}개)`);
    if (!r.titleId) reasons.push('작품 미상');
    if ((r.climaxes ?? []).length === 0) reasons.push('클라이맥스 미상');

    return {
      ...r,
      sortAt: (r.sortAt instanceof Date ? r.sortAt : new Date(r.sortAt)).toISOString(),
      candidates: byPost.get(r.postId) ?? [],
      reasons,
    } as ReviewItem;
  });
}

export async function getStats(): Promise<{ decks: number; posts: number; titles: number; images: number }> {
  const result = await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM decks d JOIN titles t ON t.id = d.title_id
         WHERE d.status = 'published' AND t.game = 'WS') AS decks,
      (SELECT count(*)::int FROM posts) AS posts,
      (SELECT count(*)::int FROM titles WHERE deck_count > 0 AND game = 'WS') AS titles,
      (SELECT count(*)::int FROM decks d JOIN titles t ON t.id = d.title_id
         WHERE d.image_id IS NOT NULL AND t.game = 'WS') AS images
  `);
  const [row] = rows<{ decks: number; posts: number; titles: number; images: number }>(result);
  return row ?? { decks: 0, posts: 0, titles: 0, images: 0 };
}
