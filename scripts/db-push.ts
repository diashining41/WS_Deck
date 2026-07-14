import { mkdirSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

const dir = process.env.PGLITE_DIR ?? './.data/pg';

mkdirSync(dir, { recursive: true });
const client = new PGlite(dir);
const db = drizzle(client);

await migrate(db, { migrationsFolder: './drizzle' });
console.log(`schema applied to ${dir}`);
await client.close();
