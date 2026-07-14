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

export async function fetchTimeline(handle: string, hosts: string[] = NITTER_HOSTS): Promise<TimelineRef[]> {
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
  const parts: string[] = [];
  let anyOk = false;
  for (const host of NITTER_HOSTS) {
    try {
      const refs = await fetchTimeline('mathjong1', [host]);
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
