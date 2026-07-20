/**
 * Best-guess metadata for a freshly captured post, from its text alone.
 *
 * Newly polled posts have no human-entered 국가/규모/형식 yet, and those columns
 * are NOT NULL, so capture needs a value. These heuristics fill in a sensible
 * default that the reviewer confirms or corrects in one click — they are a
 * starting point, not a source of truth.
 */
import type { Climax } from '@/db/schema';

export type Region = 'JP' | 'KR' | 'OVERSEAS';
export type Scale = 'SHOP' | 'CS' | 'BUSHIROAD';
export type Format = 'SINGLES' | 'TRIO';

export function guessRegion(text: string): Region {
  if (/[가-힣]/.test(text)) return 'KR';
  // Japanese kana/kanji ⇒ JP; otherwise a Latin-only post is an overseas event.
  if (/[ぁ-んァ-ヶ一-龯]/.test(text)) return 'JP';
  return 'OVERSEAS';
}

export function guessScale(text: string): Scale {
  if (/WGP|BCF|チャンピオンシップ|championship/i.test(text)) return 'BUSHIROAD';
  if (/CS|杯|カップ|championship|regional/i.test(text)) return 'CS';
  return 'SHOP'; // the overwhelming majority — shop 공인대회
}

export function guessFormat(text: string): Format {
  if (/トリオ|チーム戦|trio|team|先鋒|中堅|大将|선봉|중견|대장/i.test(text)) return 'TRIO';
  return 'SINGLES';
}

/**
 * The player's OWN deck climax(es), read from the post text.
 *
 * A WS deck runs exactly 8 climaxes of one or (rarely) two types, written as a
 * count+token ("8宝", "6宝2門", "8게이트") or, on a 使用/デッキ line, as bare
 * tokens ("使用:門扉グラブル"). But tournament posts also LOG each round against
 * the OPPONENT's deck — "扉門◯先", "8枝✕後", "1라 밀리 8게이트 O" — and those
 * climaxes are not ours. The old version scraped the whole text and so merged
 * the opponents in (a Granblue 8宝 deck came back as 문/게이트/초이스/금괴).
 *
 * So: skip any line carrying a win/loss/turn marker (a match log), take the
 * FIRST surviving deck-notation line, and prefer the strong count+token signal;
 * bare tokens are trusted only on an explicit 使用/deck line. If the text names
 * no deck climax (most shop-result announcements do not), return [] (미상) rather
 * than scrape a stray 本日/宝 — the image 판독 fills those from the photo.
 */
const CX_TOKEN: Record<string, Climax> = {
  // katakana / kanji shorthand (longest matched first)
  電源: '스탠', スタンバイ: '스탠', スタン: '스탠', ゲート: '게이트', チョイス: '초이스',
  フォーカス: '포커스', トレジャー: '금괴', ソウル: '2소울', チャンス: '찬스', ドロー: '책',
  ショット: '샷', リターン: '회오리', 望遠鏡: '망원경', プール: '보따리', 焦点: '포커스',
  扉: '문', 門: '게이트', 電: '스탠', 宝: '금괴', 枝: '초이스', 択: '초이스', 本: '책', 魂: '2소울',
  // Korean forms, as written digit-prefixed in KR posts (8게이트 / 8문 / 8초이스)
  게이트: '게이트', 스탠바이: '스탠', 스탠: '스탠', 스텐: '스탠', 전원: '스탠', 초이스: '초이스',
  포커스: '포커스', 금괴: '금괴', 소울: '2소울', 찬스: '찬스', 문: '문', 책: '책', 샷: '샷',
};
// Tokens safe to read WITHOUT a leading count, but only on an explicit 使用/deck
// line. Excludes 本 (本日 trap), 電 (too short), and every Korean form (문/책… are
// common words) — those must be count-prefixed to count.
const BARE_SAFE = new Set([
  '電源', 'スタンバイ', 'スタン', 'ゲート', 'チョイス', 'フォーカス', 'トレジャー', 'ソウル',
  'チャンス', 'ショット', 'リターン', '望遠鏡', 'プール', '焦点', '扉', '門', '宝', '枝', '択', '魂',
]);
const CX_ALT = Object.keys(CX_TOKEN).sort((a, b) => b.length - a.length).join('|');
const COUNTED_CX = new RegExp('\\d+\\s*(' + CX_ALT + ')', 'g'); // 8宝 / 6宝2門 / 8게이트
const BARE_CX = new RegExp('(' + CX_ALT + ')', 'g');
// a line that logs a round result / matchup — its climaxes belong to the opponent
const MATCH_LINE = /[◯○●◎〇⭕⚪✕×✖✗]|先攻|後攻|先手|後手|\bvs\b|対面|対戦|回戦|\d\s*[-–]\s*\d\s*[◯○✕×]|\d라\s|\dR\b|R\d/i;
const DECK_LINE = /使用|デッキ|レシピ|構築|사용|レシピの日/;

export function climaxesFromText(text: string): Climax[] {
  const t = text.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  for (const line of t.split(/\r?\n/)) {
    if (MATCH_LINE.test(line)) continue; // opponent's deck in a round log
    const found: Climax[] = [];
    const add = (c: Climax | undefined) => {
      if (c && !found.includes(c)) found.push(c);
    };
    for (const m of line.matchAll(COUNTED_CX)) add(CX_TOKEN[m[1]!]); // strong: count+token
    if (found.length === 0 && DECK_LINE.test(line))
      for (const m of line.matchAll(BARE_CX)) if (BARE_SAFE.has(m[1]!)) add(CX_TOKEN[m[1]!]);
    if (found.length) return found.slice(0, 3);
  }
  return [];
}
