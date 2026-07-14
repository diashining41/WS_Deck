import type { Climax } from '@/db/schema';
import { climaxesFromText } from '@/lib/heuristics';
import type { TitleMatcher } from '@/lib/match';

/**
 * Decide what a captured post becomes, WITHOUT reading its images.
 *
 * Auto-publish (no human review) can only place a deck if the 작품 is written in
 * the post text — the site is organised by title, so a title-less deck shows
 * nowhere anyway. So: text names the title ⇒ publish; it doesn't ⇒ hold as
 * needs_review (captured, invisible, recoverable later with AI or a glance).
 *
 * Trio posts (several images) are only auto-published when the number of titles
 * named in the text matches the number of images, bound in order of appearance.
 * That's a guess — the user asked to publish now and correct later — but a wrong
 * count is held rather than mis-bound.
 */
export interface DeckClassification {
  mediaIndex: number;
  titleId: number | null;
  climaxes: Climax[];
  status: 'published' | 'needs_review';
}

export function classifyDecks(
  text: string,
  mediaIndexes: number[],
  titleMatcher: TitleMatcher,
): DeckClassification[] {
  const climaxes = climaxesFromText(text);

  // Distinct titles named in the text, in order of first appearance.
  const ordered = titleMatcher
    .findAll(text)
    .map((m) => ({ titleId: m.key, pos: text.indexOf(m.alias) }))
    .sort((a, b) => a.pos - b.pos);

  // Single image: the common case. One title in the text ⇒ publish it with the
  // text's climaxes (a solo shop-win post's text describes only that deck).
  if (mediaIndexes.length === 1) {
    const titleId = ordered[0]?.titleId ?? null;
    return [
      {
        mediaIndex: mediaIndexes[0]!,
        titleId,
        climaxes,
        status: titleId ? 'published' : 'needs_review',
      },
    ];
  }

  // Trio: bind by position only when the counts line up. Climaxes are left empty
  // — the text mixes every player's climaxes together and can't be split safely.
  if (ordered.length === mediaIndexes.length) {
    return mediaIndexes.map((mediaIndex, i) => ({
      mediaIndex,
      titleId: ordered[i]!.titleId,
      climaxes: [],
      status: 'published' as const,
    }));
  }

  // Ambiguous — hold every deck for later rather than guess.
  return mediaIndexes.map((mediaIndex) => ({
    mediaIndex,
    titleId: null,
    climaxes: [],
    status: 'needs_review' as const,
  }));
}
