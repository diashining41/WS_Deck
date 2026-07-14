import { listReviewQueue } from '@/lib/queries';

import { listTitleOptions } from './actions';
import { ReviewClient } from './review-client';

export const dynamic = 'force-dynamic';

export default async function ReviewPage() {
  const [queue, titleOptions] = await Promise.all([listReviewQueue(80), listTitleOptions()]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl font-bold">검수 큐</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          대기 <strong className="text-[var(--text)]">{queue.length}</strong>건 · 키보드만으로 처리하세요
        </p>
      </div>

      {queue.length === 0 ? (
        <p className="py-24 text-center text-sm text-[var(--muted)]">검수할 덱이 없습니다. 👌</p>
      ) : (
        <ReviewClient queue={queue} titleOptions={titleOptions} />
      )}
    </div>
  );
}
