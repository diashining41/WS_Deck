/**
 * Ban-list seasons (制限カード改定).
 *
 * Weiß Schwarz resets its metagame with a restricted-card revision roughly twice
 * a year, and every deck's "environment" is decided by which revision was in
 * force on its date. The source spreadsheet's half-year tabs were split on
 * exactly these dates — so a deck's season is a pure function of its date, and
 * no per-deck column is needed. New decks the poller adds fall into the current
 * (top) season automatically until the next revision is announced and appended.
 *
 * Dates are the JP-format application dates, verified against the official
 * ban-list history. `start` is inclusive.
 */
export interface Season {
  key: string; // '2026H2' — stable id for URLs/state
  label: string; // '2026년도 후기'
  short: string; // '26후기' — badge text
  start: string; // 'YYYY-MM-DD', inclusive (the revision's application date)
}

// Newest first — this is also the display order.
export const SEASONS: Season[] = [
  { key: '2026H2', label: '2026년도 후기', short: '26후기', start: '2026-06-27' },
  { key: '2026H1', label: '2026년도 전기', short: '26전기', start: '2026-02-07' },
  { key: '2025H2', label: '2025년도 후기', short: '25후기', start: '2025-06-21' },
  { key: '2025H1', label: '2025년도 전기', short: '25전기', start: '2025-01-25' },
  { key: '2024H2', label: '2024년도 후기', short: '24후기', start: '2024-07-13' },
];

const STARTS = SEASONS.map((s) => ({ ...s, t: new Date(s.start + 'T00:00:00Z').getTime() }));

/** Which season a deck belongs to, from its date. Null if older than our oldest boundary. */
export function seasonOf(date: string | Date): Season | null {
  const t = (typeof date === 'string' ? new Date(date) : date).getTime();
  for (const s of STARTS) if (t >= s.t) return s;
  return null;
}

/** Human range for a season, e.g. "26.06.27 ~ 26.02.07 이전". */
export function seasonRange(key: string): string {
  const i = SEASONS.findIndex((s) => s.key === key);
  if (i < 0) return '';
  const fmt = (d: string) => d.slice(2).replace(/-/g, '.');
  const from = fmt(SEASONS[i]!.start);
  const to = i > 0 ? fmt(SEASONS[i - 1]!.start) : null;
  return to ? `${from} ~ ${to}` : `${from} ~`;
}
