# Unattended supervisor: keeps the image backfill alive, then publishes.
#
# Two things go wrong when this runs for hours with nobody watching:
#   1. shards die silently (it already happened - all four vanished at ~55 posts,
#      no error, no completion line). A shard that was killed must be restarted,
#      or the archive stalls at 10% and the run "finishes" looking successful.
#   2. the snapshot goes live before the images reach the bucket, and every new
#      thumbnail 404s. So: upload to R2 first, publish second. Never reorder.
#
# A shard that ran to the end prints BACKFILL_DONE. Anything else = killed.
#
# ASCII only: Windows PowerShell 5.1 reads .ps1 as ANSI and non-ASCII text here
# has already caused a parse failure.

$ErrorActionPreference = 'Continue'
$proj = 'C:\Users\AI_Projects\WS_DeckCheck'
Set-Location $proj

$SHARDS = 4
$MAX_RESTARTS = 20
$tsx = 'node_modules/tsx/dist/cli.mjs'
$restarts = 0

function Log([string]$msg) {
  Write-Output ('[' + (Get-Date -Format 'HH:mm:ss') + '] ' + $msg)
}

function Running-Shards {
  @(Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'node.exe' -and $_.CommandLine -like '*backfill-images*'
    }).Count
}

function Shard-Done([int]$i) {
  $log = Join-Path $proj (".data\shard-$i.log")
  if (-not (Test-Path $log)) { return $false }
  return [bool](Select-String -Path $log -Pattern 'BACKFILL_DONE' -SimpleMatch -Quiet)
}

function Start-Shard([int]$i) {
  $cmd = 'cmd.exe /c "cd /d ' + $proj + ' && set SHARD_ID=' + $i + '&& set SHARD_TOTAL=' + $SHARDS +
  '&& node node_modules\tsx\dist\cli.mjs scripts\backfill-images.ts >> .data\shard-' + $i + '.log 2>&1"'
  $r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd }
  Log ('restarted shard ' + $i + ' (pid ' + $r.ProcessId + ')')
}

Log 'supervising backfill...'
while ($true) {
  Start-Sleep -Seconds 60

  $allDone = $true
  for ($i = 0; $i -lt $SHARDS; $i++) { if (-not (Shard-Done $i)) { $allDone = $false } }
  if ($allDone) { Log 'all shards reported BACKFILL_DONE'; break }

  # Nothing running but not everything finished => shards were killed. Revive the
  # unfinished ones. Their lock files are reclaimed automatically (stale PID).
  if ((Running-Shards) -eq 0) {
    if ($restarts -ge $MAX_RESTARTS) { Log 'restart budget exhausted - publishing what we have'; break }
    $restarts++
    Log ('no shards running, ' + $restarts + '/' + $MAX_RESTARTS + ' - reviving unfinished shards')
    for ($i = 0; $i -lt $SHARDS; $i++) {
      if (-not (Shard-Done $i)) { Start-Shard $i; Start-Sleep -Milliseconds 800 }
    }
  }
}

Log 'backfill drained - publishing'

# Images BEFORE snapshot: a snapshot that references a file not yet in the bucket
# renders as a broken thumbnail on the live site.
Log 'uploading to R2...'
& node $tsx scripts/upload-r2.ts 2>&1 | Select-Object -Last 3

Log 'refreshing static snapshot...'
& node $tsx scripts/export-static.ts 2>&1 | Select-Object -Last 3

Log 'committing snapshot...'
& git add src/generated/data.json
& git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Log 'no change - skip commit'
}
else {
  & git commit -q -m ('image backfill batch (' + (Get-Date -Format 'yyyy-MM-dd') + ') - more deck previews')
  & git push origin main 2>&1 | Select-Object -Last 1
  Log 'pushed - Vercel will redeploy'
}

Log 'finished'
