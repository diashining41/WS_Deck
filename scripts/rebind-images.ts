/**
 * Vision re-binding for multi-title shared posts.
 *
 * A tournament tweet carries several players' decks and several photos. At ingest
 * we bind them by ORDER OF APPEARANCE (deck.media_index i → image at slot i) — a
 * guess, flagged image_verified=false. When the poster's photo order differs from
 * the text order, a title page shows ANOTHER work's art (an 어설트 릴리 photo on a
 * 니케 page). Code can't tell which photo is which work; vision can — the candidate
 * set is small (the post's own deck titles), so it's a photo→named-title match.
 *
 * The fix is per-image, mirroring the human review action: set decks.image_id to
 * the RIGHT photo and image_verified=true, leaving media_index (nothing renders
 * from it — display reads image_id, per the schema note "never render images[0]").
 *
 *   MODE=list  [LIMIT=40]                 → prioritized queue (popular titles first)
 *   MODE=sheet POST=<id8|uuid>           → one labeled montage + candidate decks
 *   MODE=sheet POSTS=id8,id8,…           → a montage per post
 *   MODE=sheet OFFSET=0 LIMIT=8          → next N from the queue
 *   MODE=apply POST=<id8> MAP="ALL:2 AZL:1 SBY:0 GIM:3"   (--commit to write)
 *        MAP key = title code (if unique in the post) OR a deck-id prefix.
 *        MAP val = the image media_index that is REALLY this deck's photo.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { closeDb, db, rows } from '@/db';

const MODE = process.env.MODE ?? 'list';
const COMMIT = process.argv.includes('--commit');
const LIMIT = Number(process.env.LIMIT ?? 40);
const OFFSET = Number(process.env.OFFSET ?? 0);
const OUT = resolve('.data/review');
const CACHE = join(OUT, 'orig');
mkdirSync(CACHE, { recursive: true });

type Need = {
  post_id: string; source: string; url: string;
  ndeck: number; ntitle: number; nimg: number; pop: number;
};

/** Multi-title posts with images and at least one unverified binding, popular titles first. */
async function needList(): Promise<Need[]> {
  return rows<Need>(
    await db.execute(sql`
      WITH pub AS (
        SELECT d.id, d.post_id, d.title_id, d.image_verified
        FROM decks d JOIN titles t ON t.id = d.title_id
        WHERE d.status = 'published' AND t.game = 'WS'
      ),
      pa AS (
        SELECT pub.post_id,
               count(*)::int                       AS ndeck,
               count(DISTINCT pub.title_id)::int    AS ntitle,
               bool_or(NOT pub.image_verified)      AS has_unverified,
               max(t.deck_count)::int               AS pop
        FROM pub JOIN titles t ON t.id = pub.title_id
        GROUP BY pub.post_id
      )
      SELECT pa.post_id::text AS post_id, p.source, p.url_original AS url,
             pa.ndeck, pa.ntitle, pa.pop,
             (SELECT count(*)::int FROM images i WHERE i.post_id = pa.post_id) AS nimg
      FROM pa JOIN posts p ON p.id = pa.post_id
      WHERE pa.ntitle > 1 AND pa.has_unverified
        AND (SELECT count(*) FROM images i WHERE i.post_id = pa.post_id) > 0
      ORDER BY pa.pop DESC, pa.ndeck DESC, p.posted_at DESC`),
  );
}

async function resolvePost(key: string): Promise<string | null> {
  const r = rows<{ id: string }>(
    await db.execute(sql`SELECT id::text AS id FROM posts WHERE id::text LIKE ${key + '%'} LIMIT 2`),
  );
  if (r.length !== 1) return null;
  return r[0]!.id;
}

type Img = { id: string; mi: number; url: string; w: number | null; h: number | null };
type Dck = { id: string; mi: number; code: string; ko: string; cur_mi: number | null; ver: boolean };

async function postImages(postId: string): Promise<Img[]> {
  return rows<Img>(
    await db.execute(sql`SELECT id::text AS id, media_index AS mi, origin_url AS url, width AS w, height AS h
      FROM images WHERE post_id = ${postId} ORDER BY media_index`),
  );
}
async function postDecks(postId: string): Promise<Dck[]> {
  return rows<Dck>(
    await db.execute(sql`
      SELECT d.id::text AS id, d.media_index AS mi, t.code, t.name_ko AS ko,
             i.media_index AS cur_mi, d.image_verified AS ver
      FROM decks d JOIN titles t ON t.id = d.title_id
      LEFT JOIN images i ON i.id = d.image_id
      WHERE d.post_id = ${postId} AND d.status = 'published'
      ORDER BY d.media_index`),
  );
}

async function grab(url: string): Promise<Buffer | null> {
  const f = join(CACHE, createHash('md5').update(url).digest('hex') + '.img');
  if (existsSync(f)) return readFileSync(f);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const b = Buffer.from(await res.arrayBuffer());
    writeFileSync(f, b);
    return b;
  } catch {
    return null;
  }
}

/** Labeled montage: one cell per image, banner = "img.mi=K", so vision maps photo→title. */
async function sheet(postId: string): Promise<void> {
  const imgs = await postImages(postId);
  const decks = await postDecks(postId);
  const id8 = postId.slice(0, 8);
  const cols = Math.min(imgs.length, 2) || 1;
  const CW = 900, CH = 560;
  const cells: sharp.OverlayOptions[] = [];
  for (let i = 0; i < imgs.length; i++) {
    const im = imgs[i]!;
    const raw = await grab(im.url);
    const body = raw
      ? await sharp(raw).resize({ width: CW, height: CH - 32, fit: 'contain', background: '#222' }).png().toBuffer()
      : await sharp({ create: { width: CW, height: CH - 32, channels: 3, background: '#500' } }).png().toBuffer();
    const banner = Buffer.from(
      `<svg width="${CW}" height="32"><rect width="100%" height="100%" fill="#111"/><text x="8" y="23" font-size="20" fill="#0f0" font-family="monospace">img.mi=${im.mi}${raw ? '' : '  (다운로드 실패)'}</text></svg>`,
    );
    const cell = await sharp({ create: { width: CW, height: CH, channels: 3, background: '#000' } })
      .composite([{ input: banner, top: 0, left: 0 }, { input: body, top: 32, left: 0 }]).png().toBuffer();
    cells.push({ input: cell, top: Math.floor(i / cols) * CH, left: (i % cols) * CW });
  }
  const montage = await sharp({
    create: { width: cols * CW, height: Math.ceil(imgs.length / cols) * CH, channels: 3, background: '#000' },
  }).composite(cells).png().toBuffer();
  const path = join(OUT, `_rebind_${id8}.png`);
  writeFileSync(path, montage);

  console.log(`\n════ ${id8} · 이미지 ${imgs.length}장 · → ${path}`);
  console.log(`  후보 덱(현재 추측 바인딩):`);
  for (const d of decks)
    console.log(`    [${d.code}] ${d.ko}  ·  현재 img.mi=${d.cur_mi ?? '∅'}  (deck ${d.id.slice(0, 8)}, ver=${d.ver})`);
  console.log(`  판독 후: MODE=apply POST=${id8} MAP="${decks.map((d) => `${d.code}:?`).join(' ')}" --commit`);
}

/** MAP="CODE:mi ..." → set each named deck's image to the image at that media_index. */
async function apply(postId: string, mapStr: string): Promise<void> {
  const imgs = await postImages(postId);
  const decks = await postDecks(postId);
  const byMi = new Map(imgs.map((im) => [im.mi, im]));
  const codeCount = new Map<string, number>();
  for (const d of decks) codeCount.set(d.code, (codeCount.get(d.code) ?? 0) + 1);

  const tokens = mapStr.trim().split(/\s+/).filter(Boolean);
  const plan: { deck: Dck; img: Img }[] = [];
  for (const tk of tokens) {
    const m = tk.match(/^(.+?)[:=](\d+)$/);
    if (!m) { console.log(`  ⚠ 토큰 형식 오류: "${tk}" (CODE:mi)`); continue; }
    const key = m[1]!, mi = Number(m[2]);
    const img = byMi.get(mi);
    if (!img) { console.log(`  ⚠ img.mi=${mi} 없음 (${key})`); continue; }
    // key = title code (unique in post) OR deck-id prefix
    let deck: Dck | undefined;
    if (codeCount.get(key) === 1) deck = decks.find((d) => d.code === key);
    else deck = decks.find((d) => d.id.startsWith(key));
    if (!deck) {
      console.log(`  ⚠ 덱 못 찾음: "${key}" (코드 중복 시 deckId 접두어로 지정)`);
      continue;
    }
    plan.push({ deck, img });
  }

  console.log(`\n── ${postId.slice(0, 8)} 재바인딩 계획 ──`);
  for (const { deck, img } of plan)
    console.log(`  [${deck.code}] ${deck.ko}  img.mi ${deck.cur_mi ?? '∅'} → ${img.mi} (${img.id.slice(0, 8)})`);
  const dupImg = plan.map((p) => p.img.mi).filter((mi, i, a) => a.indexOf(mi) !== i);
  if (dupImg.length) console.log(`  ⚠ 같은 이미지에 2덱 배정됨: img.mi=${[...new Set(dupImg)].join(',')} (순열 확인!)`);

  if (!COMMIT) { console.log(`\n(드라이런. 반영하려면 --commit)`); return; }
  for (const { deck, img } of plan)
    await db.execute(sql`UPDATE decks SET image_id=${img.id}, image_verified=true WHERE id=${deck.id}`);
  console.log(`\n✅ ${plan.length}덱 재바인딩(확정) 완료`);
}

// ────────────────────────────────────────────────────────────── dispatch
if (MODE === 'list') {
  const q = await needList();
  console.log(`재바인딩 대기 게시글 ${q.length}건 (인기 타이틀 우선)\n`);
  for (const r of q.slice(OFFSET, OFFSET + LIMIT)) {
    const decks = await postDecks(r.post_id);
    console.log(
      `${r.post_id.slice(0, 8)}  pop${String(r.pop).padStart(3)}  덱${r.ndeck}/사진${r.nimg}  [${decks.map((d) => d.code).join(',')}]  ${r.source}  ${r.url}`,
    );
  }
} else if (MODE === 'sheet') {
  let ids: string[] = [];
  if (process.env.POST) {
    const p = await resolvePost(process.env.POST);
    if (!p) { console.log('게시글 못 찾음/모호'); await closeDb(); process.exit(1); }
    ids = [p];
  } else if (process.env.POSTS) {
    for (const k of process.env.POSTS.split(',').map((s) => s.trim()).filter(Boolean)) {
      const p = await resolvePost(k);
      if (p) ids.push(p); else console.log(`(${k} 못 찾음/모호)`);
    }
  } else {
    const q = await needList();
    ids = q.slice(OFFSET, OFFSET + LIMIT).map((r) => r.post_id);
  }
  for (const id of ids) await sheet(id);
} else if (MODE === 'zoom') {
  // Full-res single-image view(s) to settle an ambiguous work (ALL vs GIM 등).
  const p = process.env.POST ? await resolvePost(process.env.POST) : null;
  if (!p) { console.log('POST 필요/모호'); await closeDb(); process.exit(1); }
  const imgs = await postImages(p);
  const want = (process.env.MIS ?? '').split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
  const W = Number(process.env.W ?? 1500);
  for (const im of imgs) {
    if (want.length && !want.includes(im.mi)) continue;
    const raw = await grab(im.url);
    if (!raw) { console.log(`  img.mi=${im.mi} 다운로드 실패`); continue; }
    const path = join(OUT, `_zoom_${p.slice(0, 8)}_mi${im.mi}.png`);
    await sharp(raw).resize({ width: W }).png().toFile(path);
    console.log(`  → ${path}`);
  }
} else if (MODE === 'apply') {
  const p = process.env.POST ? await resolvePost(process.env.POST) : null;
  if (!p) { console.log('POST 지정 필요/모호'); await closeDb(); process.exit(1); }
  await apply(p, process.env.MAP ?? '');
} else {
  console.log(`알 수 없는 MODE=${MODE}`);
}

await closeDb();
