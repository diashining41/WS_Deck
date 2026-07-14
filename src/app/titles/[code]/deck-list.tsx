'use client';

import { useMemo, useState } from 'react';

import type { Climax } from '@/db/schema';
import { CLIMAX_ORDER, FORMAT_LABEL, REGION_LABEL, SCALE_LABEL, SOURCE_LABEL, formatDate } from '@/lib/labels';
import { mediaUrl } from '@/lib/media-url';
import type { DeckCard } from '@/lib/queries';

type Facets = {
  region: Set<string>;
  scale: Set<string>;
  format: Set<string>;
  climax: Set<string>;
  top4: boolean;
};

const EMPTY: Facets = { region: new Set(), scale: new Set(), format: new Set(), climax: new Set(), top4: false };

function toggle(set: Set<string>, v: string): Set<string> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

function matches(d: DeckCard, f: Facets): boolean {
  if (f.region.size && !f.region.has(d.region)) return false;
  if (f.scale.size && !f.scale.has(d.scale)) return false;
  if (f.format.size && !f.format.has(d.format)) return false;
  if (f.top4 && !d.top4) return false;
  // OR within the climax facet: pick 문 and 초이스 to see decks running either.
  if (f.climax.size && !d.climaxes.some((c) => f.climax.has(c))) return false;
  return true;
}

export function DeckList({ decks }: { decks: DeckCard[] }) {
  const [f, setF] = useState<Facets>(EMPTY);
  const [lightbox, setLightbox] = useState<DeckCard | null>(null);

  const shown = useMemo(() => decks.filter((d) => matches(d, f)), [decks, f]);

  // Counts are free here because the whole list is already in memory — no query
  // per facet click, no spinner, and the numbers update live as you filter.
  const counts = useMemo(() => {
    const climax = new Map<string, number>();
    const region = new Map<string, number>();
    const scale = new Map<string, number>();
    const format = new Map<string, number>();
    let top4 = 0;
    for (const d of decks) {
      for (const c of new Set(d.climaxes)) climax.set(c, (climax.get(c) ?? 0) + 1);
      region.set(d.region, (region.get(d.region) ?? 0) + 1);
      scale.set(d.scale, (scale.get(d.scale) ?? 0) + 1);
      format.set(d.format, (format.get(d.format) ?? 0) + 1);
      if (d.top4) top4++;
    }
    return { climax, region, scale, format, top4 };
  }, [decks]);

  const active = f.region.size || f.scale.size || f.format.size || f.climax.size || f.top4;

  return (
    <>
      <div className="mb-5 space-y-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
        <FacetRow label="국가">
          {(['JP', 'KR', 'OVERSEAS'] as const)
            .filter((k) => counts.region.get(k))
            .map((k) => (
              <Chip
                key={k}
                on={f.region.has(k)}
                onClick={() => setF({ ...f, region: toggle(f.region, k) })}
                count={counts.region.get(k)}
              >
                {REGION_LABEL[k]}
              </Chip>
            ))}
        </FacetRow>

        <FacetRow label="대회">
          {(['SHOP', 'CS', 'BUSHIROAD'] as const)
            .filter((k) => counts.scale.get(k))
            .map((k) => (
              <Chip
                key={k}
                on={f.scale.has(k)}
                onClick={() => setF({ ...f, scale: toggle(f.scale, k) })}
                count={counts.scale.get(k)}
              >
                {SCALE_LABEL[k]}
              </Chip>
            ))}
          {(['SINGLES', 'TRIO'] as const)
            .filter((k) => counts.format.get(k))
            .map((k) => (
              <Chip
                key={k}
                on={f.format.has(k)}
                onClick={() => setF({ ...f, format: toggle(f.format, k) })}
                count={counts.format.get(k)}
              >
                {FORMAT_LABEL[k]}
              </Chip>
            ))}
          {counts.top4 > 0 && (
            <Chip on={f.top4} onClick={() => setF({ ...f, top4: !f.top4 })} count={counts.top4}>
              4등 이내
            </Chip>
          )}
        </FacetRow>

        <FacetRow label="클라이맥스">
          {CLIMAX_ORDER.filter((c) => counts.climax.get(c)).map((c) => (
            <Chip
              key={c}
              on={f.climax.has(c)}
              onClick={() => setF({ ...f, climax: toggle(f.climax, c) })}
              count={counts.climax.get(c)}
            >
              {c}
            </Chip>
          ))}
        </FacetRow>

        {active ? (
          <div className="pt-1">
            <button
              onClick={() => setF(EMPTY)}
              className="text-xs text-[var(--muted)] underline hover:text-[var(--accent)]"
            >
              필터 해제 ({shown.length}/{decks.length})
            </button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((d) => (
          <DeckCardView key={d.id} deck={d} onOpen={() => setLightbox(d)} />
        ))}
      </div>

      {shown.length === 0 && (
        <p className="py-16 text-center text-sm text-[var(--muted)]">조건에 맞는 덱이 없습니다.</p>
      )}

      {lightbox && <Lightbox deck={lightbox} onClose={() => setLightbox(null)} />}
    </>
  );
}

function FacetRow({ label, children }: { label: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : children;
  if (Array.isArray(items) && items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 w-16 shrink-0 text-xs text-[var(--muted)]">{label}</span>
      {items}
    </div>
  );
}

function Chip({
  on,
  count,
  onClick,
  children,
}: {
  on: boolean;
  count?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-xs transition ${
        on
          ? 'border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]'
          : 'border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)] hover:border-[var(--muted)]'
      }`}
    >
      {children}
      {count !== undefined && <span className="ml-1 tabular-nums opacity-60">{count}</span>}
    </button>
  );
}

function DeckCardView({ deck, onOpen }: { deck: DeckCard; onOpen: () => void }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      {/*
        The thumbnail is not decoration. One real post carries two decks whose
        every metadata field is identical — the image is the only thing that
        tells them apart, so each card must show its OWN deck image.
      */}
      <button
        onClick={onOpen}
        disabled={!deck.thumbKey}
        className="relative block aspect-[4/3] w-full overflow-hidden bg-[var(--panel-2)] disabled:cursor-default"
      >
        {deck.thumbKey ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaUrl(deck.thumbKey)!}
            alt="덱 레시피 미리보기"
            loading="lazy"
            className="h-full w-full object-cover transition duration-200 hover:scale-[1.03]"
            style={deck.blur ? { backgroundImage: `url(${deck.blur})`, backgroundSize: 'cover' } : undefined}
          />
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-[var(--muted)]">
            미리보기 없음
          </span>
        )}

        {deck.siblingCount > 1 && (
          <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            같은 게시물 덱 {deck.siblingCount}개
          </span>
        )}
        {deck.top4 && (
          <span className="absolute right-2 top-2 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-black">
            4등 이내
          </span>
        )}
      </button>

      <div className="space-y-2 p-3">
        <div className="flex flex-wrap gap-1">
          {deck.climaxes.map((c: Climax) => (
            <span key={c} className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[11px] text-[var(--accent)]">
              {c}
            </span>
          ))}
          {deck.climaxes.length === 0 && (
            <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
              클라이맥스 미상
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
          <span>{formatDate(deck.sortAt)}</span>
          <span>·</span>
          <span>{REGION_LABEL[deck.region]}</span>
          <span>·</span>
          <span>
            {SCALE_LABEL[deck.scale]} {FORMAT_LABEL[deck.format]}
          </span>
        </div>

        <a
          href={deck.url}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--accent)]"
        >
          <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5">{SOURCE_LABEL[deck.source] ?? deck.source}</span>
          {deck.authorHandle && <span className="truncate">@{deck.authorHandle}</span>}
          <span className="ml-auto shrink-0">원본 ↗</span>
        </a>
      </div>
    </div>
  );
}

function Lightbox({ deck, onClose }: { deck: DeckCard; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
      role="dialog"
    >
      <div className="max-h-full max-w-5xl overflow-auto" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mediaUrl(deck.mediumKey ?? deck.thumbKey) ?? ''}
          alt="덱 레시피"
          className="max-h-[80vh] w-auto rounded-lg"
        />
        <div className="mt-3 flex items-center gap-3 text-xs text-[var(--muted)]">
          <span>{formatDate(deck.sortAt)}</span>
          <span>{deck.climaxes.join(' / ') || '클라이맥스 미상'}</span>
          {!deck.imageVerified && deck.siblingCount > 1 && (
            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-300">이미지-덱 매칭 미확정</span>
          )}
          <a
            href={deck.url}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto text-[var(--accent)] hover:underline"
          >
            원본 게시물 ↗
          </a>
        </div>
      </div>
    </div>
  );
}
