# Design note — spike: a separate desktop frontend over the Apps Script backend

2026-09-25. Branch `exp/ui-playground` → new branch `spike/desk-api`. Targets the
EXPERIMENTAL script only. One page. Approval needed before any Code.gs change
(plan-then-approve) — this note is that plan.

## Problem

The Order Desk client lives inside HtmlService: a sandboxed iframe on a Google
URL. That costs native controls (the CustomSelect layer exists only to fight
it), real dialogs, clipboard and file APIs, install-to-desktop, a custom
domain, and modern tooling. Nick wants to know whether a frontend on our own
origin is possible, worth it, and free — for the DESK (the scanner stays as is).

## What the spike proves (definition of done)

From a GitHub Pages URL on a laptop, an operator signs in with a Silver Fox
Google account and completes one real flow against the DEV sheets: today's
queue → open Bommarito → Pre-fill from CAO → Run → finalize as **Test order** →
Open output folder. Two negatives: an account not on the allowlist is refused
with a clear message; the same request against the PROD script id is refused.
Nothing else is ported.

## Options for the transport + identity (the only real decision)

**A. Keep the domain-restricted web app and call it cross-origin.** Would
need the user's Google cookies on a cross-site fetch through a redirect chain;
third-party-cookie rules make this unreliable. Rejected.

**B. Execute-as-owner web app + our own token check (recommended).** The API
deployment runs as Nick, open to "anyone with the link", and every request
carries a Google ID token from the frontend's sign-in. The server verifies
the token (Google's tokeninfo endpoint), checks the email against an
allowlist, and only then dispatches. This is the standard pattern for
Apps-Script-as-API; identity is a verified email, not a shared key — which
answers the objection that killed the scanner PWA.

**C. Per-installer API key.** Loses identity. Rejected (same reason as before).

## Design (option B)

**Server — `Code.gs`, one new section, ~150 lines, EXP only at first**
- `doPost(e)`: body is JSON `{fn, args, idToken}` sent as `text/plain` (no CORS
  preflight — Apps Script can't answer OPTIONS); response is
  `ContentService` JSON. Errors return `{ok:false, error}` with the message
  the client shows; never a stack.
- Gate order: `ENV.apiEnabled === true` (set ONLY on the exp `ENV_IDS` entry)
  → token present → tokeninfo says `email_verified`, `aud` = our OAuth client
  id, not expired → email in `API_ALLOWLIST` (script property, lowercase,
  comma-separated) → `fn` in an explicit `API_FUNCTIONS` map (never arbitrary
  globals). Verified tokens are cached in `CacheService` by hash for their
  remaining lifetime, so a session costs one tokeninfo fetch per hour.
- Identity context: `API_CTX = {email}` set before dispatch. The four places
  that ask `Session.getActiveUser()` (`runDraftEmail_` for drafts, the two
  inbox "by" stamps, the EOM finalize stamp) read `API_CTX.email` first. Per-
  user preferences (theme, nav, last user) move client-side: a real origin has
  persistent storage, so the three `getUserProperties` pairs are simply not
  in the map.
- `API_FUNCTIONS` for the spike: the read calls the queue and workspace use
  today plus `getCaoVins`, `pasteVinsAndRun`, `getRunProgress`,
  `clearRunProgress`, `finalizeRun` (test), `abandonRun`, `getMyRunDrafts`,
  `saveRunDraft`, `deleteRunDraft`. Names only; the functions are untouched.

**Manifest + gates.** `appsscript.json` on the spike branch sets `webapp` to
`executeAs: USER_DEPLOYING`, `access: ANYONE`. Because the manifest is shared,
two guards: `promote.ps1` refuses to promote while the manifest says `ANYONE`
(a new Gate 1.6), and the router refuses when `ENV.apiEnabled` is not true —
so even a mistaken promote serves nothing from PROD. The EXP `/exec` becomes
the API; the HtmlService desk keeps working on the same script (doGet
unchanged).

**Frontend — `desk/`, Vite + TypeScript, no framework for the spike.**
Sign-in with Google Identity Services (one script tag, free); a 40-line
`api.ts` (`call(fn, args)` = `fetch(EXEC_URL, {method:'POST', body, redirect:
'follow'})`); the rebuilt Run Order markup/CSS and the shell's tokens carried
over, `google.script.run` swapped for `call()`, CustomSelect deleted. Hosted
by GitHub Pages from a build workflow (free, HTTPS, subdomain of
sfoxmarketing.com optional). Progress polling and the `Date`-free response
shapes carry over unchanged.

## Nick's steps (all free)

1. Google Cloud console: create an OAuth client id (Web), authorized origin =
   the Pages origin. Paste the id into the EXP script property
   `API_OAUTH_CLIENT_ID`; put the crew's emails in `API_ALLOWLIST`.
2. Redeploy the EXP web app once after the manifest change and authorize it
   as yourself (execute-as-owner needs the owner's one-time consent).
3. Push the spike branch so the Pages workflow can publish `desk/dist`.

## Costs, risks, ceilings

- Every API call is one Apps Script execution under Nick's quota (30 parallel,
  ~90 min/day total execution) — fine for a small crew; watch it if usage
  grows. Latency is unchanged (1–4 s per call); no offline runs.
- "Anyone with the link" is only as safe as the token check + allowlist +
  function map + env gate. All four are in the spike's definition of done.
- Two deployables to keep in step (Pages build, EXP API version).
- USER_PROFILES has no email column; the allowlist lives in a script property
  for the spike. Phase 2 candidate: append `google_email` (col D) and drive
  both the allowlist and "Running as" from it.
- Out of scope: porting the other views, theming, config screens, the
  scanner, PROD, the Sheets-menu modal (it keeps the HtmlService desk).

## Increments (critical path 1 → 2 → 4 → 5)

1. Branch + manifest + `apiEnabled` on the exp env + promote Gate 1.6.
2. Router + token check + function map + identity context; unit-testable
   offline (harness fixture for tokeninfo) and live with a curl and a real token.
3. `desk/` shell: sign-in, `api.ts`, tokens/CSS, queue rail.
4. Order flow: dealer → CAO → run → test finalize → folder link.
5. Pages workflow + live proof against DEV + write-up (keep / extend / stop).

## Transport decision — 2026-09-25 (evening)

Option B was built end to end (manifest, `apiEnabled`, promote Gate 1.6,
`doPost` router + tokeninfo check + allowlist + function map, 14-test harness
suite) and then refused at push time by the Workspace domain policy:

    clasp push → "ANYONE access has been disabled by your domain administrator."

An open web app is not available on this domain, so option B is dead here
regardless of the token check. Option A is dead too (a credentialed
cross-origin fetch cannot pair with the `ACAO: *` that Apps Script returns).

**Chosen: option D — the Apps Script Execution API** (`scripts.run`). The desk
signs the user in with the GIS token client requesting the script's own scopes
(imported from `appsscript.json`), then calls
`https://script.googleapis.com/v1/scripts/<EXP id>:run` with the bearer token.
Every function runs **as that user** — exactly the trust model of
`google.script.run` today — so there is no open web app, no allowlist, no
router and no identity context to maintain. What it needs instead: the EXP
script linked to a standard Google Cloud project that also holds the OAuth
client and has the Apps Script API enabled, plus an "API executable"
deployment (EXP only). The per-user consent screen lists the script's scopes
once. Cost: the same per-execution quota as before; latency unchanged.

Server side after the pivot: `appsscript.json` gains `executionApi: DOMAIN`
+ explicit `oauthScopes`; `Code.gs` gains only `deskWhoAmI()`; the harness
guards scope drift both ways. Option B's code is in git history
(`b79b557`, `a3c8407`) if the policy ever changes.

## Progress

| # | Increment | State |
|---|---|---|
| 1 | Manifest + env gate + promote gate | superseded: manifest = `executionApi` + `oauthScopes` (harness `manifest scopes` suite) |
| 2 | Router + token check + function map + identity | superseded: not needed with the Execution API; `deskWhoAmI()` only |
| 3 | `desk/` shell: sign-in, `api.ts`, tokens/CSS, queue rail | done offline (GIS token client + `scripts.run` client) |
| 4 | Order flow: dealer → CAO → run → test finalize → folder link | **live 2026-09-29/30** from localhost against EXP + DEV sheets: sign-in, queue, CAO pre-fill, run to completion (BMW of West St. Louis, 21 VINs). Also verified offline by the mocked smoke walk |
| 5 | Pages workflow + live proof against DEV + write-up | workflow in place; localhost proof done; **Pages publish, negatives and write-up pending** (steps 8–10) |

## Live proof — Nick's checklist (in order)

Done through step 7 on 2026-09-29/30. Two things that bit: the client id
must be copied from the Credentials page (the address-bar copy carried a
`?project=…` suffix → "OAuth client was not found"); and an Apps Script
editor tab opened before a push saves its stale copy over HEAD when you use
the Deploy dialog — reload the tab first. The Sheets-based desk on EXP shares
the project link, so it needs the same two APIs enabled.

1. **Cloud project.** console.cloud.google.com → project picker → New
   project, e.g. `silverfox-desk`. Note the **project number** (Dashboard).
2. **Enable two APIs.** In that project: APIs & Services → Library → enable
   **Apps Script API** and **Google Drive API**. Drive is needed because the
   script declares the advanced Drive service; Google's default hidden
   project enabled it automatically, a standard project does not (first live
   run failed with "Permission denied while enabling APIs: drive").
3. **Consent screen.** APIs & Services → OAuth consent screen → User type
   **Internal** → app name "SilverFox desk", your email → Save (no scopes
   need listing for an internal app).
4. **OAuth client.** Credentials → Create credentials → OAuth client ID →
   Web application. Authorized JavaScript origins:
   `http://localhost:5173` and `https://silver-fox-marketing-stl.github.io`.
   No redirect URIs. Copy the client id.
5. **Link the EXP script.** EXP script editor → Project Settings (gear) →
   "Google Cloud Platform (GCP) Project" → Change project → paste the
   project number → Set project.
6. **Push + deploy.** From `spike/desk-api`: `scripts/push-exp.ps1`
   (this now succeeds — the manifest is domain-restricted again). Then in
   the editor: Deploy → New deployment → type **API executable** → access
   "Anyone within Silver Fox" (DOMAIN) → Deploy. Once is enough: with
   `VITE_DEV_MODE=true` the desk runs HEAD, so later pushes need no new
   version while iterating.
7. **Local run.** `cd desk` → `Copy-Item .env.example .env.local` → paste
   the client id → `npm install` → `npm run dev` → http://localhost:5173 →
   Sign in with Google → allow the listed scopes → the chip should read
   **EXP · nvenable@sfoxmarketing.com**. Then: Bommarito from the queue →
   Pre-fill from CAO → Run → Log as test order → Open output folder.
8. **Negatives.** A non-Silver-Fox Google account is refused by Google at
   sign-in (internal app). Point `VITE_SCRIPT_ID` at PROD's id → 404/403
   (no API-executable deployment there).
9. **Pages.** Repo Settings → Pages → Source "GitHub Actions"; Settings →
   Secrets and variables → Actions → Variables: `DESK_SCRIPT_ID`,
   `DESK_GOOGLE_CLIENT_ID`. `git push -u origin spike/desk-api`. Site:
   https://silver-fox-marketing-stl.github.io/GAS-OPS-V2/ (the Pages build
   uses `VITE_DEV_MODE=false`, i.e. the API-executable version — bump it in
   Manage deployments after each push you want live there).
10. Write-up: keep / extend / stop, appended here.
