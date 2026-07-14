import { allTitles, stats as getStats } from '@/lib/static-data';

import { TitleGrid } from './title-grid';

// Reads the committed snapshot, so this prerenders to a static page at build.
export default function HomePage() {
  const titles = allTitles();
  const stats = getStats();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">타이틀별 대회 덱 레시피</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          덱 <strong className="text-[var(--text)]">{stats.decks}</strong>개 · 게시물{' '}
          <strong className="text-[var(--text)]">{stats.posts}</strong>개 · 타이틀{' '}
          <strong className="text-[var(--text)]">{stats.titles}</strong>종 · 미리보기 확보{' '}
          <strong className="text-[var(--text)]">{stats.images}</strong>개
        </p>
      </div>

      <TitleGrid titles={titles} />
    </div>
  );
}
