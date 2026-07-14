import type { Config } from 'drizzle-kit';

// `drizzle-kit push` targets DATABASE_URL when set (Neon), so the same command
// that stamps local PGlite also stamps the cloud DB.
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
} satisfies Config;
