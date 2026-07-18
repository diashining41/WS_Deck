/**
 * Keeping non-Weiß-Schwarz card games out.
 *
 * This site is base WS only. Several other games leak in because they SHARE the
 * anime IP a WS post would name, so their tournament tweets look placeable onto
 * our title pages:
 *
 *   - **Rosé / Blau** — WS's own adult / alt spin-offs (separate card pools).
 *   - **Other Bushiroad & rival TCGs** — hololive OFFICIAL CARD GAME (ホロカ),
 *     Love Live! OFFICIAL CARD GAME (ラブカ), Union Arena, Godzilla Card Game
 *     (ゴジカ), One Piece / Pokémon / Digimon / Gundam / 五等分の花嫁 card games,
 *     Yu-Gi-Oh, MTG, Duel Masters. Each shows up wearing an IP we carry
 *     (hololive, チェンソーマン, マクロス, シンデレラガールズ …).
 *
 * Two gates, because either alone leaks:
 *   - **By title code.** Every Rosé work carries an OS## code (decides Rosé).
 *   - **By post text.** The game's OWN name is the tell — a WS post never uses
 *     "ホロカ"/"ラブカ"/"ユニオンアリーナ" for itself. The trap: a WS player drops
 *     "ホロカしか勝たん" in a comment on a genuine ヴァイス post, so a bare name
 *     match alone deletes real WS decks. Hence: an other-game name AND the
 *     absence of any base-WS signal (keyword OR a WS deck-list fingerprint).
 */

/** Rosé works are exactly the OS## codes — Navel, AQUAPLUS, Alice Soft, … */
export function isRoseCode(code: string): boolean {
  return /^OS\d+$/i.test(code);
}

/**
 * `ブラウ` is a substring of `ブラウンダスト` (Brown Dust), a perfectly ordinary
 * Neo-Standard title. The negative lookahead is the entire point — do not
 * "simplify" it. Same trap on Rosé: ロゼッタ is a Granblue character.
 */
const BLAU_TEXT = /ヴァイスシュヴァルツ\s*ブラウ|WSブラウ|ブラウ(?!ン)|블라우|\bBlau\b/i;
const ROSE_TEXT = /ヴァイスシュヴァルツ\s*ロゼ|WSロゼ|ロゼ(?!ッタ)|로제|\bWSR\b/i;

/**
 * Every other TCG by its OWN distinctive game-name. Union of hololive OCG,
 * Love Live OCG, Godzilla CG, Union Arena, One Piece / Pokémon / Digimon /
 * Gundam / 五等分の花嫁 CG, Disney Lorcana, Cardfight!! Vanguard, Battle Spirits,
 * WIXOSS, Z/X, Reバース, Build Divide, Shadowverse EVOLVE, Yu-Gi-Oh, MTG,
 * Duel Masters. Only decides "not WS" together with the WS-absence guard below.
 *
 * Note the works that ALSO have a real WS set (hololive, ゴジラ, 五等分の花嫁,
 * ディズニー): match only the other game's own name (…カードゲーム / ロルカナ /
 * ミラーウォリアーズ is WS so NOT here), never the bare IP, so genuine WS decks
 * for those works stay.
 *
 * DO NOT put `\b` after a katakana/kanji token here (e.g. `ユニアリ\b`). JS `\b`
 * is a boundary between `[A-Za-z0-9_]` and non-word chars, and katakana is a
 * non-word char — so `ユニアリ\b` matches only when followed by ASCII, i.e. it
 * silently fails on the common `【#ユニアリ】` / `ユニアリの` cases. Anchor with a
 * negative lookahead against a real longer word instead, or leave the token bare.
 */
const OTHER_TCG =
  /ホロカ|ホロライブ\s*(?:オフィシャル)?\s*カードゲーム|ホロライブOCG|hololive\s*OFFICIAL\s*CARD\s*GAME|홀로라이브\s*(?:오피셜|공식)?\s*카드\s*?게임|홀로카|ラブライブ[！!]?\s*(?:シリーズ)?\s*(?:の)?オフィシャルカードゲーム|ラブライブ\s*カードゲーム|ラブカ|ラブライブTCG|러브라이브\s*(?:시리즈)?\s*(?:오피셜|공식)?\s*카드\s*?게임|러브카|러브라이브\s*TCG|ゴジラカードゲーム|ゴジラカード|ゴジカ|고질라\s*카드\s*게임|ユニオンアリーナ|ユニアリ|UNION\s*ARENA|유니온\s*아레나|ワンピースカードゲーム|ONE\s*PIECE\s*CARD\s*GAME|원피스\s*카드\s*게임|ポケモンカードゲーム|ポケカ\b|포켓몬\s*카드\s*게임|デジモンカードゲーム|디지몬\s*카드\s*게임|ガンダムカードゲーム|ガンダムカード|건담\s*카드\s*게임|五等分の花嫁\s*カードゲーム|5等分の花嫁\s*カードゲーム|五等分\s*カードゲーム|五等分TCG|ごとカド|(?:오|5)등분의?\s*신부\s*카드\s*게임|ロルカナ|Lorcana|로카나|ヴァンガード|カードファイト!?!?\s*ヴァンガード|카드파이트|뱅가드|バトルスピリッツ|バトスピ|배틀\s*스피리츠|ウィクロス|WIXOSS|위크로스|ゼクス|Z\/X|Reバース|리버스\s*포\s*유|ビルディバイド|ビルダイ|빌디바이드|シャドウバース\s*エボルヴ|Shadowverse\s*EVOLVE|遊戯王|유희왕|マジック：?ザ・?ギャザリング|Magic.{0,2}the\s*Gathering|\bMTG\b|デュエルマスターズ|デュエマ|듀얼마스터즈|듀엘마스터즈/i;

/** Keyword markers that pin a post to base Weiß Schwarz. */
const WS_KEYWORD =
  /ヴァイス|ワイス|シュヴァルツ|シュバルツ|バイス|바이스|와이스|\bWSB?\b|ws\dtcg|wei[sß]|ヴァイシュ|ﾜｲｽ|WGP|ネオスタン|네오스탠|바이스슈발츠/i;
/**
 * WS deck-list fingerprint: climax counts (8門 / 8電源 / 6宝2門 / 扉) that no
 * other TCG on the OTHER_TCG list notates. Two or more ⇒ this is a WS decklist
 * even with no keyword marker (WGP-style team reports often omit "ヴァイス").
 */
const WS_DECKLIST = /\d\s*(?:門|扉|電源|宝|チョイス|フォーカス|ゲート|魂)/g;

/**
 * A WS-community trio-tournament report: two or more of the three team positions
 * (先鋒/中堅/大将, sometimes 副将). A trio result lists decks per position with no
 * climax count and often no "ヴァイス" keyword, so it has no other fingerprint and
 * would be wrongly held. Requiring ≥2 positions keeps a stray 大将 in prose from
 * tripping it. (Other games' trio reports name their own game ⇒ OTHER_TCG gate;
 * the residual look-alike is left to the image 판독, per the recall/vision trade.)
 */
const WS_TEAM_POS = /先鋒|中堅|大将|副将/g;

function isWs(text: string): boolean {
  return WS_KEYWORD.test(text) || (text.match(WS_DECKLIST)?.length ?? 0) >= 2;
}

/**
 * A POSITIVE base-WS signal in the post text — a WS keyword, or one piece of WS
 * climax notation (8門 / 6宝2門 / 8電源 …) that no other TCG uses.
 *
 * The gate for AUTO-PUBLISH. gameFromText only tells us it's NOT an *other* game
 * by name; that isn't enough, because Reバース for you and Vanguard share the
 * very IPs WS carries (hololive, love live, マクロス) and name no other game, so
 * a "#ホロライブ 優勝 AZKi単" post looks WS by default yet may be Reバース. Only
 * a real WS fingerprint confirms it. No fingerprint ⇒ the text cannot prove this
 * is a WS 50-card recipe, so hold it for image 판독 rather than auto-publishing.
 * (Looser than isWs's ≥2 — one climax token is a confident WS tell on its own.)
 */
export function hasWsFingerprint(text: string): boolean {
  return (
    WS_KEYWORD.test(text) ||
    (text.match(WS_DECKLIST)?.length ?? 0) >= 1 ||
    (text.match(WS_TEAM_POS)?.length ?? 0) >= 2
  );
}

export type Game = 'WS' | 'ROSE' | 'BLAU' | 'OTHER';

/** What game is this post about, judged from its text alone. */
export function gameFromText(text: string): Game {
  if (ROSE_TEXT.test(text)) return 'ROSE';
  if (BLAU_TEXT.test(text)) return 'BLAU';
  if (OTHER_TCG.test(text) && !isWs(text)) return 'OTHER';
  return 'WS';
}
