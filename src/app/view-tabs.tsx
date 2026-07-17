import Link from 'next/link';

/**
 * The segmented control that flips between the two ways of reading the same
 * tournaments: by 작품 (home) and by 날짜 (archive). It sits at the top of both
 * list pages so switching is one obvious tap, not a stray header link.
 */
const TABS = [
  { href: '/', label: '타이틀별', key: 'titles' },
  { href: '/archive', label: '날짜별', key: 'archive' },
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
