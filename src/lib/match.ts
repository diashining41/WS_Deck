import type { Climax } from '@/db/schema';

/**
 * Text matching for aliases, shared by the coverage report, the AI prompt and
 * the confidence scorer so all three agree on what "the post names the title"
 * means.
 */

export interface AliasRow<T> {
  key: T;
  alias: string;
}

/**
 * Korean posts write the master code straight out ("全勝 - GBF, BRD, GIM"), so a
 * code is a useful alias — but only when it can't be mistaken for an ordinary
 * word. Two-letter codes collide with everything (CS is also the tournament
 * class), and these three are English words in their own right.
 */
const CODE_DENYLIST = new Set(['ALL', 'KEY', 'CS']);

export function codeIsUsableAsAlias(code: string): boolean {
  return code.length >= 3 && !CODE_DENYLIST.has(code) && /^[A-Za-z0-9]+$/.test(code);
}

/** Latin aliases need word boundaries; CJK ones must not have them (no spaces). */
function makeMatcher(alias: string): (haystack: string) => boolean {
  if (/^[A-Za-z0-9]+$/.test(alias)) {
    const re = new RegExp(`(?<![A-Za-z0-9])${alias}(?![A-Za-z0-9])`, 'i');
    return (h) => re.test(h);
  }
  const lower = alias.toLowerCase();
  return (h) => h.toLowerCase().includes(lower);
}

export class AliasMatcher<T> {
  private readonly entries: { key: T; alias: string; test: (h: string) => boolean }[];

  constructor(rows: AliasRow<T>[]) {
    // Longest first so 東方project beats 東方, 電源 beats 電, 2소울 beats 소울.
    this.entries = rows
      .slice()
      .sort((a, b) => b.alias.length - a.alias.length)
      .map((r) => ({ ...r, test: makeMatcher(r.alias) }));
  }

  /** Every distinct key whose alias appears in the text, best (longest) alias first. */
  findAll(text: string): { key: T; alias: string }[] {
    const seen = new Set<T>();
    const out: { key: T; alias: string }[] = [];
    for (const e of this.entries) {
      if (seen.has(e.key)) continue;
      if (e.test(text)) {
        seen.add(e.key);
        out.push({ key: e.key, alias: e.alias });
      }
    }
    return out;
  }

  has(text: string, key: T): boolean {
    return this.entries.some((e) => e.key === key && e.test(text));
  }
}

export type ClimaxMatcher = AliasMatcher<Climax>;
export type TitleMatcher = AliasMatcher<number>;
