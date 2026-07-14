/**
 * Best-guess metadata for a freshly captured post, from its text alone.
 *
 * Newly polled posts have no human-entered 국가/규모/형식 yet, and those columns
 * are NOT NULL, so capture needs a value. These heuristics fill in a sensible
 * default that the reviewer confirms or corrects in one click — they are a
 * starting point, not a source of truth.
 */
import type { Climax } from '@/db/schema';
import { CLIMAX_ALIASES } from '@/lib/aliases';

export type Region = 'JP' | 'KR' | 'OVERSEAS';
export type Scale = 'SHOP' | 'CS' | 'BUSHIROAD';
export type Format = 'SINGLES' | 'TRIO';

export function guessRegion(text: string): Region {
  if (/[가-힣]/.test(text)) return 'KR';
  // Japanese kana/kanji ⇒ JP; otherwise a Latin-only post is an overseas event.
  if (/[ぁ-んァ-ヶ一-龯]/.test(text)) return 'JP';
  return 'OVERSEAS';
}

export function guessScale(text: string): Scale {
  if (/WGP|BCF|チャンピオンシップ|championship/i.test(text)) return 'BUSHIROAD';
  if (/CS|杯|カップ|championship|regional/i.test(text)) return 'CS';
  return 'SHOP'; // the overwhelming majority — shop 공인대회
}

export function guessFormat(text: string): Format {
  if (/トリオ|チーム戦|trio|team|先鋒|中堅|大将|선봉|중견|대장/i.test(text)) return 'TRIO';
  return 'SINGLES';
}

/** Climaxes readable straight from the post text via the alias table. */
export function climaxesFromText(text: string): Climax[] {
  const found: Climax[] = [];
  const entries = Object.entries(CLIMAX_ALIASES) as [Climax, string[]][];
  // Longest alias first so 電源 wins over 電, 2소울 over 소울.
  const flat = entries
    .flatMap(([climax, aliases]) => aliases.map((alias) => ({ climax, alias })))
    .sort((a, b) => b.alias.length - a.alias.length);
  for (const { climax, alias } of flat) {
    if (found.includes(climax)) continue;
    const re = /^[A-Za-z0-9]+$/.test(alias)
      ? new RegExp(`(?<![A-Za-z0-9])${alias}(?![A-Za-z0-9])`, 'i')
      : null;
    if (re ? re.test(text) : text.includes(alias)) found.push(climax);
    if (found.length >= 4) break;
  }
  return found;
}
