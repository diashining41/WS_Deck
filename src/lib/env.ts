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
    // A Windows editor (PowerShell Set-Content, Notepad) does two things that
    // silently break parsing: it prepends a UTF-8 BOM (﻿, not \s, so it glues to
    // the first key) and it writes CRLF line endings. Splitting on \n alone
    // leaves a trailing \r on every line, and the value regex's `$` then fails to
    // match — so DATABASE_URL never loads, the driver falls back to the local
    // PGlite DB, and every script quietly runs against the wrong data. Strip both.
    for (const line of readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
      if (!m?.[1]) continue;
      // Don't override a variable the shell already set.
      if (process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = (m[2] ?? '').trim().replace(/^["']|["']$/g, '');
    }
  }
}
