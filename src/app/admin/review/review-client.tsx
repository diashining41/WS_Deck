'use client';

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';

import type { Climax } from '@/db/schema';
import { CLIMAX_ORDER, formatDate } from '@/lib/labels';
import { mediaUrl } from '@/lib/media-url';
import type { ReviewItem } from '@/lib/queries';

import { approveDeck, rejectDeck } from './actions';

/**
 * The review queue is the one place a human still spends time, so it is built
 * for speed, not for completeness: the deck image big enough to actually read a
 * trigger icon, the 13 climaxes as one keystroke each, and Enter to move on.
 *
 * Number keys map to the climaxes in CLIMAX_ORDER — the common ones first, so
 * the ones you press most are the ones under your fingers.
 */
const KEYS = '1234567890qwe'.split('');

export function ReviewClient({
  queue,
  titleOptions,
}: {
  queue: ReviewItem[];
  titleOptions: { id: number; nameKo: string; code: string }[];
}) {
  const [i, setI] = useState(0);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState<Set<string>>(new Set());

  const item = queue[i];

  const [climaxes, setClimaxes] = useState<Climax[]>([]);
  const [titleId, setTitleId] = useState<number | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [titleQuery, setTitleQuery] = useState('');
  const [titleOpen, setTitleOpen] = useState(false);

  // Reset the form to whatever the AI (or the import) already guessed, so the
  // common case is "it's right — press Enter".
  useEffect(() => {
    if (!item) return;
    setClimaxes(item.climaxes ?? []);
    setTitleId(item.titleId);
    setImageId(item.imageId ?? item.candidates[0]?.id ?? null);
    setTitleQuery('');
    setTitleOpen(false);
  }, [item]);

  const toggleClimax = useCallback((c: Climax) => {
    setClimaxes((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : prev.length >= 4 ? prev : [...prev, c]));
  }, []);

  const advance = useCallback(() => {
    setI((n) => Math.min(n + 1, queue.length));
  }, [queue.length]);

  const approve = useCallback(() => {
    if (!item || pending) return;
    startTransition(async () => {
      await approveDeck({ deckId: item.id, climaxes, titleId, imageId });
      setDone((d) => new Set(d).add(item.id));
      advance();
    });
  }, [item, pending, climaxes, titleId, imageId, advance]);

  const reject = useCallback(() => {
    if (!item || pending) return;
    startTransition(async () => {
      await rejectDeck(item.id);
      setDone((d) => new Set(d).add(item.id));
      advance();
    });
  }, [item, pending, advance]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (titleOpen) return; // the title box owns the keyboard while it's open
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT') return;

      const k = e.key.toLowerCase();
      const idx = KEYS.indexOf(k);
      if (idx >= 0 && idx < CLIMAX_ORDER.length) {
        e.preventDefault();
        toggleClimax(CLIMAX_ORDER[idx]!);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        approve();
      } else if (e.key === 'Backspace' || k === 'x') {
        e.preventDefault();
        reject();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        advance();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setI((n) => Math.max(0, n - 1));
      } else if (k === 't') {
        e.preventDefault();
        setTitleOpen(true);
      } else if (item && item.candidates.length > 1 && /^[a-d]$/.test(k)) {
        e.preventDefault();
        const c = item.candidates['abcd'.indexOf(k)];
        if (c) setImageId(c.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleClimax, approve, reject, advance, titleOpen, item]);

  const titleMatches = useMemo(() => {
    const q = titleQuery.trim().toLowerCase();
    if (!q) return titleOptions.slice(0, 8);
    return titleOptions
      .filter((t) => t.nameKo.toLowerCase().includes(q) || t.code.toLowerCase().includes(q))
      .slice(0, 8);
  }, [titleOptions, titleQuery]);

  if (!item) {
    return (
      <div className="py-24 text-center">
        <p className="text-lg font-medium">검수 완료 🎉</p>
        <p className="mt-2 text-sm text-[var(--muted)]">{done.size}건 처리했습니다.</p>
      </div>
    );
  }

  const current = item.candidates.find((c) => c.id === imageId) ?? item.candidates[0];
  const titleName = titleOptions.find((t) => t.id === titleId)?.nameKo ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* The image, as large as we can make it — the whole job is reading it. */}
      <div>
        <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
          {current?.mediumKey ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={mediaUrl(current.mediumKey)!} alt="덱 레시피" className="max-h-[62vh] w-full object-contain" />
          ) : (
            <div className="flex h-64 items-center justify-center text-sm text-[var(--muted)]">이미지 없음</div>
          )}
        </div>

        {item.candidates.length > 1 && (
          <div className="mt-3">
            <p className="mb-2 text-xs text-[var(--muted)]">
              이 게시물에 이미지 {item.candidates.length}장 · <strong className="text-[var(--text)]">이 덱의 사진을 고르세요</strong>{' '}
              (a·b·c·d)
            </p>
            <div className="flex gap-2">
              {item.candidates.map((c, n) => (
                <button
                  key={c.id}
                  onClick={() => setImageId(c.id)}
                  className={`relative overflow-hidden rounded-lg border-2 transition ${
                    c.id === imageId ? 'border-[var(--accent)]' : 'border-transparent opacity-50 hover:opacity-100'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={mediaUrl(c.thumbKey) ?? ''} alt="" className="h-20 w-28 object-cover" />
                  <span className="absolute left-1 top-1 rounded bg-black/75 px-1 text-[10px] font-bold text-white">
                    {'abcd'[n]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3">
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--muted)]">
            {item.rawText || '(본문 없음)'}
          </p>
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-block text-xs text-[var(--accent)] hover:underline"
          >
            원본 ↗ {item.authorHandle && `@${item.authorHandle}`}
          </a>
        </div>
      </div>

      {/* Controls. Everything here has a key; the mouse is a fallback. */}
      <div className="space-y-4">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
          <div className="mb-2 flex items-center justify-between text-xs text-[var(--muted)]">
            <span>
              {i + 1} / {queue.length}
            </span>
            <span>{formatDate(item.sortAt)}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {item.reasons.map((r) => (
              <span key={r} className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-300">
                {r}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
          <p className="mb-2 text-xs text-[var(--muted)]">작품 — t 키로 검색</p>
          {titleOpen ? (
            <div>
              <input
                autoFocus
                value={titleQuery}
                onChange={(e) => setTitleQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setTitleOpen(false);
                  if (e.key === 'Enter' && titleMatches[0]) {
                    setTitleId(titleMatches[0].id);
                    setTitleOpen(false);
                  }
                }}
                placeholder="작품명 또는 코드"
                className="w-full rounded-lg border border-[var(--accent)] bg-[var(--panel-2)] px-2 py-1.5 text-sm outline-none"
              />
              <div className="mt-1 space-y-0.5">
                {titleMatches.map((t, n) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTitleId(t.id);
                      setTitleOpen(false);
                    }}
                    className={`block w-full rounded px-2 py-1 text-left text-sm hover:bg-[var(--panel-2)] ${
                      n === 0 ? 'bg-[var(--panel-2)]' : ''
                    }`}
                  >
                    {t.nameKo} <span className="text-[var(--muted)]">{t.code}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              onClick={() => setTitleOpen(true)}
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-left text-sm"
            >
              {titleName ?? <span className="text-amber-400">작품 미상 — t</span>}
            </button>
          )}
        </div>

        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
          <p className="mb-2 text-xs text-[var(--muted)]">클라이맥스 — 숫자키 (최대 4개)</p>
          <div className="grid grid-cols-2 gap-1.5">
            {CLIMAX_ORDER.map((c, n) => {
              const on = climaxes.includes(c);
              return (
                <button
                  key={c}
                  onClick={() => toggleClimax(c)}
                  className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-sm transition ${
                    on
                      ? 'border-[var(--accent)] bg-[var(--accent)]/20 text-[var(--accent)]'
                      : 'border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)] hover:border-[var(--muted)]'
                  }`}
                >
                  <kbd className="rounded bg-black/40 px-1 text-[10px]">{KEYS[n]}</kbd>
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={approve}
            disabled={pending}
            className="flex-1 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-bold text-black disabled:opacity-50"
          >
            승인 <kbd className="ml-1 rounded bg-black/20 px-1 text-[10px]">Enter</kbd>
          </button>
          <button
            onClick={reject}
            disabled={pending}
            className="rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-4 py-2.5 text-sm text-[var(--muted)] disabled:opacity-50"
          >
            제외 <kbd className="ml-1 rounded bg-black/40 px-1 text-[10px]">x</kbd>
          </button>
        </div>

        <p className="text-center text-[11px] text-[var(--muted)]">← → 이동 · 처리 {done.size}건</p>
      </div>
    </div>
  );
}
