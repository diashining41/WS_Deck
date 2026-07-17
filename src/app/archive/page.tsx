import { cafeArchive } from '@/lib/static-data';

import { ViewTabs } from '../view-tabs';
import { ArchiveView } from './archive-view';

// Prerendered at build from the committed snapshot — pure static, no DB.
export const metadata = {
  title: '날짜별 대회 결과 · 바이스슈발츠',
  description: '바이스슈발츠 공식 네이버 카페의 공인 대회 결과를 년·월별로 모은 링크 아카이브입니다.',
};

export default function ArchivePage() {
  const items = cafeArchive();

  return (
    <div>
      <ViewTabs active="archive" />

      <div className="mb-4">
        <h1 className="text-2xl font-bold">날짜별 대회 결과</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          공식 네이버 카페 <span className="text-[var(--text)]">대회 결과 게시판</span>의 공인 대회 글{' '}
          <strong className="text-[var(--text)]">{items.length}</strong>건 · 최신순. 년/월을 눌러 펼치고, 특정
          년·월을 검색할 수 있습니다. 각 항목은 카페 원문으로 연결됩니다.
        </p>
      </div>

      <ArchiveView items={items} />
    </div>
  );
}
