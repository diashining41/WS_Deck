/** Naver adapter health + a real parse, before any cookie exists. */
import { fetchArticle, hasNaverCookies, health, resolveShortlink } from '@/lib/naver';

console.log(`쿠키 설정됨: ${hasNaverCookies() ? '예' : '아니오 (공개 글만 테스트)'}\n`);

const h = await health();
console.log(`■ 헬스체크: ${h.ok ? '✅' : '❌'} ${h.detail}\n`);

// A known-public article — proves parsing end to end with zero credentials.
const a = await fetchArticle('103046');
if (a) {
  console.log('■ 공개 글 103046 파싱');
  console.log(`   게시판   : ${a.boardName}`);
  console.log(`   작성자   : ${a.authorHandle}`);
  console.log(`   작성일   : ${a.createdAt.toISOString().slice(0, 10)}`);
  console.log(`   본문     : ${a.text.slice(0, 60).replace(/\n/g, ' ')}…`);
  console.log(`   이미지   : ${a.media.length}장`);
  for (const m of a.media) console.log(`     ${m.url.slice(0, 80)}`);

  // Images must be fetchable with no cookie at all.
  if (a.media[0]) {
    const res = await fetch(a.media[0].url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const bytes = (await res.arrayBuffer()).byteLength;
    console.log(`   → 이미지 다운로드 테스트: HTTP ${res.status} · ${(bytes / 1024).toFixed(0)}KB (쿠키 없이)`);
  }
}

// Shortlinks must resolve without auth.
const id = await resolveShortlink('50BBn9Zr');
console.log(`\n■ 단축링크 naver.me/50BBn9Zr → 글 ID ${id ?? '해석 실패'}`);
