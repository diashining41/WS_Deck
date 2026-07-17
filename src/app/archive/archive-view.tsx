'use client';

import { useMemo, useState } from 'react';

import type { CafeArchiveItem } from '@/lib/queries';

/**
 * The dated cafe archive, folded into a calendar. The flat feed is ~2,000 links
 * spanning 2020→now — far too long to scroll. So we group by year/month and
 * render each month as a collapsible panel (mirroring the season accordion on
 * the home page): the page opens as a short list of month headers, newest open.
 * A year filter and a numeric year/month search jump straight to a period.
 */

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()] ?? '';
  return `${y}년 ${m}월 ${d}일 (${wd})`;
}

interface MonthGroup {
  key: string; // YYYY-MM
  year: string;
  label: string; // "2026년 7월"
  count: number;
  tokens: string[]; // digit forms for search, e.g. ['2026', '202607', '20267']
  days: { date: string; items: CafeArchiveItem[] }[];
}

export function ArchiveView({ items }: { items: CafeArchiveItem[] }) {
  // items arrive newest-first; a Map preserves that order for months and days.
  const months = useMemo<MonthGroup[]>(() => {
    const order: string[] = [];
    const byMonth = new Map<string, CafeArchiveItem[]>();
    for (const it of items) {
      const mk = it.date.slice(0, 7);
      let arr = byMonth.get(mk);
      if (!arr) {
        arr = [];
        byMonth.set(mk, arr);
        order.push(mk);
      }
      arr.push(it);
    }
    return order.map((mk) => {
      const list = byMonth.get(mk)!;
      const [y, m] = mk.split('-') as [string, string];
      const days: MonthGroup['days'] = [];
      for (const it of list) {
        let d = days[days.length - 1];
        if (!d || d.date !== it.date) {
          d = { date: it.date, items: [] };
          days.push(d);
        }
        d.items.push(it);
      }
      return {
        key: mk,
        year: y,
        label: `${Number(y)}년 ${Number(m)}월`,
        count: list.length,
        tokens: [y, `${y}${m}`, `${y}${Number(m)}`],
        days,
      };
    });
  }, [items]);

  const years = useMemo(() => [...new Set(months.map((g) => g.year))], [months]);

  const [year, setYear] = useState<string>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set(months[0] ? [months[0].key] : []));

  const qDigits = q.replace(/\D/g, '');

  const visible = useMemo(
    () =>
      months.filter((g) => {
        if (year !== 'all' && g.year !== year) return false;
        if (qDigits && !g.tokens.some((t) => t.includes(qDigits))) return false;
        return true;
      }),
    [months, year, qDigits],
  );

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          inputMode="numeric"
          placeholder="년/월 검색 (예: 2026-07)"
          className="w-44 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
        />
        <div className="flex flex-wrap gap-1">
          <YearChip label="전체" on={year === 'all'} onClick={() => setYear('all')} />
          {years.map((y) => (
            <YearChip key={y} label={y} on={year === y} onClick={() => setYear(year === y ? 'all' : y)} />
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted)]">해당하는 대회 결과가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((g, i) => {
            // While searching, every matching month is forced open.
            const isOpen = qDigits ? true : open.has(g.key);
            const showYear = i === 0 || visible[i - 1]!.year !== g.year;
            return (
              <div key={g.key}>
                {showYear && (
                  <div className="mb-1 mt-5 flex items-center gap-2 first:mt-0">
                    <span className="text-sm font-bold text-[var(--accent)]">{g.year}</span>
                    <span className="h-px flex-1 bg-[var(--line)]" />
                  </div>
                )}
                <section className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
                  <button
                    onClick={() => toggle(g.key)}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-[var(--panel-2)]"
                  >
                    <span
                      className={`shrink-0 text-[var(--muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      aria-hidden
                    >
                      ▶
                    </span>
                    <span className="text-sm font-semibold">{g.label}</span>
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--muted)]">
                      {g.count}건
                    </span>
                  </button>

                  {isOpen && (
                    <div className="space-y-3 border-t border-[var(--line)] p-3">
                      {g.days.map((day) => (
                        <div key={day.date}>
                          <h3 className="mb-1 px-1 text-xs font-medium text-[var(--muted)]">
                            {prettyDate(day.date)}
                          </h3>
                          <ul className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--panel-2)]">
                            {day.items.map((it) => (
                              <li key={it.articleId}>
                                <a
                                  href={it.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[var(--panel)]"
                                >
                                  <span className="flex-1 truncate text-[var(--text)]">{it.subject}</span>
                                  <span className="shrink-0 text-xs text-[var(--muted)]">카페 원문 ↗</span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function YearChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        on
          ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--bg)]'
          : 'border-[var(--line)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)]'
      }`}
    >
      {label}
    </button>
  );
}
