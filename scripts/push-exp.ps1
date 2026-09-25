# push-exp.ps1 - push the CURRENT BRANCH to the EXPERIMENTAL Apps Script project
# and bump its versioned /exec deployment.
#
# Third environment beside DEV and PROD: a separate script project bound to
# DEV_SF_SYSTEM_MASTER (so it shares the DEV sheets, DEV folders and the
# Pipedrive fake) with its own /exec URL. A design or workflow experiment lives
# there without stomping DEV's HEAD. See docs/dev-environment.md "EXPERIMENTAL".
#
# Never touches PROD: the clasp target is pinned to .clasp.exp.json through
# clasp's --project flag, so .clasp.json (DEV) is never swapped or restored.
# PowerShell 5.1 compatible; pure ASCII (5.1 reads BOM-less scripts as ANSI).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$EXP_PROJECT_FILE = '.clasp.exp.json'
# Minted once with:  clasp -P .clasp.exp.json deploy -d "experimental"
# Same deployment id = same URL, new version on every push.
$EXP_WEBAPP_DEPLOYMENT_ID = 'REPLACE_WITH_EXP_DEPLOYMENT_ID'

# -- Gate 1: not main, no uncommitted tracked changes --------------------------
# main belongs to DEV (clasp push) and PROD (promote.ps1). Experiments come from
# a branch, and the deployment description records branch + SHA, so the tree
# must be committed for that label to mean anything.
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -eq 'main') { throw 'Refusing: on main. Push experiments from an exp/ or feature branch.' }
if (git status --porcelain --untracked-files=no) { throw 'Refusing: tracked changes are uncommitted. Commit first.' }

# -- Gate 2: the EXP target is real, is not PROD, and is registered in ENV_IDS --
if (-not (Test-Path $EXP_PROJECT_FILE)) { throw "Refusing: $EXP_PROJECT_FILE is missing." }
$expId = (Get-Content $EXP_PROJECT_FILE -Raw | ConvertFrom-Json).scriptId
if ($expId -like 'REPLACE*') { throw "Refusing: $EXP_PROJECT_FILE still holds the placeholder scriptId." }
$prodId = (Get-Content .clasp.prod.json -Raw | ConvertFrom-Json).scriptId
if ($expId -eq $prodId) { throw "Refusing: $EXP_PROJECT_FILE points at PROD." }
if (-not (Select-String -Path Code.gs -Pattern ([regex]::Escape($expId)) -Quiet)) {
    throw "Refusing: EXP scriptId $expId is not in ENV_IDS (Code.gs Section 1) - the pushed code would throw at load."
}

# -- Push ---------------------------------------------------------------------
$sha = (git log -1 --format='%h').Trim()
Write-Host ('Pushing ' + $branch + ' @ ' + $sha + ' to EXPERIMENTAL (' + $expId + ')')
clasp -P $EXP_PROJECT_FILE push -f
if ($LASTEXITCODE -ne 0) { throw "clasp push FAILED (exit $LASTEXITCODE)." }

# -- Bump the versioned /exec deployment ---------------------------------------
if ($EXP_WEBAPP_DEPLOYMENT_ID -like 'REPLACE*') {
    Write-Host 'Code pushed (HEAD / the /dev test URL is current).'
    Write-Host 'No /exec deployment id is recorded yet. Mint one once:'
    Write-Host '  clasp -P .clasp.exp.json deploy -d "experimental"'
    Write-Host 'then paste its id into $EXP_WEBAPP_DEPLOYMENT_ID in scripts/push-exp.ps1.'
    exit 0
}
clasp -P $EXP_PROJECT_FILE redeploy $EXP_WEBAPP_DEPLOYMENT_ID -d ('exp ' + $branch + ' ' + $sha)
if ($LASTEXITCODE -ne 0) {
    throw "clasp redeploy FAILED (exit $LASTEXITCODE) - code IS pushed (HEAD / the /dev URL is current) but the EXP /exec URL still serves the OLD version. Re-run, or bump manually in the EXP script editor: Deploy > Manage deployments > edit > New version."
}
Write-Host ''
Write-Host 'EXPERIMENTAL updated (code push + /exec deployment bump).'
