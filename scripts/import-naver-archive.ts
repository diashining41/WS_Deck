/**
 * Archives the official Naver cafe's 대회 결과 게시판 as a date-ordered link index.
 *
 * Unlike WGP/BCF (import-naver-wgp), this board's subject carries the SHOP name,
 * not the 작품 — "[범계 트레이너스] 7월 11일 공인대회 결과" — and the body that holds
 * the actual decks is login-gated (cookie abandoned). So all we take, cookie-free,
 * is what the public list API gives: article id, subject, date. That is enough for
 * a chronological "official cafe results" archive that links out to each post.
 *
 * Non-WS results (pure 로제/블라우) are dropped; a combined "바이스/로제" post is kept
 * because it still covers WS. Rows go to the cafe_archive table (not posts/decks),
 * so they never touch the deck stats or the image backfill.
 *
 * Dry run by default; --commit to write. PAGES env caps how many list pages to
 * scan (default 40 for a backfill; the daily job passes a small number).
 */
import { sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';
import { cafeArchive } from '@/db/schema';
import { gameFromText } from '@/lib/game';

const COMMIT = process.argv.includes('--commit');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36';
const CAFE = '18579885';
const CLUB = 'wstcg';
const BOARD = { id: 181, name: '대회 결과' };
const MAX_PAGES = Number(process.env.PAGES ?? 40);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Keep WS tournament results; drop posts that are purely Rosé/Blau/other games.
 *  A subject naming another game AND 바이스/WS is a combined result → keep. */
function isWsTournament(subject: string): boolean {
  if (gameFromText(subject) === 'WS') return true;
  return /바이스|ヴァイス|\bWS\b/i.test(subject);
}

// The table lives outside the posts/decks graph; create it on first run so the
// cloud job needs no separate migration step. IF NOT EXISTS keeps it idempotent.
await db.execute(sql`
  CREATE TABLE IF NOT EXISTS cafe_archive (
    id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    article_id text NOT NULL,
    board_id integer NOT NULL,
    board_name text NOT NULL DEFAULT '',
    subject text NOT NULL,
    url text NOT NULL,
    posted_at timestamptz NOT NULL,
    fetched_at timestamptz NOT NULL DEFAULT now()
  )
`);
await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS cafe_archive_article_uq ON cafe_archive (article_id)`);
await db.execute(sql`CREATE INDEX IF NOT EXISTS cafe_archive_date_idx ON cafe_archive (posted_at DESC)`);

interface Listed {
  articleId: string;
  subject: string;
  date: Date;
}

async function listBoard(menuId: number): Promise<Listed[]> {
  const out: Listed[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(
      `https://apis.naver.com/cafe-web/cafe2/ArticleListV2dot1.json?search.clubid=${CAFE}&search.menuid=${menuId}&search.queryType=lastArticle&search.page=${page}&search.perPage=50`,
      { headers: { 'User-Agent': UA, Referer: `https://cafe.naver.com/${CLUB}` } },
    );
    if (!res.ok) {
      console.log(`   page ${page} http=${res.status} — 중단`);
      break;
    }
    const j = (await res.json()) as {
      message?: { result?: { articleList?: { articleId: number; subject: string; writeDateTimestamp: number }[] } };
    };
    const list = j.message?.result?.articleList ?? [];
    if (!list.length) break;
    for (const a of list) {
      out.push({ articleId: String(a.articleId), subject: a.subject, date: new Date(a.writeDateTimestamp) });
    }
    if (list.length < 50) break;
    await sleep(300);
  }
  return out;
}

console.log(`■ ${BOARD.name} 게시판(${BOARD.id}) 목록 수집 — 최대 ${MAX_PAGES}페이지 (쿠키 없이)\n`);
const arts = await listBoard(BOARD.id);

let kept = 0;
let dropped = 0;
let inserted = 0;
const droppedSamples: string[] = [];

for (const a of arts) {
  if (!isWsTournament(a.subject)) {
    dropped++;
    if (droppedSamples.length < 8) droppedSamples.push(a.subject.slice(0, 44));
    continue;
  }
  kept++;
  if (!COMMIT) continue;

  const res = await db
    .insert(cafeArchive)
    .values({
      articleId: a.articleId,
      boardId: BOARD.id,
      boardName: BOARD.name,
      subject: a.subject,
      url: `https://cafe.naver.com/${CLUB}/${a.articleId}`,
      postedAt: a.date,
    })
    .onConflictDoNothing({ target: cafeArchive.articleId })
    .returning({ id: cafeArchive.id });
  if (res.length) inserted++;
}

console.log('════════ 결과 ════════');
console.log(`  수집한 글       : ${arts.length}`);
console.log(`  WS 대회(보존)   : ${kept}`);
console.log(`  비-WS 제외      : ${dropped}`);
if (droppedSamples.length) console.log(`     예: ${droppedSamples.join('  ·  ')}`);
if (COMMIT) {
  const [{ n } = { n: 0 }] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM cafe_archive`));
  console.log(`  ✅ 신규 삽입     : ${inserted} · 아카이브 총 ${n}건`);
} else {
  console.log('\n(드라이런입니다. 실제 저장하려면 --commit)');
}

await closeDb();
