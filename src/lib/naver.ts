/**
 * Naver Cafe access.
 *
 * The archive holds 273 cafe articles that arrived from the spreadsheet with a
 * title, climax, date and URL — but no image, because no adapter existed. This
 * is that adapter.
 *
 * What the investigation found, and what the shape of this file follows from:
 *
 *   - The HTML pages are decoys. `cafe.naver.com/ArticleRead.nhn` returns a
 *     944-byte JS redirect stub and `m.cafe.naver.com/...` returns an empty SPA
 *     shell. Every byte of real content comes from the XHR to apis.naver.com.
 *   - That API is LOGIN-gated, not membership-gated: 260 of our 273 articles
 *     answer 401 {"errorCode":"0004","reason":"로그인하지 않았습니다"} without
 *     cookies. Only 12 are 전체공개 and readable anonymously — enough to develop
 *     and test this file end to end before any cookie exists.
 *   - naver.me shortlinks resolve WITHOUT auth and hand back the articleId (the
 *     `art` JWT in the redirect target decodes to {articleId, cafeId}). The token
 *     bypasses membership, not login — reading still 401s. So: resolve free,
 *     read with cookies.
 *   - Images need no auth at all, ever. cafeptthumb-phinf.pstatic.net serves them
 *     to a plain GET with no cookie and no Referer.
 *
 * Cookies rot in weeks. That is survivable here because we never poll naver —
 * these 273 posts came from the sheet, so this is a one-shot backfill, not a
 * standing dependency. It fails loudly (NaverAuthRequired) rather than silently
 * archiving empty posts.
 */
import { loadEnv } from '@/lib/env';

loadEnv();

export const CAFE_CLUB = 'wstcg';
export const CAFE_ID = '18579885';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export class NaverAuthRequired extends Error {
  constructor(public articleId: string) {
    super(`네이버 로그인 필요 (글 ${articleId}) — .env.local 의 NAVER_NID_AUT / NAVER_NID_SES 를 확인하세요`);
  }
}

function cookieHeader(): string | null {
  const aut = process.env.NAVER_NID_AUT?.trim();
  const ses = process.env.NAVER_NID_SES?.trim();
  if (!aut || !ses) return null;
  return `NID_AUT=${aut}; NID_SES=${ses}`;
}

export function hasNaverCookies(): boolean {
  return cookieHeader() !== null;
}

export interface NaverMedia {
  url: string;
}

/** Deliberately the same shape as x.ts's Tweet, so backfill can treat them alike. */
export interface NaverArticle {
  id: string;
  authorHandle: string;
  text: string;
  createdAt: Date;
  media: NaverMedia[];
  /** decklog codes linked from the body — a crisp render beats the cafe photo. */
  decklogCodes: string[];
  /** Board name/id. Board 181 IS "대회 결과 게시판" — tournament by structure, not inference. */
  boardName: string;
  boardId: number | null;
  raw: unknown;
}

/**
 * decklog codes from the body. Two forms appear, and the naive "코드 : (\w+)"
 * regex mis-reads the second one — the WGP/BCF template often writes
 * "덱 로그 코드 : https://decklog.bushiroad.com/view/7WB7B", so a plain capture
 * grabs "https". Take the code out of the URL first; only fall back to a bare
 * token when there is no URL, and never accept "http(s)".
 */
function extractDecklogCodes(html: string): string[] {
  const codes = new Set<string>();
  for (const m of html.matchAll(/decklog(?:-en)?\.bushiroad\.com\/view\/([A-Za-z0-9]+)/gi)) {
    if (m[1]) codes.add(m[1].toUpperCase());
  }
  if (codes.size === 0) {
    for (const m of html.matchAll(/덱\s*로그\s*코드\s*[:：]\s*([A-Za-z0-9]{3,10})/g)) {
      const c = m[1];
      if (c && !/^https?$/i.test(c)) codes.add(c.toUpperCase());
    }
  }
  return [...codes];
}

/** 대회 결과 게시판. Membership of this board is proof, not evidence. */
export const TOURNAMENT_BOARD_ID = 181;

/**
 * A naver.me shortlink → the real article id.
 *
 * Works with no credentials: the redirect lands on
 * m.cafe.naver.com/{club}/{articleId}?art=<JWT>, and the id is right there in
 * the path (the JWT also carries it, but the path is enough).
 */
export async function resolveShortlink(slug: string): Promise<string | null> {
  const res = await fetch(`https://naver.me/${slug}`, {
    headers: { 'User-Agent': UA },
    redirect: 'follow',
  });
  const m = res.url.match(/cafe\.naver\.com\/(?:ca-fe\/web\/cafes\/)?[\w-]+\/(?:articles\/)?(\d+)/);
  return m?.[1] ?? null;
}

/** The article id for a post's stored source_id ("wstcg/100596" or "me/50BBn9Zr"). */
export async function articleIdFor(sourceId: string): Promise<string | null> {
  if (sourceId.startsWith('me/')) return resolveShortlink(sourceId.slice(3));
  const m = sourceId.match(/\/(\d+)$/);
  return m?.[1] ?? null;
}

/**
 * SmartEditor emits each photo twice — the original and a `?type=w1600` downscale.
 * Strip the query to keep the original (the same trick as X's ?name=orig), then
 * dedupe: 4 raw matches in a real article turned out to be 2 actual photos.
 */
function extractImages(contentHtml: string): NaverMedia[] {
  const urls = new Set<string>();
  for (const m of contentHtml.matchAll(/https?:\/\/cafeptthumb-phinf\.pstatic\.net\/[^\s"'<>\\]+/gi)) {
    const raw = m[0].replace(/&amp;/g, '&');
    urls.add(raw.split('?')[0]!);
  }
  return [...urls].map((url) => ({ url }));
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Fetch one article. Returns null if it is gone (404).
 * Throws NaverAuthRequired on 401 — a login wall is not a missing article, and
 * treating it as one would quietly delete 260 real posts.
 */
export async function fetchArticle(articleId: string): Promise<NaverArticle | null> {
  const cookie = cookieHeader();
  const res = await fetch(
    `https://apis.naver.com/cafe-web/cafe-articleapi/v3/cafes/${CAFE_ID}/articles/${articleId}?query=&useCafeId=true&requestFrom=A`,
    {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        Referer: `https://cafe.naver.com/${CAFE_CLUB}/${articleId}`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    },
  );

  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new NaverAuthRequired(articleId);
  if (!res.ok) throw new Error(`네이버 글 ${articleId}: HTTP ${res.status}`);

  const j = (await res.json()) as {
    result?: {
      article?: {
        subject?: string;
        contentHtml?: string;
        writeDate?: number;
        writer?: { nick?: string };
        // menu is nested INSIDE article, not beside it.
        menu?: { id?: number; name?: string };
      };
      errorCode?: string;
    };
    errorCode?: string;
    reason?: string;
  };

  // The API can answer 200 with an error body when the session is stale.
  if (j.errorCode || !j.result?.article) throw new NaverAuthRequired(articleId);

  const a = j.result.article;
  const html = a.contentHtml ?? '';

  return {
    id: articleId,
    authorHandle: a.writer?.nick ?? '',
    // Title first: the board convention is "[금정배틀시티] 5월 4일 공인대회 결과",
    // so the subject carries the event and often the placement.
    text: [a.subject ?? '', stripHtml(html)].filter(Boolean).join('\n'),
    createdAt: a.writeDate ? new Date(a.writeDate) : new Date(),
    media: extractImages(html),
    decklogCodes: extractDecklogCodes(html),
    boardName: a.menu?.name ?? '',
    boardId: a.menu?.id ?? null,
    raw: j,
  };
}

/** Self-test: are the cookies (if any) actually live? */
export async function health(): Promise<{ ok: boolean; detail: string }> {
  // 103046 is one of the 12 articles that are public even without a login, so
  // this proves reachability with or without cookies.
  try {
    const open = await fetchArticle('103046');
    if (!open) return { ok: false, detail: '공개 글 103046 이 사라졌습니다' };
    if (!hasNaverCookies()) {
      return { ok: true, detail: `쿠키 없음 — 공개 글만 읽힙니다 (이미지 ${open.media.length}장 확인)` };
    }
    // With cookies, a login-gated article must also come back.
    const gated = await fetchArticle('100596');
    return {
      ok: true,
      detail: gated ? '쿠키 유효 — 로그인 전용 글도 읽힙니다' : '쿠키 유효 (대상 글은 삭제됨)',
    };
  } catch (err) {
    if (err instanceof NaverAuthRequired) {
      return { ok: false, detail: '쿠키가 없거나 만료되었습니다 — 다시 발급하세요' };
    }
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
