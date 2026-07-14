import { existsSync, readFileSync } from 'node:fs';

/**
 * Loads .env.local for the standalone scripts.
 *
 * Next.js reads .env.local on its own, but the tsx-run scripts (eval, poll,
 * backfill) do not — so a key that works in the app silently doesn't exist in
 * the CLI, which looks exactly like "the key is wrong".
 */
let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!m?.[1]) continue;
      // Don't override a variable the shell already set.
      if (process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = (m[2] ?? '').trim().replace(/^["']|["']$/g, '');
    }
  }
}
