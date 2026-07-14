# 매일 자동 실행 (Windows 작업 스케줄러가 호출).
#
# 이 PC가 "워커"입니다: 새 대회 트윗을 발견해 Neon에 쌓고, 이미지를 받고,
# 스냅샷을 갱신해 GitHub 에 push 합니다 → Vercel 이 자동 재배포.
# 게시는 검수(로컬 /admin/review)를 거칩니다.
#
# 수동 실행: powershell -ExecutionPolicy Bypass -File scripts\daily.ps1

$ErrorActionPreference = 'Continue'
$proj = Split-Path -Parent $PSScriptRoot
Set-Location $proj

$node = 'C:\Program Files\nodejs'
$env:Path = "$node;$env:Path"
$npm = Join-Path $node 'npm.cmd'

$log = Join-Path $proj 'accumulate.log'
function Log($m) { "$([DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss')) $m" | Tee-Object -FilePath $log -Append }

Log '=== 자동 수집 시작 ==='

# 1. nitter 로 새 대회 트윗 발견 (→ Neon)
& $npm run poll        *>> $log
# 2. 이미지 수집 + 검수 대기 덱 생성
& $npm run backfill:images *>> $log
# 3. Neon → 정적 스냅샷
& $npm run export:static   *>> $log

# 4. 변경분(새 이미지 + 스냅샷)만 커밋 & push → Vercel 재배포
git add public/media src/generated/data.json 2>> $log
$staged = git diff --cached --name-only
if ($staged) {
  git commit -q -m "accumulate: $((Get-Date).ToString('yyyy-MM-dd')) 자동 수집" 2>> $log
  git push 2>> $log
  Log "커밋 & push 완료 ($($staged.Count) 파일)"
} else {
  Log '변경 없음 — 새 게시 없음'
}

Log '=== 완료 ==='
