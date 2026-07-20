/**
 * Apply climax verdicts read by eye (in-conversation Claude vision) to 미상 decks —
 * the free, no-API path. Reversible: only decks.climaxes changes, nothing deleted.
 *
 * CLIMAX="<id8>:금괴 <id8>:문,금괴 <id8>:none" — id prefix (≥8 chars) → types,
 * comma-separated; `none`/`skip` leaves it 미상. Dry run by default; --commit.
 */
import { eq, sql } from 'drizzle-orm';
import { closeDb, db, rows } from '@/db';
import { type Climax, decks } from '@/db/schema';

const COMMIT = process.argv.includes('--commit');
const VALID: Climax[] = ['문', '게이트', '스탠', '초이스', '금괴', '책', '포커스', '2소울', '찬스', '샷', '회오리', '망원경', '보따리'];

const spec = (process.env.CLIMAX ?? '').trim();
if (!spec) {
  console.log('CLIMAX="<id8>:금괴 <id8>:문,금괴 …" 를 지정하세요.');
  await closeDb();
  process.exit(0);
}
const items = spec.split(/\s+/).map((tok) => {
  const [idp, types] = tok.split(':');
  return { idp: idp!, types: (types ?? '').split(',').map((t) => t.trim()).filter((t) => t && t !== 'none' && t !== 'skip') };
});

// resolve id prefixes to full ids
let applied = 0;
for (const it of items) {
  const bad = it.types.filter((t) => !VALID.includes(t as Climax));
  if (bad.length) {
    console.log(`  [무효타입] ${it.idp}: ${bad.join(',')}`);
    continue;
  }
  const found = rows<{ id: string; cur: string; code: string | null }>(
    await db.execute(sql`SELECT d.id::text, d.climaxes::text AS cur, t.code FROM decks d LEFT JOIN titles t ON t.id=d.title_id WHERE d.id::text LIKE ${it.idp + '%'} AND d.status='published'`),
  );
  if (found.length !== 1) {
    console.log(`  [${found.length}건 매치] ${it.idp} — 스킵`);
    continue;
  }
  const d = found[0]!;
  const target = `{${it.types.join(',')}}`;
  console.log(`  ${d.id.slice(0, 8)} ${(d.code ?? '-').padEnd(5)} ${d.cur} → ${target}${it.types.length ? '' : ' (미상 유지)'}`);
  if (COMMIT && it.types.length) {
    await db.update(decks).set({ climaxes: it.types as Climax[] }).where(eq(decks.id, d.id));
    applied++;
  }
}
console.log(COMMIT ? `\n✅ ${applied}건 반영` : '\n(드라이런. --commit 로 반영)');
await closeDb();
