'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { TitleSummary } from '@/lib/queries';
import { SEASONS, seasonRange } from '@/lib/seasons';

/**
 * Home = titles grouped by ban-list season, each season a collapsible panel.
 * A title with decks in three seasons appears in all three, with that season's
 * count — so the home page reads as "what was played each environment". The
 * newest season starts open; searching opens every season that still matches.
 */
export function SeasonHome({ titles }: { titles: TitleSummary[] }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set([SEASONS[0]!.key]));

  const needle = q.trim().toLowerCase();

  const groups = useMemo(() => {
    const matched = needle
      ? titles.filter((t) => t.nameKo.toLowerCase().includes(needle) || t.code.toLowerCase().includes(needle))
      : titles;
    return SEASONS.map((season) => {
      const items = matched
        .map((t) => ({ t, n: t.seasons?.[season.key] ?? 0 }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n || a.t.nameKo.localeCompare(b.t.nameKo));
      const deckTotal = items.reduce((sum, x) => sum + x.n, 0);
      return { season, items, deckTotal };
    });
  }, [titles, needle]);

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="타이틀 검색 (예: 홀로라이브, GBF)"
        className="mb-5 w-full max-w-sm rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
      />

      <div className="space-y-3">
        {groups.map(({ season, items, deckTotal }) => {
          if (items.length === 0) return null;
          // While searching, every matching season is forced open.
          const isOpen = needle ? true : open.has(season.key);
          return (
            <section key={season.key} className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
              <button
                onClick={() => toggle(season.key)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-[var(--panel-2)]"
              >
                <span
                  className={`shrink-0 text-[var(--muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  aria-hidden
                >
                  ▶
                </span>
                <span className="h-4 w-1 shrink-0 rounded-full bg-[var(--accent)]" />
                <span className="text-sm font-semibold">{season.label}</span>
                <span className="text-xs text-[var(--muted)]">{seasonRange(season.key)}</span>
                <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--muted)]">
                  작품 {items.length} · 덱 {deckTotal}
                </span>
              </button>

              {isOpen && (
                <div className="grid grid-cols-2 gap-2 border-t border-[var(--line)] p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {items.map(({ t, n }) => (
                    <Link
                      key={t.id}
                      href={`/titles/${encodeURIComponent(t.code)}?season=${season.key}`}
                      className="group flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-3 transition hover:border-[var(--accent)]"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium group-hover:text-[var(--accent)]">
                          {t.nameKo}
                        </span>
                        <span className="block text-[11px] text-[var(--muted)]">{t.code}</span>
                      </span>
                      <span className="shrink-0 rounded-md bg-[var(--panel)] px-1.5 py-0.5 text-xs tabular-nums text-[var(--muted)]">
                        {n}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {groups.every((g) => g.items.length === 0) && (
          <p className="py-12 text-center text-sm text-[var(--muted)]">검색 결과가 없습니다.</p>
        )}
      </div>
    </>
  );
}
