/**
 * Per-title climax-card catalog from Encore Decks' card API — the resolution-
 * independent source of truth for "which climax is which type".
 *
 * Encore Decks exposes a full card object at /api/card?cardcode=<code> including
 * `cardtype` (CH/EV/CX) and `trigger` (the climax's trigger icons). WS card codes
 * run sequentially per set (`<set>/S<release>-NNN`), so we enumerate codes, keep
 * the CX cards, and record {cardcode, trigger, name, image}. Their `set` code is
 * the same short code we use (GBF, LHS, ALL…), so the catalog maps straight onto
 * our titles. A new deck's climax is then identified by matching its CX card art
 * against this small per-title set — never by reading a 10px trigger icon.
 *
 * ENV: NAME="Granblue" (serieslist name filter) · MAX(140) codes/set · OUT path
 * Writes .data/climax-catalog.json (append/merge by set).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const NAME = (process.env.NAME ?? 'Granblue').toLowerCase();
const MAX = Number(process.env.MAX ?? 140);
const OUTP = resolve(process.env.OUT ?? '.data/climax-catalog.json');

// Encore Decks trigger icon → our Korean climax type. The trigger field is the
// authoritative climax type; SOUL is the always-present soul trigger, so the
// climax's "kind" is the non-SOUL trigger (double-SOUL alone ⇒ 2소울/魂).
const TRIG2CX: Record<string, string> = {
  TREASURE: '금괴', // 宝 Bar
  GATE: '게이트', // 門 Pants
  COMEBACK: '문', // 扉 Door / return
  CHOICE: '초이스', // 택/枝
  DRAW: '책', // 本 Book
  BOOK: '책',
  STANDBY: '스탠', // 電源
  SHOT: '샷',
  RETURN: '회오리',
  POOL: '보따리',
  STOCK: '보따리',
  FOCUS: '포커스',
  CHANCE: '찬스',
  BOUNCE: '문',
};
function typeOf(trigger: string[]): string | null {
  const nonSoul = trigger.filter((t) => t !== 'SOUL');
  for (const t of nonSoul) if (TRIG2CX[t]) return TRIG2CX[t];
  if (trigger.filter((t) => t === 'SOUL').length >= 2) return '2소울';
  return null;
}

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

type Series = { set: string; side: string; release: string; name: string; lang: string; game: string };
const series: Series[] = (await getJson('https://www.encoredecks.com/api/serieslist/')) ?? [];
const wanted = series.filter((s) => s.game === 'WS' && (s.name ?? '').toLowerCase().includes(NAME));
// unique (set, release) pairs
const pairs = [...new Map(wanted.map((s) => [`${s.set}/${s.release}`, s])).values()];
console.log(`serieslist에서 "${NAME}" 매치: ${wanted.length}엔트리 · (set,release) ${pairs.length}쌍`);
for (const p of pairs) console.log(`  ${p.set}/S${p.release}  «${p.name}» ${p.lang}`);

type CxCard = { cardcode: string; set: string; trigger: string[]; type: string | null; name: string; imagepath: string; side: string; level: number };
const found: CxCard[] = [];
const triggerVocab = new Map<string, number>();

async function fetchCard(cardcode: string): Promise<any> {
  return getJson('https://www.encoredecks.com/api/card?cardcode=' + encodeURIComponent(cardcode));
}

for (const p of pairs) {
  let miss = 0;
  for (let n = 1; n <= MAX && miss < 12; n++) {
    const num = String(n).padStart(3, '0');
    const cardcode = `${p.set}/S${p.release}-${num}`;
    const c = await fetchCard(cardcode);
    if (!c || !c.cardtype) {
      miss++;
      continue;
    }
    miss = 0;
    if (c.cardtype === 'CX') {
      const trig: string[] = Array.isArray(c.trigger) ? c.trigger : [];
      const type = typeOf(trig);
      found.push({ cardcode, set: c.set, trigger: trig, type, name: c.locale?.EN?.name ?? c.locale?.NP?.name ?? '', imagepath: c.imagepath, side: c.side, level: c.level });
      for (const t of trig) triggerVocab.set(t, (triggerVocab.get(t) ?? 0) + 1);
      console.log(`  CX ${cardcode}  ${(type ?? '?').padEnd(5)} trigger=${JSON.stringify(trig)}  «${(c.locale?.EN?.name ?? '').slice(0, 22)}»`);
    }
  }
}

console.log(`\n클라이맥스 카드 ${found.length}장`);
console.log('trigger 어휘:', [...triggerVocab.entries()].map(([t, n]) => `${t}:${n}`).join(' · '));

mkdirSync(resolve('.data'), { recursive: true });
const prev: Record<string, CxCard[]> = existsSync(OUTP) ? JSON.parse(readFileSync(OUTP, 'utf8')) : {};
for (const c of found) (prev[c.set] ??= []).push(c);
// dedupe by cardcode within set
for (const set of Object.keys(prev)) prev[set] = [...new Map(prev[set]!.map((c) => [c.cardcode, c])).values()];
writeFileSync(OUTP, JSON.stringify(prev, null, 1));
console.log(`→ ${OUTP} (set별 저장)`);
