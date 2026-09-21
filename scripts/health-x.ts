/**
 * Discovery health check — fails LOUDLY when tweet discovery is dead.
 *
 * The whole point: for ~6 weeks the daily job stayed green while ingesting zero
 * new decks, because nitter died and poll-x swallows per-account errors. This
 * probes the live discovery path (official API when a Bearer token is set, else
 * cookie session, else the dead nitter fallback) and exits non-zero if it can't
 * reach X — so the failure shows up as a red run / preflight instead of a silent
 * stale snapshot.
 *
 * Run it locally right after setting X_BEARER_TOKEN (or X_AUTH_TOKEN / X_CT0) to
 * confirm the credential works, before the real poll.
 */
import { loadEnv } from '@/lib/env';

loadEnv(); // must run BEFORE x.ts reads the token/cookies — x reads env lazily, so this is enough

const { hasXApi, hasXCookies, health } = await import('@/lib/x');

const r = await health();
console.log(`discovery health: ${r.ok ? 'OK' : 'DOWN'} — ${r.detail}`);
if (!hasXApi() && !hasXCookies()) {
  console.log('※ 수집 자격증명 미설정(X_BEARER_TOKEN, 또는 X_AUTH_TOKEN·X_CT0/X_COOKIES) — nitter 폴백은 전멸 상태라 수집 불가.');
}
if (!r.ok) console.log('::error::X 수집(discovery)이 죽어 있습니다. 새 덱이 들어오지 않습니다.');
// Set the code and let the event loop drain instead of a hard process.exit():
// fetch (undici) leaves a socket closing, and exiting mid-close trips a libuv
// assertion on Windows. A short timer lets it settle, then we exit cleanly.
process.exitCode = r.ok ? 0 : 1;
setTimeout(() => process.exit(process.exitCode ?? 0), 200);
