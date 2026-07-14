import type { DeckCard, TitleSummary } from '@/lib/queries';

/**
 * The public site's data source.
 *
 * Pages read this committed snapshot, not the database — so the deployed site is
 * pure static files with no DB and no secrets. Regenerate with
 * `npm run export:static` after ingesting. The DB-backed queries in queries.ts
 * still power local dev and the admin review UI.
 */
interface Snapshot {
  generatedAt: string;
  stats: { decks: number; posts: number; titles: number; images: number };
  titles: TitleSummary[];
  byTitle: Record<string, DeckCard[]>;
}

// Static import so it's baked into the build and there's no runtime file read.
import snapshot from '@/generated/data.json';

const data = snapshot as unknown as Snapshot;

export function allTitles(): TitleSummary[] {
  return data.titles;
}

export function titleByCode(code: string): TitleSummary | null {
  return data.titles.find((t) => t.code === code) ?? null;
}

export function decksForCode(code: string): DeckCard[] {
  return data.byTitle[code] ?? [];
}

export function stats() {
  return data.stats;
}

export function generatedAt(): string {
  return data.generatedAt;
}
