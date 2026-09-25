# promote.ps1 - guarded PROD deploy for GAS ShortCut OPS. Nick-run, interactive.
# `clasp push` from this repo always targets DEV (.clasp.json); this script is
# the ONLY path to prod. Pipeline: docs/promote-checklist.md
# PowerShell 5.1 compatible; pure ASCII (5.1 reads BOM-less scripts as ANSI).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

# The versioned PROD web-app deployment (the fullscreen /exec URL users open).
# clasp push only updates HEAD (the sheet menu/modal); the /exec URL serves this
# deployment's pinned version, so every promote must also bump it to a new
# version. Same deployment id = same URL, new code.
$PROD_WEBAPP_DEPLOYMENT_ID = 'AKfycbwB_wXCfnBEJCwM-bN6lO_HYtzeFI5J2e-EdURk5y-V0ZrfZ9qetotggbIE28Ez6pkI'

# -- Gate 1: main branch, clean tree, synced with origin/main ----------------
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -ne 'main') { throw "Refusing: on branch '$branch', not main." }

if (git status --porcelain) { throw 'Refusing: working tree is not clean.' }

git fetch origin | Out-Null
$head   = (git rev-parse HEAD).Trim()
$remote = (git rev-parse origin/main).Trim()
if ($head -ne $remote) { throw "Refusing: HEAD ($head) != origin/main ($remote). Push/pull first." }

# -- Gate 1.5: offline test harness must be green ------------------------------
node test/run-tests.js
if ($LASTEXITCODE -ne 0) { throw 'Refusing: test harness is red (node test/run-tests.js).' }

# -- Gate 1.6: the manifest is still the domain-restricted desk ---------------
# The desk-API spike (docs/spike-separate-frontend.md) flips appsscript.json to
# executeAs USER_DEPLOYING + access ANYONE so the EXP /exec can serve JSON to a
# frontend on our own origin. That manifest must never reach PROD: every request
# would run as the deploying account and the desk would be open to the internet.
# Belt and braces: the PROD ENV_IDS entry must not carry apiEnabled: true either
# (the router refuses without it, so a mistaken promote would still serve nothing).
$manifest = Get-Content appsscript.json -Raw | ConvertFrom-Json
$webapp = $manifest.webapp
if (-not $webapp) { throw 'Refusing: appsscript.json has no webapp block.' }
if ($webapp.access -ne 'DOMAIN') {
    throw ('Refusing: appsscript.json webapp.access is "' + $webapp.access + '", not DOMAIN (spike manifest on main?).')
}
if ($webapp.executeAs -ne 'USER_ACCESSING') {
    throw ('Refusing: appsscript.json webapp.executeAs is "' + $webapp.executeAs + '", not USER_ACCESSING (spike manifest on main?).')
}
$code = Get-Content Code.gs -Raw
$prodId = (Get-Content .clasp.prod.json -Raw | ConvertFrom-Json).scriptId
$prodAt = $code.IndexOf("'" + $prodId + "'")                        # first hit = the ENV_IDS key (Section 1)
$blockEnd = if ($prodAt -ge 0) { $code.IndexOf("`n  }", $prodAt) } else { -1 }   # closing brace of that entry
if ($prodAt -lt 0 -or $blockEnd -lt 0) { throw 'Refusing: could not locate the PROD ENV_IDS entry in Code.gs Section 1.' }
if ($code.Substring($prodAt, $blockEnd - $prodAt) -match 'apiEnabled\s*:\s*true') {
    throw 'Refusing: the PROD ENV_IDS entry in Code.gs carries apiEnabled: true.'
}

# -- Show what is about to ship -----------------------------------------------
Write-Host ''
Write-Host ('Promoting: ' + (git log -1 --format='%h %s'))
Write-Host '--- CHANGELOG.md [Unreleased] (top) ---'
$lines = Get-Content CHANGELOG.md
$hit = $lines | Select-String -Pattern '^## \[Unreleased\]' | Select-Object -First 1
if ($hit) {
    $start = $hit.LineNumber                      # 1-based -> first line AFTER the header
    $end   = [Math]::Min($start + 14, $lines.Count - 1)
    $lines[$start..$end] | ForEach-Object { Write-Host $_ }
} else {
    Write-Host '(no [Unreleased] section found)'
}
Write-Host '---------------------------------------'

# -- Gate 2: typed confirmation (case-sensitive) ------------------------------
$answer = Read-Host 'Type PROMOTE to push main to PROD'
if ($answer -cne 'PROMOTE') { Write-Host 'Aborted - nothing pushed.'; exit 1 }

# -- Push to prod; ALWAYS restore the DEV clasp target ------------------------
try {
    Copy-Item .clasp.prod.json .clasp.json -Force
    clasp push -f
    if ($LASTEXITCODE -ne 0) {
        throw "clasp push FAILED (exit $LASTEXITCODE) - PROD may be partially updated. Investigate before re-running."
    }

    # Bump the versioned /exec web-app deployment to the just-pushed code.
    $sha = (git log -1 --format='%h').Trim()
    clasp deploy --deploymentId $PROD_WEBAPP_DEPLOYMENT_ID --description "promote $sha"
    if ($LASTEXITCODE -ne 0) {
        throw "clasp deploy FAILED (exit $LASTEXITCODE) - code IS pushed (menu/modal live) but the /exec web app still serves the OLD version. Re-run promote, or bump manually: script editor > Deploy > Manage deployments > edit > New version."
    }

    Write-Host ''
    Write-Host 'PROD updated (code push + /exec deployment bump).'
    Write-Host 'Run the prod SPA smoke: open the fullscreen web app, one read-only flow.'
} finally {
    # Delete first: Copy-Item preserves the source mtime, so if the two clasp
    # jsons ever match in size git's stat cache sees .clasp.json as unchanged
    # and checkout no-ops (bit the lot-scan twin 2026-07-14).
    Remove-Item .clasp.json -Force
    git checkout -- .clasp.json
    Write-Host '(.clasp.json restored to DEV target)'
}
