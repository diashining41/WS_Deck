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

export type Game = 'WS' | 'ROSE' | 'BLAU';

/** What game is this post about, judged from its text alone. */
export function gameFromText(text: string): Game {
  if (ROSE_TEXT.test(text)) return 'ROSE';
  if (BLAU_TEXT.test(text)) return 'BLAU';
  return 'WS';
}
