# promote-eom-viewer.ps1 - guarded PROD deploy for the standalone EOM Report
# Viewer subproject (eom-viewer/). Nick-run, interactive. `clasp push` from
# eom-viewer/ always targets the DEV twin (eom-viewer/.clasp.json); this script
# is the ONLY path to the prod viewer (the invoice team's bookmarked /exec URL).
# Same gate structure as promote.ps1: main / clean / synced / green harness /
# typed PROMOTE. The harness is included because it guards the viewer directly
# (PdFake.gs + EomReportRenderer.html byte-copies, the ENV resolver, the
# off-prod fake path, the prod passthrough).
# PowerShell 5.1 compatible; pure ASCII (5.1 reads BOM-less scripts as ANSI).
$ErrorActionPreference = 'Stop'
$repoRoot = Join-Path $PSScriptRoot '..'
Set-Location (Join-Path $repoRoot 'eom-viewer')

# The versioned PROD web-app deployment (the /exec URL the invoice team opens).
# clasp push only updates HEAD; every promote must also bump this deployment
# to a new version. Same deployment id = same URL, new code. NEVER create a
# "New deployment" here - that mints a new URL and orphans the bookmarks.
$PROD_WEBAPP_DEPLOYMENT_ID = 'AKfycby7zl3kavPEXArOp0lnSiEnW450R_jQThspSkhIUvUEDl4GaZ46DSNkYSVzMyXtoPitIQ'

# -- Gate 1: main branch, clean tree, synced with origin/main ----------------
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { throw "Refusing: on branch '$branch', not main." }

if (git status --porcelain) { throw 'Refusing: working tree is not clean.' }

git fetch origin | Out-Null
$head   = (git rev-parse HEAD).Trim()
$remote = (git rev-parse origin/main).Trim()
if ($head -ne $remote) { throw "Refusing: HEAD ($head) != origin/main ($remote). Push/pull first." }

# -- Gate 1.5: offline test harness must be green ------------------------------
Push-Location $repoRoot
try {
    node test/run-tests.js
    if ($LASTEXITCODE -ne 0) { throw 'Refusing: test harness is red (node test/run-tests.js).' }
} finally { Pop-Location }

# -- Show what is about to ship -----------------------------------------------
Write-Host ''
Write-Host ('Promoting (last eom-viewer commit): ' + (git log -1 --format='%h %s' -- .))

# -- Gate 2: typed confirmation (case-sensitive) ------------------------------
$answer = Read-Host 'Type PROMOTE to push eom-viewer to the PROD viewer'
if ($answer -cne 'PROMOTE') { Write-Host 'Aborted - nothing pushed.'; exit 1 }

# -- Push to prod; ALWAYS restore the DEV clasp target ------------------------
try {
    Copy-Item .clasp.prod.json .clasp.json -Force
    clasp push -f
    if ($LASTEXITCODE -ne 0) {
        throw "clasp push FAILED (exit $LASTEXITCODE) - PROD viewer may be partially updated. Investigate before re-running."
    }

    # Bump the versioned /exec web-app deployment to the just-pushed code.
    $sha = (git log -1 --format='%h').Trim()
    clasp deploy --deploymentId $PROD_WEBAPP_DEPLOYMENT_ID --description "promote eom-viewer $sha"
    if ($LASTEXITCODE -ne 0) {
        throw "clasp deploy FAILED (exit $LASTEXITCODE) - code IS pushed but the /exec viewer still serves the OLD version. Re-run promote, or bump manually: script editor > Deploy > Manage deployments > edit > New version."
    }

    Write-Host ''
    Write-Host 'PROD viewer updated (code push + /exec deployment bump).'
    Write-Host 'Smoke: open the viewer /exec URL, open an archived month, then Current.'
    Write-Host '       Current = live v2 reads: org/person/owner names, product codes, a variation name.'
    Write-Host 'Rollback: Manage deployments > edit > pick the previous version (never clasp push).'
} finally {
    # Delete first: Copy-Item preserves the source mtime, and both clasp jsons
    # are the same byte size, so git's stat cache saw .clasp.json as unchanged
    # and let checkout no-op - left the DEV target aimed at prod (2026-07-14).
    Remove-Item .clasp.json -Force
    git checkout -- .clasp.json
    Write-Host '(eom-viewer/.clasp.json restored to DEV target)'
}
