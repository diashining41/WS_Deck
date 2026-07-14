import type { Climax } from '@/db/schema';
import { climaxesFromText } from '@/lib/heuristics';
import type { TitleMatcher } from '@/lib/match';

/**
 * Decide what a captured post becomes, WITHOUT reading its images.
 *
 * Auto-publish (no human review) can only place a deck if the 작품 is written in
 * the post text — the site is organised by title, so a title-less deck shows
 * nowhere anyway. So: text names the title ⇒ publish; it doesn't ⇒ hold as
 * needs_review (captured, invisible, recoverable later).
 *
 * The trap is picking the WRONG title. A tournament post often names several
 * works — opponents, match-ups, a whole team. Two rules keep accuracy high:
 *
 *   1. Prefer the title written right after a 使用 / 사용 marker — that's the
 *      poster's own deck, not an opponent's.
 *   2. If there's no marker, only trust a title when it's the ONLY one named.
 *      Multiple candidates and no marker ⇒ hold rather than guess.
 *
 * Match-video announcements (対戦動画) are two players' decks in one post and are
 * always held.
 */
export interface DeckClassification {
  mediaIndex: number;
  titleId: number | null;
  climaxes: Climax[];
  status: 'published' | 'needs_review';
}

const MATCH_VIDEO = /対戦動画|試合動画|対戦\s*(?:動画|映像)/;

/** The poster's own deck: what follows a 使用 / 사용 marker, up to the line end. */
function ownDeckSegment(text: string): string | null {
  const m = text.match(/(?:使用構築|使用リスト|使用デッキ|使用タイトル|使用|사용덱|사용\s*덱|사용)\s*[:：]?\s*([^\n]{0,40})/);
  return m?.[1]?.trim() || null;
}

function hold(mediaIndexes: number[]): DeckClassification[] {
  return mediaIndexes.map((mediaIndex) => ({ mediaIndex, titleId: null, climaxes: [], status: 'needs_review' as const }));
}

export function classifyDecks(
  text: string,
  mediaIndexes: number[],
  titleMatcher: TitleMatcher,
): DeckClassification[] {
  // A match video is two decks in one post — never auto-place it.
  if (MATCH_VIDEO.test(text)) return hold(mediaIndexes);

  const climaxes = climaxesFromText(text);

  if (mediaIndexes.length === 1) {
    // 1) Title named right after a 使用 marker wins.
    const seg = ownDeckSegment(text);
    let titleId: number | null = seg ? (titleMatcher.findAll(seg)[0]?.key ?? null) : null;

    // 2) No marker: trust the text only when exactly one title is named.
    if (titleId === null) {
      const all = titleMatcher.findAll(text);
      if (all.length === 1) titleId = all[0]!.key;
    }

    return [
      { mediaIndex: mediaIndexes[0]!, titleId, climaxes, status: titleId ? 'published' : 'needs_review' },
    ];
  }

  // Trio: bind by order of appearance only when the counts line up exactly.
  // Climaxes are left empty — the text mixes every player's together.
  const ordered = titleMatcher
    .findAll(text)
    .map((m) => ({ titleId: m.key, pos: text.indexOf(m.alias) }))
    .sort((a, b) => a.pos - b.pos);

  if (ordered.length === mediaIndexes.length) {
    return mediaIndexes.map((mediaIndex, i) => ({
      mediaIndex,
      titleId: ordered[i]!.titleId,
      climaxes: [],
      status: 'published' as const,
    }));
  }

  return hold(mediaIndexes);
}
