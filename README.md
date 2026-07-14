# WS_DeckCheck

바이스슈발츠 **대회** 덱 레시피를 타이틀별로 모아 보는 사이트. 수기로 관리하던
[스프레드시트](https://docs.google.com/spreadsheets/d/10aivS4WkD8eeQZbTDmU_YVx1hziFqlAEfcN8Xx0btF0/edit?gid=0)를
대체합니다.

타이틀을 고르면 그 작품의 덱 레시피가 최신 등록순으로 나오고, 각 항목에 덱 이미지 미리보기와
원본 게시물(X / 공식 홈페이지 / 카페) 링크가 붙습니다.

## 지금 되는 것

- 스프레드시트 임포트 — 덱 485개 / 게시물 406개 / 타이틀 148종(덱 보유 74종)
- X·DECK LOG에서 덱 이미지 자동 수집 + 썸네일 생성
- 타이틀 인덱스 → 타이틀별 덱 목록(썸네일 미리보기 + 원본 링크) → 라이트박스
- 클라이맥스 / 국가 / 대회 규모·형식 / 4등 이내 패싯 필터
- **정규식 프리필터** — 알려진 대회 게시물 387건에 대해 재현율 **99.7%**
- **X 계정 폴링** — 214개 계정, 실측 레이트리밋(15분당 30요청) 준수
- **고속 검수 UI** (`/admin/review`) — 키보드만으로 처리
- **AI 추출 + 평가 하네스** — API 키만 넣으면 동작 (`npm run eval`)

## 실행

```bash
npm install
npm run db:push          # 스키마 생성
npm run import:sheet     # 스프레드시트 임포트 (--refresh 로 재다운로드)
npm run backfill:images  # 덱 이미지 수집 (X 레이트리밋 준수, 수 분 소요)
npm run seed:aliases     # 작품·클라이맥스 별칭 + 본문 판독 커버리지 측정
npm run seed:accounts    # X 폴링 대상 계정 등록 (티어 자동 분류)
npm run dev
```

수집·AI:

```bash
npm run test:prefilter   # 프리필터 재현율 측정 (정답셋 대비)
npm run poll             # X 신규 대회 게시물 수집 (nitter RSS 기반)
npm run poll             # FULL_SCAN=true 로 커서 무시하고 전체 재스캔
npm run eval 20          # AI 추출 정확도 측정 (ANTHROPIC_API_KEY 필요)
```

## 공개 배포

공개 사이트는 **DB도 시크릿도 없이** 정적 파일로만 배포됩니다. 구조:

- 수집·AI·검수는 로컬(또는 워커)에서 DB(PGlite/Postgres)를 채운다
- `npm run export:static` 로 현재 데이터를 `src/generated/data.json` 스냅샷으로 굽는다
- 공개 페이지(`/`, `/titles/[code]`)는 그 스냅샷 + `public/media/{thumb,medium}` 만 읽는다
- 관리자 화면은 프로덕션에서 404 (dev 전용)

이미지(`thumb`+`medium`, 112MB)는 저장소에 함께 커밋되고 Vercel이 `/public`에서 서빙합니다.
환경변수도 시크릿도 필요 없습니다.

배포 절차:

```bash
npm run export:static    # 최신 데이터로 스냅샷 갱신
npm run build            # 공개 페이지가 정적으로 구워지는지 확인
git push                 # GitHub → Vercel 자동 배포
```

> Vercel 대신 Netlify·Cloudflare Pages 도 동일 (Next.js 프리셋).
> 데이터 갱신: `export:static` → `git push` 반복.

**나중에 이미지를 git 밖으로 빼려면** (저장소가 무거워질 때): Cloudflare R2 등에
`npm run upload:r2`로 올리고, Vercel 환경변수 `NEXT_PUBLIC_MEDIA_BASE_URL`을 그 공개 URL로
설정한 뒤 `.gitignore`에 `public/media/`를 추가하면 됩니다. **코드 변경은 없습니다** —
이미지 URL이 이미 그 환경변수로 분리돼 있습니다. `orig`(349MB)는 항상 로컬 아카이브.

> **주의: 한 번에 하나만.** 로컬 DB는 PGlite(파일 기반 Postgres)라 프로세스 하나만 열 수
> 있습니다. `npm run dev`를 띄운 채로 스크립트를 돌리면 락 충돌이 납니다. 배포용으로
> `DATABASE_URL`(Neon 등)을 설정하면 이 제약은 사라집니다.

## 데이터 모델에서 조심할 것

실제 데이터를 검증하면서 확인한, 틀리기 쉬운 지점들입니다.

- **게시물 1개에 덱이 최대 4개.** 트리오 팀전은 한 트윗에 팀원 3~4명의 덱 리스트를 같이 올립니다.
  `posts` 406개에 `decks`가 485개인 이유입니다.
- **덱의 썸네일은 반드시 그 덱 자신의 이미지(`decks.image_id`)여야 합니다.** `post.images[0]`을
  쓰면 안 됩니다 — 한 게시물 안에서 **모든 메타데이터가 완전히 동일한 덱이 실재**하고
  (`x.com/nyaroha/status/2076098724124623263`의 우마무스메 2개), 이미지가 유일한 식별자입니다.
- **클라이맥스는 최대 4개.** 1개 313 / 2개 167 / 3개 4 / 4개 1. 2개로 모델링하면 조용히 잘립니다.
- **`4등 이내`에 CHECK 제약을 걸지 마세요.** 시트 범례는 "중·대 한정"이라고 하지만 실제로는
  샵 공인(소) 대회에도 11건이 `O`로 찍혀 있습니다.
- **X 게시물 ID는 TEXT.** 19자리 스노플레이크라 JS number로 바꾸면 뒷자리가 조용히 깨집니다.

## 아직 안 된 것

- **`/admin` 인증.** 지금은 잠금장치가 없습니다. 배포하면 누구나 덱을 지울 수 있으므로,
  `src/middleware.ts`가 **프로덕션에서 `/admin`을 아예 404로 막습니다.** Auth.js + Google +
  이메일 allowlist를 붙이고 `ADMIN_AUTH_CONFIGURED=true`를 설정하면 열립니다.
- 네이버 카페 / DC 갤러리 어댑터 (목록 API는 검증 완료, 본문 수집은 미구현)
- 확신도 게이트 자동 게시 — 임계값은 `npm run eval` 결과가 나온 뒤에 정합니다

## 알려진 한계

**본문만으로 판독 가능한 비율** (`npm run seed:aliases`가 매번 측정):

| | 비율 |
|---|---|
| 작품 | 64% |
| 클라이맥스 (전체 일치) | 26% |
| 둘 다 | 20% |

나머지 80%는 **실물 덱 사진을 AI가 읽어야** 합니다. 대부분의 샵 게시물이 `優勝は◯◯さん` +
사진만 올리고 덱 구성을 안 적기 때문입니다. 이게 검수 큐가 필수인 이유이고, 검수를 3초로
만드는 게 설계 목표인 이유입니다.

**프리필터가 놓치는 1건**: 본문이 `✌` 이모지 하나뿐인 게시물. 텍스트로는 원리적으로 불가능하며,
계정 신뢰도 우회로만 잡을 수 있습니다.

## 외부 소스

전부 실제로 호출해 확인한 것들입니다.

| 소스 | 방법 | 비고 |
|---|---|---|
| X 개별 트윗 | `cdn.syndication.twimg.com/tweet-result` | 무료·무인증 |
| X 계정 타임라인(발견) | **nitter RSS** (`nitter.net` 등, Node `https` 모듈) | 공식 syndication 타임라인은 수년치 큐레이션 표본만 줘서 **신규 발견 불가** — nitter RSS가 실제 최근 트윗을 준다 |
| DECK LOG | `decklog.bushiroad.com/deckimages/{코드}.png` | 덱 이미지 직행 |
| ws-tcg 공식 | `/deckrecipe/{ID}/` | OGP 없음 → DOM 파싱 필요 |
| DC 갤러리 | `gall.dcinside.com/mgallery/board/lists/?id=weissschwartz` | id에 **T** 주의 |
| 네이버 카페 | 목록 API 무인증 / 본문·이미지는 로그인 쿠키 필요 | 대회 결과 게시판 `menuId=181` |

X의 엔드포인트는 전부 **비공식**입니다. nitter 인스턴스는 자주 죽으므로 `NITTER_HOSTS`에
여러 개를 두고 순회하며, `src/lib/x.ts`의 `health()`가 전멸을 감지합니다. 발견(nitter)이
막혀도 개별 트윗 조회(`cdn.syndication.twimg.com`)는 별개 경로라 URL만 있으면 항상 동작합니다.

## X 자동 발견에 대한 주의 (중요)

공식 X 타임라인 엔드포인트(`syndication.twitter.com/srv/timeline-profile`)는 계정당 101건을
주지만, 그건 **최근 트윗이 아니라 수년치 큐레이션 표본**입니다. 실측: 한 샵의 대회 트윗 중
타임라인 날짜 범위 안에 드는 11건이 **하나도 타임라인에 없었습니다.** 그래서 발견은 **nitter
RSS**를 씁니다 (실측: 한 계정 20건 중 16건이 대회 트윗, 당일까지).

nitter는 `fetch()`(undici)의 TLS 지문을 막고 빈 200을 돌려주므로, `src/lib/x.ts`는 Node 내장
`https` 모듈로 요청합니다. 이건 이 코드베이스의 숨은 함정이니 `fetch()`로 되돌리지 마세요.
