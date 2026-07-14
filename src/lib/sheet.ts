import type { Climax } from '@/db/schema';

export const SHEET_ID = '10aivS4WkD8eeQZbTDmU_YVx1hziFqlAEfcN8Xx0btF0';
export const csvUrl = (gid: string) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;

/** RFC4180-ish parser; the sheet has quoted cells containing commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export type Region = 'JP' | 'KR' | 'OVERSEAS';
export type Scale = 'SHOP' | 'CS' | 'BUSHIROAD';
export type Format = 'SINGLES' | 'TRIO';
export type Source = 'x' | 'decklog' | 'naver' | 'dc' | 'wstcg' | 'manual';

const REGION: Record<string, Region> = { 일본: 'JP', 한국: 'KR', 해외: 'OVERSEAS' };

/**
 * The sheet fuses scale and format into one token ("중트리오"). Splitting them
 * is what lets the UI facet on either axis independently.
 *   소 = 샵 공인 · 중 = 사설 CS · 대 = 부시로드 주관
 */
const TOURNAMENT: Record<string, { scale: Scale; format: Format }> = {
  소개인: { scale: 'SHOP', format: 'SINGLES' },
  소트리오: { scale: 'SHOP', format: 'TRIO' },
  중개인: { scale: 'CS', format: 'SINGLES' },
  중트리오: { scale: 'CS', format: 'TRIO' },
  대개인: { scale: 'BUSHIROAD', format: 'SINGLES' },
  대트리오: { scale: 'BUSHIROAD', format: 'TRIO' },
};

const CLIMAXES: readonly Climax[] = [
  '스탠',
  '문',
  '찬스',
  '샷',
  '회오리',
  '초이스',
  '망원경',
  '포커스',
  '보따리',
  '금괴',
  '책',
  '게이트',
  '2소울',
];

/** One real cell reads 초이싀 — a typo for 초이스. */
const CLIMAX_FIXUPS: Record<string, Climax> = { 초이싀: '초이스' };

export function normalizeClimax(raw: string): Climax | null {
  const v = raw.trim();
  if (!v) return null;
  if (v in CLIMAX_FIXUPS) return CLIMAX_FIXUPS[v]!;
  return (CLIMAXES as readonly string[]).includes(v) ? (v as Climax) : null;
}

/* ------------------------------------------------------------- tab layouts */

/**
 * The spreadsheet grew columns over time, so each half-year tab has its own
 * layout. All indices are 0-based; data begins at `header + 1`. A `null` column
 * means the tab never recorded that field — those rows are archived with the
 * corresponding value left null rather than invented.
 *
 *   A (2026): full — country, scale/format token, top-4, code all present
 *   B (2025): + a 바이스/로제 game column, but no country/scale/format/top-4
 *   C (2024 H2): earliest — only year, month, work, climax, url
 */
export interface Layout {
  header: number;
  year: number;
  month: number;
  day: number | null;
  country: number | null;
  tournament: number | null;
  top4: number | null;
  title: number;
  code: number | null;
  climax: number;
  url: number;
  /** 바이스/로제 column — present only in the 2025 tabs. */
  game: number | null;
  masterTitle: number;
  masterCode: number;
}

export const LAYOUT_A: Layout = {
  header: 8, year: 1, month: 2, day: 3, country: 4, tournament: 5, top4: 6,
  title: 7, code: 8, climax: 9, url: 10, game: null, masterTitle: 12, masterCode: 13,
};
export const LAYOUT_B: Layout = {
  header: 6, year: 2, month: 3, day: 4, country: null, tournament: null, top4: null,
  title: 5, code: 6, climax: 7, url: 8, game: 1, masterTitle: 10, masterCode: 11,
};
export const LAYOUT_C: Layout = {
  header: 5, year: 1, month: 2, day: null, country: null, tournament: null, top4: null,
  title: 3, code: null, climax: 4, url: 5, game: null, masterTitle: 7, masterCode: 8,
};

export interface Tab {
  gid: string;
  name: string;
  layout: Layout;
}

/**
 * Newest tab first: when the same work appears in several tabs' title masters,
 * the earliest (newest-tab) code wins, and cross-tab duplicate posts keep the
 * first (newest) occurrence.
 */
export const TABS: Tab[] = [
  { gid: '0', name: '26년 하반기', layout: LAYOUT_A },
  { gid: '740386458', name: '26년 상반기', layout: LAYOUT_A },
  { gid: '251899463', name: '25년 하반기', layout: LAYOUT_B },
  { gid: '1748151760', name: '25년 상반기', layout: LAYOUT_B },
  { gid: '1749739193', name: '24년 하반기', layout: LAYOUT_C },
];

export interface SheetRow {
  tab: string;
  rowIndex: number;
  date: Date;
  region: Region | null;
  scale: Scale | null;
  format: Format | null;
  top4: boolean | null;
  titleKo: string;
  /** Present only where the tab has a code column; otherwise resolved from the master. */
  code: string | null;
  /** Verbatim 바이스/로제 cell, for Rosé exclusion (2025 tabs only). */
  gameCol: string | null;
  climaxes: Climax[];
  url: string;
}

export interface ParsedTab {
  titles: { nameKo: string; code: string }[];
  rows: SheetRow[];
  /** Rows whose URL cell holds something else entirely ("빌드 2위") — kept out of the DB. */
  quarantined: { rowIndex: number; cell: string }[];
  warnings: string[];
}

export function parseTab(csv: string, tab: Tab): ParsedTab {
  const all = parseCsv(csv);
  const L = tab.layout;
  const warnings: string[] = [];

  // Title master lives alongside the data in its own pair of columns.
  const seen = new Set<string>();
  const titles: { nameKo: string; code: string }[] = [];
  for (const r of all) {
    const nameKo = (r[L.masterTitle] ?? '').trim();
    const code = (r[L.masterCode] ?? '').trim();
    if (!nameKo || !code || nameKo === '작품' || nameKo === '작품명') continue;
    if (seen.has(nameKo)) continue;
    seen.add(nameKo);
    titles.push({ nameKo, code });
  }

  const rows: SheetRow[] = [];
  const quarantined: { rowIndex: number; cell: string }[] = [];

  for (let i = L.header + 1; i < all.length; i++) {
    const r = all[i];
    if (!r) continue;
    const url = (r[L.url] ?? '').trim();
    if (!url) continue;
    if (!/^https?:\/\//.test(url)) {
      quarantined.push({ rowIndex: i, cell: url });
      continue;
    }
    const titleKo = (r[L.title] ?? '').trim();
    if (!titleKo) {
      quarantined.push({ rowIndex: i, cell: `작품 없음 (${url})` });
      continue;
    }

    // Country / scale / format / top-4 exist only where the tab has the column.
    const region = L.country !== null ? (REGION[(r[L.country] ?? '').trim()] ?? null) : null;
    const tour = L.tournament !== null ? TOURNAMENT[(r[L.tournament] ?? '').trim()] : undefined;
    const top4 = L.top4 !== null ? ((r[L.top4] ?? '').trim() === 'O' ? true : null) : null;

    const climaxes: Climax[] = [];
    for (const part of (r[L.climax] ?? '').split('/')) {
      const cx = normalizeClimax(part);
      if (cx) climaxes.push(cx);
      else if (part.trim()) warnings.push(`${tab.name} 행 ${i}: 알 수 없는 클라이맥스 "${part.trim()}"`);
    }

    const y = Number(r[L.year]);
    const m = Number(r[L.month]);
    const d = L.day !== null ? Number(r[L.day]) : 1;
    const date =
      Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
        ? new Date(Date.UTC(y, m - 1, d || 1))
        : new Date();

    rows.push({
      tab: tab.name,
      rowIndex: i,
      date,
      region,
      scale: tour?.scale ?? null,
      format: tour?.format ?? null,
      top4,
      titleKo,
      code: L.code !== null ? (r[L.code] ?? '').trim() || null : null,
      gameCol: L.game !== null ? (r[L.game] ?? '').trim() || null : null,
      climaxes,
      url,
    });
  }

  return { titles, rows, quarantined, warnings };
}

export interface PostRef {
  source: Source;
  sourceId: string;
  canonical: string;
}

/**
 * The canonical URL is what dedupes a post. For X we key on the status id alone
 * so the same tweet found under a different handle casing, a quote link or a
 * /photo/1 suffix collapses to one row.
 */
export function identifyPost(url: string): PostRef | null {
  const x = url.match(/(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i);
  if (x?.[1]) return { source: 'x', sourceId: x[1], canonical: `https://x.com/i/status/${x[1]}` };

  const dl = url.match(/decklog(?:-en)?\.bushiroad\.com\/view\/(\w+)/i);
  if (dl?.[1]) {
    const code = dl[1].toUpperCase();
    return { source: 'decklog', sourceId: code, canonical: `https://decklog.bushiroad.com/view/${code}` };
  }

  const cafe = url.match(/cafe\.naver\.com\/([\w-]+)\/(\d+)/i);
  if (cafe?.[1] && cafe[2]) {
    return { source: 'naver', sourceId: `${cafe[1]}/${cafe[2]}`, canonical: `https://cafe.naver.com/${cafe[1]}/${cafe[2]}` };
  }

  // naver.me shortlinks need a network round-trip to resolve; key on the slug
  // until the ingester expands them.
  const short = url.match(/naver\.me\/(\w+)/i);
  if (short?.[1]) return { source: 'naver', sourceId: `me/${short[1]}`, canonical: `https://naver.me/${short[1]}` };

  const ws = url.match(/ws-tcg\.com\/deckrecipe\/(\d+)/i);
  if (ws?.[1]) return { source: 'wstcg', sourceId: ws[1], canonical: `https://ws-tcg.com/deckrecipe/${ws[1]}/` };

  const dc = url.match(/gall\.dcinside\.com\/.*[?&]no=(\d+)/i);
  if (dc?.[1]) return { source: 'dc', sourceId: dc[1], canonical: url };

  return null;
}
