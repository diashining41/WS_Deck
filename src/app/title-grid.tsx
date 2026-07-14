'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { TitleSummary } from '@/lib/queries';

export function TitleGrid({ titles }: { titles: TitleSummary[] }) {
  const [q, setQ] = useState('');

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return titles;
    return titles.filter(
      (t) => t.nameKo.toLowerCase().includes(needle) || t.code.toLowerCase().includes(needle),
    );
  }, [titles, q]);

  return (
    <>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="타이틀 검색 (예: 홀로라이브, GBF)"
        className="mb-5 w-full max-w-sm rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {shown.map((t) => (
          <Link
            key={t.id}
            href={`/titles/${encodeURIComponent(t.code)}`}
            className="group flex items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-3 transition hover:border-[var(--accent)] hover:bg-[var(--panel-2)]"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium group-hover:text-[var(--accent)]">
                {t.nameKo}
              </span>
              <span className="block text-[11px] text-[var(--muted)]">{t.code}</span>
            </span>
            <span className="shrink-0 rounded-md bg-[var(--panel-2)] px-1.5 py-0.5 text-xs tabular-nums text-[var(--muted)]">
              {t.deckCount}
            </span>
          </Link>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="py-12 text-center text-sm text-[var(--muted)]">검색 결과가 없습니다.</p>
      )}
    </>
  );
}
