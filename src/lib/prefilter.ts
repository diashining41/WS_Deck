/**
 * The free first pass: is this post worth a vision call?
 *
 * This filter decides *who pays for the model*, not *who exists*. Nothing is
 * ever deleted — a post below the threshold is parked, not dropped. That's the
 * whole design: a false negative here would silently erase a deck from the
 * archive forever, while a false positive costs a few cents. So the scoring is
 * deliberately generous, and the AI makes the real tournament/not call later.
 *
 * Calibrated against the 406 imported posts, every one of which is a known
 * tournament post — recall below ~100% there means a keyword is missing, and
 * scripts/test-prefilter.ts will say so.
 */

export interface PrefilterInput {
  text: string;
  title?: string;
  hasImage: boolean;
  /** Set by adapters that already know from structure — a cafe tournament board, ws-tcg's 大会入賞 section. */
  structuralTournament?: boolean;
}

export interface PrefilterResult {
  score: number;
  pass: boolean;
  reasons: string[];
}

/** Result words — the strongest signal a post is reporting a finish. */
const RESULT = [
  '優勝', '準優勝', '入賞', '上位入賞', '決勝', 'ベスト4', 'ベスト8', 'BEST4', '予選突破', '大会結果', '全勝', '戦績',
  '우승', '준우승', '입상', '상위입상', '4강', '8강', '탑4', '결승', '전승',
];

/**
 * Result patterns. The plain word list missed a whole class of real posts:
 * shops announce placements as "🥈2位🥈" or "2nd Place" and never write 優勝 at
 * all, and 54 of the sheet's rows are overseas events reported in English or
 * Spanish. Each of these was a deck we would have quietly dropped.
 */
const RESULT_RE: [RegExp, string][] = [
  [/[0-9０-９一二三四五六七八九]\s*位/, 'placement_jp'], // 2位 · 三位
  [/\b\d+(st|nd|rd|th)\s*place\b/i, 'placement_en'],
  [/\btop\s*(4|8|16|cut)\b/i, 'top_cut'],
  [/\b(1st|2nd|3rd)\b/i, 'ordinal_en'],
  [/\bwon\b/i, 'won_en'],
  // Shops announce the winner with a medal and no words at all.
  [/[\u{1F3C6}\u{1F947}\u{1F948}\u{1F949}]/u, 'medal_emoji'],
];

/** Event words — a tournament happened, even if the post doesn't name a winner. */
const EVENT = [
  'ショップ大会', '公認大会', '非公認大会', 'CXチャレンジ', 'ネオスタンダード', 'チャンピオンシップ',
  '大会', 'トリオ', 'チーム戦', '個人戦', '杯', 'カップ', 'CS', 'WGP', 'BCF',
  '샵대회', '샵 대회', '공인', '비공인', '대회', '트리오', '팀전', '개인전', '챔피언십',
  // Overseas shops report in English or Spanish; 54 sheet rows come from them.
  'championship', 'regionals', 'local', 'trio', 'torneo', 'jugadores', 'swiss', 'players', 'teams', 'rds',
];

/** Structure — corroborating, never sufficient on its own. */
const STRUCTURE: [RegExp, string, number][] = [
  [/先鋒|中堅|大将|선봉|중견|대장/, 'trio_positions', 2],
  [/【[^】]{1,20}】/, 'bracketed_title', 1],
  [/#ヴァイスシュヴァルツ|#ヴァイス|#ws2tcg|#wstcg|#바이스슈발츠/i, 'hashtag', 1],
  [/decklog\.bushiroad\.com\/view\//i, 'decklog_link', 1],
  [/使用|사용덱|사용\s*덱/, 'used_deck_marker', 2],
  // The deck spelled out in shorthand: "8扉", "6扉2電", "八択", "8초". Nobody
  // writes this except when reporting what they actually piloted — note the
  // kanji numerals, which shop accounts use as readily as digits.
  [
    /[0-9０-９一二三四五六七八九]\s*(扉|門|電源|電|枝|択|宝|魂|本|フォーカス|チョイス|초|금|문|게|책|샷|스탠)/,
    'climax_shorthand',
    2,
  ],
  // English-speaking players write the same thing as "8 door" / "4 gate".
  [/\b\d\s*(door|gate|choice|treasure|book|standby|soul|shot|focus)s?\b/i, 'climax_shorthand_en', 2],
  // A win-loss record ("3-3", "2-0") or a run of match marks only ever appears
  // in a results report — nobody writes ○○○×○ about a deck they're brewing.
  // No word boundary: shops write it flush against the event name ("福福3-3").
  // This will occasionally catch a date, which costs one wasted vision call —
  // a false negative here costs a deck, permanently.
  [/(?<![0-9])[0-9]{1,2}\s*[-–]\s*[0-9]{1,2}(?![0-9])/, 'match_record', 2],
  [/[○×⭕❌⚪◯🙆🙅]{2,}/u, 'match_marks', 2],
];

/** Casual markers. Weak negatives — they lower the score, they never disqualify. */
const CASUAL = [
  '構築中', '考察', '妄想', 'カジュアル', 'ファンデッキ', '作ってみた', '組んでみた', '構築相談', '調整中',
  '자작', '첨삭', '봐주세요', '캐주얼', '팬덱', '미완성', '조언', '어때',
];

export const PASS_THRESHOLD = 3;

export function prefilter(input: PrefilterInput): PrefilterResult {
  const hay = `${input.title ?? ''}\n${input.text}`;
  const reasons: string[] = [];
  let score = 0;

  if (input.structuralTournament) {
    score += 5;
    reasons.push('structural');
  }

  let resultHit = false;
  for (const w of RESULT) {
    if (hay.includes(w)) {
      score += 3;
      reasons.push(`result:${w}`);
      resultHit = true;
      break; // one result word is proof; ten don't make it more true
    }
  }
  if (!resultHit) {
    for (const [re, label] of RESULT_RE) {
      if (re.test(hay)) {
        score += 3;
        reasons.push(label);
        break;
      }
    }
  }

  for (const w of EVENT) {
    if (hay.includes(w)) {
      score += 2;
      reasons.push(`event:${w}`);
      break;
    }
  }

  for (const [re, label, pts] of STRUCTURE) {
    if (re.test(hay)) {
      score += pts;
      reasons.push(label);
    }
  }

  if (input.hasImage) {
    score += 1;
    reasons.push('has_image');
  }

  for (const w of CASUAL) {
    if (hay.includes(w)) {
      score -= 2;
      reasons.push(`casual:${w}`);
      break;
    }
  }

  return { score, pass: score >= PASS_THRESHOLD, reasons };
}
