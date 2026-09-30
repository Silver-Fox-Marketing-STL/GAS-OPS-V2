# Handoff — 2026-09-30 — desk spike (`spike/desk-api`), parked

Read this first when resuming the desk spike. It supersedes the spike parts of
`docs/handoff-2026-09-25-order-desk.md` (that file's Order Desk rebuild notes
still stand). Nick parked this to work on other things first.

## One-paragraph state

A separate desktop frontend (`desk/`, Vite + TypeScript) now drives the Apps
Script backend through the **Apps Script Execution API** (`scripts.run`), as
the signed-in Google user. **Proven live from localhost on 2026-09-30**: sign
in → work queue → open dealer → Pre-fill from CAO → run to completion (BMW of
West St. Louis, 21 VINs) against the EXPERIMENTAL script and the DEV sheets.
Not yet done: the test-finalize + folder-link clicks were not confirmed, the
GitHub Pages publish, the negative check, and the keep / extend / stop
decision. PROD and DEV were never touched.

## Where things are

| Thing | State |
|---|---|
| `spike/desk-api` | pushed to origin 2026-09-30. Off `exp/ui-playground` (`4e79a0e`). Not merged anywhere. |
| `main`, `exp/ui-playground` | pushed, unchanged since 2026-09-25. PROD is still the 2026-09-23 promote. |
| EXP script | HEAD = the spike branch (re-pushed 2026-09-29 after a stale editor tab overwrote it). `/exec` deployment at version 13. **API executable deployment "Silverfox-desk" still points at stale version 12** — bump it (New version) before the Pages site is used. |
| Google Cloud | project `silverfox-desk` (number `932631831178`), EXP script linked to it. Enabled: Apps Script API, Google Drive API. OAuth consent screen Internal. Web OAuth client created. |
| Tests | harness `node test/run-tests.js` 141/141 (incl. `manifest scopes` suite). Desk: `npm run build` clean. |
| Untracked, pre-existing, not part of this work | `AGENTS.md`, `docs/system-audit-handoff-2026-07-23.md`. |

## Setting up the other machine

1. `git fetch origin && git checkout spike/desk-api`
2. `cd desk && npm install`
3. Create `desk/.env.local` (git-ignored, so it does not travel). Copy
   `desk/.env.example` and set the client id. Both values are public by design:
   ```
   VITE_SCRIPT_ID=1P8oMEhR0xpljFLCGnzEJQRGSs38aju2VUiUy0HIj3imB-Hopt26hD3Ha
   VITE_GOOGLE_CLIENT_ID=932631831178-tddi1kv0f6ikr0legrjt06dg5l49omid.apps.googleusercontent.com
   VITE_DEV_MODE=true
   ```
4. `npm run dev` → http://localhost:5173 → Sign in with Google. The chip
   should read `EXP · nvenable@sfoxmarketing.com`.
5. Only needed to push code to EXP from that machine: `clasp login`, then
   `scripts/push-exp.ps1` from the branch.

## What was decided and why

- **Transport = Execution API, not an open web app.** The first design (web app
  executing as owner, open to "anyone", with our own Google ID-token check,
  allowlist and function map) was fully built and harness-tested, then refused
  at push: *"ANYONE access has been disabled by your domain administrator."*
  The Workspace policy forbids open web apps, so that design cannot exist on
  this domain. It was backed out; the code is in git history (`b79b557`,
  `a3c8407`) if the policy ever changes.
- **Consequences of the Execution API.** Functions run as the signed-in user,
  the same trust model as `google.script.run`. No router, allowlist, or token
  check on the server. The server delta is tiny: `appsscript.json` gained
  `executionApi: DOMAIN` + explicit `oauthScopes`; `Code.gs` gained only
  `deskWhoAmI()` (Section 36). The desk imports the scope list from
  `appsscript.json`, so the two cannot drift; the harness fails if the code
  uses a Google service whose scope is missing, or lists an unused scope.
- **Spike scope is enforced client-side only now.** `desk/src/order.ts` passes
  dealId `'test'` to `finalizeRun`. Nothing on the server stops a caller from
  passing a real deal id — fine for a spike, a real decision if extended.

## What is left, in order

1. In the desk, finish an order: **Log as test order** → **Open output
   folder**. Confirms the last two steps of the flow live.
2. **Pages publish.** Repo Settings → Pages → Source "GitHub Actions";
   Actions variables `DESK_SCRIPT_ID`, `DESK_GOOGLE_CLIENT_ID` (same values as
   `.env.local`). Reload the EXP editor tab, then Deploy → Manage deployments →
   edit "Silverfox-desk" → New version (the Pages build uses that deployment,
   `VITE_DEV_MODE=false`). Re-run the `desk-pages` workflow. The first push of
   the branch already triggered one run; it fails at deploy until Pages is on.
3. **Negative check.** Sign in with a non-Silver-Fox Google account → Google
   refuses at sign-in (internal app).
4. **Decision: keep / extend / stop**, written at the end of
   `docs/spike-separate-frontend.md`.

Known costs for that decision: a one-time per-user Google consent screen
listing the script's scopes; more setup than the Sheets-based desk (Cloud
project, two APIs, a separate deployment to bump); extending means porting
real finalize, Pipedrive push, VIN-log commit, drafts resume, edit columns,
and the inspector. Known gains: native selects and dialogs (no CustomSelect
layer), real storage, own origin, modern tooling, free hosting.

## Gotchas that bit (do not repeat)

- **Stale editor tab overwrites HEAD.** An Apps Script editor tab opened
  before a `clasp push` saves its old in-memory files over HEAD when you use
  the Deploy dialog. Reload the tab before touching the editor. Symptom:
  `Script function not found: deskWhoAmI` though the push succeeded. Verify by
  `clasp pull` into a scratch folder, never by assumption.
- **Standard Cloud project = enable APIs by hand.** The advanced Drive service
  needs the Google Drive API enabled in the linked project. Symptom:
  `Permission denied while enabling APIs: drive for GCP project …`. This also
  affects the Sheets-based desk on EXP, since the link is per script.
- **Copy the client id from the Credentials page**, not the address bar (a
  `?project=…` suffix → "The OAuth client was not found", error 401).
- **`runDealer` returns `null` on failure** and records the reason in the run
  progress record. Read `getRunProgress` before `clearRunProgress`.
- **A failed cross-origin call looks like "network".** A 401 login page has no
  CORS header, so the browser hides the status. Probe with `curl` to see it.
- **Line endings.** Most repo files are CRLF on disk (autocrlf); a
  `grep $'\r'` test in Git Bash wrongly reports LF. Check with Node and make
  patch scripts match the file's own line ending.
- `.gitignore` line 24 (`.env*`) also matches `desk/.env.example`; it is
  force-added.
- `clasp logs` does not work for EXP without extra setup; surface server
  errors in the client instead.

## Key files

`docs/spike-separate-frontend.md` (design, transport decision, progress table,
10-step live-proof checklist) · `desk/src/{main,auth,api,queue,order}.ts` ·
`desk/.env.example` · `.github/workflows/desk-pages.yml` · `appsscript.json` ·
`Code.gs` Section 36 · `test/run-tests.js` (`manifest scopes` suite) ·
`docs/dev-environment.md` (EXPERIMENTAL section) · `CHANGELOG.md` [Unreleased].

## Commits on the branch (oldest first)

`b79b557` `a3c8407` `708bf2c` `5a68e6d` — first transport, superseded ·
`13da9af` — Execution API pivot · `f7b2709` — failed-run reason fix ·
`438616a` — live proof recorded · this handoff.
