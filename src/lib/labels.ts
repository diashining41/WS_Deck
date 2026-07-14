import type { Climax } from '@/db/schema';

export const REGION_LABEL = { JP: '일본', KR: '한국', OVERSEAS: '해외' } as const;
export const SCALE_LABEL = { SHOP: '샵 공인', CS: '사설 CS', BUSHIROAD: '부시로드' } as const;
export const FORMAT_LABEL = { SINGLES: '개인', TRIO: '트리오' } as const;

export const CLIMAX_ORDER: Climax[] = [
  '스탠',
  '문',
  '초이스',
  '게이트',
  '금괴',
  '포커스',
  '책',
  '찬스',
  '샷',
  '2소울',
  '회오리',
  '망원경',
  '보따리',
];

export const SOURCE_LABEL: Record<string, string> = {
  x: 'X',
  decklog: 'DECK LOG',
  naver: '네이버 카페',
  dc: 'DC 갤러리',
  wstcg: '공식 홈페이지',
  manual: '직접 등록',
};

export function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return `${date.getUTCFullYear()}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${String(date.getUTCDate()).padStart(2, '0')}`;
}
