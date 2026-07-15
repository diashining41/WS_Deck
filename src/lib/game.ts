/**
 * Keeping the two spin-offs out.
 *
 * Weiß Schwarz Rosé and Blau are separate games with separate card pools; this
 * site is base WS only. Two independent gates, because either one alone leaks:
 *
 *   - **By title code.** Every Rosé work carries an OS## code. Measured against
 *     the imported data this agrees with the post text 31/31 in both directions,
 *     so for any work already in the master, the code alone decides it.
 *   - **By post text.** A brand-new Rosé work won't be in the master yet, so the
 *     text gate catches it at ingest before it can create a bogus title.
 */

/** Rosé works are exactly the OS## codes — Navel, AQUAPLUS, Alice Soft, … */
export function isRoseCode(code: string): boolean {
  return /^OS\d+$/i.test(code);
}

/**
 * `ブラウ` is a substring of `ブラウンダスト` (Brown Dust), which is a perfectly
 * ordinary Neo-Standard title with 37 decks in the archive. A naive /ブラウ/
 * match flags 12 of them as Blau and would delete them. The negative lookahead
 * is the entire point of this regex — do not "simplify" it.
 */
const BLAU_TEXT = /ヴァイスシュヴァルツ\s*ブラウ|WSブラウ|ブラウ(?!ン)|블라우|\bBlau\b/i;
/** Same trap on the other side: ロゼッタ is a Granblue character, not the game. */
const ROSE_TEXT = /ヴァイスシュヴァルツ\s*ロゼ|WSロゼ|ロゼ(?!ッタ)|로제|\bWSR\b/i;

/**
 * Love Live! Official Card Game (ラブライブ！オフィシャルカードゲーム, "ラブカ") is a
 * SEPARATE Bushiroad TCG — not a WS spin-off. It shares the Love Live IP, so its
 * tournament posts name works we genuinely carry in WS (μ's, Aqours, 蓮ノ空, …)
 * and would otherwise be auto-placed onto those title pages. Eight had already
 * landed on the 러브라이브본가 page this way — μ's OCG shop wins masquerading as WS.
 *
 * The tell is the game's own name: オフィシャルカードゲーム / ラブカ / ラブライブカードゲーム,
 * which a WS post never uses for itself. The trap is that a WS player sometimes
 * drops "ラブカ" in a *comment* ("ラブカ楽しいです") on a genuine ヴァイス post, so a
 * bare ラブカ match alone would wrongly delete real WS decks. Hence: an OCG name
 * AND the absence of any base-WS marker. Checked after ROSE/BLAU, whose posts
 * carry シュヴァルツ (a WS marker) yet must not be read as base WS.
 */
const LLOCG_TEXT =
  /ラブライブ[！!]?\s*(?:シリーズ)?\s*(?:の)?オフィシャルカードゲーム|ラブライブ\s*カードゲーム|ラブカ|러브라이브\s*(?:시리즈)?\s*(?:오피셜|공식)?\s*카드\s*게임|러브카/i;
/** Any marker that pins a post to base Weiss Schwarz — its presence overrides the OCG guess. */
const WS_TEXT = /ヴァイス|ワイス|シュヴァルツ|바이스|와이스|\bWS\b|ws\dtcg|wei[sß]/i;

export type Game = 'WS' | 'ROSE' | 'BLAU' | 'LLOCG';

/** What game is this post about, judged from its text alone. */
export function gameFromText(text: string): Game {
  if (ROSE_TEXT.test(text)) return 'ROSE';
  if (BLAU_TEXT.test(text)) return 'BLAU';
  if (LLOCG_TEXT.test(text) && !WS_TEXT.test(text)) return 'LLOCG';
  return 'WS';
}
