/**
 * Applies the reviewed title master: official WS codes + Korean 정발/통용 names.
 *
 * - Renames 128 surviving titles (code + name_ko) to the reviewed values.
 * - Merges 4 duplicate rows (same work under one code) into their target:
 *   decks and aliases move over, the source row is flagged merged_into and
 *   falls to deck_count 0 (hidden from the site), never deleted.
 * - Codes follow the official ws-tcg master; names use the Korean official
 *   release title where one exists, else the common Korean name.
 *
 * Renames run in two passes (temp names first) so no unique(name_ko) collision
 * trips mid-batch. Dry run by default; --commit to write.
 */
import { sql } from 'drizzle-orm';

import { closeDb, db, rows } from '@/db';

const COMMIT = process.argv.includes('--commit');

// id -> [official WS code, Korean name]
const MAP: Record<number, [string, string]> = {
  111: ['GIM', '학원 아이돌마스터'],
  88: ['LHS', '러브라이브! 하스노소라 여학원 스쿨아이돌클럽'],
  85: ['BD', '뱅드림!'],
  64: ['OSK', '최애의 아이'],
  108: ['OVL', '오버로드'],
  8: ['NIK', '승리의 여신: 니케'],
  52: ['UMA', '우마무스메 프리티 더비'],
  34: ['ISC', '아이돌마스터 샤이니 컬러즈'],
  81: ['HOL', '홀로라이브 프로덕션'],
  87: ['DAL', '데이트 어 라이브'],
  21: ['ALL', '어설트 릴리'],
  30: ['AZL', '벽람항로'],
  76: ['PJS', '프로젝트 세카이 컬러풀 스테이지!'],
  51: ['5HY', '5등분의 신부'],
  54: ['YRC', '유루캠프△'],
  18: ['RZ', 'Re:제로부터 시작하는 이세계 생활'],
  43: ['IMC', '아이돌마스터 신데렐라 걸즈'],
  37: ['SMP', '썸머 포켓'],
  86: ['BAV', '블루 아카이브'],
  61: ['SBY', '청춘 돼지 시리즈'],
  117: ['KJ8', '괴수 8호'],
  120: ['KMS', '금빛 모자이크'],
  114: ['AOH', '아오기리 고교'],
  101: ['DC', '다 카포 (D.C.)'],
  3: ['GCR', '걸즈 밴드 크라이'],
  9: ['DDD', '단다단'],
  110: ['AMG', '신들이 맺어준 인연'],
  19: ['LRC', '리코리스 리코일'],
  49: ['IM', '아이돌마스터'],
  121: ['TAL', '테일즈 오브 시리즈'],
  22: ['MAR', '마블'],
  140: ['THP', '동방 프로젝트'],
  57: ['TSK', '전생했더니 슬라임이었던 건에 대하여'],
  27: ['IMS', '아이돌마스터 밀리언 라이브!'],
  141: ['GA', 'GA문고'],
  79: ['PXR', '픽사'],
  80: ['HBR', '헤븐 번즈 레드'],
  46: ['AGS', '앨리스 기어 아이기스'],
  40: ['SKS', '카도카와 스니커문고'],
  91: ['FT', '페어리 테일'],
  5: ['GRI', '그리자이아 시리즈'],
  60: ['CS', '짱구는 못말려'],
  31: ['BTR', '봇치 더 록!'],
  2: ['GGO', '소드 아트 온라인 얼터너티브 건 게일 온라인'],
  107: ['KNK', '그녀, 빌리겠습니다'],
  116: ['MKI', '패배 히로인이 너무 많아!'],
  6: ['ND', '마법소녀 리리컬 나노하'],
  32: ['SHS', '시원찮은 그녀를 위한 육성방법'],
  62: ['CSM', '체인소 맨'],
  12: ['DCT', '디사이드 트로이메라이'],
  7: ['LNJ', '러브라이브! 니지가사키 학원 스쿨아이돌 동호회'],
  89: ['富士見', '후지미 판타지아 문고'],
  90: ['SPY', '스파이 패밀리'],
  143: ['GBF', '그랑블루 판타지'],
  77: ['SFN', '장송의 프리렌'],
  38: ['SAO', '소드 아트 온라인'],
  132: ['VRG', '버추얼 걸 @ 월즈 엔드'],
  28: ['RKN', '바람의 검심'],
  297: ['MRD', '디즈니 미러 워리어즈'],
  72: ['GU', '주문은 토끼입니까?'],
  33: ['SS', '작안의 샤나'],
  48: ['AYT', '아야카시 트라이앵글'],
  144: ['BRD', '브라운더스트2'],
  93: ['KEY', 'Key (키)'],
  23: ['MDE', '마크로스 시리즈'],
  14: ['RSL', '소녀☆가극 레뷰 스타라이트'],
  59: ['JJ', '죠죠의 기묘한 모험'],
  35: ['CHA', '샬롯 (Charlotte)'],
  56: ['電撃', '전격문고'],
  73: ['P5', '페르소나'],
  78: ['PRD', '프린세스 커넥트! Re:Dive'],
  11: ['TRV', '도쿄 리벤저스'],
  67: ['CCS', '카드캡터 사쿠라'],
  36: ['LSS', '러브라이브! 선샤인!!'],
  82: ['ARI', '흔해빠진 직업으로 세계최강'],
  71: ['KS', '이 멋진 세계에 축복을!'],
  102: ['SY', '스즈미야 하루히의 우울'],
  45: ['SG', '전희절창 심포기어'],
  26: ['MTI', '무직전생 ~이세계에 갔으면 최선을 다한다~'],
  58: ['ZLS', '좀비 랜드 사가'],
  105: ['AB', '엔젤 비트!'],
  44: ['DBG', '신이 된 날'],
  103: ['PAD', '퍼즐 앤 드래곤'],
  98: ['YHN', '환일의 요하네'],
  74: ['FS', '페이트 (Fate)'],
  4: ['GBS', '고블린 슬레이어'],
  42: ['SW', '스타워즈'],
  138: ['DDS', '디즈니100'],
  66: ['KGL', '카구야 님은 고백받고 싶어'],
  104: ['KF', '더 킹 오브 파이터즈'],
  39: ['LSP', '러브라이브! 슈퍼스타!!'],
  17: ['RSK', '리아세카이'],
  92: ['TL', 'To LOVE루 트러블'],
  106: ['MM', '마법소녀 마도카☆마기카'],
  24: ['KMD', '코바야시네 메이드래곤'],
  69: ['CTB', '캡틴 츠바사'],
  13: ['LL', '러브라이브!'],
  29: ['BFR', '아파는 건 싫으니까 방어력에 올인하려고 합니다'],
  41: ['LSF', '러브라이브! 스쿨아이돌 페스티벌2'],
  83: ['HLL', '히나로지 ~from Luck & Logic~'],
  139: ['ANM', '아네모이 (anemoi)'],
  20: ['LB', '리틀 버스터즈!'],
  84: ['DJ', 'D4DJ'],
  16: ['RW', '리라이트 (Rewrite)'],
  75: ['PD', '하츠네 미쿠 -Project DIVA-'],
  10: ['DDM', '던전에서 만남을 추구하면 안 되는 걸까'],
  68: ['KC', '함대 컬렉션 -칸코레-'],
  55: ['PI', '프리즈마☆이리야'],
  131: ['KMN', '케모노 프렌즈'],
  50: ['AW', '액셀 월드'],
  115: ['VS', '비비드 스트라이크!'],
  94: ['GL', '천원돌파 그렌라간'],
  118: ['PY', '뿌요뿌요'],
  130: ['STG', '슈타인즈 게이트'],
  95: ['NK', '니세코이'],
  99: ['FGO', '페이트/그랜드 오더'],
  1: ['AOT', '진격의 거인'],
  53: ['WTR', '월드 트리거'],
  148: ['DS', '달 세뇨 (Dal Segno)'],
  97: ['NGL', '노 게임 노 라이프'],
  119: ['FXX', '달링 인 더 프랑키스'],
  142: ['LOD', '로스트 디케이드'],
  100: ['GF', '걸프렌드(임시)'],
  137: ['CGS', '카드게임 하자 시요코'],
  136: ['EV', '에반게리온 신극장판'],
  113: ['GZL', '고질라 (애니메이션 영화)'],
  63: ['RG', '어떤 과학의 초전자포'],
  112: ['KR', '경계의 린네'],
};

// [sourceId, targetId] — duplicate rows folded into their target
const MERGES: [number, number][] = [
  [96, 110], // 인연맺기 → AMG
  [70, 131], // 케모노 → KMN
  [109, 24], // 코바야시메이드래곤 → KMD
  [129, 297], // 디즈니미러워리어즈 → MRD
];

const cur = rows<{ id: number; code: string; nameko: string; deck: number }>(
  await db.execute(sql`SELECT id, code, name_ko AS nameko, deck_count AS deck FROM titles`),
);
const byId = new Map(cur.map((t) => [t.id, t]));

let codeChanges = 0;
let nameChanges = 0;
console.log('■ 이름/코드 변경 (변화 있는 것만)');
for (const [idStr, [code, name]] of Object.entries(MAP)) {
  const t = byId.get(Number(idStr));
  if (!t) {
    console.log(`   ⚠ id ${idStr} 없음`);
    continue;
  }
  const cc = t.code !== code;
  const nc = t.nameko !== name;
  if (cc) codeChanges++;
  if (nc) nameChanges++;
  if (cc || nc)
    console.log(`   [${t.code}${cc ? `→${code}` : ''}] ${t.nameko}${nc ? `  →  ${name}` : ''}`);
}

console.log('\n■ 병합');
for (const [src, dst] of MERGES) {
  const s = byId.get(src);
  const d = byId.get(dst);
  console.log(`   ${s?.nameko}(${s?.deck}덱) → ${d?.nameko} [id ${dst}]`);
}

// Collision guard: no two final names identical, none clashes with a kept name.
const finalName = new Map<number, string>();
for (const [idStr, [, name]] of Object.entries(MAP)) finalName.set(Number(idStr), name);
const mergedAway = new Set(MERGES.map(([s]) => s));
const keptNames = new Map<string, number>();
for (const t of cur) if (!MAP[t.id] && !mergedAway.has(t.id)) keptNames.set(t.nameko, t.id);
const seen = new Map<string, number>();
let collisions = 0;
for (const [id, name] of finalName) {
  if (seen.has(name)) {
    console.log(`   ⚠ 이름 중복: "${name}" (id ${seen.get(name)} & ${id})`);
    collisions++;
  }
  seen.set(name, id);
  if (keptNames.has(name)) {
    console.log(`   ⚠ 기존 타이틀과 이름 충돌: "${name}" (기존 id ${keptNames.get(name)})`);
    collisions++;
  }
}

console.log(`\n코드변경 ${codeChanges} · 이름변경 ${nameChanges} · 병합 ${MERGES.length} · 충돌 ${collisions}`);

if (!COMMIT) {
  console.log('\n(드라이런입니다. 반영하려면 --commit)');
  await closeDb();
  process.exit(collisions ? 1 : 0);
}
if (collisions) {
  console.log('\n❌ 이름 충돌이 있어 중단합니다.');
  await closeDb();
  process.exit(1);
}

// ---- write ----
for (const [src, dst] of MERGES) {
  await db.execute(sql`UPDATE decks SET title_id=${dst} WHERE title_id=${src}`);
  await db.execute(
    sql`UPDATE title_aliases SET title_id=${dst} WHERE title_id=${src} AND alias NOT IN (SELECT alias FROM title_aliases WHERE title_id=${dst})`,
  );
  await db.execute(sql`UPDATE titles SET merged_into=${dst} WHERE id=${src}`);
}

const ids = Object.keys(MAP).map(Number);
// Pass 1: park every changing name at a unique temp value.
for (const id of ids) await db.execute(sql`UPDATE titles SET name_ko=${`__tmp_${id}`} WHERE id=${id}`);
// Pass 2: set final code + name.
for (const id of ids) {
  const [code, name] = MAP[id]!;
  await db.execute(sql`UPDATE titles SET code=${code}, name_ko=${name} WHERE id=${id}`);
}

await db.execute(sql`
  UPDATE titles SET deck_count=(SELECT count(*) FROM decks WHERE decks.title_id=titles.id AND decks.status='published')`);

const [{ n } = { n: 0 }] = rows<{ n: number }>(
  await db.execute(sql`SELECT count(*)::int n FROM titles WHERE deck_count>0 AND game='WS'`),
);
console.log(`\n✅ 반영 완료 · 노출 타이틀 ${n}종`);
await closeDb();
