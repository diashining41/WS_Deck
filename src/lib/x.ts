import https from 'node:https';

/**
 * X access without an API key.
 *
 * Two jobs, two mechanisms:
 *
 *   discovery — WHICH tweets an account posted recently. nitter RSS.
 *   detail    — the full text + original images for one tweet id.
 *               cdn.syndication.twimg.com/tweet-result.
 *
 * The seemingly-obvious discovery endpoint, syndication.twitter.com's
 * timeline-profile, is a trap: it returns ~101 tweets, but they are a years-old
 * curated sample, not the recent timeline. Verified against the sheet — of one
 * shop's tournament tweets that fall inside the returned date range, ZERO were
 * actually in the payload. nitter RSS returns the genuinely-recent timeline, so
 * that's what discovery uses.
 *
 * Both are unofficial and unowned. Callers must be able to fall back to a
 * manually pasted URL, and every path here is written to fail loudly (health())
 * rather than let the archive go quietly stale.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** The token the embed widget derives from the tweet id; no secret involved. */
export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

export interface TweetMedia {
  url: string;
  width?: number;
  height?: number;
}

export interface Tweet {
  id: string;
  authorHandle: string;
  authorName?: string;
  text: string;
  createdAt: Date;
  media: TweetMedia[];
  /** Any decklog deck codes linked from the tweet — a crisp render beats a table photo. */
  decklogCodes: string[];
  raw: unknown;
}

export class RateLimited extends Error {
  constructor(public resetAt: Date) {
    super(`rate limited until ${resetAt.toISOString()}`);
  }
}

function extractDecklogCodes(text: string, urls: string[]): string[] {
  const found = new Set<string>();
  for (const s of [text, ...urls]) {
    for (const m of s.matchAll(/decklog(?:-en)?\.bushiroad\.com\/view\/(\w+)/gi)) {
      if (m[1]) found.add(m[1].toUpperCase());
    }
  }
  return [...found];
}

/* ----------------------------------------------------------- detail (works) */

export async function fetchTweet(id: string): Promise<Tweet | null> {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=ja&token=${syndicationToken(id)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });

  if (res.status === 404) return null; // deleted, or the author went private
  if (res.status === 429) {
    const reset = res.headers.get('x-rate-limit-reset');
    throw new RateLimited(reset ? new Date(Number(reset) * 1000) : new Date(Date.now() + 60_000));
  }
  if (!res.ok) throw new Error(`tweet ${id}: HTTP ${res.status}`);

  const j = (await res.json()) as {
    __typename?: string;
    id_str?: string;
    text?: string;
    created_at?: string;
    user?: { screen_name?: string; name?: string };
    mediaDetails?: { media_url_https?: string; original_info?: { width?: number; height?: number } }[];
    entities?: { urls?: { expanded_url?: string }[] };
  };

  /**
   * A gone tweet does not reliably 404. When the post (or its author) is deleted,
   * this endpoint answers 200 with a tombstone:
   *   {"__typename":"TweetTombstone","tombstone":{...}}
   * Parsed naively that becomes a tweet with no text and no media — which reads
   * as "alive, just no photo" and is indistinguishable from a real text-only
   * post. 247 deleted posts sat in the archive misfiled that way. Treat the
   * tombstone as what it is: gone.
   */
  if (j.__typename === 'TweetTombstone') return null;

  const expanded = (j.entities?.urls ?? []).map((u) => u.expanded_url ?? '');
  const media: TweetMedia[] = (j.mediaDetails ?? [])
    .filter((m) => m.media_url_https)
    .map((m) => ({
      // ?name=orig asks X for the untouched upload rather than the display crop.
      url: `${m.media_url_https}?name=orig`,
      width: m.original_info?.width,
      height: m.original_info?.height,
    }));

  return {
    id,
    authorHandle: j.user?.screen_name ?? '',
    authorName: j.user?.name,
    text: j.text ?? '',
    createdAt: j.created_at ? new Date(j.created_at) : new Date(),
    media,
    decklogCodes: extractDecklogCodes(j.text ?? '', expanded),
    raw: j,
  };
}

/** DECK LOG renders every deck as a clean, machine-generated image keyed by its code. */
export function decklogImageUrl(code: string): string {
  return `https://decklog.bushiroad.com/deckimages/${code.toUpperCase()}.png`;
}

/* ------------------------------------------------- discovery (nitter RSS) */

export interface TimelineRef {
  id: string;
  authorHandle: string;
  /** The RSS title + description — enough text for the prefilter to decide. */
  text: string;
  createdAt: Date;
  url: string;
}

/**
 * nitter instances come and go, so callers pass a list and we try them in order.
 * A 200 with no items means the instance is degraded, not that the account is
 * silent — we fall through rather than trust it.
 */
export const NITTER_HOSTS = ['nitter.net', 'nitter.tiekoetter.com', 'lightbrd.com'];

/**
 * Fetch via Node's built-in https, NOT fetch().
 *
 * These instances sit behind a Caddy/WAF that fingerprints the TLS ClientHello
 * and serves undici (Node's fetch) an empty 200 — content-length 0, no error, no
 * body. curl and Node's own https agent get the real 25KB feed with the same
 * headers. This is a TLS-fingerprint block, not an HTTP or header problem, so the
 * only fix is to use a client whose handshake it accepts. Redirects are followed
 * manually (some instances 302 between mirrors).
 */
function httpsGet(url: string, depth = 0): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.get(
      { host: u.host, path: u.pathname + u.search, headers: { 'User-Agent': UA, Accept: '*/*' } },
      (res) => {
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc && depth < 3) {
          res.resume();
          resolve(httpsGet(new URL(loc, url).toString(), depth + 1));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.setTimeout(15_000, () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseRss(xml: string, fallbackHandle: string): TimelineRef[] {
  const out: TimelineRef[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = m[1] ?? '';
    const link = item.match(/<link>([^<]*)<\/link>/)?.[1] ?? '';
    const idm = link.match(/status\/(\d+)/);
    if (!idm?.[1]) continue;

    const title = decodeXml(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    const desc = decodeXml(item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? '').replace(/<[^>]+>/g, ' ');
    const author = link.match(/nitter[^/]*\/([^/]+)\/status|x\.com\/([^/]+)\/status/)?.[1] ?? fallbackHandle;
    const pub = item.match(/<pubDate>([^<]*)<\/pubDate>/)?.[1];

    out.push({
      id: idm[1],
      authorHandle: author,
      text: `${title}\n${desc}`.trim(),
      createdAt: pub ? new Date(pub) : new Date(0),
      url: `https://x.com/${author}/status/${idm[1]}`,
    });
  }
  return out;
}

/* ----------------------------------------------- discovery (official API) */

/**
 * Paid X API v2 discovery — no account, no cookies, fully legit (app-only Bearer).
 * Uses recent search with a per-account `from:` filter AND a tournament-keyword
 * group, so we only ever READ (and pay ~$0.005 for) posts that look like results;
 * shop chatter is filtered server-side and never billed. `since_id` (the account
 * cursor) means a post is read at most once. Pay-per-use, no subscription — a
 * small credit top-up is a hard spending ceiling.
 *
 * Recall trade-off (deliberate, chosen for "min cost / max efficiency"): X search
 * has no regex, so the signals the prefilter catches by PATTERN — bare placements
 * (2位), win-loss records (3-3), medal-only posts — are only caught here via
 * explicit keywords/emoji. A result post that uses none of the query terms is not
 * read. Tune the term set with X_QUERY (no code change). Also: recent search only
 * spans the last 7 days, so it keeps the archive current going forward but can't
 * backfill the older gap (that needs a cookie run or full-archive search).
 */
export const TOURNAMENT_TERMS = [
  '優勝', '準優勝', '入賞', '上位入賞', '決勝', '予選突破', '全勝', '大会結果', 'ベスト4', 'ベスト8',
  '大会', 'ショップ大会', '公認', '公認大会', 'ネオスタンダード', 'ネオスタン', 'チャンピオンシップ', '選手権', 'トリオ', 'チーム戦', 'WGP', 'CXチャレンジ',
  '우승', '준우승', '입상', '대회', '결승', '공인',
  'championship', 'regionals', '"top 4"', '"top 8"',
  '🏆', '🥇', '🥈', '🥉',
];
const DEFAULT_QUERY = TOURNAMENT_TERMS.join(' OR ');

const xBearer = () => process.env.X_BEARER_TOKEN?.trim() || '';
export function hasXApi(): boolean {
  return !!xBearer();
}

// Twitter snowflake ids embed a ms timestamp: age lets us skip a since_id that
// predates recent-search's 7-day window (which would 400 the request).
function snowflakeAgeDays(id: string): number {
  try {
    return (Date.now() - (Number(BigInt(id) >> 22n) + 1288834974657)) / 86_400_000;
  } catch {
    return Infinity;
  }
}

async function xApiGet(path: string): Promise<any> {
  const res = await fetch(`https://api.x.com${path}`, { headers: { Authorization: `Bearer ${xBearer()}`, 'User-Agent': UA } });
  if (res.status === 429) {
    const reset = res.headers.get('x-rate-limit-reset');
    throw new RateLimited(reset ? new Date(Number(reset) * 1000) : new Date(Date.now() + 15 * 60_000));
  }
  if (!res.ok) throw new Error(`X API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function fetchTimelineViaApi(handle: string, opts: { sinceId?: string } = {}): Promise<TimelineRef[]> {
  const query = process.env.X_QUERY?.trim() || DEFAULT_QUERY;
  const params = new URLSearchParams({
    query: `from:${handle} (${query}) -is:retweet`,
    max_results: '100',
    'tweet.fields': 'created_at',
  });
  // Only send since_id when it's inside the 7-day recent-search window; an older
  // cursor 400s. Without it, we read the full 7-day window and the poller's own
  // cursor filter (plus the DB unique constraint) dedupes — costs a little more
  // once, never loses a post.
  if (opts.sinceId && snowflakeAgeDays(opts.sinceId) < 6.5) params.set('since_id', opts.sinceId);
  const j = await xApiGet(`/2/tweets/search/recent?${params.toString()}`);
  return (j?.data ?? []).map((t: any) => ({
    id: String(t.id),
    authorHandle: handle,
    text: (t.text ?? '').trim(),
    createdAt: t.created_at ? new Date(t.created_at) : new Date(0),
    url: `https://x.com/${handle}/status/${t.id}`,
  }));
}

/* ------------------------------------------- discovery (logged-in cookie) */

/**
 * Cookie-based discovery. Every nitter instance died (see NITTER_HOSTS — the
 * whole ecosystem collapsed: offline, Cloudflare bot-walls, or 403), so we can
 * no longer discover tweets anonymously. Discovery now runs through the
 * logged-in web API with a throwaway account's session cookies.
 *
 * Free and automated, but against X's ToS and subject to the account being
 * rate-limited or suspended — treat the cookies as disposable and expect to
 * refresh them when they expire (health() reports when they've gone stale).
 *
 * Provide EITHER X_COOKIES (a full "name=value; name=value" cookie header copied
 * from a logged-in browser) OR both X_AUTH_TOKEN and X_CT0. Absent ⇒ we fall
 * through to the (dead) nitter path, so nothing crashes before the secret exists.
 */
// Read lazily (at call time), not at module load: a script's loadEnv() runs
// AFTER this module is first evaluated, so top-level env reads would miss .env.local.
function xEnv() {
  return {
    cookies: process.env.X_COOKIES?.trim() || '',
    authToken: process.env.X_AUTH_TOKEN?.trim() || '',
    ct0: process.env.X_CT0?.trim() || '',
    maxTweets: Number(process.env.X_MAX_TWEETS ?? 20),
  };
}
export function hasXCookies(): boolean {
  const e = xEnv();
  return !!(e.cookies || (e.authToken && e.ct0));
}

/**
 * tough-cookie only sends a cookie whose domain matches the request host, and
 * the scraper talks to both twitter.com and x.com — so register each cookie for
 * both domains. setCookies() accepts raw strings, so no tough-cookie import.
 */
function cookieStrings(): string[] {
  const e = xEnv();
  const pairs: string[] = [];
  if (e.cookies) {
    for (const part of e.cookies.split(';')) {
      const p = part.trim();
      if (p.includes('=')) pairs.push(p);
    }
  } else {
    pairs.push(`auth_token=${e.authToken}`, `ct0=${e.ct0}`);
  }
  const out: string[] = [];
  for (const domain of ['.twitter.com', '.x.com']) for (const p of pairs) out.push(`${p}; Domain=${domain}; Path=/; Secure`);
  return out;
}

// One scraper per process: cookies are set once and the session is reused across
// every account in the sweep. Lazily loaded so the heavy dep never enters other
// scripts' or the Next build's module graph.
let _scraper: Promise<any> | null = null;
function xScraper(): Promise<any> {
  if (!_scraper) {
    _scraper = (async () => {
      const mod: any = await import('@the-convocation/twitter-scraper');
      const Scraper = mod.Scraper ?? mod.default?.Scraper ?? mod.default;
      const s = new Scraper();
      await s.setCookies(cookieStrings());
      return s;
    })();
  }
  return _scraper;
}

export async function fetchTimelineViaCookies(handle: string, count?: number): Promise<TimelineRef[]> {
  const s = await xScraper();
  const out: TimelineRef[] = [];
  for await (const t of s.getTweets(handle, count ?? xEnv().maxTweets) as AsyncIterable<any>) {
    // Match nitter's "Tweets" tab: skip replies. Keep retweets — a shop that RTs
    // a player's result still surfaces a deck, and the timeline id stays monotonic
    // so the poller's cursor is unaffected.
    if (!t?.id || t.isReply) continue;
    out.push({
      id: String(t.id),
      authorHandle: t.username ?? handle,
      text: (t.text ?? '').trim(),
      createdAt: t.timeParsed ?? (t.timestamp ? new Date(t.timestamp * 1000) : new Date(0)),
      url: t.permanentUrl ?? `https://x.com/${t.username ?? handle}/status/${t.id}`,
    });
  }
  return out;
}

/* ------------------------------------------------- discovery (nitter, dead) */

export async function fetchTimeline(handle: string, opts: { sinceId?: string; hosts?: string[] } = {}): Promise<TimelineRef[]> {
  // Priority: official API (paid, keyword-filtered) → logged-in cookie → nitter.
  // The nitter loop is a dead fallback, kept only so the job still runs and
  // health() still reports before a discovery secret is configured.
  if (hasXApi()) return fetchTimelineViaApi(handle, { sinceId: opts.sinceId });
  if (hasXCookies()) return fetchTimelineViaCookies(handle);
  const hosts = opts.hosts ?? NITTER_HOSTS;
  let lastErr = '';
  for (const host of hosts) {
    try {
      const res = await httpsGet(`https://${host}/${handle}/rss`);
      if (res.status === 404) return []; // account gone — not the instance's fault
      if (res.status !== 200) {
        lastErr = `${host} HTTP ${res.status}`;
        continue; // a different instance may be healthy
      }
      const refs = parseRss(res.body, handle);
      if (refs.length > 0) return refs;
      // A 200 with no items means the instance is degraded, not that the account
      // is silent — fall through rather than trust it.
      lastErr = `${host} 빈 피드`;
    } catch (err) {
      lastErr = `${host} ${err instanceof Error ? err.message : err}`;
    }
  }
  throw new Error(`모든 nitter 인스턴스 실패: ${lastErr}`);
}

/**
 * Self-test for endpoints nobody owns and nobody documents. If nitter dies
 * across every instance, this is what surfaces it — instead of the archive
 * quietly going stale.
 */
export async function health(): Promise<{ ok: boolean; detail: string }> {
  // When cookies are configured, THEY are the discovery path — test them, not
  // the dead nitter instances. A 0-item result means the cookie has expired or
  // the account is blocked: the signal that must surface instead of a silent
  // green run committing an unchanged snapshot.
  if (hasXApi()) {
    // A user lookup verifies the Bearer token without depending on any account
    // having a recent tournament post (a keyword search could legitimately be
    // empty). 200 + an id ⇒ auth is good.
    try {
      const j = await xApiGet('/2/users/by/username/mathjong1');
      return j?.data?.id
        ? { ok: true, detail: 'x-api ✅ (Bearer 인증 OK)' }
        : { ok: false, detail: `x-api ✗ 응답 이상: ${JSON.stringify(j).slice(0, 120)}` };
    } catch (e) {
      return { ok: false, detail: `x-api ✗ ${e instanceof Error ? e.message : e} — X_BEARER_TOKEN 확인/크레딧 잔액 확인` };
    }
  }
  if (hasXCookies()) {
    // Try a few active shops — one deleted/quiet account shouldn't read as "cookie
    // dead". OK if ANY returns tweets.
    const probes = ['mathjong1', 'bigmagicakb', 'YS_HIMEJI'];
    const parts: string[] = [];
    let lastErr = '';
    for (const h of probes) {
      try {
        const refs = await fetchTimelineViaCookies(h, 5);
        parts.push(`${h}:${refs.length}`);
        if (refs.length > 0) return { ok: true, detail: `x-cookie ✅ ${parts.join(' ')}` };
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        parts.push(`${h}:✗`);
      }
    }
    return {
      ok: false,
      detail: `x-cookie ✗ ${parts.join(' ')}${lastErr ? ` (${lastErr})` : ''} — 쿠키 만료/계정 차단 의심, 재로그인해 X_AUTH_TOKEN·X_CT0 갱신 필요`,
    };
  }
  const parts: string[] = [];
  let anyOk = false;
  for (const host of NITTER_HOSTS) {
    try {
      const refs = await fetchTimeline('mathjong1', { hosts: [host] });
      if (refs.length > 0) {
        anyOk = true;
        parts.push(`${host}✅${refs.length}`);
      } else parts.push(`${host}∅`);
    } catch {
      parts.push(`${host}✗`);
    }
  }
  return {
    ok: anyOk,
    detail: anyOk ? `nitter: ${parts.join(' ')}` : `모든 nitter 인스턴스 실패: ${parts.join(' ')}`,
  };
}
