# Unattended finisher: waits for the image backfill to drain, then publishes.
#
# The backfill runs as detached shards for hours. This watches them, and once
# they are all gone it pushes every new image to R2, refreshes the snapshot from
# Neon, and commits it - so the site ends up showing the images with nobody at
# the keyboard. Only the snapshot is committed; images live in R2 (.gitignore).
#
# ASCII only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI, and non-ASCII
# text here has already caused a parse failure once.

$ErrorActionPreference = 'Continue'
$proj = 'C:\Users\AI_Projects\WS_DeckCheck'
Set-Location $proj

$tsx = 'node_modules/tsx/dist/cli.mjs'

function Log([string]$msg) {
  $ts = Get-Date -Format 'HH:mm:ss'
  Write-Output ('[' + $ts + '] ' + $msg)
}

Log 'waiting for backfill shards to finish...'
while ($true) {
  $running = @(Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'node.exe' -and $_.CommandLine -like '*backfill-images*'
    })
  if ($running.Count -eq 0) { break }
  Start-Sleep -Seconds 60
}
Log 'backfill done - publishing'

# Images first: the snapshot must never go live referencing a file that is not in
# the bucket yet, or the site renders broken thumbnails.
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
  $today = Get-Date -Format 'yyyy-MM-dd'
  & git commit -q -m ("image backfill batch (" + $today + ") - more deck previews")
  & git push origin main 2>&1 | Select-Object -Last 1
  Log 'pushed - Vercel will redeploy'
}

Log 'finished'
