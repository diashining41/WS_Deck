import type { Climax } from '@/db/schema';
import { gameFromText } from '@/lib/game';
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

/**
 * A shop's sales / restock / buylist / open-for-business post — a card image but
 * NOT a tournament result. "【販売情報】8門アズレンのデッキ" or "本日発売！GA文庫入荷"
 * carry a 작품 and would auto-publish as a deck, so they must be held. The tell is
 * a shop-ad phrase with NO tournament-result signal; a post that reports a winner
 * ("優勝", "3位", 使用デッキ, レシピ) is a real result and passes even if it also
 * plugs the next event.
 */
const RESULT_SIGNAL =
  /優勝|準優勝|入賞|\d\s*位|上位|ベスト\d|使用(?:デッキ|構築|リスト|タイトル)?|使っ|考案|デッキ名|デッキレシピ|レシピ|結果|우승|입상|사용\s*덱|사용덱|先鋒|中堅|大将|全勝|\d\s*[-‐]\s*\d|使\/|勝者|Top\s*\d/i;
const SHOP_AD =
  /【?\s*販売情報\s*】?|【?\s*入荷情報\s*】?|デッキ販売|買取価格|買取情報|在庫補充|価格調整|価格改定|本日発売|明日発売|発売開始|発売予定|オープンしました|営業(?:中|です|時間|しております)|商品ページ|通販(?:ページ|サイト)|ご来店(?:を)?お?待ち|入荷しました/i;

/** True when a post is a shop advert / listing rather than a tournament result. */
export function isShopAd(text: string): boolean {
  return SHOP_AD.test(text) && !RESULT_SIGNAL.test(text);
}

/**
 * This site collects 입상덱 — decks that PLACED in a tournament. A creator's
 * deck-showcase or "I built this for fun" video ("かべウチ #92", "組んでみました",
 * "ぜひ試してみて", a YouTube link) carries a WS 작품 and a deck photo, so it
 * auto-publishes — but it never placed anywhere. Tell: a showcase/video marker
 * with NO tournament context at all. A genuine placing post that also links a
 * video keeps a 優勝/入賞/位/大会 marker, so it passes.
 */
const TOURNEY_CONTEXT =
  /優勝|準優勝|入賞|ベスト\d|トップ\d|Top\s*\d|\d\s*位|\d+\s*등|上位|全勝|大会|公認|ショップ(?:大会|バトル|ファイト)|\bCS\b|杯|カップ|トナメ|トーナメント|予選|本戦|決勝|準決|戦績|使用|使\/|レシピ|優勝者|入賞者|우승|입상|Locals|Regional|WGP|Champion|Swiss|Round\s*\d|\bR\d\b|対戦|\d\s*[-‐]\s*\d|勝ち|敗/i;
const SHOWCASE =
  /かべウチ|デッキ紹介|紹介動画|組んでみ|作ってみ|回してみ|やってみ|試してみ|一人回し|ソロ回し|解説動画|ゆっくり|youtu\.?be|youtube|生放送|【[^】]{0,20}#\d{1,4}】|やりたいだけ|チャンネル登録|概要欄/i;

/** True when a post is a deck-showcase / video, not a tournament placement. */
export function isShowcase(text: string): boolean {
  return SHOWCASE.test(text) && !TOURNEY_CONTEXT.test(text);
}

/**
 * An announcement for an UPCOMING event, not a placing result. Shops post these
 * with a 작품 named only in the prize ("全勝賞：シンデレラガールズ 1BOX") and a
 * flyer image, so they auto-publish as a deck though no one has placed yet.
 *
 * This gate is deliberately hard to trip, because the failure mode is DELETING
 * REAL RESULTS. Two rules learned the hard way:
 *
 *   - PROMO_SIGNAL is registration-only vocabulary (will-be-held / entry / sign-
 *     up / pre-order / all-win-PRIZE). It must NOT include 参加費 or 参加お待ち:
 *     "またのご参加お待ちしております" and "参加費奢ってくれた" are boilerplate in
 *     the FOOTER of ordinary result tweets, so those would nuke real placements.
 *   - PROMO_RESULT (this-is-a-result, so pass) is broad: おめでとう / 🥇 / 選手 /
 *     デッキ名 / 制した / 使用 / a match score — the things a report has and an
 *     announcement doesn't. 全勝賞・優勝賞 are PRIZES (negative lookahead on 賞),
 *     not results, so a pure "全勝賞：BOX" flyer is not rescued by them.
 */
const PROMO_SIGNAL =
  /開催\s*(?:予定|決定)|開催っ|エントリー\s*(?:受付|開始|はこちら|する)|参加者?\s*募集|参加\s*受付|事前\s*(?:予約|登録)|(?:予約|申[しこ]込)\s*(?:受付|開始|はこちら|方法)|トナメル|締[めき]切|全勝賞|参加賞|要\s*事前|개최\s*(?:예정|확정)|참가자?\s*모집|사전\s*(?:예약|등록)|참가\s*신청/i;
const PROMO_RESULT =
  /おめでとう|🥇|🥈|🥉|優勝(?!賞)|準優勝|入賞(?!賞)|全勝(?!賞)|ベスト\d|トップ\d|Top\s*\d|\d\s*位|\d+\s*등|上位|制した|選手|さんです|さん\s*です|デッキ\s*[名:：]|使用|使っ|レシピ|戦績|構築|開催\s*(?:され|となり|しま)|でした|\d\s*[-‐]\s*\d|우승|입상/i;

/** True when a post announces a future event (sign-up / entry / prize), not a result. */
export function isEventPromo(text: string): boolean {
  return PROMO_SIGNAL.test(text) && !PROMO_RESULT.test(text);
}

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
  // A different card game entirely — Rosé, Blau, or the Love Live Official Card
  // Game — must never be auto-placed onto a WS title page. The poll gate drops
  // most at ingest, but this is the choke point that also catches posts stored
  // before the gate existed and any whose game only shows in the fetched text.
  // Hold rather than publish: invisible, and recoverable if ever misjudged.
  if (gameFromText(text) !== 'WS') return hold(mediaIndexes);

  // A shop advert (sales / restock / buylist / open) is not a deck result.
  if (isShopAd(text)) return hold(mediaIndexes);

  // A deck-showcase / video ("組んでみた", "かべウチ #92") never placed anywhere.
  if (isShowcase(text)) return hold(mediaIndexes);

  // An upcoming-event announcement ("BOX争奪戦 開催！参加費500円") is not a result.
  if (isEventPromo(text)) return hold(mediaIndexes);

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
