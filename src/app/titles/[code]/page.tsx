import Link from 'next/link';
import { notFound } from 'next/navigation';

import { allTitles, decksForCode, titleByCode } from '@/lib/static-data';

import { DeckList } from './deck-list';

// One static page per title, prerendered at build from the committed snapshot.
export function generateStaticParams() {
  return allTitles().map((t) => ({ code: t.code }));
}

export default async function TitlePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const title = titleByCode(decodeURIComponent(code));
  if (!title) notFound();

  const decks = decksForCode(title.code);

  return (
    <div>
      <Link href="/" className="text-xs text-[var(--muted)] hover:text-[var(--accent)]">
        ← 타이틀 목록
      </Link>

      <div className="mb-6 mt-3 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold">{title.nameKo}</h1>
        <span className="rounded-md bg-[var(--panel-2)] px-2 py-0.5 text-xs text-[var(--muted)]">
          {title.code}
        </span>
        <span className="text-sm text-[var(--muted)]">덱 {decks.length}개 · 최신 등록순</span>
      </div>

      <DeckList decks={decks} />
    </div>
  );
}
