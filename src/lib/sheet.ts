import type { Climax } from '@/db/schema';

export const SHEET_ID = '10aivS4WkD8eeQZbTDmU_YVx1hziFqlAEfcN8Xx0btF0';
export const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;

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

/* Column layout of the sheet (0-based). Row 8 is the header; data starts at 9. */
const COL = {
  year: 1,
  month: 2,
  day: 3,
  country: 4,
  tournament: 5, // 소개인 / 중트리오 / 중개인 / 소트리오
  top4: 6, // 'O' | '-'
  title: 7,
  code: 8,
  climax: 9, // 'a' or 'a/b' … up to 4
  url: 10,
  masterTitle: 12,
  masterCode: 13,
} as const;

export const HEADER_ROWS = 9;

export type Region = 'JP' | 'KR' | 'OVERSEAS';
export type Scale = 'SHOP' | 'CS' | 'BUSHIROAD';
export type Format = 'SINGLES' | 'TRIO';
export type Source = 'x' | 'decklog' | 'naver' | 'dc' | 'wstcg' | 'manual';

const REGION: Record<string, Region> = { 일본: 'JP', 한국: 'KR', 해외: 'OVERSEAS' };

/**
 * The sheet fuses scale and format into one token ("중트리오"). Splitting them
 * is what lets the UI facet on either axis independently.
 *   소 = 샵 공인 · 중 = 사설 CS · 대 = 부시로드 주관 (no 대 rows exist yet)
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

export interface SheetRow {
  rowIndex: number;
  date: Date;
  region: Region;
  scale: Scale;
  format: Format;
  top4: boolean | null;
  titleKo: string;
  code: string;
  climaxes: Climax[];
  url: string;
}

export interface ParsedSheet {
  titles: { nameKo: string; code: string }[];
  rows: SheetRow[];
  /** Rows whose URL cell holds something else entirely ("빌드 2위") — kept out of the DB. */
  quarantined: { rowIndex: number; cell: string }[];
  warnings: string[];
}

export function parseSheet(csv: string): ParsedSheet {
  const all = parseCsv(csv);
  const warnings: string[] = [];

  // Title master lives in columns M/N alongside the data, with its own header.
  const seen = new Set<string>();
  const titles: { nameKo: string; code: string }[] = [];
  for (const r of all) {
    const nameKo = (r[COL.masterTitle] ?? '').trim();
    const code = (r[COL.masterCode] ?? '').trim();
    if (!nameKo || !code || nameKo === '작품') continue;
    if (seen.has(nameKo)) {
      warnings.push(`중복 타이틀 마스터 항목 무시: ${nameKo} (${code})`);
      continue;
    }
    seen.add(nameKo);
    titles.push({ nameKo, code });
  }

  const rows: SheetRow[] = [];
  const quarantined: { rowIndex: number; cell: string }[] = [];

  for (let i = HEADER_ROWS; i < all.length; i++) {
    const r = all[i];
    if (!r) continue;
    const url = (r[COL.url] ?? '').trim();
    if (!url) continue;

    if (!/^https?:\/\//.test(url)) {
      quarantined.push({ rowIndex: i, cell: url });
      continue;
    }

    const titleKo = (r[COL.title] ?? '').trim();
    if (!titleKo) {
      quarantined.push({ rowIndex: i, cell: `작품 없음 (${url})` });
      continue;
    }

    const region = REGION[(r[COL.country] ?? '').trim()];
    const tour = TOURNAMENT[(r[COL.tournament] ?? '').trim()];
    if (!region || !tour) {
      warnings.push(`행 ${i}: 국가/대회 정보 해석 실패 — ${r[COL.country]} / ${r[COL.tournament]}`);
      continue;
    }

    const climaxes: Climax[] = [];
    for (const part of (r[COL.climax] ?? '').split('/')) {
      const cx = normalizeClimax(part);
      if (cx) climaxes.push(cx);
      else if (part.trim()) warnings.push(`행 ${i}: 알 수 없는 클라이맥스 "${part.trim()}"`);
    }

    const y = Number(r[COL.year]);
    const m = Number(r[COL.month]);
    const d = Number(r[COL.day]);
    const date = Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) ? new Date(Date.UTC(y, m - 1, d)) : new Date();

    rows.push({
      rowIndex: i,
      date,
      region,
      scale: tour.scale,
      format: tour.format,
      top4: (r[COL.top4] ?? '').trim() === 'O' ? true : null,
      titleKo,
      code: (r[COL.code] ?? '').trim(),
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
