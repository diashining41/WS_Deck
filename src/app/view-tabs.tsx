import Link from 'next/link';

/**
 * The segmented control that flips between the two sources this site draws from:
 * X 대회 게시글(작품별로 정리) and the official WS 카페 아카이브(날짜별). Labeling
 * by source, not by layout, matches how the data is actually classified and
 * avoids the 타이틀별/날짜별 confusion. It sits at the top of both list pages so
 * switching is one obvious tap, not a stray header link.
 */
const TABS = [
  { href: '/', label: 'X게시글', key: 'titles' },
  { href: '/archive', label: 'WS카페', key: 'archive' },
] as const;

export function ViewTabs({ active }: { active: 'titles' | 'archive' }) {
  return (
    <div className="mb-5 inline-flex rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5 text-sm">
      {TABS.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={`rounded-md px-4 py-1.5 font-medium transition ${
              on
                ? 'bg-[var(--accent)] text-[var(--bg)]'
                : 'text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
