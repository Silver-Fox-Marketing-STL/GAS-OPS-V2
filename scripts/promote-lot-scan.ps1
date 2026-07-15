# promote-lot-scan.ps1 - guarded PROD deploy for the standalone Lot Scanner
# subproject (lot-scan/). Nick-run, interactive. `clasp push` from lot-scan/
# always targets DEV (lot-scan/.clasp.json); this script is the ONLY path to
# the prod scanner. Same gate structure as promote.ps1 minus the Node harness
# (it tests main-app Code.gs paths, not the scanner).
# PowerShell 5.1 compatible; pure ASCII (5.1 reads BOM-less scripts as ANSI).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\lot-scan')

# The versioned PROD web-app deployment (the /exec URL the lot crew opens).
# clasp push only updates HEAD; every promote must also bump this deployment
# to a new version. Same deployment id = same URL, new code.
$PROD_WEBAPP_DEPLOYMENT_ID = 'AKfycbwOv4waW5OrV6tLllV2HxVqLsO6fMdP6hfGbYvuDu8IpGyRb5r2bmCNVkTB0mvcpOFvCQ'

# -- Gate 1: main branch, clean tree, synced with origin/main ----------------
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { throw "Refusing: on branch '$branch', not main." }

if (git status --porcelain) { throw 'Refusing: working tree is not clean.' }

git fetch origin | Out-Null
$head   = (git rev-parse HEAD).Trim()
$remote = (git rev-parse origin/main).Trim()
if ($head -ne $remote) { throw "Refusing: HEAD ($head) != origin/main ($remote). Push/pull first." }

# -- Show what is about to ship -----------------------------------------------
Write-Host ''
Write-Host ('Promoting (last lot-scan commit): ' + (git log -1 --format='%h %s' -- .))

# -- Gate 2: typed confirmation (case-sensitive) ------------------------------
$answer = Read-Host 'Type PROMOTE to push lot-scan to the PROD scanner'
if ($answer -cne 'PROMOTE') { Write-Host 'Aborted - nothing pushed.'; exit 1 }

# -- Push to prod; ALWAYS restore the DEV clasp target ------------------------
try {
    Copy-Item .clasp.prod.json .clasp.json -Force
    clasp push -f
    if ($LASTEXITCODE -ne 0) {
        throw "clasp push FAILED (exit $LASTEXITCODE) - PROD scanner may be partially updated. Investigate before re-running."
    }

    # Bump the versioned /exec web-app deployment to the just-pushed code.
    $sha = (git log -1 --format='%h').Trim()
    clasp deploy --deploymentId $PROD_WEBAPP_DEPLOYMENT_ID --description "promote lot-scan $sha"
    if ($LASTEXITCODE -ne 0) {
        throw "clasp deploy FAILED (exit $LASTEXITCODE) - code IS pushed but the /exec scanner still serves the OLD version. Re-run promote, or bump manually: script editor > Deploy > Manage deployments > edit > New version."
    }

    Write-Host ''
    Write-Host 'PROD scanner updated (code push + /exec deployment bump).'
    Write-Host 'Smoke: open the scanner /exec URL on a phone, pick a dealer, one capture flow.'
} finally {
    # Delete first: Copy-Item preserves the source mtime, and both clasp jsons
    # are the same byte size, so git's stat cache saw .clasp.json as unchanged
    # and let checkout no-op - left the DEV target aimed at prod (2026-07-14).
    Remove-Item .clasp.json -Force
    git checkout -- .clasp.json
    Write-Host '(lot-scan/.clasp.json restored to DEV target)'
}
