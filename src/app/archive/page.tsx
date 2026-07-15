import Link from 'next/link';

import { cafeArchive } from '@/lib/static-data';

// Prerendered at build from the committed snapshot — pure static, no DB.
export const metadata = {
  title: '날짜별 대회 결과 · 바이스슈발츠',
  description: '바이스슈발츠 공식 네이버 카페의 공인 대회 결과를 날짜순으로 모은 링크 아카이브입니다.',
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const wd = WEEKDAYS[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()] ?? '';
  return `${y}년 ${m}월 ${d}일 (${wd})`;
}

export default function ArchivePage() {
  const items = cafeArchive();

  // Flat list is already newest-first; fold into date groups preserving order.
  const groups: { date: string; items: typeof items }[] = [];
  for (const it of items) {
    let g = groups[groups.length - 1];
    if (!g || g.date !== it.date) {
      g = { date: it.date, items: [] };
      groups.push(g);
    }
    g.items.push(it);
  }

  return (
    <div>
      <Link href="/" className="text-xs text-[var(--muted)] hover:text-[var(--accent)]">
        ← 타이틀 목록
      </Link>

      <div className="mb-2 mt-3">
        <h1 className="text-2xl font-bold">날짜별 대회 결과</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          공식 네이버 카페 <span className="text-[var(--text)]">대회 결과 게시판</span>의 공인 대회 글{' '}
          <strong className="text-[var(--text)]">{items.length}</strong>건 · 최신순. 각 항목은 카페 원문으로
          연결됩니다.
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="mt-10 text-center text-sm text-[var(--muted)]">아직 수집된 대회 결과가 없습니다.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {groups.map((g) => (
            <section key={g.date}>
              <h2 className="sticky top-16 z-10 mb-2 inline-block rounded-md bg-[var(--panel-2)] px-2 py-1 text-xs font-semibold text-[var(--muted)]">
                {prettyDate(g.date)} · {g.items.length}건
              </h2>
              <ul className="divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
                {g.items.map((it) => (
                  <li key={it.articleId}>
                    <a
                      href={it.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[var(--panel-2)]"
                    >
                      <span className="flex-1 truncate text-[var(--text)]">{it.subject}</span>
                      <span className="shrink-0 text-xs text-[var(--muted)]">카페 원문 ↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
