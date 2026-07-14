/**
 * Where deck images are served from.
 *
 * Image keys are stored path-relative ("/media/thumb/ab/….webp"). In local dev
 * they resolve against /public; in production they resolve against an external
 * bucket (Cloudflare R2), so the 112MB of images never has to live in git or in
 * the Vercel deployment.
 *
 * NEXT_PUBLIC_MEDIA_BASE_URL is inlined at build time — set it in the host's env
 * (e.g. https://pub-xxxx.r2.dev) before building for production. Unset ⇒ local.
 */
const BASE = (process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? '').replace(/\/$/, '');

export function mediaUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return BASE ? `${BASE}${key}` : key;
}
