/**
 * Derives the Japanese/Korean climax shorthand table from the spreadsheet.
 *
 * The sheet is a Rosetta stone: every row carries a human-verified Korean climax
 * label AND a link to the post that writes the same climax in shorthand
 * (東方8扉, ブルアカ8宝, 8초 카캡사). Correlating the two recovers the mapping
 * without anyone hand-writing it.
 *
 * Three things make the signal usable:
 *
 *  1. Tournament posts list the OPPONENTS' decks too. Correlating over the whole
 *     tweet mixes every deck in a match report together. We isolate the author's
 *     own deck (the 使用 / 사용덱 segment) — or, failing that, accept the tweet
 *     only when it contains exactly one climax token overall, which leaves
 *     nothing to confuse it with.
 *  2. A post with two climaxes and two tokens can't say which token is which. So
 *     round 1 only counts unambiguous 1-token/1-climax samples.
 *  3. Once a token is known, it can be subtracted. A deck labelled 금괴/2소울
 *     whose text reads 魂宝 resolves 魂→2소울 the moment 宝→금괴 is settled. We
 *     iterate that to a fixed point rather than guessing the rest by hand.
 */
import { eq, ne, sql } from 'drizzle-orm';

import { db } from '@/db';
import { decks, posts, type Climax } from '@/db/schema';

/** Shorthand candidates, longest-first so 電源 beats 電 and 2소울 beats 소울. */
const TOKENS = [
  '電源',
  'フォーカス',
  'スタンバイ',
  'カムバック',
  'トレジャー',
  'チョイス',
  'ショット',
  'リターン',
  'チャンス',
  'ドロー',
  'ゲート',
  'ソウル',
  '焦点',
  '望遠',
  '移動',
  '2소울',
  '扉',
  '門',
  '電',
  '枝',
  '宝',
  '魂',
  '本',
  '風',
  '鍵',
  '銃',
  '스탠',
  '초이스',
  '포커스',
  '게이트',
  '보따리',
  '망원경',
  '회오리',
  '금괴',
  '찬스',
  '초',
  '금',
  '문',
  '게',
  '책',
  '샷',
] as const;

const TOKEN_RE = new RegExp(`(?:\\d+|[０-９]+)\\s*(${TOKENS.join('|')})`, 'g');

/** Everything after a 使用 marker up to the line break is the author's own deck. */
function ownDeckSegment(text: string): string | null {
  const m = text.match(/(?:使用構築|使用リスト|使用デッキ|使用|사용덱|사용\s*덱|사용)\s*[:：]?\s*([^\n]{0,60})/);
  return m?.[1]?.trim() ?? null;
}

function tokensIn(s: string): string[] {
  return [...s.matchAll(TOKEN_RE)].map((m) => m[1]!).filter(Boolean);
}

const singleDeckPosts = db.$with('single').as(
  db.select({ postId: decks.postId }).from(decks).groupBy(decks.postId).having(sql`count(*) = 1`),
);

const samples = (
  await db
    .with(singleDeckPosts)
    .select({ text: posts.rawText, climaxes: decks.climaxes })
    .from(decks)
    .innerJoin(posts, eq(posts.id, decks.postId))
    .innerJoin(singleDeckPosts, eq(singleDeckPosts.postId, decks.postId))
    .where(ne(posts.rawText, ''))
)
  .map((s) => {
    const seg = ownDeckSegment(s.text);
    // Prefer the author's own-deck segment; fall back to the whole tweet only when
    // it is unambiguous on its own.
    const segTokens = seg ? tokensIn(seg) : [];
    const tokens = segTokens.length > 0 ? segTokens : tokensIn(s.text);
    const trustWholeText = segTokens.length === 0 && tokens.length === 1;
    return { climaxes: s.climaxes ?? [], tokens, usable: segTokens.length > 0 || trustWholeText };
  })
  .filter((s) => s.usable && s.tokens.length > 0 && s.climaxes.length > 0);

console.log(`사용 가능한 샘플 ${samples.length}건\n`);

const votes = new Map<Climax, Map<string, number>>();
const resolved = new Map<string, Climax>(); // token -> climax

function vote(cx: Climax, tok: string): void {
  const inner = votes.get(cx) ?? new Map<string, number>();
  inner.set(tok, (inner.get(tok) ?? 0) + 1);
  votes.set(cx, inner);
}

/**
 * A sample resolves a token when, after removing every token/climax pair we
 * already know, exactly one of each is left over.
 */
function round(): number {
  let learned = 0;
  for (const s of samples) {
    const tokens = [...s.tokens];
    const climaxes = [...s.climaxes];

    for (const tok of [...tokens]) {
      const known = resolved.get(tok);
      if (!known) continue;
      const at = climaxes.indexOf(known);
      if (at === -1) continue; // token contradicts the label — leave the sample alone
      tokens.splice(tokens.indexOf(tok), 1);
      climaxes.splice(at, 1);
    }

    if (tokens.length === 1 && climaxes.length === 1) {
      vote(climaxes[0]!, tokens[0]!);
    }
  }

  // Promote a pairing once it dominates its token's votes.
  const byToken = new Map<string, Map<Climax, number>>();
  for (const [cx, inner] of votes) {
    for (const [tok, n] of inner) {
      const m = byToken.get(tok) ?? new Map<Climax, number>();
      m.set(cx, (m.get(cx) ?? 0) + n);
      byToken.set(tok, m);
    }
  }

  for (const [tok, m] of byToken) {
    if (resolved.has(tok)) continue;
    const ranked = [...m].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((a, b) => a + b[1], 0);
    const [cx, n] = ranked[0]!;
    // Two votes and a clear majority is enough; the alias table is reviewed by a
    // human before it is trusted anyway.
    if (n >= 2 && n / total >= 0.6) {
      resolved.set(tok, cx);
      learned++;
    }
  }
  return learned;
}

let pass = 0;
for (;;) {
  votes.clear();
  const before = resolved.size;
  round();
  pass++;
  if (resolved.size === before || pass > 12) break;
  console.log(`  ${pass}회차: 토큰 ${resolved.size}개 확정`);
}

console.log('\n유도 결과 (클라이맥스 → 축약어):\n');
const byClimax = new Map<Climax, string[]>();
for (const [tok, cx] of resolved) {
  byClimax.set(cx, [...(byClimax.get(cx) ?? []), tok]);
}
for (const [cx, toks] of [...byClimax].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`  ${cx.padEnd(5)} → ${toks.join(', ')}`);
}

const ALL: Climax[] = [
  '스탠', '문', '찬스', '샷', '회오리', '초이스', '망원경', '포커스', '보따리', '금괴', '책', '게이트', '2소울',
];
const missing = ALL.filter((c) => !byClimax.has(c));
console.log(`\n유도 못한 클라이맥스: ${missing.length ? missing.join(', ') : '없음'}`);
console.log('※ 확정된 표는 scripts/seed-aliases.ts 에 반영합니다.');

process.exit(0);
