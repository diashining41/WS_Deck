import { mkdirSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { loadEnv } from '@/lib/env';

import * as schema from './schema';

// Pull DATABASE_URL from .env.local before deciding PGlite vs Neon, so every
// script picks up the cloud DB without needing it exported in the shell.
loadEnv();

/**
 * Local dev runs on PGlite — real Postgres compiled to WASM, so enum arrays,
 * GIN indexes and partial indexes behave exactly as they will on Neon. Set
 * DATABASE_URL to point at a server instead; nothing else changes.
 */
const DATA_DIR = process.env.PGLITE_DIR ?? './.data/pg';

type Db = ReturnType<typeof drizzlePglite<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __wsDeckDb?: Db;
  __wsDeckPglite?: PGlite;
  __wsDeckPg?: ReturnType<typeof postgres>;
};

function create(): Db {
  const url = process.env.DATABASE_URL;
  if (url) {
    // Neon (and any hosted Postgres). The two drivers expose the same query
    // builder; only the shape of the raw-SQL result differs, which `rows()`
    // below normalises. Keep the client so closeDb() can end it — otherwise a
    // script's open pool keeps the CI process alive forever.
    const client = globalForDb.__wsDeckPg ?? postgres(url, { max: 5 });
    globalForDb.__wsDeckPg = client;
    return drizzlePostgres(client, { schema }) as unknown as Db;
  }
  mkdirSync(DATA_DIR, { recursive: true });
  const client = globalForDb.__wsDeckPglite ?? new PGlite(DATA_DIR);
  globalForDb.__wsDeckPglite = client;
  return drizzlePglite(client, { schema });
}

export const db: Db = globalForDb.__wsDeckDb ?? create();
globalForDb.__wsDeckDb = db;

/**
 * `db.execute()` hands back `{ rows: [...] }` on PGlite but a bare array on
 * postgres-js. Reading `.rows` directly works locally and silently yields
 * undefined against Neon, so every raw query goes through here.
 */
export function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const r = (result as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as T[]) : [];
}

/**
 * Scripts must close the database before exiting. Calling process.exit() with
 * PGlite's WASM handles still open trips a libuv assertion on Windows and the
 * process dies with a nonzero code even though the work succeeded — which would
 * read as a failed run to whatever cron is watching.
 */
export async function closeDb(): Promise<void> {
  await globalForDb.__wsDeckPglite?.close();
  await globalForDb.__wsDeckPg?.end();
  globalForDb.__wsDeckPglite = undefined;
  globalForDb.__wsDeckPg = undefined;
  globalForDb.__wsDeckDb = undefined;
}

export { schema };
